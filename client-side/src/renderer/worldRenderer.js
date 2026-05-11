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
import { FOOD_BASE_RADIUS, GRID_STEP, VIEW_MARGIN, WORLD_SIZE } from '../constants/gameConfig';
/**
 * Inputs:
 * - Canvas context, camera offset, and viewport size.
 *
 * Output:
 * - None; paints world bounds and grid lines.
 */
export const drawGrid = (ctx, camX, camY, width, height) => {
  const visibleLeft = Math.max(0, -camX);
  const visibleTop = Math.max(0, -camY);
  const visibleRight = Math.min(WORLD_SIZE, width - camX);
  const visibleBottom = Math.min(WORLD_SIZE, height - camY);

  ctx.fillStyle = '#a8ffa8';
  ctx.fillRect(
    camX + visibleLeft,
    camY + visibleTop,
    Math.max(0, visibleRight - visibleLeft),
    Math.max(0, visibleBottom - visibleTop),
  );

  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return;

  ctx.strokeStyle = 'rgba(70, 76, 70, 0.3)';
  ctx.lineWidth = 4;
  ctx.beginPath();

  const startX = Math.floor(visibleLeft / GRID_STEP) * GRID_STEP;
  const endX = Math.ceil(visibleRight / GRID_STEP) * GRID_STEP;
  for (let x = startX; x <= endX; x += GRID_STEP) {
    const sx = camX + x;
    ctx.moveTo(sx, camY + visibleTop);
    ctx.lineTo(sx, camY + visibleBottom);
  }

  const startY = Math.floor(visibleTop / GRID_STEP) * GRID_STEP;
  const endY = Math.ceil(visibleBottom / GRID_STEP) * GRID_STEP;
  for (let y = startY; y <= endY; y += GRID_STEP) {
    const sy = camY + y;
    ctx.moveTo(camX + visibleLeft, sy);
    ctx.lineTo(camX + visibleRight, sy);
  }

  ctx.stroke();
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

    ctx.fillStyle = food.color || '#ffeb3b';
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
