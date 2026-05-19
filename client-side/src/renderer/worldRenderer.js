/**
 * Purpose:
 * - Render world-level visuals (map grid and food entities).
 *
 * Responsibilities:
 * - Draw static background grid using camera offsets.
 * - Draw food and report consumable collisions with local player.
 *
 * Key concepts:
 * - Rendering applies camera transform externally via `camX/camY`.
 * - Food consumption is computed during render pass for local player only.
 */
import { FOOD_BASE_RADIUS, VIEW_MARGIN, WORLD_SIZE } from '../constants/gameConfig';

const GRID_STEP_FINE = 100;
const GRID_STEP_SECTOR = 500;
const DUST_COUNT = 260;
const DUST_PARALLAX = 0.3;
const DUST_FIELDS = 4;

let dustPoints = null;
let baseGradient = null;
let baseGradientWidth = 0;
let baseGradientHeight = 0;
let vignetteGradient = null;
let vignetteWidth = 0;
let vignetteHeight = 0;

const createDustPoints = () => {
  const points = new Float32Array(DUST_COUNT * DUST_FIELDS);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < DUST_COUNT; i += 1) {
    const idx = i * DUST_FIELDS;
    points[idx] = rand() * WORLD_SIZE;
    points[idx + 1] = rand() * WORLD_SIZE;
    points[idx + 2] = 0.5 + rand();
    points[idx + 3] = 0.2 + rand() * 0.3;
  }

  return points;
};

const getBaseGradient = (ctx, width, height) => {
  if (!baseGradient || baseGradientWidth !== width || baseGradientHeight !== height) {
    baseGradientWidth = width;
    baseGradientHeight = height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(width, height) * 0.7;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, '#0a0f1e');
    gradient.addColorStop(1, '#04070f');
    baseGradient = gradient;
  }

  return baseGradient;
};

const getVignetteGradient = (ctx, width, height) => {
  if (!vignetteGradient || vignetteWidth !== width || vignetteHeight !== height) {
    vignetteWidth = width;
    vignetteHeight = height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(width, height) * 0.75;
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.45)');
    vignetteGradient = gradient;
  }

  return vignetteGradient;
};

const hashStringToUnit = (value) => {
  if (!value) return 0;
  const text = typeof value === 'string' ? value : String(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
};
/**
 * Inputs:
 * - Canvas context, camera offset, and viewport size.
 *
 * Output:
 * - None; paints world bounds and grid lines.
 */
export const drawGrid = (ctx, camX, camY, width, height) => {
  if (!dustPoints) dustPoints = createDustPoints();
  ctx.fillStyle = getBaseGradient(ctx, width, height);
  ctx.fillRect(0, 0, width, height);

  const visibleLeft = Math.max(0, -camX);
  const visibleTop = Math.max(0, -camY);
  const visibleRight = Math.min(WORLD_SIZE, width - camX);
  const visibleBottom = Math.min(WORLD_SIZE, height - camY);

  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return;

  ctx.save();
  ctx.fillStyle = '#d7e7ff';
  for (let i = 0; i < dustPoints.length; i += DUST_FIELDS) {
    const fx = dustPoints[i] + camX * DUST_PARALLAX;
    const fy = dustPoints[i + 1] + camY * DUST_PARALLAX;
    if (
      fx < -VIEW_MARGIN ||
      fy < -VIEW_MARGIN ||
      fx > width + VIEW_MARGIN ||
      fy > height + VIEW_MARGIN
    ) {
      continue;
    }
    ctx.globalAlpha = dustPoints[i + 3];
    ctx.beginPath();
    ctx.arc(fx, fy, dustPoints[i + 2], 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const fineStartX = Math.floor(visibleLeft / GRID_STEP_FINE) * GRID_STEP_FINE;
  const fineEndX = Math.ceil(visibleRight / GRID_STEP_FINE) * GRID_STEP_FINE;
  for (let x = fineStartX; x <= fineEndX; x += GRID_STEP_FINE) {
    const sx = camX + x;
    ctx.moveTo(sx, camY + visibleTop);
    ctx.lineTo(sx, camY + visibleBottom);
  }

  const fineStartY = Math.floor(visibleTop / GRID_STEP_FINE) * GRID_STEP_FINE;
  const fineEndY = Math.ceil(visibleBottom / GRID_STEP_FINE) * GRID_STEP_FINE;
  for (let y = fineStartY; y <= fineEndY; y += GRID_STEP_FINE) {
    const sy = camY + y;
    ctx.moveTo(camX + visibleLeft, sy);
    ctx.lineTo(camX + visibleRight, sy);
  }

  ctx.stroke();

  ctx.strokeStyle = 'rgba(100,200,255,0.06)';
  ctx.lineWidth = 2;
  ctx.beginPath();

  const sectorStartX = Math.floor(visibleLeft / GRID_STEP_SECTOR) * GRID_STEP_SECTOR;
  const sectorEndX = Math.ceil(visibleRight / GRID_STEP_SECTOR) * GRID_STEP_SECTOR;
  for (let x = sectorStartX; x <= sectorEndX; x += GRID_STEP_SECTOR) {
    const sx = camX + x;
    ctx.moveTo(sx, camY + visibleTop);
    ctx.lineTo(sx, camY + visibleBottom);
  }

  const sectorStartY = Math.floor(visibleTop / GRID_STEP_SECTOR) * GRID_STEP_SECTOR;
  const sectorEndY = Math.ceil(visibleBottom / GRID_STEP_SECTOR) * GRID_STEP_SECTOR;
  for (let y = sectorStartY; y <= sectorEndY; y += GRID_STEP_SECTOR) {
    const sy = camY + y;
    ctx.moveTo(camX + visibleLeft, sy);
    ctx.lineTo(camX + visibleRight, sy);
  }

  ctx.stroke();

  ctx.fillStyle = getVignetteGradient(ctx, width, height);
  ctx.fillRect(0, 0, width, height);
};

/**
 * Inputs:
 * - Canvas context, food collection, camera offset, and local player collision info.
 * - Optional `onEat` callback invoked when local player consumes food.
 *
 * Output:
 * - Array of eaten food IDs to remove from backend.
 *
 * Performance-sensitive:
 * - Early culling by viewport margin prevents unnecessary draw calls.
 */
export const drawFood = (ctx, foodItems, camX, camY, myWorldPos, myRadius, onEat) => {
  const foodsToRemove = [];
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const collisionRadiusExtra = myRadius > 0 ? myRadius : -1e9;
  const now = Date.now();

  Object.entries(foodItems || {}).forEach(([foodId, food]) => {
    if (!food) return;
    const size = food.size || 1;
    const radius = FOOD_BASE_RADIUS * size;

    const collisionRadius = radius + collisionRadiusExtra;
    const dx = food.x - myWorldPos.x;
    const dy = food.y - myWorldPos.y;
    if (collisionRadius > 0 && dx * dx + dy * dy < collisionRadius * collisionRadius) {
      foodsToRemove.push(foodId);
      if (typeof onEat === 'function') onEat(food, foodId);
      return;
    }

    const fx = food.x + camX;
    const fy = food.y + camY;

    if (
      fx + radius < -VIEW_MARGIN ||
      fx - radius > canvasWidth + VIEW_MARGIN ||
      fy + radius < -VIEW_MARGIN ||
      fy - radius > canvasHeight + VIEW_MARGIN
    ) {
      return;
    }

    const baseColor = food.color || '#ffeb3b';
    const pulseOffset = hashStringToUnit(foodId) * Math.PI * 2;
    const pulse = Math.sin(now * 0.003 + pulseOffset);
    const glowRadius = radius * 3 + pulse;
    const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, glowRadius);
    glow.addColorStop(0, baseColor);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fx, fy, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(fx, fy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.min(3, radius * 0.4);
    ctx.beginPath();
    ctx.moveTo(fx - radius * 0.6, fy);
    ctx.lineTo(fx + radius * 0.6, fy);
    ctx.stroke();
  });

  return foodsToRemove;
};
