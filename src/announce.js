import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getBotSettings } from './database.js';

export const ANNOUNCE_USER_ID = '1068921869408944128';
export const MODAL_COMMANDS = new Set(['announce']);

const EMBED_COLOR = 0x2b2d31;
const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map();

async function deny(interaction) {
  await interaction.reply({ content: 'У вас нет доступа к этой команде.', flags: MessageFlags.Ephemeral });
}

function textRow({ id, label, style, required, maxLength, placeholder }) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(input);
}

export async function handleAnnounceCommand(interaction) {
  if (interaction.user.id !== ANNOUNCE_USER_ID) {
    await deny(interaction);
    return;
  }
  const role = interaction.options.getRole('ping');
  const modal = new ModalBuilder()
    .setCustomId(`announce:modal:${role?.id ?? '0'}`)
    .setTitle('Новость об обновлении')
    .addComponents(
      textRow({
        id: 'title', label: 'Заголовок', style: TextInputStyle.Short, required: true, maxLength: 100,
        placeholder: 'Например: Обновление 1.4.0',
      }),
      textRow({ id: 'description', label: 'Описание', style: TextInputStyle.Paragraph, required: false, maxLength: 2000 }),
      textRow({ id: 'added', label: 'Добавлено', style: TextInputStyle.Paragraph, required: false, maxLength: 1024 }),
      textRow({ id: 'changed', label: 'Изменено', style: TextInputStyle.Paragraph, required: false, maxLength: 1024 }),
      textRow({ id: 'fixed', label: 'Исправлено', style: TextInputStyle.Paragraph, required: false, maxLength: 1024 }),
    );
  await interaction.showModal(modal);
}

function purgeExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}

export async function handleAnnounceModal(interaction) {
  if (interaction.user.id !== ANNOUNCE_USER_ID) {
    await deny(interaction);
    return;
  }
  const [, , roleId] = interaction.customId.split(':');
  const get = (id) => interaction.fields.getTextInputValue(id).trim();
  const title = get('title');
  const description = get('description');
  const sections = [
    ['Добавлено', get('added')],
    ['Изменено', get('changed')],
    ['Исправлено', get('fixed')],
  ].filter(([, value]) => value);

  if (!description && !sections.length) {
    await interaction.reply({
      content: 'Заполните хотя бы одно из полей: описание, «Добавлено», «Изменено» или «Исправлено».',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { guild } = interaction;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined });
  if (description) embed.setDescription(description);
  if (sections.length) embed.addFields(sections.map(([name, value]) => ({ name, value })));

  purgeExpiredSessions();
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    embed: embed.toJSON(),
    roleId: roleId && roleId !== '0' ? roleId : null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`announce:publish:${sessionId}`).setLabel('Опубликовать').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`announce:cancel:${sessionId}`).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content: 'Предпросмотр новости. Опубликовать её в канал новостей?',
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleAnnounceButton(interaction) {
  if (interaction.user.id !== ANNOUNCE_USER_ID) {
    await deny(interaction);
    return;
  }
  const [, action, sessionId] = interaction.customId.split(':');
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    await interaction.update({ content: 'Черновик устарел. Вызовите /announce заново.', embeds: [], components: [] });
    return;
  }

  if (action === 'cancel') {
    sessions.delete(sessionId);
    await interaction.update({ content: 'Публикация отменена.', embeds: [], components: [] });
    return;
  }

  const settings = await getBotSettings();
  if (!settings?.updates_news) {
    await interaction.reply({
      content: 'Канал новостей не задан: укажите `updates_news` в таблице `bot_settings`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const channel = await interaction.client.channels.fetch(settings.updates_news).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    await interaction.reply({
      content: '`updates_news` должен указывать на текстовый канал сервера, доступный боту.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let message;
  try {
    message = await channel.send({
      content: session.roleId ? `<@&${session.roleId}>` : undefined,
      embeds: [EmbedBuilder.from(session.embed)],
      allowedMentions: session.roleId ? { roles: [session.roleId] } : { parse: [] },
    });
  } catch (error) {
    console.error('Could not publish update news:', error);
    await interaction.reply({
      content: 'Не удалось отправить сообщение. Проверьте права бота в канале новостей.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  sessions.delete(sessionId);
  await interaction.update({ content: `Новость опубликована: ${message.url}`, embeds: [], components: [] });
}