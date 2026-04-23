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
import { getDistance } from '../utils/math';

/**
 * Inputs:
 * - Canvas context, camera offset, and viewport size.
 *
 * Output:
 * - None; paints world bounds and grid lines.
 */
export const drawGrid = (ctx, camX, camY, width, height) => {
  ctx.fillStyle = '#a8ffa8';
  ctx.fillRect(camX, camY, WORLD_SIZE, WORLD_SIZE);
  ctx.strokeStyle = 'rgba(70, 76, 70, 0.3)';
  ctx.lineWidth = 4;

  for (let i = 0; i <= WORLD_SIZE; i += GRID_STEP) {
    ctx.beginPath();
    ctx.moveTo(camX + i, camY);
    ctx.lineTo(camX + i, camY + WORLD_SIZE);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(camX, camY + i);
    ctx.lineTo(camX + WORLD_SIZE, camY + i);
    ctx.stroke();
  }
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

  Object.entries(foodItems || {}).forEach(([foodId, food]) => {
    if (!food) return;
    const size = food.size || 1;
    const radius = FOOD_BASE_RADIUS * size;

    const distFood = getDistance(food.x, food.y, myWorldPos.x, myWorldPos.y);
    if (distFood < radius + myRadius) {
      foodsToRemove.push(foodId);
      if (typeof onEat === 'function') onEat(food, foodId);
      return;
    }

    const fx = food.x + camX;
    const fy = food.y + camY;

    if (
      fx + radius < -VIEW_MARGIN ||
      fx - radius > ctx.canvas.width + VIEW_MARGIN ||
      fy + radius < -VIEW_MARGIN ||
      fy - radius > ctx.canvas.height + VIEW_MARGIN
    ) {
      return;
    }

    ctx.save();
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
    ctx.restore();
  });

  return foodsToRemove;
};
