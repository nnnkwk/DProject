import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

const FONT_REGULAR = 'RankSans';
const FONT_BOLD = 'RankSansBold';
GlobalFonts.registerFromPath(fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url)), FONT_REGULAR);
GlobalFonts.registerFromPath(fileURLToPath(new URL('../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url)), FONT_BOLD);

const WIDTH = 934;
const HEIGHT = 282;
const AVATAR_RADIUS = 80;
const AVATAR_CX = 40 + AVATAR_RADIUS;
const AVATAR_CY = HEIGHT / 2;
const CONTENT_X = 240;
const CONTENT_RIGHT = WIDTH - 40;
const BAR_Y = 166;
const BAR_HEIGHT = 38;

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

async function loadAvatar(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Could not load avatar for the rank card:', error);
    return null;
  }
}

const formatNumber = (value) => new Intl.NumberFormat('ru-RU').format(value);

export async function renderRankCard({ name, avatarUrl, level, exp, expNeeded, totalExp, rank }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  roundedRectPath(ctx, 0, 0, WIDTH, HEIGHT, 28);
  ctx.save();
  ctx.clip();
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#1b1e2b');
  background.addColorStop(1, '#2c2f48');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = 'rgba(245, 166, 35, 0.08)';
  ctx.beginPath();
  ctx.arc(WIDTH - 40, 20, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(120, HEIGHT + 40, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_RADIUS, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const avatar = await loadAvatar(avatarUrl);
  if (avatar) {
    ctx.drawImage(avatar, AVATAR_CX - AVATAR_RADIUS, AVATAR_CY - AVATAR_RADIUS, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
  } else {
    ctx.fillStyle = '#3a3f5c';
    ctx.fillRect(AVATAR_CX - AVATAR_RADIUS, AVATAR_CY - AVATAR_RADIUS, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
  }
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#f5a623';
  ctx.beginPath();
  ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_RADIUS + 3, 0, Math.PI * 2);
  ctx.stroke();

  // Имя
  ctx.fillStyle = '#ffffff';
  ctx.font = `38px ${FONT_BOLD}`;
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, name, CONTENT_RIGHT - CONTENT_X), CONTENT_X, 82);

  // «РАНГ #N   УР. L»
  let cursorX = CONTENT_X;
  const drawPair = (label, value) => {
    ctx.font = `18px ${FONT_REGULAR}`;
    ctx.fillStyle = '#9aa0b8';
    ctx.fillText(label, cursorX, 132);
    cursorX += ctx.measureText(label).width + 10;
    ctx.font = `36px ${FONT_BOLD}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(value, cursorX, 132);
    cursorX += ctx.measureText(value).width + 36;
  };
  drawPair('РАНГ', rank ? `#${formatNumber(rank)}` : '—');
  drawPair('УР.', String(level));

  // Прогресс-бар
  const barWidth = CONTENT_RIGHT - CONTENT_X;
  const ratio = expNeeded > 0 ? Math.min(Math.max(exp / expNeeded, 0), 1) : 0;
  roundedRectPath(ctx, CONTENT_X, BAR_Y, barWidth, BAR_HEIGHT, BAR_HEIGHT / 2);
  ctx.fillStyle = '#3a3f5c';
  ctx.fill();
  if (ratio > 0) {
    ctx.save();
    roundedRectPath(ctx, CONTENT_X, BAR_Y, barWidth, BAR_HEIGHT, BAR_HEIGHT / 2);
    ctx.clip();
    const fillWidth = Math.max(BAR_HEIGHT, barWidth * ratio);
    const fill = ctx.createLinearGradient(CONTENT_X, 0, CONTENT_X + barWidth, 0);
    fill.addColorStop(0, '#f5a623');
    fill.addColorStop(1, '#ffd36b');
    ctx.fillStyle = fill;
    ctx.fillRect(CONTENT_X, BAR_Y, fillWidth, BAR_HEIGHT);
    ctx.restore();
  }

  ctx.font = `20px ${FONT_REGULAR}`;
  ctx.fillStyle = '#9aa0b8';
  ctx.textAlign = 'left';
  ctx.fillText(`Всего: ${formatNumber(totalExp)} XP`, CONTENT_X, BAR_Y + BAR_HEIGHT + 34);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(
    `${formatNumber(exp)}/${formatNumber(expNeeded)} XP (${Math.floor(ratio * 100)}%)`,
    CONTENT_RIGHT,
    BAR_Y + BAR_HEIGHT + 34,
  );

  return canvas.toBuffer('image/png');
}
