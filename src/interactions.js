import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  createRoleRequest,
  getBotSettings,
  getActiveRoles,
  getActiveServers,
  getManagedRoleIds,
  setReviewMessage,
} from './database.js';
import {
  decideRoleRequest,
  handleModerationDashboardInteraction,
} from './moderation-panel.js';
import { handleCommand } from './commands.js';
import { handleLeadersButton } from './levels.js';
import { handleMarketAutocomplete, handleMarketInteraction } from './market.js';
import { handleTicketCreateButton, handleTicketModalSubmit } from './tickets.js';

const sessions = new Map();
const PAGE_SIZE = 25;
const SESSION_TTL_MS = 15 * 60 * 1000;

function flowButton(customId, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function serverSelectionView(session) {
  const servers = session.servers;
  const start = session.serverPage * PAGE_SIZE;
  const page = servers.slice(start, start + PAGE_SIZE);
  const selected = new Set(session.serverIds);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`flow:servers:${session.id}`)
    .setPlaceholder('Выбери серверы')
    .setMinValues(0)
    .setMaxValues(page.length || 1)
    .addOptions(page.map((server) => ({
      label: server.name.slice(0, 100),
      value: String(server.id),
      default: selected.has(String(server.id)),
    })));
  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (servers.length > PAGE_SIZE) {
    rows.push(new ActionRowBuilder().addComponents(
      flowButton(`flow:server-prev:${session.id}`, '◀', ButtonStyle.Secondary, session.serverPage === 0),
      flowButton(`flow:server-next:${session.id}`, '▶', ButtonStyle.Secondary, start + PAGE_SIZE >= servers.length),
      flowButton(`flow:server-continue:${session.id}`, 'Продолжить', ButtonStyle.Primary, session.serverIds.length === 0),
    ));
  } else {
    rows.push(new ActionRowBuilder().addComponents(
      flowButton(`flow:server-continue:${session.id}`, 'Продолжить', ButtonStyle.Primary, session.serverIds.length === 0),
      flowButton(`flow:cancel:${session.id}`, 'Отмена'),
    ));
  }
  if (servers.length > PAGE_SIZE) {
    rows.push(new ActionRowBuilder().addComponents(flowButton(`flow:cancel:${session.id}`, 'Отмена')));
  }
  return {
    content: `Выбери серверы. Страница ${session.serverPage + 1}/${Math.max(1, Math.ceil(servers.length / PAGE_SIZE))}. Выбрано: ${session.serverIds.length}.`,
    components: rows,
  };
}

async function roleSelectionView(session, guild) {
  const serverId = session.serverIds[session.serverIndex];
  const server = session.servers.find((item) => String(item.id) === serverId);
  const roles = (await getActiveRoles(serverId)).filter((role) =>
    !session.memberRoleIds.has(role.discord_role_id) && guild.roles.cache.has(role.discord_role_id),
  );
  session.currentRoles = roles;
  const start = session.rolePage * PAGE_SIZE;
  const page = roles.slice(start, start + PAGE_SIZE);
  const chosen = new Set(session.roleIdsByServer[serverId] ?? []);
  const rows = [];

  if (page.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`flow:roles:${session.id}`)
      .setPlaceholder(`Должности для ${server.name}`.slice(0, 150))
      .setMinValues(0)
      .setMaxValues(page.length)
      .addOptions(page.map((role) => ({
        label: role.label.slice(0, 100),
        value: String(role.id),
        default: chosen.has(String(role.id)),
      })));
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  const nav = [];
  if (roles.length > PAGE_SIZE) {
    nav.push(flowButton(`flow:role-prev:${session.id}`, '◀', ButtonStyle.Secondary, session.rolePage === 0));
    nav.push(flowButton(`flow:role-next:${session.id}`, '▶', ButtonStyle.Secondary, start + PAGE_SIZE >= roles.length));
  }
  const selectionCount = (session.roleIdsByServer[serverId] ?? []).length;
  const isLast = session.serverIndex === session.serverIds.length - 1;
  const canSkip = roles.length === 0;
  nav.push(flowButton(
    `flow:role-continue:${session.id}`,
    canSkip ? 'Пропустить сервер' : (isLast ? 'Отправить заявки' : 'Далее'),
    ButtonStyle.Primary,
    selectionCount === 0 && !canSkip,
  ));
  nav.push(flowButton(`flow:cancel:${session.id}`, 'Отмена'));
  rows.push(new ActionRowBuilder().addComponents(...nav));

  let content = `Выбери должности для **${server.name}** (${session.serverIndex + 1}/${session.serverIds.length}). Выбрано: ${selectionCount}.`;
  if (!roles.length) content += '\nДля этого сервера нет доступных ролей, которые ещё не выданы тебе.';
  return { content, components: rows };
}

async function openRoleFlow(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const servers = await getActiveServers();
  if (!servers.length) {
    await interaction.editReply({ content: 'Каталог ролей пока не настроен.' });
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const session = {
    id,
    ownerId: interaction.user.id,
    expiresAt: Date.now() + SESSION_TTL_MS,
    servers,
    serverIds: [],
    serverPage: 0,
    serverIndex: 0,
    rolePage: 0,
    roleIdsByServer: {},
    memberRoleIds: new Set(member.roles.cache.keys()),
  };
  sessions.set(id, session);
  const cleanupTimer = setTimeout(() => sessions.delete(id), SESSION_TTL_MS);
  cleanupTimer.unref?.();
  await interaction.editReply(serverSelectionView(session));
}

async function beginRoles(interaction, session) {
  await interaction.deferUpdate();
  if (!session.serverIds.length) {
    await interaction.editReply(serverSelectionView(session));
    return;
  }
  session.serverIndex = 0;
  session.rolePage = 0;
  await interaction.editReply(await roleSelectionView(session, interaction.guild));
}

async function submitRequests(interaction, session) {
  await interaction.deferUpdate();
  const settings = await getBotSettings();
  const reviewChannel = settings?.review_channel_id
    ? await interaction.guild.channels.fetch(settings.review_channel_id).catch(() => null)
    : null;
  if (!reviewChannel?.isTextBased()) {
    await interaction.followUp({ content: 'Канал проверки заявок не настроен или недоступен. Обратитесь к модератору.', flags: MessageFlags.Ephemeral });
    sessions.delete(session.id);
    return;
  }

  let submitted = 0;
  let failed = 0;
  for (const serverId of session.serverIds) {
    const selectedIds = session.roleIdsByServer[serverId] ?? [];
    const activeRoles = await getActiveRoles(serverId);
    for (const roleId of selectedIds) {
      const role = activeRoles.find((item) => String(item.id) === roleId);
      if (!role || session.memberRoleIds.has(role.discord_role_id)) continue;
      const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
      if (!discordRole || discordRole.managed) {
        failed += 1;
        continue;
      }
      try {
        const requestId = await createRoleRequest(session.ownerId, serverId, role);
        const receivedAt = new Date();
        const embed = new EmbedBuilder()
          .setColor(0x2f3136)
          .setTitle('Запрос на получение ролей')
          .addFields(
            { name: 'Пользователь', value: `<@${session.ownerId}>` },
            { name: 'Сервер', value: session.servers.find((item) => String(item.id) === serverId)?.name ?? '—' },
            { name: 'Роль', value: `${role.label} | ${discordRole}` },
            { name: 'Запрос получен', value: `<t:${Math.floor(receivedAt.getTime() / 1000)}:F>` },
          )
          .setFooter({
            text: interaction.guild.name,
            iconURL: interaction.guild.iconURL({ size: 64 }) ?? undefined,
          });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`review:approve:${requestId}`).setLabel('Одобрить').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`review:reject:${requestId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger),
        );
        const message = await reviewChannel.send({ embeds: [embed], components: [row] });
        await setReviewMessage(requestId, message.id);
        submitted += 1;
      } catch (error) {
        console.error('Could not submit a role request:', error);
        failed += 1;
      }
    }
  }

  sessions.delete(session.id);
  await interaction.followUp({
    content: `Отправлено заявок: ${submitted}.${failed ? ` Не удалось отправить: ${failed}. Проверь, что канал модерации доступен боту и роли существуют.` : ''}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReview(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, action, rawId] = interaction.customId.split(':');
  const requestId = Number(rawId);
  if (!Number.isSafeInteger(requestId)) {
    await interaction.editReply({ content: 'Некорректный номер заявки.' });
    return;
  }
  const result = await decideRoleRequest(interaction, requestId, action, interaction.message);
  await interaction.editReply({ content: result.text });
}

async function handleRemoveRoles(interaction) {
  if (interaction.customId === 'panel:remove') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:remove-confirm').setLabel('Да, снять').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel:remove-cancel').setLabel('Отмена').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ content: 'Снять все роли из каталога этого бота? Будут удалены только назначенные ботом каталоговые роли.', components: [row], flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId === 'panel:remove-cancel') {
    await interaction.update({ content: 'Действие отменено.', components: [] });
    return;
  }
  await interaction.deferUpdate();
  const roleIds = await getManagedRoleIds();
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const toRemove = roleIds.filter((roleId) => member.roles.cache.has(roleId));
  if (!toRemove.length) {
    await interaction.editReply({ content: 'У тебя нет ролей из каталога бота.', components: [] });
    return;
  }
  await member.roles.remove(toRemove, 'Участник запросил снятие ролей через панель');
  await interaction.editReply({ content: `Снято ролей: ${toRemove.length}.`, components: [] });
}

export async function handleInteraction(interaction) {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'delmarket') await handleMarketAutocomplete(interaction);
    return;
  }

  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction);
    return;
  }

  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('market:')) {
    await handleMarketInteraction(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('leaders:')) {
    await handleLeadersButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === 'ticket:create') {
    await handleTicketCreateButton(interaction);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket:create-modal') {
    await handleTicketModalSubmit(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('panel:')) {
    if (!interaction.inGuild()) return;
    if (interaction.customId === 'panel:request') await openRoleFlow(interaction);
    else await handleRemoveRoles(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('review:')) {
    if (interaction.customId === 'review:done') return;
    await handleReview(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('mod:')) {
    await handleModerationDashboardInteraction(interaction);
    return;
  }

  const isSelect = interaction.isStringSelectMenu();
  const isButton = interaction.isButton();
  if (!isSelect && !isButton) return;
  if (!interaction.customId.startsWith('flow:')) return;
  const [, action, sessionId] = interaction.customId.split(':');
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    await interaction.reply({ content: 'Сессия истекла. Начни запрос заново.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({ content: 'Эта форма принадлежит другому пользователю.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'cancel') {
    sessions.delete(sessionId);
    await interaction.update({ content: 'Запрос отменён.', components: [] });
    return;
  }
  if (action === 'servers') {
    const start = session.serverPage * PAGE_SIZE;
    const pageIds = new Set(session.servers.slice(start, start + PAGE_SIZE).map((item) => String(item.id)));
    session.serverIds = session.serverIds.filter((id) => !pageIds.has(id)).concat(interaction.values);
    await interaction.update(serverSelectionView(session));
    return;
  }
  if (action === 'server-prev' || action === 'server-next') {
    session.serverPage += action === 'server-next' ? 1 : -1;
    await interaction.update(serverSelectionView(session));
    return;
  }
  if (action === 'server-continue') {
    await beginRoles(interaction, session);
    return;
  }
  if (action === 'roles') {
    const serverId = session.serverIds[session.serverIndex];
    const start = session.rolePage * PAGE_SIZE;
    const pageIds = new Set(session.currentRoles.slice(start, start + PAGE_SIZE).map((item) => String(item.id)));
    const previous = session.roleIdsByServer[serverId] ?? [];
    session.roleIdsByServer[serverId] = previous.filter((id) => !pageIds.has(id)).concat(interaction.values);
    await interaction.deferUpdate();
    await interaction.editReply(await roleSelectionView(session, interaction.guild));
    return;
  }
  if (action === 'role-prev' || action === 'role-next') {
    session.rolePage += action === 'role-next' ? 1 : -1;
    await interaction.deferUpdate();
    await interaction.editReply(await roleSelectionView(session, interaction.guild));
    return;
  }
  if (action === 'role-continue') {
    const currentServer = session.serverIds[session.serverIndex];
    const chosen = (session.roleIdsByServer[currentServer] ?? []).length;
    if (!chosen && session.currentRoles.length > 0) {
      await interaction.reply({ content: 'Выбери хотя бы одну должность.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (session.serverIndex === session.serverIds.length - 1) {
      if (!chosen) {
        const hasEarlierSelections = Object.values(session.roleIdsByServer).some((roleIds) => roleIds.length > 0);
        if (hasEarlierSelections) {
          await submitRequests(interaction, session);
        } else {
          sessions.delete(session.id);
          await interaction.update({ content: 'Нет новых должностей для отправки.', components: [] });
        }
        return;
      }
      await submitRequests(interaction, session);
      return;
    }
    session.serverIndex += 1;
    session.rolePage = 0;
    await interaction.deferUpdate();
    await interaction.editReply(await roleSelectionView(session, interaction.guild));
  }
}
