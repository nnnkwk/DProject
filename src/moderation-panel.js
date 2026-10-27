import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import {
  getBotSettings,
  getModerationStats,
  getPendingRequests,
  getRoleRequest,
  resetRequestToPending,
  updateRequestStatus,
} from './database.js';

async function renderDashboard(interaction, requestedPage = 0, notice = '') {
  const stats = await getModerationStats();
  const totalPending = Number(stats.pending);
  const maxPage = Math.max(0, totalPending - 1);
  const page = Math.min(Math.max(0, requestedPage), maxPage);
  const [request] = totalPending ? await getPendingRequests(1, page) : [];

  const embed = new EmbedBuilder()
    .setColor(0x2f3136)
    .setAuthor({
      name: 'Панель модерации',
      iconURL: interaction.guild.iconURL({ dynamic: true }) ?? undefined,
    })
    .setTitle('Заявки на рассмотрение')
    .setDescription([
      `Всего заявок: ${stats.total}`,
      `В ожидании: ${stats.pending}`,
      `Одобрено: ${stats.approved}`,
      `Отклонено: ${stats.rejected}`,
    ].join('\n'));

  if (request) {
    embed.addFields(
      { name: 'Заявка', value: `${page + 1} / ${totalPending}`, inline: true },
      { name: 'Пользователь', value: `<@${request.user_id}>`, inline: true },
      { name: 'Сервер', value: request.server_name, inline: true },
      { name: 'Роль', value: `${request.role_label} • <@&${request.discord_role_id}>`, inline: true },
      { name: 'Создана', value: `<t:${Math.floor(new Date(request.created_at).getTime() / 1000)}:R>`, inline: true },
    );
  } else {
    embed.addFields({ name: 'Очередь', value: 'Ожидающих заявок нет.' });
  }

  embed.setFooter({ text: `${interaction.guild.name} • заявки` });

  const rows = [];
  if (request) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mod:approve:${request.id}:${page}`)
        .setLabel('Одобрить')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`mod:reject:${request.id}:${page}`)
        .setLabel('Отклонить')
        .setStyle(ButtonStyle.Danger),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mod:prev:${page}`)
      .setLabel('← Предыдущая')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!request || page === 0),
    new ButtonBuilder()
      .setCustomId(`mod:next:${page}`)
      .setLabel('Следующая →')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!request || page >= totalPending - 1),
    new ButtonBuilder()
      .setCustomId(`mod:refresh:${page}`)
      .setLabel('Обновить')
      .setStyle(ButtonStyle.Primary),
  ));

  await interaction.editReply({
    content: notice || null,
    embeds: [embed],
    components: rows,
  });
}

export async function openModerationDashboard(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  await renderDashboard(interaction);
}

async function syncRequestMessage(interaction, request, decision, sourceMessage) {
  let message = sourceMessage;
  if (!message && request.review_message_id) {
    const settings = await getBotSettings();
    const channel = settings?.review_channel_id
      ? await interaction.guild.channels.fetch(settings.review_channel_id).catch(() => null)
      : null;
    if (channel?.isTextBased()) {
      message = await channel.messages.fetch(request.review_message_id).catch(() => null);
    }
  }
  if (!message?.embeds?.[0]) return;

  const approved = decision === 'approved';
  const embed = EmbedBuilder.from(message.embeds[0])
    .setColor(approved ? 0x57f287 : 0xed4245)
    .addFields({
      name: 'Решение',
      value: `${approved ? 'Одобрена' : 'Отклонена'}: <@${interaction.user.id}>`,
    });
  await message.edit({
    embeds: [embed],
    components: [],
  }).catch((error) => console.error('Could not update the original review message:', error));
}

export async function decideRoleRequest(interaction, requestId, action, sourceMessage = null) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, text: 'Для рассмотрения заявок требуется право «Управлять ролями».' };
  }

  const request = await getRoleRequest(requestId);
  if (!request) {
    return { ok: false, text: 'Заявка не найдена.' };
  }
  if (request.status !== 'pending') {
    return { ok: false, text: `Заявка уже обработана (статус: ${request.status}).` };
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  const updated = await updateRequestStatus(requestId, status, interaction.user.id);
  if (!updated) {
    return { ok: false, text: 'Заявка уже рассматривается или обработана другим модератором.' };
  }

  if (action === 'approve') {
    try {
      const member = await interaction.guild.members.fetch(request.user_id);
      const role = await interaction.guild.roles.fetch(request.discord_role_id);
      if (!role || role.managed) throw new Error('Роль удалена или не может быть выдана.');
      await member.roles.add(role, `Запрос на роль одобрен ${interaction.user.tag}`);
    } catch (error) {
      await resetRequestToPending(requestId);
      console.error('Could not grant requested role:', error);
      return {
        ok: false,
        text: 'Не удалось выдать роль. Проверьте, что участник и роль существуют, а роль бота выше выдаваемой роли. Заявка возвращена в ожидание.',
      };
    }
  }

  await syncRequestMessage(interaction, request, status, sourceMessage);
  return { ok: true, text: `Заявка ${status === 'approved' ? 'одобрена' : 'отклонена'}.` };
}

export async function handleModerationDashboardInteraction(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: 'Для доступа к панели требуется право «Управлять ролями».',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [, action, value, pageValue] = interaction.customId.split(':');
  const page = Number.parseInt(action === 'prev' || action === 'next' || action === 'refresh' ? value : pageValue, 10) || 0;
  if (action === 'approve' || action === 'reject') {
    const requestId = Number(value);
    if (!Number.isSafeInteger(requestId)) {
      await interaction.reply({ content: 'Некорректный номер заявки.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferUpdate();
    const result = await decideRoleRequest(interaction, requestId, action);
    await renderDashboard(interaction, page, result.text);
    return;
  }

  const nextPage = action === 'prev' ? page - 1 : action === 'next' ? page + 1 : page;
  await interaction.deferUpdate();
  await renderDashboard(interaction, nextPage);
}
