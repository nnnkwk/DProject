import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import {
  adjustModeratorDiscipline,
  adjustModeratorPoints,
  createModeratorProfile,
  deactivateModeratorProfile,
  deleteModeratorProfile,
  getBotSettings,
  getModeratorProfile,
  getModeratorProfileRecord,
  getModeratorPositionRole,
  getModeratorPositionRoleIds,
  getModeratorWeeklyWork,
  getPositionRoleIds,
  promoteModerator,
  reactivateModeratorProfile,
  setModeratorArchiveThread,
} from './database.js';
import { MODERATOR_CARD_TITLE, withPointsField } from './archive-migration.js';
import { getModeratorPositionLabel, MODERATOR_POSITIONS } from './moderator-positions.js';

const MODERATOR_ARCHIVE_TAG_ID = '1559258896353202357';
const MODERATOR_FIRED_TAG_ID = '1559259047641874554';

function getMoscowWeekStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
  }).format(now);
  const daysSinceMonday = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 })[weekday];
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function discordTimestamp(date, style = 'F') {
  if (!date) return 'Не указана';
  const timestamp = new Date(date).getTime();
  return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'Не указана';
}

function buildDarkModeratorCard({ title, authorName, authorIcon, fields = [], description = '', footerText = '', color = 0x2f3136 }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title);

  if (authorName) {
    embed.setAuthor({
      name: authorName,
      iconURL: authorIcon || undefined,
    });
  }

  if (description) embed.setDescription(description);

  if (fields.length) embed.addFields(fields);

  if (footerText) {
    embed.setFooter({ text: footerText });
  }

  return embed;
}

async function getTargetMember(interaction, userId) {
  return interaction.guild.members.fetch(userId);
}

async function updateArchiveDisciplineCounts(interaction, profile, thread) {
  if (!thread?.isThread()) return;
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (!starter?.embeds?.[0]) return;

  const values = {
    Выговоры: `${profile.reprimand_count}/3`,
    Предупреждения: `${profile.warning_count}/3`,
    Баллы: String(profile.points ?? 0),
  };
  const fields = starter.embeds[0].fields.map((field) => (
    Object.hasOwn(values, field.name) ? { ...field, value: values[field.name] } : field
  ));
  for (const [name, value] of Object.entries(values)) {
    if (!fields.some((field) => field.name === name)) fields.push({ name, value });
  }

  await starter.edit({
    embeds: [EmbedBuilder.from(starter.embeds[0]).setFields(withPointsField(fields, values.Баллы))],
  });
}

async function restoreActiveModeratorArchive(interaction, profile, member, role, positionLabel) {
  const thread = await interaction.guild.channels.fetch(profile.archive_thread_id).catch(() => null);
  if (!thread?.isThread()) return null;
  const forum = thread.parent ?? await interaction.guild.channels.fetch(thread.parentId).catch(() => null);
  if (forum?.type !== ChannelType.GuildForum
    || !forum.availableTags.some(({ id }) => id === MODERATOR_ARCHIVE_TAG_ID)) {
    throw new Error(`Active moderator archive tag ${MODERATOR_ARCHIVE_TAG_ID} is not configured on the archive forum.`);
  }

  if (thread.archived) await thread.setArchived(false, 'Повторное назначение модератора');
  await thread.setAppliedTags([MODERATOR_ARCHIVE_TAG_ID], 'Повторное назначение модератора');
  await thread.setName(`#${profile.id} | Модератор ${member.user.tag}`.slice(0, 100), 'Обновление архива при повторном назначении');

  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (starter?.embeds?.[0]) {
    const values = {
      'Имя': profile.real_name,
      'Возраст': String(profile.age),
      'Discord': `${member.id} | ${member}`,
      'Должность': `${positionLabel} | ${role}`,
      'Дата назначения': discordTimestamp(profile.appointed_at, 'F'),
      'Инициатор': `${interaction.user.id} | ${interaction.user}`,
      'Выговоры': `${profile.reprimand_count}/3`,
      'Предупреждения': `${profile.warning_count}/3`,
      'Баллы': String(profile.points ?? 0),
    };
    const fields = starter.embeds[0].fields.map((field) => (
      Object.hasOwn(values, field.name) ? { ...field, value: values[field.name] } : field
    ));
    await starter.edit({
      embeds: [EmbedBuilder.from(starter.embeds[0]).setTitle(MODERATOR_CARD_TITLE)
        .setFields(withPointsField(fields, values['Баллы']))],
    });
  }

  await thread.setArchived(true, 'Закрытие архива после повторного назначения');
  return thread;
}

async function createArchiveThread(
  interaction,
  profile,
  member,
  role,
  positionLabel = getModeratorPositionLabel(profile.position_key) ?? 'Не указана',
  { previousThreadId = null } = {},
) {
  if (profile.archive_thread_id) {
    const existingThread = await interaction.guild.channels.fetch(profile.archive_thread_id).catch(() => null);
    if (existingThread?.isThread()) {
      if (existingThread.archived) {
        await existingThread.setArchived(false, 'Обновление архива модератора');
      }
      await existingThread.setAppliedTags([MODERATOR_ARCHIVE_TAG_ID], 'Активный архив модератора');
      await updateArchiveDisciplineCounts(interaction, profile, existingThread);
      await existingThread.setArchived(true, 'Закрытие архива модератора после создания');
      return existingThread;
    }
  }
  const settings = await getBotSettings();
  const forum = settings?.moderator_forum_channel_id
    ? await interaction.guild.channels.fetch(settings.moderator_forum_channel_id).catch(() => null)
    : null;
  if (!forum || forum.type !== ChannelType.GuildForum) {
    return null;
  }
  if (!forum.availableTags.some(({ id }) => id === MODERATOR_ARCHIVE_TAG_ID)) {
    throw new Error(`Moderator archive tag ${MODERATOR_ARCHIVE_TAG_ID} is not configured on forum ${forum.id}.`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle(MODERATOR_CARD_TITLE)
    .addFields(
      { name: 'Имя', value: profile.real_name },
      { name: 'Возраст', value: String(profile.age) },
      { name: 'Discord', value: `${member.id} | ${member}` },
      { name: 'Должность', value: `${positionLabel} | ${role}` },
      { name: 'Дата назначения', value: discordTimestamp(profile.appointed_at, 'F') },
      { name: 'Инициатор', value: `${interaction.user.id} | ${interaction.user}` },
      { name: 'Выговоры', value: `${profile.reprimand_count}/3` },
      { name: 'Предупреждения', value: `${profile.warning_count}/3` },
      { name: 'Баллы', value: String(profile.points ?? 0) },
    )
    .setFooter({
      text: interaction.guild.name,
      iconURL: interaction.guild.iconURL({ size: 64 }) ?? undefined,
    });
  if (previousThreadId) {
    embed.addFields({ name: 'Предыдущий архив', value: `<#${previousThreadId}>` });
  }

  const thread = await forum.threads.create({
    name: `#${profile.id} | Модератор ${member.user.tag}`.slice(0, 100),
    appliedTags: [MODERATOR_ARCHIVE_TAG_ID],
    message: { embeds: [embed] },
    reason: `Создание архива профиля модератора ${member.user.tag}`,
  });
  await setModeratorArchiveThread(profile.user_id, thread.id);
  await thread.setArchived(true, 'Закрытие архива модератора после создания');
  return thread;
}

function russianCountForm(count, forms) {
  const absoluteCount = Math.abs(count);
  const lastTwoDigits = absoluteCount % 100;
  const lastDigit = absoluteCount % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return forms[2];
  if (lastDigit === 1) return forms[0];
  if (lastDigit >= 2 && lastDigit <= 4) return forms[1];
  return forms[2];
}

function disciplineActionTitle(type, delta) {
  const count = Math.abs(delta);
  const isWarning = type === 'warning';
  const noun = isWarning
    ? russianCountForm(count, ['предупреждение', 'предупреждения', 'предупреждений'])
    : russianCountForm(count, ['выговор', 'выговора', 'выговоров']);
  const isIssue = delta > 0;

  if (isWarning) {
    return `${isIssue ? 'Выдано' : 'Снято'} ${count} ${noun}`;
  }

  const verb = isIssue
    ? (count === 1 ? 'Выдан' : 'Выданы')
    : (count === 1 ? 'Снят' : 'Сняты');
  return `${verb} ${count} ${noun}`;
}

async function appendArchiveEvent(interaction, profile, title, change, reason, extraFields = []) {
  if (!profile.archive_thread_id) return false;
  const thread = await interaction.guild.channels.fetch(profile.archive_thread_id).catch(() => null);
  if (!thread?.isThread()) return false;
  if (thread.archived) await thread.setArchived(false);
  const embed = buildDarkModeratorCard({
    title,
    fields: [
      { name: 'Действие', value: change },
      { name: 'Причина', value: reason },
      ...extraFields,
      { name: 'Дата', value: discordTimestamp(new Date(), 'F') },
      { name: 'Модератор', value: `${profile.user_id} | <@${profile.user_id}>` },
      { name: 'Инициатор', value: `${interaction.user.id} | ${interaction.user}` },
    ],
  });
  embed.setFooter({
    text: interaction.guild.name,
    iconURL: interaction.guild.iconURL({ size: 64 }) ?? undefined,
  });
  try {
    await thread.send({ embeds: [embed] });
  } finally {
    await updateArchiveDisciplineCounts(interaction, profile, thread)
      .catch((error) => console.error('Could not update moderator discipline counts in archive:', error));
    await thread.setArchived(true, 'Закрытие архива модератора после добавления записи')
      .catch((error) => console.error('Could not re-archive moderator topic:', error));
  }
  return true;
}

async function appendDismissalArchiveEvent(interaction, profile, reason) {
  const thread = await interaction.guild.channels.fetch(profile.archive_thread_id).catch(() => null);
  if (!thread?.isThread()) return false;
  if (thread.archived) await thread.setArchived(false, 'Добавление отдельной карточки снятия модератора');

  const embed = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle('Снятие модератора')
    .addFields(
      { name: 'Причина', value: reason },
      { name: 'Дата', value: discordTimestamp(new Date(), 'F') },
      { name: 'Модератор', value: `${profile.user_id} | <@${profile.user_id}>` },
      { name: 'Инициатор', value: `${interaction.user.id} | ${interaction.user}` },
    )
    .setFooter({
      text: interaction.guild.name,
      iconURL: interaction.guild.iconURL({ size: 64 }) ?? undefined,
    });

  try {
    await thread.send({ embeds: [embed] });
    await updateArchiveDisciplineCounts(interaction, profile, thread);
  } finally {
    await thread.setArchived(true, 'Закрытие архива после снятия модератора')
      .catch((error) => console.error('Could not re-archive dismissed moderator topic:', error));
  }
  return true;
}

const PROMOTION_LADDER = [
  'moderator',
  'senior_moderator',
  'moderation_curator',
  'deputy_head_moderator',
  'head_moderator',
];
const TOP_AUTHORITY = PROMOTION_LADDER.length;
const AUTHORITY_OUTSIDE_LADDER = {
  discord_administrator: TOP_AUTHORITY,
  technical_moderator: TOP_AUTHORITY,
};

function getPromotionAuthority(interaction, roleIdByPosition) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return TOP_AUTHORITY;
  const roles = interaction.member?.roles;
  const memberRoleIds = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
  let authority = -1;
  for (const [positionKey, roleId] of Object.entries(roleIdByPosition)) {
    if (!memberRoleIds.includes(roleId)) continue;
    const ladderIndex = PROMOTION_LADDER.indexOf(positionKey);
    authority = Math.max(authority, ladderIndex >= 0 ? ladderIndex : (AUTHORITY_OUTSIDE_LADDER[positionKey] ?? -1));
  }
  return authority;
}

async function appendPromotionArchiveEvent(interaction, profile, { fromLabel, toLabel, role }) {
  if (!profile.archive_thread_id) return false;
  const thread = await interaction.guild.channels.fetch(profile.archive_thread_id).catch(() => null);
  if (!thread?.isThread()) return false;
  if (thread.archived) await thread.setArchived(false, 'Добавление записи о повышении модератора');

  const newPosition = `${toLabel} | ${role}`;
  const embed = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle('Повышение модератора')
    .addFields(
      { name: 'Было', value: fromLabel },
      { name: 'Стало', value: newPosition },
      { name: 'Дата', value: discordTimestamp(new Date(), 'F') },
      { name: 'Модератор', value: `${profile.user_id} | <@${profile.user_id}>` },
      { name: 'Инициатор', value: `${interaction.user.id} | ${interaction.user}` },
    )
    .setFooter({
      text: interaction.guild.name,
      iconURL: interaction.guild.iconURL({ size: 64 }) ?? undefined,
    });

  try {
    await thread.send({ embeds: [embed] });
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter?.embeds?.[0]) {
      const fields = starter.embeds[0].fields.map((field) => (
        field.name === 'Должность' ? { ...field, value: newPosition } : field
      ));
      await starter.edit({ embeds: [EmbedBuilder.from(starter.embeds[0]).setFields(fields)] })
        .catch((error) => console.error('Could not update the position in the moderator archive:', error));
    }
  } finally {
    await thread.setArchived(true, 'Закрытие архива модератора после записи о повышении')
      .catch((error) => console.error('Could not re-archive promoted moderator topic:', error));
  }
  return true;
}

export async function sendModeratorStats(interaction, userId) {
  const weekStart = getMoscowWeekStart();
  const profile = await getModeratorProfile(userId, weekStart);
  if (!profile) {
    await interaction.editReply({ content: 'Активный профиль модератора не найден.' });
    return;
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const currentNick = member?.displayName ?? `<@${userId}>`;
  const weekTimestamp = Math.floor(new Date(`${weekStart}T00:00:00+03:00`).getTime() / 1000);
  const embed = buildDarkModeratorCard({
    title: 'Статистика модератора',
    authorName: `${currentNick} • ${profile.real_name}`,
    authorIcon: member?.displayAvatarURL({ dynamic: true }) ?? undefined,
    description: `${member ?? `<@${userId}>`} • ${profile.real_name}`,
    footerText: `${interaction.guild.name} • неделя ${weekStart}`,
    fields: [
      { name: 'Должность', value: `${getModeratorPositionLabel(profile.position_key) ?? 'Не указана'} • <@&${profile.moderator_role_id}>`, inline: true },
      { name: 'Возраст', value: String(profile.age), inline: true },
      { name: 'Назначен', value: discordTimestamp(profile.appointed_at, 'D'), inline: true },
      { name: 'Последнее повышение', value: discordTimestamp(profile.last_promotion_at, 'D'), inline: true },
      { name: 'Предупреждения', value: `${profile.warning_count}/3`, inline: true },
      { name: 'Выговоры', value: String(profile.reprimand_count), inline: true },
      { name: 'Сообщения за неделю', value: `${profile.weekly_messages} • <t:${weekTimestamp}:D>`, inline: false },
    ],
  });
  await interaction.editReply({ embeds: [embed] });
}

async function sendWeeklyActivityStats(interaction) {
  const weekStart = getMoscowWeekStart();
  const profile = await getModeratorProfile(interaction.user.id, weekStart);
  if (!profile) {
    await interaction.editReply({ content: 'Команда /stats доступна только зарегистрированным модераторам.' });
    return;
  }

  const weekStartDate = new Date(`${weekStart}T00:00:00+03:00`);
  const [work, settings] = await Promise.all([
    getModeratorWeeklyWork(interaction.user.id, Math.floor(weekStartDate.getTime() / 1000)),
    getBotSettings(),
  ]);
  const channelLabel = (channelId, fallback) => (/^\d{17,20}$/.test(channelId ?? '') ? `<#${channelId}>` : fallback);

  const embed = new EmbedBuilder()
    .setColor(0x8be28b)
    .setTitle('Активность модератора за текущую неделю')
    .setDescription([
      '**Работа модератора**',
      `Сообщений в ${channelLabel(settings?.main_chat_id, 'главном чате')}: ${profile.weekly_messages}`,
      `Работа с ролями ${channelLabel(settings?.review_channel_id, '(канал заявок)')}: ${work.roleRequestsReviewed}`,
      `Выдано мутов: ${work.mutes}`,
      `Выдано блокировок: ${work.bans}`,
      `Кикнуто пользователей: ${work.kicks}`,
      `Закрыто обращений: ${work.ticketsClosed}`,
    ].join('\n'))
    .setFooter({ text: 'Начало недели:' })
    .setTimestamp(weekStartDate);

  await interaction.editReply({ content: 'Вот ваша статистика модератора.', embeds: [embed] });
}

export async function handleModeratorCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.editReply({ content: 'Эту команду можно использовать только на сервере Discord.' });
    return;
  }
  switch (interaction.commandName) {
    case 'fire': {
      const user = interaction.options.getUser('member', true);
      const reason = interaction.options.getString('reason', true).trim();
      if (!reason) {
        await interaction.editReply({ content: 'Укажите причину снятия модератора.' });
        return;
      }

      const profile = await getModeratorProfile(user.id, getMoscowWeekStart());
      if (!profile) {
        await interaction.editReply({ content: 'Активный профиль модератора не найден.' });
        return;
      }

      const member = await getTargetMember(interaction, user.id).catch(() => null);
      if (!member) {
        await interaction.editReply({ content: 'Модератор не найден на сервере.' });
        return;
      }

      const archiveThread = profile.archive_thread_id
        ? await interaction.guild.channels.fetch(profile.archive_thread_id).catch(() => null)
        : null;
      if (!archiveThread?.isThread()) {
        await interaction.editReply({ content: 'Форум-архив профиля не найден; снятие не выполнено.' });
        return;
      }
      const forum = archiveThread.parent ?? await interaction.guild.channels.fetch(archiveThread.parentId).catch(() => null);
      if (forum?.type !== ChannelType.GuildForum
        || !forum.availableTags.some(({ id }) => id === MODERATOR_FIRED_TAG_ID)) {
        await interaction.editReply({ content: `В Forum-канале должен быть настроен тег снятых модераторов ${MODERATOR_FIRED_TAG_ID}; снятие не выполнено.` });
        return;
      }

      const mappedRoleIds = await getModeratorPositionRoleIds();
      const moderatorRoleIds = [...new Set([...mappedRoleIds, profile.moderator_role_id])];
      const rolesToRemove = moderatorRoleIds
        .filter((roleId) => member.roles.cache.has(roleId))
        .map((roleId) => interaction.guild.roles.cache.get(roleId))
        .filter(Boolean);
      const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      if (rolesToRemove.length && !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.editReply({ content: 'У бота нет права «Управлять ролями»; снять модераторские роли не удалось.' });
        return;
      }
      const unmanageableRole = rolesToRemove.find((role) => role.managed || role.position >= botMember.roles.highest.position);
      if (unmanageableRole) {
        await interaction.editReply({ content: `Бот не может снять роль ${unmanageableRole}: проверьте иерархию ролей.` });
        return;
      }

      try {
        if (rolesToRemove.length) {
          await member.roles.remove(rolesToRemove, `Модератор снят с должности: ${reason}`);
        }
      } catch (error) {
        console.error('Could not remove moderator roles:', error);
        await interaction.editReply({ content: 'Не удалось снять все модераторские роли. Профиль оставлен активным.' });
        return;
      }

      try {
        const deactivated = await deactivateModeratorProfile(user.id, interaction.user.id, reason);
        if (!deactivated) {
          if (rolesToRemove.length) await member.roles.add(rolesToRemove, 'Откат снятия: профиль уже изменён');
          await interaction.editReply({ content: 'Профиль уже был изменён другой операцией; роли восстановлены.' });
          return;
        }

        if (archiveThread.archived) await archiveThread.setArchived(false, 'Добавление записи о снятии модератора');
        await archiveThread.setAppliedTags([MODERATOR_FIRED_TAG_ID], 'Модератор снят с должности');
        await appendDismissalArchiveEvent(interaction, profile, reason);
        await interaction.editReply({
          content: `Модератор <@${user.id}> снят с должности. Снято модераторских ролей: ${rolesToRemove.length}; архив помечен соответствующим тегом.`,
        });
      } catch (error) {
        console.error('Moderator was deactivated, but archive update failed:', error);
        await interaction.editReply({ content: 'Роли сняты и профиль деактивирован, но архив не удалось полностью обновить. Проверьте права на управление Forum-темами и тег.' });
      }
      return;
    }

    case 'setwarn':
    case 'setvig': {
      const user = interaction.options.getUser('member', true);
      const delta = interaction.options.getInteger('amount', true);
      const note = interaction.options.getString('reason', true).trim();
      if (!note || delta === 0) {
        await interaction.editReply({ content: 'Укажите ненулевое количество (+/-) и причину.' });
        return;
      }

      const profile = await getModeratorProfile(user.id, getMoscowWeekStart());
      if (!profile) {
        await interaction.editReply({ content: 'Активный профиль модератора не найден.' });
        return;
      }

      const isWarning = interaction.commandName === 'setwarn';
      const type = isWarning ? 'warning' : 'reprimand';
      const result = await adjustModeratorDiscipline(user.id, type, delta, interaction.user.id, note);
      if (!result.success) {
        const kind = isWarning ? 'предупреждений' : 'выговоров';
        const errorText = result.reason === 'profile_missing'
          ? 'Активный профиль модератора не найден.'
          : `Нельзя изменить значение на ${delta > 0 ? '+' : ''}${delta}: количество ${kind} должно оставаться от 0 до 3. Сейчас: ${result.currentCount}/3.`;
        await interaction.editReply({ content: errorText });
        return;
      }

      const refreshed = await getModeratorProfile(user.id, getMoscowWeekStart());
      const penaltyName = isWarning ? 'предупреждения' : 'выговора';
      const eventTitle = `${delta > 0 ? 'Выдача' : 'Снятие'} ${penaltyName}`;
      const actionText = disciplineActionTitle(type, delta);
      await appendArchiveEvent(interaction, refreshed, eventTitle, actionText, note)
        .catch((error) => console.error('Could not update the moderator archive after a discipline change:', error));
      await interaction.editReply({
        content: `${eventTitle} для <@${user.id}>: ${delta > 0 ? '+' : ''}${delta}. Сейчас: выговоры ${refreshed.reprimand_count}/3, предупреждения ${refreshed.warning_count}/3.`,
      });
      return;
    }

    case 'setpoints': {
      const user = interaction.options.getUser('member', true);
      const delta = interaction.options.getInteger('amount', true);
      const note = interaction.options.getString('reason', true).trim();
      if (!note || delta === 0) {
        await interaction.editReply({ content: 'Укажите ненулевое количество баллов (+/-) и причину.' });
        return;
      }
      if (user.id === interaction.user.id) {
        await interaction.editReply({ content: 'Нельзя менять баллы самому себе.' });
        return;
      }

      const result = await adjustModeratorPoints(user.id, delta, interaction.user.id, note);
      if (!result.success) {
        await interaction.editReply({
          content: result.reason === 'profile_missing'
            ? 'Активный профиль модератора не найден.'
            : `Нельзя изменить баллы на ${delta}: у модератора сейчас ${result.currentPoints}, итог не может быть меньше нуля.`,
        });
        return;
      }

      const refreshed = await getModeratorProfile(user.id, getMoscowWeekStart());
      const amount = Math.abs(delta);
      const word = russianCountForm(amount, ['балл', 'балла', 'баллов']);
      const eventTitle = delta > 0 ? 'Выдача баллов' : 'Снятие баллов';
      const actionText = `${delta > 0 ? 'Выдано' : 'Снято'} ${amount} ${word}`;
      let archiveNote = '';
      try {
        const sent = await appendArchiveEvent(
          interaction,
          refreshed,
          eventTitle,
          actionText,
          note,
          [{ name: 'Всего баллов', value: String(result.points) }],
        );
        if (!sent) archiveNote = '\nАрхив модератора не найден, запись в архив не добавлена.';
      } catch (error) {
        console.error('Could not update the moderator archive after a points change:', error);
        archiveNote = '\nБаллы изменены, но запись в архив добавить не удалось. Проверьте права бота на управление Forum-темами.';
      }
      await interaction.editReply({
        content: `${eventTitle} для <@${user.id}>: ${delta > 0 ? '+' : ''}${delta}. Сейчас баллов: ${result.points}.${archiveNote}`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    case 'uplvl': {
      const user = interaction.options.getUser('member', true);
      if (user.bot) {
        await interaction.editReply({ content: 'Бота нельзя повысить.' });
        return;
      }
      if (user.id === interaction.user.id) {
        await interaction.editReply({ content: 'Нельзя повысить самого себя.' });
        return;
      }

      const profile = await getModeratorProfile(user.id, getMoscowWeekStart());
      if (!profile) {
        await interaction.editReply({ content: 'Активный профиль модератора не найден.' });
        return;
      }

      const roleIdByPosition = await getPositionRoleIds(MODERATOR_POSITIONS.map(({ key }) => key));
      const currentKey = profile.position_key
        ?? Object.keys(roleIdByPosition).find((key) => roleIdByPosition[key] === profile.moderator_role_id)
        ?? null;
      const currentIndex = PROMOTION_LADDER.indexOf(currentKey);
      if (currentIndex === -1) {
        await interaction.editReply({ content: `Должность «${getModeratorPositionLabel(currentKey) ?? 'не указана'}» не входит в линейку повышения (модератор → главный модератор), повысить её командой нельзя.` });
        return;
      }
      if (currentIndex === PROMOTION_LADDER.length - 1) {
        await interaction.editReply({ content: `<@${user.id}> уже занимает максимальную должность: «${getModeratorPositionLabel(currentKey)}».`, allowedMentions: { parse: [] } });
        return;
      }

      const newIndex = currentIndex + 1;
      const newKey = PROMOTION_LADDER[newIndex];
      const fromLabel = getModeratorPositionLabel(currentKey);
      const toLabel = getModeratorPositionLabel(newKey);
      if (newIndex >= getPromotionAuthority(interaction, roleIdByPosition)) {
        await interaction.editReply({ content: `Вы не можете повысить модератора до «${toLabel}»: нельзя повышать до должности, равной вашей или выше.` });
        return;
      }

      const newRoleId = roleIdByPosition[newKey];
      if (!newRoleId) {
        await interaction.editReply({ content: `Для должности «${toLabel}» не настроена роль в таблице moderator_position_roles.` });
        return;
      }
      const newRole = await interaction.guild.roles.fetch(newRoleId).catch(() => null);
      if (!newRole || newRole.id === interaction.guildId || newRole.managed) {
        await interaction.editReply({ content: `Роль для должности «${toLabel}» не найдена на сервере или не может быть назначена. Проверьте moderator_position_roles.` });
        return;
      }
      const member = await getTargetMember(interaction, user.id).catch(() => null);
      if (!member) {
        await interaction.editReply({ content: 'Модератор не найден на сервере.' });
        return;
      }

      const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      const oldRoles = [...new Set([roleIdByPosition[currentKey], profile.moderator_role_id])]
        .filter((roleId) => roleId && roleId !== newRole.id && member.roles.cache.has(roleId))
        .map((roleId) => interaction.guild.roles.cache.get(roleId))
        .filter(Boolean);
      const botTop = botMember.roles.highest.position;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)
        || newRole.position >= botTop
        || oldRoles.some((role) => role.managed || role.position >= botTop)) {
        await interaction.editReply({ content: 'Боту нужно право «Управлять ролями», а его роль должна быть выше старой и новой роли модератора.' });
        return;
      }

      const auditReason = `Повышение модератора до «${toLabel}» (${interaction.user.tag})`;
      const rollbackRoles = async () => {
        await member.roles.remove(newRole.id, 'Откат повышения').catch(() => {});
        for (const role of oldRoles) await member.roles.add(role.id, 'Откат повышения').catch(() => {});
      };
      try {
        await member.roles.add(newRole.id, auditReason);
        for (const role of oldRoles) await member.roles.remove(role.id, auditReason);
      } catch (error) {
        console.error('Could not change moderator roles on promotion:', error);
        await rollbackRoles();
        await interaction.editReply({ content: 'Не удалось сменить роли модератора. Повышение не выполнено.' });
        return;
      }

      let promoted = false;
      try {
        promoted = await promoteModerator(
          user.id,
          newRole.id,
          newKey,
          profile.position_key ?? null,
          interaction.user.id,
          `Повышение: ${fromLabel} → ${toLabel}`,
        );
      } catch (error) {
        console.error('Could not save moderator promotion:', error);
      }
      if (!promoted) {
        await rollbackRoles();
        await interaction.editReply({ content: 'Не удалось сохранить повышение (профиль мог быть изменён другой операцией). Роли возвращены, повторите команду.' });
        return;
      }

      let archiveNote = '';
      try {
        const sent = await appendPromotionArchiveEvent(interaction, profile, { fromLabel, toLabel, role: newRole });
        if (!sent) archiveNote = '\nАрхив модератора не найден, запись о повышении не добавлена.';
      } catch (error) {
        console.error('Could not add the promotion to the moderator archive:', error);
        archiveNote = '\nПовышение выполнено, но запись в архив добавить не удалось. Проверьте права бота на управление Forum-темами.';
      }
      await interaction.editReply({
        content: `<@${user.id}> повышен: **${fromLabel}** → **${toLabel}**.${archiveNote}`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    case 'stats': {
      await sendWeeklyActivityStats(interaction);
      return;
    }

    case 'setmoder': {
      const user = interaction.options.getUser('member', true);
      const realName = interaction.options.getString('name', true).trim();
      const age = interaction.options.getInteger('age', true);
      const positionKey = interaction.options.getString('position', true);
      const positionLabel = getModeratorPositionLabel(positionKey);
      if (user.bot || !realName || !positionLabel) {
        await interaction.editReply({ content: 'Укажите участника, имя и одну из доступных должностей.' });
        return;
      }
      const settings = await getBotSettings();
      const forum = settings?.moderator_forum_channel_id
        ? await interaction.guild.channels.fetch(settings.moderator_forum_channel_id).catch(() => null)
        : null;
      if (forum?.type !== ChannelType.GuildForum) {
        await interaction.editReply({ content: 'Сначала настройте форум командой /moder-configure.' });
        return;
      }
      const existing = await getModeratorProfileRecord(user.id, getMoscowWeekStart());
      if (existing?.active) {
        const member = await getTargetMember(interaction, user.id);
        try {
          const currentRole = await interaction.guild.roles.fetch(existing.moderator_role_id).catch(() => null);
          const thread = existing.archive_thread_id
            ? await restoreActiveModeratorArchive(
              interaction,
              existing,
              member,
              currentRole ?? `<@&${existing.moderator_role_id}>`,
              getModeratorPositionLabel(existing.position_key) ?? 'Не указана',
            )
            : await createArchiveThread(
              interaction,
              existing,
              member,
              currentRole ?? `<@&${existing.moderator_role_id}>`,
              getModeratorPositionLabel(existing.position_key) ?? 'Не указана',
            );
          await interaction.editReply({ content: thread
            ? `Профиль уже существует; архив создан: ${thread}.`
            : 'Профиль уже существует, но создать форум-архив не удалось.' });
        } catch (error) {
          console.error('Could not create moderator archive:', error);
          await interaction.editReply({ content: `Профиль уже существует, но не удалось создать или закрыть форум-архив. Проверьте права бота (включая управление темами) и наличие тега ${MODERATOR_ARCHIVE_TAG_ID} в Forum-канале.` });
        }
        return;
      }

      let member;
      try {
        member = await getTargetMember(interaction, user.id);
      } catch {
        await interaction.editReply({ content: 'Участник не найден на этом Discord-сервере.' });
        return;
      }
      const configuredRoleId = await getModeratorPositionRole(positionKey);
      if (!configuredRoleId) {
        await interaction.editReply({ content: `Для должности «${positionLabel}» не настроена роль в таблице moderator_position_roles.` });
        return;
      }
      const role = await interaction.guild.roles.fetch(configuredRoleId).catch(() => null);
      if (!role || role.id === interaction.guildId || role.managed) {
        await interaction.editReply({ content: `Роль для должности «${positionLabel}» не найдена на сервере или не может быть назначена. Проверьте moderator_position_roles.` });
        return;
      }
      const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)
        || role.position >= botMember.roles.highest.position) {
        await interaction.editReply({ content: 'Боту нужно право «Управлять ролями», а его роль должна быть выше выбранной роли.' });
        return;
      }

      let profileId;
      if (existing && !existing.active) {
        try {
          await member.roles.add(role, `Повторное назначение модератора: ${realName}`);
          const reactivated = await reactivateModeratorProfile(user.id, role.id, positionKey, realName, age);
          if (!reactivated) throw new Error('Moderator profile could not be reactivated.');
          profileId = existing.id;
        } catch (error) {
          await member.roles.remove(role, 'Откат повторного назначения модератора').catch(() => {});
          console.error('Could not reactivate moderator profile:', error);
          await interaction.editReply({ content: 'Не удалось повторно назначить модератора. Проверьте роль и состояние профиля.' });
          return;
        }
      } else {
        try {
          profileId = await createModeratorProfile(user.id, role.id, positionKey, realName, age);
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') {
            await interaction.editReply({ content: 'Профиль этого участника уже зарегистрирован.' });
            return;
          }
          throw error;
        }

        try {
          await member.roles.add(role, `Регистрация профиля модератора: ${realName}`);
        } catch (error) {
          await deleteModeratorProfile(user.id);
          console.error('Could not assign moderator role:', error);
          await interaction.editReply({ content: 'Не удалось выдать выбранную роль. Профиль не сохранён; проверьте иерархию ролей бота.' });
          return;
        }
      }

      const profile = await getModeratorProfile(user.id, getMoscowWeekStart());
      try {
        const thread = await createArchiveThread(interaction, profile, member, role, positionLabel, {
          previousThreadId: existing?.archive_thread_id ?? null,
        });
        await interaction.editReply({ content: `${existing ? 'Профиль повторно активирован' : 'Профиль создан'} и роль выдана. Наказания и недельная статистика сброшены. ${existing ? 'Новый архив' : 'Архив'}: ${thread}.` });
      } catch (error) {
        console.error('Could not create moderator archive:', error);
        await interaction.editReply({ content: `Профиль создан и роль выдана, но архив не создан или не закрыт. Проверьте права бота (включая управление темами) и наличие тега ${MODERATOR_ARCHIVE_TAG_ID} в Forum-канале, затем повторите /setmoder.` });
      }
      console.log(`Created moderator profile ${profileId} on Discord server ${interaction.guildId}.`);
      return;
    }

    default:
      await interaction.editReply({ content: 'Неизвестная команда управления профилями модераторов.' });
  }
}

export { getMoscowWeekStart };
