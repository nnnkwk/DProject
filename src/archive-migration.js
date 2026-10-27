import { ChannelType, EmbedBuilder } from 'discord.js';
import {
  getBotSettings,
  getModeratorArchiveThreads,
  setArchiveEmbedsVersion,
} from './database.js';

export const MODERATOR_CARD_TITLE = 'Информация о модераторе';
const OLD_CARD_TITLE = 'Назначение модератора';
const POINTS_FIELD = 'Баллы';
const PREVIOUS_ARCHIVE_FIELD = 'Предыдущий архив';
const ARCHIVE_EMBEDS_VERSION = 2;

export function withPointsField(fields, value) {
  const existing = fields.find((field) => field.name === POINTS_FIELD);
  const rest = fields.filter((field) => field.name !== POINTS_FIELD);
  const previousIndex = rest.findIndex((field) => field.name === PREVIOUS_ARCHIVE_FIELD);
  const pointsField = { name: POINTS_FIELD, value: value ?? existing?.value ?? '0' };
  rest.splice(previousIndex === -1 ? rest.length : previousIndex, 0, pointsField);
  return rest;
}

export async function migrateModeratorArchiveEmbeds(client, guildId) {
  const settings = await getBotSettings();
  if (!settings || Number(settings.archive_embeds_version ?? 0) >= ARCHIVE_EMBEDS_VERSION) return;

  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
  const forum = settings.moderator_forum_channel_id
    ? await guild.channels.fetch(settings.moderator_forum_channel_id).catch(() => null)
    : null;
  if (forum?.type !== ChannelType.GuildForum) {
    console.warn('Archive embeds were not updated: the moderator forum is not configured.');
    return;
  }

  const pointsByThread = new Map(
    (await getModeratorArchiveThreads()).map((row) => [row.archive_thread_id, Number(row.points)]),
  );

  const threads = new Map();
  let failures = 0;
  try {
    for (const thread of (await forum.threads.fetchActive()).threads.values()) threads.set(thread.id, thread);
    let before;
    for (let page = 0; page < 200; page += 1) {
      const archived = await forum.threads.fetchArchived({ type: 'public', limit: 100, before });
      for (const thread of archived.threads.values()) threads.set(thread.id, thread);
      if (!archived.hasMore || !archived.threads.size) break;
      before = archived.threads.last();
    }
  } catch (error) {
    failures += 1;
    console.error('Could not list all moderator archive threads:', error);
  }
  for (const threadId of pointsByThread.keys()) {
    if (threads.has(threadId)) continue;
    const thread = await forum.guild.channels.fetch(threadId).catch(() => null);
    if (thread?.isThread()) threads.set(thread.id, thread);
  }

  let updated = 0;
  for (const thread of threads.values()) {
    try {
      const starter = await thread.fetchStarterMessage().catch(() => null);
      const embed = starter?.embeds?.[0];
      if (!embed || starter.author.id !== client.user.id) continue;

      const needsTitle = embed.title === OLD_CARD_TITLE;
      const existingPoints = embed.fields.find((field) => field.name === POINTS_FIELD);
      const orderedFields = pointsByThread.has(thread.id)
        ? withPointsField(embed.fields, existingPoints ? undefined : String(pointsByThread.get(thread.id)))
        : null;
      const needsPoints = orderedFields !== null
        && orderedFields.map((field) => field.name).join('|') !== embed.fields.map((field) => field.name).join('|');
      if (!needsTitle && !needsPoints) continue;

      const wasArchived = thread.archived;
      if (wasArchived) await thread.setArchived(false, 'Обновление карточки модератора');
      try {
        const updatedEmbed = EmbedBuilder.from(embed);
        if (needsTitle) updatedEmbed.setTitle(MODERATOR_CARD_TITLE);
        if (needsPoints) updatedEmbed.setFields(orderedFields);
        await starter.edit({ embeds: [updatedEmbed, ...starter.embeds.slice(1)] });
        updated += 1;
      } finally {
        if (wasArchived) {
          await thread.setArchived(true, 'Закрытие архива после обновления карточки')
            .catch((error) => console.error(`Could not re-archive thread ${thread.id}:`, error));
        }
      }
    } catch (error) {
      failures += 1;
      console.error(`Could not update the moderator card in thread ${thread.id}:`, error);
    }
  }

  console.log(`Moderator archive cards updated: ${updated}, errors: ${failures}.`);
  if (!failures) await setArchiveEmbedsVersion(ARCHIVE_EMBEDS_VERSION);
}