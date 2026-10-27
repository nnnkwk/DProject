import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  addMarketItem,
  deleteMarketItem,
  getBotSettings,
  getMarketItem,
  getMarketItems,
  getNefrits,
  purchaseMarketItem,
  saveMarketMessageId,
} from './database.js';
import { CURRENCY_NAME, formatNefrits } from './economy.js';

export const MARKET_COMMANDS = new Set(['addmarket', 'delmarket']);

const BUY_BUTTON_ID = 'market:buy';
const SELECT_ID = 'market:select';
const CONFIRM_PREFIX = 'market:confirm:';
const CANCEL_ID = 'market:cancel';
const MAX_ITEMS = 25; // лимит Discord на варианты в меню выбора
const UNKNOWN_MESSAGE_CODE = 10008;
const EMBED_COLOR = 0x2ecc71;
const purchasesInProgress = new Set();

function buildMarketMessage(items) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Магазин');

  embed.setDescription(items.length
    ? items.map((item, index) => `**${index + 1}.** ${item.name} — ${formatNefrits(item.price)}`).join('\n')
    : 'Товаров пока нет.');

  const button = new ButtonBuilder()
    .setCustomId(BUY_BUTTON_ID)
    .setLabel('Купить')
    .setStyle(ButtonStyle.Success)
    .setDisabled(!items.length);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

// Публикует сообщение магазина или редактирует уже опубликованное.
export async function refreshMarketMessage(client) {
  const settings = await getBotSettings();
  if (!settings?.market_channel_id) return { published: false, reason: 'no_channel' };

  const channel = await client.channels.fetch(settings.market_channel_id);
  if (!channel?.isTextBased() || channel.isDMBased()) return { published: false, reason: 'bad_channel' };

  const payload = buildMarketMessage(await getMarketItems());
  if (settings.market_message_id) {
    try {
      const message = await channel.messages.fetch(settings.market_message_id);
      await message.edit(payload);
      return { published: true };
    } catch (error) {
      if (error?.code !== UNKNOWN_MESSAGE_CODE) throw error;
    }
  }
  const message = await channel.send(payload);
  await saveMarketMessageId(message.id);
  return { published: true };
}

export async function ensureMarketPanel(client) {
  try {
    const result = await refreshMarketMessage(client);
    if (result.reason === 'no_channel') {
      console.warn('Магазин отключён: укажите market_channel_id в таблице bot_settings.');
    } else if (result.reason === 'bad_channel') {
      console.warn('market_channel_id в bot_settings должен указывать на текстовый канал сервера.');
    }
  } catch (error) {
    console.error('Could not publish market message:', error);
  }
}

async function refreshNote(client, doneNote = '') {
  try {
    const result = await refreshMarketMessage(client);
    if (result.reason === 'no_channel') return '\nКанал магазина не задан: укажите `market_channel_id` в `bot_settings`.';
    if (result.reason === 'bad_channel') return '\n`market_channel_id` должен указывать на текстовый канал сервера.';
  } catch (error) {
    console.error('Could not update market message:', error);
    return '\nСообщение магазина обновить не удалось (проверьте права бота в канале).';
  }
  return doneNote;
}

async function findMarketItem(query) {
  const value = query.trim();
  if (/^\d+$/.test(value)) return getMarketItem(Number(value));
  const items = await getMarketItems();
  return items.find((item) => item.name.toLowerCase() === value.toLowerCase()) ?? null;
}

async function removeMarketItem(interaction) {
  const item = await findMarketItem(interaction.options.getString('item', true));
  if (!item || !await deleteMarketItem(item.id)) {
    await interaction.editReply({ content: 'Такого товара нет в магазине.' });
    return;
  }
  const note = await refreshNote(interaction.client);
  await interaction.editReply({
    content: `Товар **${item.name}** удалён из магазина.${note}`,
    allowedMentions: { parse: [] },
  });
}

export async function handleMarketAutocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const items = await getMarketItems();
  await interaction.respond(items
    .filter((item) => item.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((item) => ({ name: truncate(`${item.name} — ${item.price}`, 100), value: String(item.id) })));
}

export async function handleMarketCommand(interaction) {
  if (interaction.commandName === 'delmarket') {
    await removeMarketItem(interaction);
    return;
  }
  const name = interaction.options.getString('name', true).trim();
  const price = interaction.options.getInteger('price', true);
  if (!name) {
    await interaction.editReply({ content: 'Название товара не может быть пустым.' });
    return;
  }

  const items = await getMarketItems();
  if (items.length >= MAX_ITEMS) {
    await interaction.editReply({ content: `В магазине уже ${MAX_ITEMS} товаров — это максимум для меню выбора.` });
    return;
  }

  try {
    await addMarketItem(name, price, interaction.user.id);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      await interaction.editReply({ content: 'Товар с таким названием уже есть в магазине.' });
      return;
    }
    throw error;
  }

  const note = await refreshNote(interaction.client);
  await interaction.editReply({
    content: `Товар **${name}** добавлен: ${formatNefrits(price)}.${note}`,
    allowedMentions: { parse: [] },
  });
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function showItemSelect(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const items = await getMarketItems();
  if (!items.length) {
    await interaction.editReply({ content: 'В магазине пока нет товаров.' });
    return;
  }
  const balance = await getNefrits(interaction.user.id);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder('Выберите товар')
    .addOptions(items.map((item) => ({
      label: truncate(item.name, 100),
      description: formatNefrits(item.price).replace(/^\S+ /, `${CURRENCY_NAME}: `),
      value: String(item.id),
    })));
  await interaction.editReply({
    content: `Ваш баланс: ${formatNefrits(balance)}\nВыберите товар, который хотите купить.`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function showConfirmation(interaction) {
  await interaction.deferUpdate();
  const item = await getMarketItem(Number(interaction.values[0]));
  if (!item) {
    await interaction.editReply({ content: 'Этот товар больше недоступен.', components: [] });
    return;
  }
  const balance = await getNefrits(interaction.user.id);
  const enough = balance >= item.price;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_PREFIX}${item.id}`)
      .setLabel('Подтвердить покупку')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enough),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({
    content: `Купить **${item.name}** за ${formatNefrits(item.price)}?\nВаш баланс: ${formatNefrits(balance)}`
      + `${enough ? '' : `\nНе хватает: ${formatNefrits(item.price - balance)}`}`,
    components: [row],
  });
}

// Красивое оповещение о покупке в канал market_log_channel_id (если он задан).
async function announcePurchase(interaction, item) {
  try {
    const settings = await getBotSettings();
    if (!settings?.market_log_channel_id) return;
    const channel = await interaction.client.channels.fetch(settings.market_log_channel_id);
    if (!channel?.isTextBased() || channel.isDMBased()) return;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setAuthor({
        name: 'Новая покупка в магазине',
        iconURL: interaction.user.displayAvatarURL({ size: 128 }),
      })
      .setThumbnail(interaction.member?.displayAvatarURL?.({ size: 256 }) ?? interaction.user.displayAvatarURL({ size: 256 }))
      .setDescription(`${interaction.user} приобрёл(а) товар **${item.name}**`)
      .addFields(
        { name: 'Товар', value: item.name, inline: true },
        { name: 'Стоимость', value: formatNefrits(item.price), inline: true },
        { name: 'Покупатель', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: false },
      )
      .setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('Could not send purchase notification:', error);
  }
}

async function completePurchase(interaction) {
  await interaction.deferUpdate();
  const itemId = Number(interaction.customId.slice(CONFIRM_PREFIX.length));
  if (purchasesInProgress.has(interaction.user.id)) return;
  purchasesInProgress.add(interaction.user.id);
  let result;
  try {
    result = await purchaseMarketItem(interaction.user.id, itemId);
  } finally {
    purchasesInProgress.delete(interaction.user.id);
  }
  if (result.status === 'missing') {
    await interaction.editReply({ content: 'Этот товар больше недоступен.', components: [] });
    return;
  }
  if (result.status === 'insufficient') {
    await interaction.editReply({
      content: `Недостаточно Нефритов: нужно ${formatNefrits(result.item.price)}, у вас ${formatNefrits(result.balance)}.`,
      components: [],
    });
    return;
  }
  await announcePurchase(interaction, result.item);
  await interaction.editReply({
    content: `Покупка совершена: **${result.item.name}** за ${formatNefrits(result.item.price)}.\nОстаток: ${formatNefrits(result.after)}`,
    components: [],
  });
}

export async function handleMarketInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === BUY_BUTTON_ID) {
    await showItemSelect(interaction);
  } else if (interaction.isStringSelectMenu() && interaction.customId === SELECT_ID) {
    await showConfirmation(interaction);
  } else if (interaction.isButton() && interaction.customId.startsWith(CONFIRM_PREFIX)) {
    await completePurchase(interaction);
  } else if (interaction.isButton() && interaction.customId === CANCEL_ID) {
    await interaction.update({ content: 'Покупка отменена.', components: [] });
  }
}
