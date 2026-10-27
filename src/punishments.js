import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  deactivateBanRecord,
  getExpiredBans,
  recordModerationAction,
} from './database.js';

export const PUNISHMENT_COMMANDS = new Set(['ban', 'unban', 'mute', 'unmute', 'kick']);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 28 * DAY_MS;
const MAX_BAN_MS = 3650 * DAY_MS;
const CLEAR_MESSAGES_SECONDS = 3 * 24 * 60 * 60;
const DEFAULT_REASON = 'Не указана';
const UNKNOWN_BAN_CODE = 10026;

const PERMANENT_WORDS = new Set(['perm', 'permanent', 'forever', 'навсегда', 'перм', '0']);

const UNITS = [
  [['секунд', 'сек', 'sec', 's', 'с'], 1000],
  [['мин', 'min', 'm', 'м'], 60 * 1000],
  [['час', 'hour', 'h', 'ч'], 60 * 60 * 1000],
  [['дней', 'дня', 'день', 'дн', 'day', 'd', 'д'], DAY_MS],
  [['нед', 'week', 'w', 'н'], 7 * DAY_MS],
];
const UNIT_MS = new Map(UNITS.flatMap(([aliases, ms]) => aliases.map((alias) => [alias, ms])));
const UNIT_ALTERNATION = [...UNIT_MS.keys()].sort((a, b) => b.length - a.length).join('|');

export function parseDuration(input) {
  const text = input.trim().toLowerCase();
  if (PERMANENT_WORDS.has(text)) return { permanent: true };

  const pattern = new RegExp(`(\\d+)\\s*(${UNIT_ALTERNATION})`, 'gu');
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return null;
  if (text.replace(pattern, '').trim() !== '') return null;

  const ms = matches.reduce((sum, [, amount, unit]) => sum + Number(amount) * UNIT_MS.get(unit), 0);
  if (!Number.isSafeInteger(ms) || ms <= 0) return null;
  return { ms };
}

function formatDuration(ms) {
  const parts = [];
  let rest = Math.round(ms / 1000);
  for (const [label, size] of [['д', 86400], ['ч', 3600], ['мин', 60], ['сек', 1]]) {
    const value = Math.floor(rest / size);
    if (value) parts.push(`${value} ${label}`);
    rest -= value * size;
  }
  return parts.join(' ') || '0 сек';
}

function discordTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

function auditReason(interaction, reason) {
  return `${interaction.user.tag}: ${reason}`.slice(0, 512);
}

const EMBED_COLOR = 0x2b2d31;

function userLine(user) {
  return `${user.id} | <@${user.id}>`;
}

function resultEmbed(title, interaction, user, fields) {
  const { guild } = interaction;
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Пользователь', value: userLine(user) },
      { name: 'Модератор', value: userLine(interaction.user) },
      ...fields,
      { name: 'Дата', value: `<t:${Math.floor(Date.now() / 1000)}:F>` },
    )
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined });
}

async function announce(interaction, embed) {
  await interaction.editReply({ embeds: [embed] });
}

async function fail(interaction, content) {
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  await interaction.deleteReply().catch(() => {});
}

async function fetchMember(interaction, userId) {
  return interaction.guild.members.fetch(userId).catch(() => null);
}

function baseTargetError(interaction, user) {
  if (user.id === interaction.user.id) return 'Нельзя применить это действие к самому себе.';
  if (user.id === interaction.client.user.id) return 'Нельзя применить это действие к боту.';
  return null;
}

function hierarchyError(interaction, targetMember) {
  if (!targetMember) return null;
  const { guild } = interaction;
  if (targetMember.id === guild.ownerId) return 'Нельзя применять наказания к владельцу сервера.';
  if (interaction.user.id !== guild.ownerId
    && interaction.member.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
    return 'Высшая роль этого участника не ниже вашей — действие запрещено.';
  }
  return null;
}

async function sendDirectMessage(user, guildName, title, fields) {
  try {
    const message = await user.send({
      embeds: [new EmbedBuilder()
        .setTitle(title)
        .setDescription(`Сервер: **${guildName}**`)
        .addFields(fields)
        .setColor(0xed4245)
        .setTimestamp()],
    });
    return () => message.delete().catch(() => {});
  } catch {
    return null;
  }
}

async function requirePermissions(interaction, flag, label) {
  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  if (!botMember.permissions.has(flag)) {
    await fail(interaction, `У бота нет права «${label}».`);
    return false;
  }
  return true;
}

async function handleBan(interaction) {
  if (!await requirePermissions(interaction, PermissionFlagsBits.BanMembers, 'Банить участников')) return;

  const user = interaction.options.getUser('user', true);
  const timeInput = interaction.options.getString('time', true);
  const reason = interaction.options.getString('reason', true).trim() || DEFAULT_REASON;
  const clearMessages = interaction.options.getString('clear_messages', true) === 'yes';

  const targetError = baseTargetError(interaction, user);
  if (targetError) return fail(interaction, targetError);

  const duration = parseDuration(timeInput);
  if (!duration) {
    return fail(interaction, 'Неверный срок. Примеры: `30m`, `2h`, `7d`, `1w`, `1d12h` или `навсегда`.');
  }
  if (!duration.permanent && duration.ms > MAX_BAN_MS) {
    return fail(interaction, 'Максимальный срок бана — 3650 дней. Для бессрочного бана укажите `навсегда`.');
  }

  const existingBan = await interaction.guild.bans.fetch(user.id).catch(() => null);
  if (existingBan) return fail(interaction, 'Этот пользователь уже забанен.');

  const member = await fetchMember(interaction, user.id);
  const hierarchy = hierarchyError(interaction, member);
  if (hierarchy) return fail(interaction, hierarchy);
  if (member && !member.bannable) {
    return fail(interaction, 'Бот не может забанить этого участника: проверьте иерархию ролей.');
  }

  const expiresAtMs = duration.permanent ? null : Date.now() + duration.ms;
  const durationText = duration.permanent ? 'Навсегда' : formatDuration(duration.ms);

  const rollbackDm = await sendDirectMessage(user, interaction.guild.name, 'Вы забанены', [
    { name: 'Срок', value: durationText, inline: true },
    ...(expiresAtMs ? [{ name: 'Истекает', value: discordTime(expiresAtMs), inline: true }] : []),
    { name: 'Причина', value: reason },
  ]);

  try {
    await interaction.guild.members.ban(user.id, {
      reason: auditReason(interaction, reason),
      deleteMessageSeconds: clearMessages ? CLEAR_MESSAGES_SECONDS : 0,
    });
  } catch (error) {
    await rollbackDm?.();
    console.error('Could not ban user:', error);
    return fail(interaction, 'Не удалось выдать бан. Проверьте права и иерархию ролей бота.');
  }

  try {
    await recordModerationAction({
      guildId: interaction.guildId,
      action: 'ban',
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason,
      durationMs: duration.permanent ? null : duration.ms,
      expiresAtMs,
      clearedMessages: clearMessages,
    });
  } catch (error) {
    console.error('Ban applied but could not be recorded:', error);
    return fail(interaction, expiresAtMs
      ? 'Бан выдан, но не записан в БД — автоматического разбана по сроку не будет, снимите бан вручную.'
      : 'Бан выдан, но не записан в БД.');
  }

  await announce(
    interaction,
    resultEmbed('Бан пользователя', interaction, user, [
      { name: 'Срок', value: durationText },
      ...(expiresAtMs ? [{ name: 'Истекает', value: discordTime(expiresAtMs) }] : []),
      { name: 'Сообщения за 3 дня', value: clearMessages ? 'Удалены' : 'Не удалялись' },
      { name: 'Причина', value: reason },
    ]),
  );
}

async function handleUnban(interaction) {
  if (!await requirePermissions(interaction, PermissionFlagsBits.BanMembers, 'Банить участников')) return;

  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason')?.trim() || DEFAULT_REASON;

  const ban = await interaction.guild.bans.fetch(user.id).catch(() => null);
  if (!ban) return fail(interaction, 'Этот пользователь не забанен.');

  try {
    await interaction.guild.bans.remove(user.id, auditReason(interaction, reason));
  } catch (error) {
    console.error('Could not unban user:', error);
    return fail(interaction, 'Не удалось снять бан.');
  }

  try {
    await recordModerationAction({
      guildId: interaction.guildId,
      action: 'unban',
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason,
    });
  } catch (error) {
    console.error('Unban applied but could not be recorded:', error);
  }

  await announce(
    interaction,
    resultEmbed('Разбан пользователя', interaction, user, [
      { name: 'Причина', value: reason },
    ]),
  );
}

async function handleMute(interaction) {
  if (!await requirePermissions(interaction, PermissionFlagsBits.ModerateMembers, 'Модерировать участников')) return;

  const user = interaction.options.getUser('user', true);
  const timeInput = interaction.options.getString('time', true);
  const reason = interaction.options.getString('reason', true).trim() || DEFAULT_REASON;

  const targetError = baseTargetError(interaction, user);
  if (targetError) return fail(interaction, targetError);

  const duration = parseDuration(timeInput);
  if (!duration || duration.permanent) {
    return fail(interaction, 'Неверный срок. Примеры: `10m`, `2h`, `7d`, `1d12h`. Максимум — 28 дней.');
  }
  if (duration.ms > MAX_TIMEOUT_MS) {
    return fail(interaction, 'Максимальный срок мута — 28 дней (ограничение Discord).');
  }

  const member = await fetchMember(interaction, user.id);
  if (!member) return fail(interaction, 'Участник не найден на сервере.');

  const hierarchy = hierarchyError(interaction, member);
  if (hierarchy) return fail(interaction, hierarchy);
  if (!member.moderatable) {
    return fail(interaction, 'Бот не может замутить этого участника: проверьте иерархию ролей (администраторам тайм-аут выдать нельзя).');
  }

  const expiresAtMs = Date.now() + duration.ms;
  const rollbackDm = await sendDirectMessage(user, interaction.guild.name, 'Вам выдан мут', [
    { name: 'Срок', value: formatDuration(duration.ms), inline: true },
    { name: 'Истекает', value: discordTime(expiresAtMs), inline: true },
    { name: 'Причина', value: reason },
  ]);

  try {
    await member.timeout(duration.ms, auditReason(interaction, reason));
  } catch (error) {
    await rollbackDm?.();
    console.error('Could not mute member:', error);
    return fail(interaction, 'Не удалось выдать мут.');
  }

  await recordModerationAction({
    guildId: interaction.guildId,
    action: 'mute',
    targetId: user.id,
    moderatorId: interaction.user.id,
    reason,
    durationMs: duration.ms,
    expiresAtMs,
  }).catch((error) => console.error('Mute applied but could not be recorded:', error));

  await announce(
    interaction,
    resultEmbed('Мут пользователя', interaction, user, [
      { name: 'Срок', value: formatDuration(duration.ms) },
      { name: 'Истекает', value: discordTime(expiresAtMs) },
      { name: 'Причина', value: reason },
    ]),
  );
}

async function handleUnmute(interaction) {
  if (!await requirePermissions(interaction, PermissionFlagsBits.ModerateMembers, 'Модерировать участников')) return;

  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason')?.trim() || DEFAULT_REASON;

  const member = await fetchMember(interaction, user.id);
  if (!member) return fail(interaction, 'Участник не найден на сервере.');
  if (!member.isCommunicationDisabled()) {
    return fail(interaction, 'У этого участника нет активного мута.');
  }
  if (!member.moderatable) {
    return fail(interaction, 'Бот не может снять мут с этого участника: проверьте иерархию ролей.');
  }

  try {
    await member.timeout(null, auditReason(interaction, reason));
  } catch (error) {
    console.error('Could not unmute member:', error);
    return fail(interaction, 'Не удалось снять мут.');
  }

  await recordModerationAction({
    guildId: interaction.guildId,
    action: 'unmute',
    targetId: user.id,
    moderatorId: interaction.user.id,
    reason,
  }).catch((error) => console.error('Unmute applied but could not be recorded:', error));

  await announce(
    interaction,
    resultEmbed('Снятие мута', interaction, user, [
      { name: 'Причина', value: reason },
    ]),
  );
}

async function handleKick(interaction) {
  if (!await requirePermissions(interaction, PermissionFlagsBits.KickMembers, 'Выгонять участников')) return;

  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true).trim() || DEFAULT_REASON;

  const targetError = baseTargetError(interaction, user);
  if (targetError) return fail(interaction, targetError);

  const member = await fetchMember(interaction, user.id);
  if (!member) return fail(interaction, 'Участник не найден на сервере.');

  const hierarchy = hierarchyError(interaction, member);
  if (hierarchy) return fail(interaction, hierarchy);
  if (!member.kickable) {
    return fail(interaction, 'Бот не может выгнать этого участника: проверьте иерархию ролей.');
  }

  const rollbackDm = await sendDirectMessage(user, interaction.guild.name, 'Вас выгнали с сервера', [
    { name: 'Причина', value: reason },
  ]);

  try {
    await member.kick(auditReason(interaction, reason));
  } catch (error) {
    await rollbackDm?.();
    console.error('Could not kick member:', error);
    return fail(interaction, 'Не удалось выгнать участника.');
  }

  await recordModerationAction({
    guildId: interaction.guildId,
    action: 'kick',
    targetId: user.id,
    moderatorId: interaction.user.id,
    reason,
  }).catch((error) => console.error('Kick applied but could not be recorded:', error));

  await announce(
    interaction,
    resultEmbed('Кик пользователя', interaction, user, [
      { name: 'Причина', value: reason },
    ]),
  );
}

const HANDLERS = {
  ban: handleBan,
  unban: handleUnban,
  mute: handleMute,
  unmute: handleUnmute,
  kick: handleKick,
};

export async function handlePunishmentCommand(interaction) {
  await HANDLERS[interaction.commandName](interaction);
}

export function startTempBanScheduler(client, guildId, intervalMs = 60_000) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const expired = await getExpiredBans(guildId, Date.now());
      if (!expired.length) return;
      const guild = await client.guilds.fetch(guildId);
      for (const row of expired) {
        try {
          await guild.bans.remove(row.target_id, 'Истёк срок временного бана');
        } catch (error) {
          if (error.code !== UNKNOWN_BAN_CODE) {
            console.error(`Could not auto-unban ${row.target_id}:`, error);
            continue;
          }
        }
        await deactivateBanRecord(row.id);
      }
    } catch (error) {
      console.error('Temp-ban scheduler failed:', error);
    } finally {
      running = false;
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}