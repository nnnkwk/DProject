import { MessageFlags } from 'discord.js';
import { denyCommandAccess, hasCommandAccess } from './command-access.js';
import { handleLevelCommand, LEVEL_COMMANDS, PUBLIC_LEVEL_COMMANDS } from './levels.js';
import { handleModeratorCommand } from './moderators.js';
import { handlePunishmentCommand, PUNISHMENT_COMMANDS } from './punishments.js';
import { handleTicketCommand, TICKET_COMMANDS } from './tickets.js';

const MODERATOR_COMMANDS = new Set(['setmoder', 'fire', 'stats', 'setwarn', 'setvig', 'setpoints', 'uplvl']);

export async function handleCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'Эту команду можно использовать только на Discord-сервере.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isPunishment = PUNISHMENT_COMMANDS.has(interaction.commandName);
  const isTicket = TICKET_COMMANDS.has(interaction.commandName);
  const isLevel = LEVEL_COMMANDS.has(interaction.commandName);
  const isOpenCommand = PUBLIC_LEVEL_COMMANDS.has(interaction.commandName);
  const isPublicReply = isPunishment || isTicket || isOpenCommand;
  if (!isPublicReply && !isLevel && !MODERATOR_COMMANDS.has(interaction.commandName)) {
    await interaction.reply({
      content: 'Доступны команды /setmoder, /fire, /stats, /setwarn, /setvig, /setpoints, /uplvl, /ban, /unban, /mute, /unmute, /kick, /hold, /close, /pass, /exp, /lvl, /leaders и /rank.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply(isPublicReply ? {} : { flags: MessageFlags.Ephemeral });
  }

  if (!isOpenCommand && !await hasCommandAccess(interaction)) {
    await denyCommandAccess(interaction, { publicReply: isPublicReply });
    return;
  }

  if (isPunishment) {
    await handlePunishmentCommand(interaction);
  } else if (isTicket) {
    await handleTicketCommand(interaction);
  } else if (isLevel) {
    await handleLevelCommand(interaction);
  } else {
    await handleModeratorCommand(interaction);
  }
}