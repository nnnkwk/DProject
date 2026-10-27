import { EmbedBuilder } from 'discord.js';
import { changeNefrits, getBotSettings, getNefrits } from './database.js';

export const CURRENCY_NAME = 'Нефриты';
export const CURRENCY_EMOJI = '\u{1F7E2}';
const EMBED_COLOR = 0x2ecc71;

export const ECONOMY_COMMANDS = new Set(['nefrit', 'profile']);
export const PUBLIC_ECONOMY_COMMANDS = new Set(['profile']);

const numberFormat = new Intl.NumberFormat('ru-RU');

export function formatNefrits(value) {
  return `${CURRENCY_EMOJI} ${numberFormat.format(value)}`;
}

function userLine(user) {
  return `${user.id} | <@${user.id}>`;
}

// Лог экономических действий модераторов в канал economy_log_channel (если задан).
export async function logEconomyAction(interaction, { title, user, fields }) {
  try {
    const settings = await getBotSettings();
    const channelId = settings?.economy_log_channel;
    if (!channelId) return;
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.isDMBased()) return;

    const { guild } = interaction;
    const embed = new EmbedBuilder()
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
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('Could not send economy log:', error);
  }
}

async function changeBalance(interaction) {
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason')?.trim() || null;

  if (user.bot) {
    await interaction.editReply({ content: 'У ботов нет профиля и Нефритов.' });
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

  const result = await changeNefrits(user.id, amount, interaction.user.id, reason);
  if (!result.ok) {
    await interaction.editReply({
      content: `Нельзя снять ${numberFormat.format(Math.abs(amount))}: у ${member} только ${formatNefrits(result.before)}.`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await logEconomyAction(interaction, {
    title: amount > 0 ? 'Выдача Нефритов' : 'Снятие Нефритов',
    user,
    fields: [
      { name: 'Изменение', value: `${CURRENCY_EMOJI} ${amount > 0 ? '+' : '-'}${numberFormat.format(Math.abs(amount))}` },
      { name: 'Баланс', value: `${formatNefrits(result.before)} → ${formatNefrits(result.after)}` },
      ...(reason ? [{ name: 'Причина', value: reason }] : []),
    ],
  });
  await interaction.editReply({
    content: `${CURRENCY_NAME} ${member} изменены на ${amount > 0 ? '+' : ''}${numberFormat.format(amount)}.\n`
      + `Было: ${formatNefrits(result.before)}\nСтало: ${formatNefrits(result.after)}`
      + `${reason ? `\nПричина: ${reason}` : ''}`,
    allowedMentions: { parse: [] },
  });
}

async function showProfile(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  if (user.bot) {
    await interaction.editReply({ content: 'У ботов нет профиля.' });
    return;
  }
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const nefrits = await getNefrits(user.id);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({
      name: `Профиль ${member?.displayName ?? user.globalName ?? user.username}`,
      iconURL: (member ?? user).displayAvatarURL({ size: 128 }),
    })
    .setThumbnail((member ?? user).displayAvatarURL({ size: 256 }))
    .addFields({ name: CURRENCY_NAME, value: formatNefrits(nefrits), inline: true });

  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

export async function handleEconomyCommand(interaction) {
  if (interaction.commandName === 'profile') {
    await showProfile(interaction);
    return;
  }
  await changeBalance(interaction);
}
