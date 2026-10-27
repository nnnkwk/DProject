import 'dotenv/config';
import { ActivityType, ChannelType, Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import { incrementModeratorWeeklyMessage, pool } from './database.js';
import { migrateModeratorArchiveEmbeds } from './archive-migration.js';
import { handleInteraction } from './interactions.js';
import { getMoscowWeekStart } from './moderators.js';
import { PUNISHMENT_COMMANDS, startTempBanScheduler } from './punishments.js';
import { handleMessageExp, isMainChatMessage, PUBLIC_LEVEL_COMMANDS, startVoiceExpTracker } from './levels.js';
import { ensureTicketPanel, startTicketScheduler, TICKET_COMMANDS } from './tickets.js';

const PUBLIC_REPLY_COMMANDS = new Set([...PUNISHMENT_COMMANDS, ...TICKET_COMMANDS, ...PUBLIC_LEVEL_COMMANDS]);

const targetGuildId = process.env.DISCORD_GUILD_ID?.trim();
if (!process.env.DISCORD_TOKEN || !targetGuildId) {
  throw new Error('Set DISCORD_TOKEN and DISCORD_GUILD_ID in .env. This bot is configured for one Discord server.');
}
if (!/^\d{17,20}$/.test(targetGuildId)) {
  throw new Error('DISCORD_GUILD_ID must be the numeric ID of the one Discord server.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

async function updateMemberCountStatus() {
  try {
    const guild = await client.guilds.fetch({ guild: targetGuildId, force: true });
    const count = guild.approximateMemberCount ?? guild.memberCount;
    client.user.setPresence({
      status: 'online',
      activities: [{ name: `за ${count} участниками`, type: ActivityType.Watching }],
    });
  } catch (error) {
    console.error('Could not update member count status:', error);
  }
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  updateMemberCountStatus();
  setInterval(updateMemberCountStatus, 5 * 60_000);
  startTempBanScheduler(client, targetGuildId);
  ensureTicketPanel(client);
  startTicketScheduler(client);
  startVoiceExpTracker(client, targetGuildId);
  migrateModeratorArchiveEmbeds(client, targetGuildId)
    .catch((error) => console.error('Could not update moderator archive cards:', error));
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.guildId !== targetGuildId) {
    if (interaction.isChatInputCommand() || interaction.isButton() || interaction.isStringSelectMenu()) {
      await interaction.reply({
        content: 'Этот бот настроен для другого Discord-сервера.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
    return;
  }

  try {
    const dispatchDelay = Date.now() - interaction.createdTimestamp;
    if (dispatchDelay > 1000) {
      console.warn(`Interaction reached the handler after ${dispatchDelay}ms.`);
    }
    if (interaction.isChatInputCommand() && !PUBLIC_REPLY_COMMANDS.has(interaction.commandName)
      && !interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    if (interaction.isChatInputCommand() && PUBLIC_REPLY_COMMANDS.has(interaction.commandName)
      && !interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }
    if (interaction.isButton() && interaction.customId === 'panel:request') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    await handleInteraction(interaction);
  } catch (error) {
    console.error('Interaction failed:', error);
    const response = { content: 'Произошла внутренняя ошибка. Попробуйте позже или обратитесь к администратору.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.guildId !== targetGuildId || message.author.bot || message.system) return;
  if (message.channel.isThread() && message.channel.parent?.type === ChannelType.GuildForum) return;
  try {
    if (!await isMainChatMessage(message)) return;
  } catch (error) {
    console.error('Could not check the main chat:', error);
    return;
  }
  handleMessageExp(message);
  incrementModeratorWeeklyMessage(message.author.id, getMoscowWeekStart())
    .catch((error) => console.error('Could not record moderator weekly message count:', error));
});

await pool.query('SELECT 1');
await client.login(process.env.DISCORD_TOKEN);

async function shutdown() {
  client.destroy();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);