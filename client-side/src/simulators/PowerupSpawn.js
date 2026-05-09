/**
 * Purpose:
 * - Maintain shield powerup population per room.
 *
 * Responsibilities:
 * - Remove expired powerups.
 * - Spawn missing Shield Orbs up to the target count.
 *
 * Key concepts:
 * - Host-only caller.
 * - Room-scoped writes through `getRoomCollectionPath`.
 * - Per-entity writes avoid overwriting the full collection.
 */
import { ref as dbRef, get, set as dbSet, remove as dbRemove } from 'firebase/database';
import { db } from '../firebase/config';
import {
  POWERUP_TTL_MS,
  TARGET_POWERUP_COUNT,
  WORLD_SIZE,
} from '../constants/gameConfig';
import { getRoomCollectionPath } from '../firebase/paths';

/** Output: random world-space position inside bounds. */
const getRandomSpawnPosition = () => ({
  x: Math.random() * WORLD_SIZE,
  y: Math.random() * WORLD_SIZE,
});

/** Input: raw powerup payload. Output: Firebase-safe payload. */
const sanitizePowerupForDb = (powerup) => {
  const output = {};
  Object.entries(powerup || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      output[key] = value;
    }
  });
  return output;
};

/**
 * Input: roomId.
 * Output: none (side effect writes/removes powerups).
 */
export const ensureShieldPowerups = async (roomId) => {
  const powerupsPath = getRoomCollectionPath(roomId, 'powerups');
  const powerupsRef = dbRef(db, powerupsPath);
  const now = Date.now();
  const snap = await get(powerupsRef);
  const existing = snap.val() || {};
  const activeEntries = [];
  const expiredIds = [];

  Object.entries(existing).forEach(([id, powerup]) => {
    if (!powerup || powerup.type !== 'shield') return;
    const spawnedAt = typeof powerup.spawnedAt === 'number' ? powerup.spawnedAt : 0;
    if (!spawnedAt || now - spawnedAt > POWERUP_TTL_MS) {
      expiredIds.push(id);
      return;
    }
    activeEntries.push([id, powerup]);
  });

  const spawnCount = Math.max(0, TARGET_POWERUP_COUNT - activeEntries.length);
  const writes = [];

  expiredIds.forEach((id) => {
    writes.push(dbRemove(dbRef(db, `${powerupsPath}/${id}`)));
  });

  for (let i = 0; i < spawnCount; i++) {
    const id = crypto.randomUUID();
    const position = getRandomSpawnPosition();
    const payload = sanitizePowerupForDb({
      x: position.x,
      y: position.y,
      type: 'shield',
      spawnedAt: now,
    });
    writes.push(dbSet(dbRef(db, `${powerupsPath}/${id}`), payload));
  }

  await Promise.all(writes);
};
