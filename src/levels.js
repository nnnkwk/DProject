import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  MessageFlags,
} from 'discord.js';
import {
  countLevelTop,
  getBotSettings,
  getLevelRoles,
  getLevelSettings,
  getLevelTop,
  getUserLevel,
  getUserRank,
  updateUserLevel,
} from './database.js';
import { logEconomyAction } from './economy.js';
import { renderRankCard } from './rank-card.js';

export const LEVEL_COMMANDS = new Set(['exp', 'lvl', 'leaders', 'rank']);
export const PUBLIC_LEVEL_COMMANDS = new Set(['leaders', 'rank']);

const MAX_LEVEL = 1000;
const LEADERS_PAGE_SIZE = 10;
const CONFIG_CACHE_MS = 60_000;

const DEFAULT_SETTINGS = {
  message_exp_min: 15,
  message_exp_max: 25,
  message_cooldown_seconds: 60,
  voice_exp_per_minute: 10,
  keep_previous_roles: 0,
};

/** Сколько EXP нужно набрать на уровне `level`, чтобы перейти на следующий. */
export function expForNextLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

/** Весь набранный EXP: сумма порогов пройденных уровней плюс EXP на текущем. */
export function totalExpFor(level, exp) {
  const passed = level - 1;
  return (5 * passed * (passed + 1) * (2 * passed + 1)) / 6 + 25 * passed * (passed + 1) + 100 * passed + exp;
}

/* ---------- Конфигурация из БД (кэш на минуту) ---------- */

let configCache = { settings: DEFAULT_SETTINGS, roles: [], notifyChannelId: null, mainChatId: null, loadedAt: 0 };

async function loadConfig() {
  if (Date.now() - configCache.loadedAt < CONFIG_CACHE_MS) return configCache;
  const [settings, roles, botSettings] = await Promise.all([getLevelSettings(), getLevelRoles(), getBotSettings()]);
  configCache = {
    settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    roles,
    notifyChannelId: botSettings?.level_notify_channel ?? null,
    mainChatId: botSettings?.main_chat_id ?? null,
    loadedAt: Date.now(),
  };
  return configCache;
}

/* ---------- Расчёт уровня ---------- */

function applyExpDelta({ level, exp }, delta) {
  let newLevel = level;
  let newExp = exp + delta;
  while (newLevel < MAX_LEVEL && newExp >= expForNextLevel(newLevel)) {
    newExp -= expForNextLevel(newLevel);
    newLevel += 1;
  }
  while (newExp < 0 && newLevel > 1) {
    newLevel -= 1;
    newExp += expForNextLevel(newLevel);
  }
  newExp = Math.max(0, Math.min(newExp, expForNextLevel(newLevel) - 1));
  return { level: newLevel, exp: newExp };
}

function applyLevelDelta({ level, exp }, delta) {
  const newLevel = Math.max(1, Math.min(level + delta, MAX_LEVEL));
  return { level: newLevel, exp: Math.min(exp, expForNextLevel(newLevel) - 1) };
}

async function syncLevelRoles(member, level) {
  try {
    const { settings, roles } = await loadConfig();
    if (!roles.length) return [];
    const reached = roles.filter((entry) => entry.level <= level);
    const target = new Set(settings.keep_previous_roles
      ? reached.map((entry) => entry.role_id)
      : reached.slice(-1).map((entry) => entry.role_id));
    const toAdd = [...target].filter((id) => !member.roles.cache.has(id));
    const toRemove = roles
      .map((entry) => entry.role_id)
      .filter((id) => !target.has(id) && member.roles.cache.has(id));
    for (const roleId of toAdd) await member.roles.add(roleId, `Уровень ${level}`);
    for (const roleId of toRemove) await member.roles.remove(roleId, `Уровень ${level}`);
    return toAdd;
  } catch (error) {
    console.error(`Could not sync level roles for ${member.id}:`, error);
    return [];
  }
}

async function sendLevelUpNotification(member, before, after, addedRoleIds) {
  try {
    const { notifyChannelId } = await loadConfig();
    if (!/^\d{17,20}$/.test(notifyChannelId ?? '')) return;
    const channel = await member.guild.channels.fetch(notifyChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL({ size: 64 }) })
      .setTitle('🎉 Повышение уровня!')
      .setDescription(`${member} поднялся с **${before.level}** на **${after.level}** уровень.`)
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Текущий уровень', value: String(after.level), inline: true },
        { name: 'До следующего уровня', value: `${expForNextLevel(after.level) - after.exp} EXP`, inline: true },
      )
      .setFooter({ text: member.guild.name })
      .setTimestamp();
    if (addedRoleIds.length) {
      embed.addFields({ name: 'Новая роль', value: addedRoleIds.map((id) => `<@&${id}>`).join(' '), inline: true });
    }
    await channel.send({ content: `${member}`, embeds: [embed], allowedMentions: { users: [member.id] } });
  } catch (error) {
    console.error(`Could not send level-up notification for ${member.id}:`, error);
  }
}

async function changeUserLevel(member, compute) {
  const result = await updateUserLevel(member.id, compute);
  const addedRoleIds = await syncLevelRoles(member, result.after.level);
  if (result.after.level > result.before.level) {
    await sendLevelUpNotification(member, result.before, result.after, addedRoleIds);
  }
  return result;
}

export async function isMainChatMessage(message) {
  const { mainChatId } = await loadConfig();
  return Boolean(mainChatId) && message.channelId === mainChatId;
}

const lastMessageAward = new Map();

export async function handleMessageExp(message) {
  try {
    const { settings } = await loadConfig();
    const now = Date.now();
    if (now - (lastMessageAward.get(message.author.id) ?? 0) < settings.message_cooldown_seconds * 1000) return;
    if (lastMessageAward.size > 10_000) {
      for (const [userId, time] of lastMessageAward) {
        if (now - time > settings.message_cooldown_seconds * 1000) lastMessageAward.delete(userId);
      }
    }
    const min = Math.min(settings.message_exp_min, settings.message_exp_max);
    const max = Math.max(settings.message_exp_min, settings.message_exp_max);
    const amount = min + Math.floor(Math.random() * (max - min + 1));
    if (amount <= 0) return;
    lastMessageAward.set(message.author.id, now);

    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    await changeUserLevel(member, (state) => applyExpDelta(state, amount));
  } catch (error) {
    console.error('Could not award message EXP:', error);
  }
}

/* ---------- EXP за голосовые каналы ---------- */

export function startVoiceExpTracker(client, guildId, intervalMs = 60_000) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;
      const { settings } = await loadConfig();
      if (settings.voice_exp_per_minute <= 0) return;

      const byChannel = new Map();
      for (const state of guild.voiceStates.cache.values()) {
        if (!state.channelId || state.channelId === guild.afkChannelId) continue;
        const list = byChannel.get(state.channelId) ?? [];
        list.push(state);
        byChannel.set(state.channelId, list);
      }

      for (const states of byChannel.values()) {
        const people = [];
        for (const state of states) {
          const member = state.member ?? await guild.members.fetch(state.id).catch(() => null);
          if (member && !member.user.bot) people.push({ member, state });
        }
        if (people.length < 2) continue;
        for (const { member, state } of people) {
          if (state.deaf || state.selfDeaf) continue;
          try {
            await changeUserLevel(member, (current) => applyExpDelta(current, settings.voice_exp_per_minute));
          } catch (error) {
            console.error(`Could not award voice EXP to ${member.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Voice EXP tracker failed:', error);
    } finally {
      running = false;
    }
  };

  return setInterval(tick, intervalMs);
}

/* ---------- Команды /leaders, /rank, /exp, /lvl ---------- */

const MEDALS = ['🥇', '🥈', '🥉'];

async function resolveDisplayName(guild, userId) {
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  if (member) return member.displayName;
  const user = await guild.client.users.fetch(userId).catch(() => null);
  return user ? (user.globalName ?? user.username) : null;
}

function leadersButtons(page, pages, ownerId) {
  const button = (action, label, disabled, style = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId(`leaders:${action}:${page}:${ownerId}`)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
  return new ActionRowBuilder().addComponents(
    button('first', '«', page <= 1),
    button('prev', '‹', page <= 1),
    button('next', '›', page >= pages),
    button('last', '»', page >= pages),
    button('close', '✖', false, ButtonStyle.Danger),
  );
}

async function buildLeadersPage(interaction, requestedPage) {
  const total = await countLevelTop();
  if (!total) return { content: 'Пока никто не набрал EXP.', embeds: [], components: [] };

  const pages = Math.ceil(total / LEADERS_PAGE_SIZE);
  const page = Math.max(1, Math.min(requestedPage, pages));
  const offset = (page - 1) * LEADERS_PAGE_SIZE;
  const rows = await getLevelTop(LEADERS_PAGE_SIZE, offset);
  const names = await Promise.all(rows.map((row) => resolveDisplayName(interaction.guild, row.user_id)));

  const lines = rows.map((row, index) => {
    const position = offset + index + 1;
    const medal = position <= MEDALS.length ? `${MEDALS[position - 1]} ` : '';
    const name = names[index] ? ` (${escapeMarkdown(names[index])})` : '';
    return `${medal}**#${position}.** <@${row.user_id}>${name}\n`
      + `**Уровень:** ${row.level} | **Опыт:** ${totalExpFor(row.level, row.exp)}`;
  });
  const number = (value) => value.toLocaleString('ru-RU');

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Топ рейтинга участников')
    .setDescription([
      'Отсортировано по опыту 🏆',
      '',
      lines.join('\n\n'),
      '',
      `Страница ${number(page)} из ${number(pages)} — Всего участников: ${number(total)}`,
    ].join('\n'))
    .setFooter({
      text: `Запросил ${interaction.member?.displayName ?? interaction.user.username}`,
      iconURL: interaction.user.displayAvatarURL({ size: 64 }),
    });
  const guildIcon = interaction.guild.iconURL({ size: 128 });
  if (guildIcon) embed.setThumbnail(guildIcon);

  return {
    content: '',
    embeds: [embed],
    components: [leadersButtons(page, pages, interaction.user.id)],
    allowedMentions: { parse: [] },
  };
}

async function showLeaders(interaction) {
  await interaction.editReply(await buildLeadersPage(interaction, 1));
}

export async function handleLeadersButton(interaction) {
  const [, action, rawPage, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'Эти кнопки доступны только тому, кто вызвал команду.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  if (action === 'close') {
    await interaction.deleteReply().catch(() => interaction.message.delete().catch(() => {}));
    return;
  }
  const current = Number(rawPage) || 1;
  const target = { first: 1, prev: current - 1, next: current + 1, last: Number.MAX_SAFE_INTEGER }[action] ?? current;
  await interaction.editReply(await buildLeadersPage(interaction, target));
}

async function showRank(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  if (user.bot) {
    await interaction.editReply({ content: 'У ботов нет уровней.' });
    return;
  }

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const { level, exp } = (await getUserLevel(user.id)) ?? { level: 1, exp: 0 };
  const hasActivity = level > 1 || exp > 0;
  const rank = hasActivity ? await getUserRank(user.id, level, exp) : null;

  const image = await renderRankCard({
    name: member?.displayName ?? user.globalName ?? user.username,
    avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
    level,
    exp,
    expNeeded: expForNextLevel(level),
    totalExp: totalExpFor(level, exp),
    rank,
  });
  await interaction.editReply({ files: [new AttachmentBuilder(image, { name: 'rank.png' })] });
}

function describeState({ level, exp }) {
  return `${level} ур. (${exp}/${expForNextLevel(level)} EXP)`;
}

export async function handleLevelCommand(interaction) {
  if (interaction.commandName === 'leaders') {
    await showLeaders(interaction);
    return;
  }
  if (interaction.commandName === 'rank') {
    await showRank(interaction);
    return;
  }

  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  if (user.bot) {
    await interaction.editReply({ content: 'У ботов нет уровней.' });
    return;
  }
  if (amount === 0) {
    await interaction.editReply({ content: 'Укажите число, отличное от нуля.' });
    return;
  }
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.editReply({ content: 'Пользователь не найден на сервере.' });
    return;
  }

  const isExp = interaction.commandName === 'exp';
  const { before, after } = await changeUserLevel(
    member,
    (state) => (isExp ? applyExpDelta(state, amount) : applyLevelDelta(state, amount)),
  );
  await logEconomyAction(interaction, {
    title: isExp ? 'Изменение EXP' : 'Изменение уровня',
    user,
    fields: [
      { name: 'Изменение', value: `${amount > 0 ? '+' : ''}${amount}${isExp ? ' EXP' : ' ур.'}` },
      { name: 'Было', value: describeState(before), inline: true },
      { name: 'Стало', value: describeState(after), inline: true },
    ],
  });
  await interaction.editReply({
    content: `${isExp ? 'EXP' : 'Уровень'} ${member} изменён на ${amount > 0 ? '+' : ''}${amount}.\n`
      + `Было: ${describeState(before)}\nСтало: ${describeState(after)}`,
    allowedMentions: { parse: [] },
  });
}
