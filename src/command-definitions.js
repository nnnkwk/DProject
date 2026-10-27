import { SlashCommandBuilder } from 'discord.js';
import { MODERATOR_POSITIONS } from './moderator-positions.js';
import { TICKET_TEAMS } from './ticket-teams.js';

export const commandData = [
  new SlashCommandBuilder()
    .setName('setmoder')
    .setDescription('Создать профиль модератора и архив')
    .addUserOption((option) => option
      .setName('member')
      .setDescription('Участник Discord, которого назначают модератором')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('name')
      .setDescription('Имя модератора')
      .setMaxLength(100)
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('age')
      .setDescription('Возраст модератора')
      .setMinValue(13)
      .setMaxValue(100)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('position')
      .setDescription('Должность модератора')
      .addChoices(...MODERATOR_POSITIONS.map(({ key, label }) => ({ name: label, value: key })))
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('fire')
    .setDescription('Снять модератора с должности')
    .addUserOption((option) => option
      .setName('member')
      .setDescription('Модератор, которого снимают с должности')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина снятия с должности')
      .setMaxLength(1000)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Показать активность за текущую неделю: сообщения в главном чате и закрытые обращения'),
  new SlashCommandBuilder()
    .setName('setwarn')
    .setDescription('Изменить количество предупреждений модератора')
    .addUserOption((option) => option
      .setName('member')
      .setDescription('Модератор')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Изменение: положительное число выдает, отрицательное снимает')
      .setMinValue(-3)
      .setMaxValue(3)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина выдачи или снятия предупреждений')
      .setMaxLength(1000)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('setvig')
    .setDescription('Изменить количество выговоров модератора')
    .addUserOption((option) => option
      .setName('member')
      .setDescription('Модератор')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Изменение: положительное число выдает, отрицательное снимает')
      .setMinValue(-3)
      .setMaxValue(3)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина выдачи или снятия выговоров')
      .setMaxLength(1000)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('setpoints')
    .setDescription('Изменить количество баллов модератора')
    .addUserOption((option) => option
      .setName('member')
      .setDescription('Модератор')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Изменение: положительное число выдает, отрицательное снимает')
      .setMinValue(-10000)
      .setMaxValue(10000)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина выдачи или снятия баллов')
      .setMaxLength(1000)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('uplvl')
    .setDescription('Повысить модератора на одну должность')
    .addUserOption((option) => option
      .setName('member')
      .setDescription('Модератор, которого повышают')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Забанить пользователя')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Пользователь')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('time')
      .setDescription('Срок: 30m, 2h, 7d, 1w, 1d12h или «навсегда»')
      .setMaxLength(30)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина бана')
      .setMaxLength(400)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('clear_messages')
      .setDescription('Удалить сообщения пользователя за последние 3 дня?')
      .addChoices({ name: 'Да', value: 'yes' }, { name: 'Нет', value: 'no' })
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Разбанить пользователя')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Пользователь (можно вставить ID)')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина разбана')
      .setMaxLength(400)),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Выдать мут (тайм-аут)')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Участник')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('time')
      .setDescription('Срок: 10m, 2h, 7d, 1d12h (максимум 28 дней)')
      .setMaxLength(30)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина мута')
      .setMaxLength(400)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут (тайм-аут)')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Участник')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина снятия мута')
      .setMaxLength(400)),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Выгнать участника с сервера')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Участник')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Причина кика')
      .setMaxLength(400)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('hold')
    .setDescription('Закрепить обращение за собой'),
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Закрыть обращение'),
  new SlashCommandBuilder()
    .setName('pass')
    .setDescription('Передать обращение другой команде модерации')
    .addStringOption((option) => option
      .setName('team')
      .setDescription('Команда модерации')
      .addChoices(...Object.entries(TICKET_TEAMS).map(([value, { label }]) => ({ name: label, value })))
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('exp')
    .setDescription('Изменить EXP участника')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Участник')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Сколько EXP добавить или отнять (например, 500 или -500)')
      .setMinValue(-1000000)
      .setMaxValue(1000000)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('lvl')
    .setDescription('Изменить уровень участника')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Участник')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('На сколько уровней изменить (например, 2 или -2)')
      .setMinValue(-1000)
      .setMaxValue(1000)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('leaders')
    .setDescription('Топ участников по уровням'),
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Показать карточку уровня участника')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Участник (по умолчанию вы)')),
].map((command) => command.toJSON());
