import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  MessageFlags,
} from 'discord.js';
import {
  acceptFamilyInvite,
  createFamily,
  createFamilyInvite,
  deleteFamily,
  deleteFamilyInvite,
  findPendingFamilyInvite,
  getFamily,
  getFamilyByName,
  getFamilyInvite,
  getFamilyMemberRole,
  getFamilyMembers,
  getInvitableFamilies,
  getUserFamilies,
  searchFamilies,
} from './database.js';

export const FAMILY_COMMANDS = new Set(['createfam', 'delfam', 'faminfo', 'faminvite']);
export const OPEN_FAMILY_COMMANDS = new Set(['faminfo', 'faminvite']);

const EMBED_COLOR = 0x2b2d31;
const INVITE_TTL_SECONDS = 24 * 60 * 60;
const NO_MENTIONS = { parse: [] };

const DEFAULT_OWNED_FAMILIES = 1;
function ownedFamiliesLimit() {
  return DEFAULT_OWNED_FAMILIES;
}

function baseEmbed(guild, color = EMBED_COLOR) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined });
}

async function fail(interaction, content) {
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  await interaction.deleteReply().catch(() => {});
}

function familyLabel(family) {
  return `${escapeMarkdown(family.name)} [${family.id}]`;
}

async function resolveFamily(query) {
  const value = query.trim();
  if (!value) return null;
  return /^\d+$/.test(value) ? getFamily(Number(value)) : getFamilyByName(value);
}

async function createFamilyCommand(interaction) {
  const name = interaction.options.getString('name', true).replace(/\s+/g, ' ').trim();
  const leader = interaction.options.getUser('leader', true);

  if (name.length < 2) return fail(interaction, 'Название семьи должно содержать минимум 2 символа.');
  if (/^\d+$/.test(name)) return fail(interaction, 'Название семьи не может состоять только из цифр.');
  if (leader.bot) return fail(interaction, 'Ботов нельзя назначить лидером семьи.');
  const member = await interaction.guild.members.fetch(leader.id).catch(() => null);
  if (!member) return fail(interaction, 'Указанный лидер не найден на сервере.');

  const result = await createFamily(name, leader.id, interaction.user.id, ownedFamiliesLimit(leader.id));
  if (!result.ok) {
    return fail(
      interaction,
      result.reason === 'name_taken'
        ? `Семья с названием **${escapeMarkdown(name)}** уже существует.`
        : `${member} уже возглавляет семью и не может быть лидером ещё одной.`,
    );
  }

  const embed = baseEmbed(interaction.guild)
    .setTitle('Семья создана')
    .setDescription([
      `**Название:** ${escapeMarkdown(name)} [${result.id}]`,
      `**Лидер семьи:** ${member}`,
      `**Создал:** ${interaction.user}`,
    ].join('\n'));
  await interaction.editReply({ content: `${member}`, embeds: [embed], allowedMentions: { users: [leader.id] } });
  return undefined;
}

const DELETE_CONFIRM_TTL_MS = 5 * 60 * 1000;

async function deleteFamilyCommand(interaction) {
  const family = await resolveFamily(interaction.options.getString('family', true));
  if (!family) return fail(interaction, 'Семья не найдена.');

  const members = await getFamilyMembers(family.id);
  const embed = baseEmbed(interaction.guild)
    .setTitle('Удаление семьи')
    .setDescription(
      `Вы действительно хотите удалить семью **${familyLabel(family)}**?\n`
      + `**Участников:** ${members.length}\n`
      + 'Действие необратимо: семья, её состав и приглашения будут удалены.',
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`family:delyes:${family.id}:${interaction.user.id}`)
      .setLabel('Удалить')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`family:delno:${family.id}:${interaction.user.id}`)
      .setLabel('Отмена')
      .setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row], allowedMentions: NO_MENTIONS });
  return undefined;
}

async function handleDeleteConfirmation(interaction, action, rawId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'Эту кнопку может нажать только тот, кто вызвал команду.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const finish = (title, description, color = EMBED_COLOR) => interaction.update({
    content: '',
    embeds: [resultEmbed(interaction.guild, color, title, description)],
    components: [],
    allowedMentions: NO_MENTIONS,
  });

  if (action === 'delno') {
    await finish('Удаление отменено', `${interaction.user} отменил(а) удаление семьи.`);
    return;
  }
  if (Date.now() - interaction.message.createdTimestamp > DELETE_CONFIRM_TTL_MS) {
    await finish('Подтверждение истекло', 'Вызовите /delfam заново.');
    return;
  }

  const family = await getFamily(Number(rawId));
  if (!family) {
    await finish('Семья не найдена', 'Эта семья уже удалена.');
    return;
  }
  const members = await getFamilyMembers(family.id);
  await deleteFamily(family.id);
  await finish(
    'Семья удалена',
    `**Семья:** ${familyLabel(family)}\n`
    + `**Участников на момент удаления:** ${members.length}\n`
    + `**Удалил:** ${interaction.user}`,
    0xed4245,
  );
}

async function showFamilyInfo(interaction) {
  const query = interaction.options.getString('family');
  let family;
  if (query) {
    family = await resolveFamily(query);
    if (!family) return fail(interaction, 'Семья не найдена.');
  } else {
    const own = await getUserFamilies(interaction.user.id);
    if (!own.length) return fail(interaction, 'Вы не состоите ни в одной семье. Укажите семью в параметре family.');
    if (own.length > 1) {
      return fail(
        interaction,
        `Вы состоите в нескольких семьях, выберите одну в параметре family:\n${own.map((f) => `• ${familyLabel(f)}`).join('\n')}`,
      );
    }
    family = await getFamily(own[0].id);
  }

  const members = await getFamilyMembers(family.id);
  const leaderId = members.find((m) => m.role === 'leader')?.user_id ?? family.leader_id;
  const deputies = members.filter((m) => m.role === 'deputy').map((m) => `<@${m.user_id}>`);

  const embed = baseEmbed(interaction.guild)
    .setTitle(`${family.name} [${family.id}]`)
    .setDescription([
      `**Лидер семьи:** <@${leaderId}>`,
      `**Заместитель семьи:** ${deputies.length ? deputies.join(', ') : 'отсутствует'}`,
      `**Всего участников:** ${members.length}`,
      `**Дата создания:** <t:${family.created_ts}:F>`,
    ].join('\n'));
  await interaction.editReply({ embeds: [embed], allowedMentions: NO_MENTIONS });
  return undefined;
}

async function inviteToFamily(interaction) {
  const target = interaction.options.getUser('member', true);
  const family = await resolveFamily(interaction.options.getString('family', true));
  if (!family) return fail(interaction, 'Семья не найдена.');

  const role = await getFamilyMemberRole(family.id, interaction.user.id);
  if (role !== 'leader' && role !== 'deputy') {
    return fail(interaction, 'Приглашать в семью могут только её лидер и заместители.');
  }
  if (target.bot) return fail(interaction, 'Ботов нельзя пригласить в семью.');
  if (target.id === interaction.user.id) return fail(interaction, 'Нельзя пригласить самого себя.');

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) return fail(interaction, 'Пользователь не найден на сервере.');
  if (await getFamilyMemberRole(family.id, target.id)) {
    return fail(interaction, `${member} уже состоит в семье ${familyLabel(family)}.`);
  }
  if (await findPendingFamilyInvite(family.id, target.id, INVITE_TTL_SECONDS)) {
    return fail(interaction, `${member} уже приглашён(а) в семью ${familyLabel(family)}, дождитесь ответа.`);
  }

  const inviteId = await createFamilyInvite(family.id, target.id, interaction.user.id);
  const embed = baseEmbed(interaction.guild)
    .setTitle('Приглашение в семью')
    .setDescription(
      `${interaction.user} приглашает ${member} в семью **${familyLabel(family)}**.\n`
      + 'Приглашение действует 24 часа.',
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`family:accept:${inviteId}`).setLabel('Принять').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`family:decline:${inviteId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger),
  );
  await interaction.editReply({
    content: `${member}`,
    embeds: [embed],
    components: [row],
    allowedMentions: { users: [target.id] },
  });
  return undefined;
}

export async function handleFamilyCommand(interaction) {
  if (interaction.commandName === 'createfam') await createFamilyCommand(interaction);
  else if (interaction.commandName === 'delfam') await deleteFamilyCommand(interaction);
  else if (interaction.commandName === 'faminfo') await showFamilyInfo(interaction);
  else await inviteToFamily(interaction);
}

export async function handleFamilyAutocomplete(interaction) {
  const query = interaction.options.getFocused().trim();
  const families = interaction.commandName === 'faminvite'
    ? await getInvitableFamilies(interaction.user.id, query)
    : await searchFamilies(query);
  await interaction.respond(families.map((family) => ({
    name: `${family.name} [${family.id}]`.slice(0, 100),
    value: String(family.id),
  })));
}

function resultEmbed(guild, color, title, description) {
  return baseEmbed(guild, color).setTitle(title).setDescription(description);
}

export async function handleFamilyInteraction(interaction) {
  const [, action, rawId, ownerId] = interaction.customId.split(':');
  if (action === 'delyes' || action === 'delno') {
    await handleDeleteConfirmation(interaction, action, rawId, ownerId);
    return;
  }
  const invite = await getFamilyInvite(Number(rawId));
  if (!invite) {
    await interaction.reply({ content: 'Это приглашение уже недействительно.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== invite.user_id) {
    await interaction.reply({ content: 'Это приглашение адресовано другому участнику.', flags: MessageFlags.Ephemeral });
    return;
  }

  const label = familyLabel({ id: invite.family_id, name: invite.name });
  if (invite.age_seconds > INVITE_TTL_SECONDS) {
    await deleteFamilyInvite(invite.id);
    await interaction.update({
      content: '',
      embeds: [resultEmbed(interaction.guild, EMBED_COLOR, 'Приглашение истекло', `Срок приглашения в семью **${label}** закончился.`)],
      components: [],
    });
    return;
  }

  if (action === 'decline') {
    await deleteFamilyInvite(invite.id);
    await interaction.update({
      content: '',
      embeds: [resultEmbed(interaction.guild, 0xed4245, 'Приглашение отклонено', `${interaction.user} отклонил(а) приглашение в семью **${label}**.`)],
      components: [],
      allowedMentions: NO_MENTIONS,
    });
    return;
  }

  const result = await acceptFamilyInvite(invite);
  await interaction.update({
    content: '',
    embeds: [resultEmbed(
      interaction.guild,
      0x57f287,
      'Приглашение принято',
      result.joined
        ? `${interaction.user} вступил(а) в семью **${label}**.`
        : `${interaction.user} уже состоит в семье **${label}**.`,
    )],
    components: [],
    allowedMentions: NO_MENTIONS,
  });
}
