/**
 * Purpose:
 * - Central gameplay tuning constants.
 *
 * Responsibilities:
 * - Define shared world/combat/simulation parameters.
 * - Provide XP table and derived cooldown helper.
 *
 * Key concepts:
 * - Values here are consumed by simulation, sync, and renderer together.
 * - Keep cross-module constants coherent to avoid visual/logic drift.
 */
export const WORLD_SIZE = 5000;
export const TICK_RATE = 120; // ms
export const LERP_FACTOR = 0.3;
export const LERP_COMBAT_FACTOR = 0.35;
export const PLAYER_SIZE = 60;
export const DEFAULT_ROOM_ID = 'default';

export const SPEED = 300;
export const SPEED_BOOST_MULTIPLIER = 1.3;
export const BOOST_SCORE_DRAIN_PER_SEC = 20;

export const SWING_EXTEND_DURATION = 180;
export const SWING_RETURN_DURATION = 180;
export const SWING_TOTAL_DURATION = SWING_EXTEND_DURATION + SWING_RETURN_DURATION;

export const KNOCKBACK_Y = 100;

export const BOT_UPDATE_INTERVAL_MS = 40;
export const BOT_ENSURE_INTERVAL_MS = 5000;
export const FOOD_SPAWN_INTERVAL_MS = 1000;

export const TARGET_BOT_COUNT = 25;
export const BOT_SPEED = 300;
export const BOT_HIT_PUSH_Y = 100;
export const BOT_ID_PREFIX = 'bot-';

export const TARGET_FOOD_COUNT = 600;

export const EVOWARS_XP_TABLE = [
  { level: 1, score: 0 },
  { level: 2, score: 100 },
  { level: 3, score: 200 },
  { level: 4, score: 350 },
  { level: 5, score: 500 },
  { level: 6, score: 700 },
  { level: 7, score: 900 },
  { level: 8, score: 1150 },
  { level: 9, score: 1400 },
  { level: 10, score: 1700 },
  { level: 11, score: 2050 },
  { level: 12, score: 2400 },
  { level: 13, score: 2800 },
  { level: 14, score: 3200 },
  { level: 15, score: 3700 },
  { level: 16, score: 4200 },
  { level: 17, score: 4800 },
  { level: 18, score: 5400 },
  { level: 19, score: 6100 },
  { level: 20, score: 6800 },
  { level: 21, score: 8200 },
  { level: 22, score: 10000 },
  { level: 23, score: 12500 },
  { level: 24, score: 15500 },
  { level: 25, score: 19500 },
  { level: 26, score: 24000 },
  { level: 27, score: 30000 },
  { level: 28, score: 37000 },
  { level: 29, score: 46000 },
  { level: 30, score: 58000 },
  { level: 31, score: 72000 },
  { level: 32, score: 90000 },
  { level: 33, score: 115000 },
  { level: 34, score: 145000 },
  { level: 35, score: 180000 },
  { level: 36, score: 220000 },
  { level: 37, score: 270000 },
  { level: 38, score: 330000 },
  { level: 39, score: 400000 },
  { level: 40, score: 480000 },
];

export const MAX_LEVEL = EVOWARS_XP_TABLE[EVOWARS_XP_TABLE.length - 1].level;

export const PUNCH_DURATION = 200;
export const PUNCH_COOLDOWN = 500;
export const PUNCH_COOLDOWN_PER_LEVEL = 60;
export const PUNCH_EXTRA_FACTOR = 0.6;
export const PUNCH_EXTRA = PLAYER_SIZE * PUNCH_EXTRA_FACTOR;
export const PUNCH_CONVERGENCE = 0.5;

// Sword swing config
export const SWORD_BASE_ANGLE = Math.PI;
export const SWORD_SWEEP_ARC = Math.PI;

export const GRID_STEP = 75;
export const FOOD_BASE_RADIUS = 4;
export const VIEW_MARGIN = 100;

/**
 * Input: player level.
 * Output: attack cooldown in milliseconds.
 */
export const getAttackDelayByLevel = (level) => {
  const safeLevel = Math.max(1, Number.isFinite(level) ? level : 1);
  return PUNCH_COOLDOWN + PUNCH_COOLDOWN_PER_LEVEL * (safeLevel - 1);
};
