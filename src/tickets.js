import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  claimTicketHold,
  closeTicketRecord,
  createTicketRecord,
  deleteTicketRecord,
  getBotSettings,
  getPositionRoleIds,
  getTicketByChannel,
  getTicketsDueForDeletion,
  markTicketArchived,
  markTicketDeleted,
  releaseTicketHold,
  setTicketChannel,
} from './database.js';
import { TICKET_TEAMS } from './ticket-teams.js';

export const TICKET_COMMANDS = new Set(['hold', 'close', 'pass']);

const CREATE_BUTTON_ID = 'ticket:create';
const CREATE_MODAL_ID = 'ticket:create-modal';
const CONTENT_INPUT_ID = 'ticket:content';
const UNKNOWN_CHANNEL_CODE = 10003;
const MAX_TRANSCRIPT_BYTES = 8_000_000;

const INITIAL_STAFF_POSITIONS = [
  'senior_moderator',
  'moderation_curator',
  'deputy_head_moderator',
  'head_moderator',
  'discord_administrator',
];

const MEMBER_TICKET_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

async function getTicketConfig() {
  const settings = await getBotSettings();
  const config = {
    channelId: settings?.ticket_channel_id,
    openedCategoryId: settings?.tickets_opened_category_id,
    heldCategoryId: settings?.tickets_held_category_id,
    closedCategoryId: settings?.tickets_closed_category_id,
    archiveChannelId: settings?.tickets_archive_channel_id,
  };
  config.ready = Object.values(config).every((value) => /^\d{17,20}$/.test(value ?? ''));
  return config;
}

function ticketNumber(id) {
  return String(id).padStart(4, '0');
}

function ticketChannelName(id) {
  return `тикет-${ticketNumber(id)}`;
}

export async function ensureTicketPanel(client) {
  try {
    const config = await getTicketConfig();
    if (!config.ready) {
      console.warn('Система тикетов отключена: заполните настройки обращений в таблице bot_settings.');
      return;
    }
    const channel = await client.channels.fetch(config.channelId);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      console.warn('ticket_channel_id в bot_settings должен указывать на текстовый канал сервера.');
      return;
    }
    const recent = await channel.messages.fetch({ limit: 50 });
    const exists = recent.some((message) => message.author.id === client.user.id
      && message.components.some((row) => row.components.some((component) => component.customId === CREATE_BUTTON_ID)));
    if (exists) return;

    const embed = new EmbedBuilder()
      .setColor(0x2f3136)
      .setTitle('Обращение в поддержку')
      .setDescription('Если у вас возник вопрос или проблема, нажмите кнопку ниже и опишите суть обращения. '
        + 'Для вас будет создан приватный канал, в котором с вами свяжется команда модерации.');
    await channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CREATE_BUTTON_ID)
          .setLabel('Создать обращение')
          .setStyle(ButtonStyle.Primary),
      )],
    });
  } catch (error) {
    console.error('Could not publish ticket panel:', error);
  }
}

export async function handleTicketCreateButton(interaction) {
  if (!(await getTicketConfig()).ready) {
    await interaction.reply({ content: 'Система обращений пока не настроена.', flags: MessageFlags.Ephemeral });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(CREATE_MODAL_ID)
    .setTitle('Новое обращение')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(CONTENT_INPUT_ID)
        .setLabel('Суть обращения')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Опишите ваш вопрос или проблему')
        .setMinLength(10)
        .setMaxLength(1500)
        .setRequired(true),
    ));
  await interaction.showModal(modal);
}

export async function handleTicketModalSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await getTicketConfig();
  if (!config.ready) {
    await interaction.editReply({ content: 'Система обращений пока не настроена.' });
    return;
  }
  const content = interaction.fields.getTextInputValue(CONTENT_INPUT_ID).trim();
  if (!content) {
    await interaction.editReply({ content: 'Опишите суть обращения.' });
    return;
  }

  const guild = interaction.guild;
  const ticketId = await createTicketRecord(interaction.user.id, content);
  let channel = null;
  try {
    const staffRoleIds = Object.values(await getPositionRoleIds(INITIAL_STAFF_POSITIONS));
    const seniorRoleId = (await getPositionRoleIds(['senior_moderator'])).senior_moderator ?? null;
    const botId = interaction.client.user.id;

    channel = await guild.channels.create({
      name: ticketChannelName(ticketId),
      type: ChannelType.GuildText,
      parent: config.openedCategoryId,
      topic: `Обращение №${ticketNumber(ticketId)} | автор: ${interaction.user.tag}`.slice(0, 1024),
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: MEMBER_TICKET_PERMISSIONS },
        { id: botId, allow: MEMBER_TICKET_PERMISSIONS },
        ...staffRoleIds.map((id) => ({ id, allow: MEMBER_TICKET_PERMISSIONS })),
      ],
      reason: `Обращение №${ticketNumber(ticketId)} от ${interaction.user.tag}`,
    });
    await setTicketChannel(ticketId, channel.id);

    if (!seniorRoleId) console.warn('Для senior_moderator не настроена роль в moderator_position_roles: пинг в обращении пропущен.');
    const embed = new EmbedBuilder()
      .setColor(0x2f3136)
      .setTitle('Обращение к команде поддержки')
      .setDescription(content)
      .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ size: 64 }) })
      .setFooter({ text: `Обращение №${ticketNumber(ticketId)}` });
    await channel.send({
      content: seniorRoleId ? `<@&${seniorRoleId}>` : undefined,
      embeds: [embed],
      allowedMentions: { roles: seniorRoleId ? [seniorRoleId] : [] },
    });
    await interaction.editReply({ content: `Обращение создано: ${channel}` });
  } catch (error) {
    console.error('Could not create ticket:', error);
    if (channel) await channel.delete('Не удалось завершить создание обращения').catch(() => {});
    await deleteTicketRecord(ticketId).catch(() => {});
    await interaction.editReply({ content: 'Не удалось создать обращение. Попробуйте позже или обратитесь к администратору.' });
  }
}

async function reject(interaction, content) {
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  await interaction.deleteReply().catch(() => {});
}

async function moveTicketChannel(channel, categoryId, reason) {
  await channel.setParent(categoryId, { lockPermissions: false, reason });
}

async function getTicketForCommand(interaction) {
  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'deleted') {
    await reject(interaction, 'Эту команду можно использовать только в канале обращения.');
    return null;
  }
  if (ticket.status === 'closed') {
    await reject(interaction, 'Обращение уже закрыто.');
    return null;
  }
  return ticket;
}

async function holdTicket(interaction, config) {
  const ticket = await getTicketForCommand(interaction);
  if (!ticket) return;
  if (ticket.held_by === interaction.user.id) {
    await reject(interaction, 'Обращение уже закреплено за вами.');
    return;
  }
  if (ticket.held_by) {
    await reject(interaction, `Обращение уже закреплено за <@${ticket.held_by}>.`);
    return;
  }
  if (!await claimTicketHold(ticket.id, interaction.user.id)) {
    const current = await getTicketByChannel(interaction.channelId);
    await reject(interaction, current?.held_by ? `Обращение уже закреплено за <@${current.held_by}>.` : 'Не удалось закрепить обращение.');
    return;
  }
  try {
    await moveTicketChannel(interaction.channel, config.heldCategoryId, `Обращение закреплено за ${interaction.user.tag}`);
  } catch (error) {
    console.error('Could not move ticket to held category:', error);
    await releaseTicketHold(ticket.id);
    await reject(interaction, 'Не удалось переместить канал в категорию закреплённых обращений. Проверьте категорию закреплённых обращений в bot_settings и права бота.');
    return;
  }
  await interaction.editReply({
    content: `Модератор ${interaction.user} закрепил обращение за собой.`,
    allowedMentions: { parse: [] },
  });
}

async function closeTicket(interaction, config) {
  const ticket = await getTicketForCommand(interaction);
  if (!ticket) return;
  if (!await closeTicketRecord(ticket.id, interaction.user.id)) {
    await reject(interaction, 'Обращение уже закрыто.');
    return;
  }
  const problems = [];
  try {
    await interaction.channel.permissionOverwrites.delete(ticket.user_id, 'Обращение закрыто');
  } catch (error) {
    console.error('Could not remove ticket author access:', error);
    problems.push('не удалось закрыть доступ автору');
  }
  try {
    await moveTicketChannel(interaction.channel, config.closedCategoryId, `Обращение закрыто ${interaction.user.tag}`);
  } catch (error) {
    console.error('Could not move ticket to closed category:', error);
    problems.push('не удалось переместить канал в категорию закрытых обращений');
  }
  const warning = problems.length ? `\nВнимание: ${problems.join('; ')}. Проверьте права бота.` : '';
  await interaction.editReply({
    content: `Модератор ${interaction.user} закрыл обращение. Канал останется доступным модерации 24 часа, затем будет удалён, а переписка отправится в архив.${warning}`,
    allowedMentions: { parse: [] },
  });
}

async function passTicket(interaction, config) {
  const ticket = await getTicketForCommand(interaction);
  if (!ticket) return;
  const team = TICKET_TEAMS[interaction.options.getString('team', true)];
  if (!team) {
    await reject(interaction, 'Неизвестная команда модерации.');
    return;
  }
  const roleIds = Object.values(await getPositionRoleIds(team.positions));
  if (!roleIds.length) {
    await reject(interaction, `Для команды «${team.label}» не настроены роли в таблице moderator_position_roles.`);
    return;
  }
  try {
    for (const roleId of roleIds) {
      await interaction.channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
      }, { reason: `Передача обращения команде ${team.label}` });
    }
  } catch (error) {
    console.error('Could not grant team access to ticket:', error);
    await reject(interaction, 'Не удалось выдать доступ выбранной команде. Проверьте права бота.');
    return;
  }

  if (ticket.held_by) {
    await releaseTicketHold(ticket.id);
    await moveTicketChannel(interaction.channel, config.openedCategoryId, 'Обращение передано другой команде')
      .catch((error) => console.error('Could not move passed ticket back to opened category:', error));
  }
  await interaction.editReply({
    content: `Модератор ${interaction.user} передал обращение команде ${team.label}\n${roleIds.map((id) => `<@&${id}>`).join(' ')}`,
    allowedMentions: { roles: roleIds },
  });
}

export async function handleTicketCommand(interaction) {
  const config = await getTicketConfig();
  if (!config.ready) {
    await reject(interaction, 'Система обращений не настроена: заполните настройки обращений в таблице bot_settings.');
    return;
  }
  switch (interaction.commandName) {
    case 'hold': return holdTicket(interaction, config);
    case 'close': return closeTicket(interaction, config);
    case 'pass': return passTicket(interaction, config);
    default: return reject(interaction, 'Неизвестная команда обращений.');
  }
}

function formatDate(value) {
  return value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
}

async function buildTranscript(channel, ticket) {
  const messages = [];
  let before;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `Обращение №${ticketNumber(ticket.id)}`,
    `Автор: ${ticket.user_id}`,
    `Создано: ${formatDate(ticket.created_at)}`,
    `Закреплено за: ${ticket.held_by ?? '—'}`,
    `Закрыто: ${formatDate(ticket.closed_at)} (модератор: ${ticket.closed_by ?? '—'})`,
    `Суть обращения: ${ticket.content}`,
    '='.repeat(60),
  ];
  for (const message of messages) {
    lines.push(`[${formatDate(message.createdTimestamp)}] ${message.author.tag} (${message.author.id}): ${message.content}`);
    for (const attachment of message.attachments.values()) {
      lines.push(`    [вложение] ${attachment.name}: ${attachment.url}`);
    }
    for (const embed of message.embeds) {
      const text = [embed.title, embed.description].filter(Boolean).join(' — ');
      if (text) lines.push(`    [эмбед] ${text}`);
    }
  }
  let text = lines.join('\n');
  if (Buffer.byteLength(text, 'utf8') > MAX_TRANSCRIPT_BYTES) {
    text = `${text.slice(0, MAX_TRANSCRIPT_BYTES / 4)}\n[... переписка обрезана из-за размера ...]`;
  }
  return text;
}

async function archiveAndDelete(client, config, ticket) {
  let channel = null;
  try {
    channel = await client.channels.fetch(ticket.channel_id);
  } catch (error) {
    if (error.code !== UNKNOWN_CHANNEL_CODE) throw error;
  }
  if (!channel) {
    console.warn(`Ticket channel ${ticket.channel_id} for ticket ${ticket.id} no longer exists.`);
    await markTicketDeleted(ticket.id);
    return;
  }

  if (!ticket.archived) {
    const transcript = await buildTranscript(channel, ticket);
    const archiveChannel = await client.channels.fetch(config.archiveChannelId);
    await archiveChannel.send({
      content: `Архив обращения №${ticketNumber(ticket.id)} | автор: <@${ticket.user_id}> | закрыл: ${ticket.closed_by ? `<@${ticket.closed_by}>` : '—'}`,
      files: [new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `ticket-${ticketNumber(ticket.id)}.txt` })],
      allowedMentions: { parse: [] },
    });
    await markTicketArchived(ticket.id);
  }
  await channel.delete('Обращение закрыто более 24 часов назад');
  await markTicketDeleted(ticket.id);
}

export function startTicketScheduler(client, intervalMs = 60_000) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const config = await getTicketConfig();
      if (!config.ready) return;
      for (const ticket of await getTicketsDueForDeletion()) {
        try {
          await archiveAndDelete(client, config, ticket);
        } catch (error) {
          console.error(`Could not archive ticket ${ticket.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Ticket scheduler failed:', error);
    } finally {
      running = false;
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}
