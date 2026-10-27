export const MODERATOR_POSITIONS = [
  { key: 'moderator', label: 'Модератор' },
  { key: 'senior_moderator', label: 'Старший модератор' },
  { key: 'moderation_curator', label: 'Куратор модерации' },
  { key: 'deputy_head_moderator', label: 'Заместитель главного модератора' },
  { key: 'head_moderator', label: 'Главный модератор' },
  { key: 'discord_administrator', label: 'Администратор Discord' },
  { key: 'technical_moderator', label: 'Технический модератор' },
];

export function getModeratorPositionLabel(key) {
  return MODERATOR_POSITIONS.find((position) => position.key === key)?.label ?? null;
}