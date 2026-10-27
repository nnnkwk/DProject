import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandData } from './src/command-definitions.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  throw new Error('Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID in .env. Commands are deployed to one server only.');
}
if (!/^\d{17,20}$/.test(DISCORD_GUILD_ID)) {
  throw new Error('DISCORD_GUILD_ID must be the numeric ID of the one Discord server.');
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commandData });
await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: [] });
console.log(`Removed global commands and registered ${commandData.length} commands for guild ${DISCORD_GUILD_ID}.`);
