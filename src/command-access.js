import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getCommandAccessRoleIds } from './database.js';

export async function hasCommandAccess(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  const allowedRoleIds = await getCommandAccessRoleIds(interaction.commandName);
  if (!allowedRoleIds.length) return false;

  const roles = interaction.member?.roles;
  const memberRoleIds = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
  return allowedRoleIds.some((roleId) => memberRoleIds.includes(roleId));
}

export async function denyCommandAccess(interaction, { publicReply }) {
  const content = `У вас нет доступа к команде /${interaction.commandName}.`;
  if (publicReply) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    await interaction.deleteReply().catch(() => {});
    return;
  }
  await interaction.editReply({ content });
}