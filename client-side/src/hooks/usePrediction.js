/**
 * Purpose:
 * - Provide lightweight short-horizon prediction for remote players.
 *
 * Responsibilities:
 * - Estimate remote velocity at snapshot ingest time.
 * - Project display target slightly forward between packets.
 *
 * Key concepts:
 * - Bot entities are excluded from player prediction logic.
 * - Velocity is capped to prevent extreme teleport-like projections.
 */
import { useCallback } from 'react';
import { BOT_ID_PREFIX, WORLD_SIZE } from '../constants/gameConfig';

const REMOTE_PREDICTION_MS = 70;
const MAX_ESTIMATED_PLAYER_SPEED = 1200;

/**
 * Input:
 * - myId: local player id.
 *
 * Output:
 * - Prediction helpers for snapshot ingest and display target lookup.
 */
export const usePrediction = (myId) => {
  /**
   * Inputs:
   * - id: entity id.
   * - normalized: normalized latest snapshot (mutated in place).
   * - previous: previous raw snapshot for velocity estimation.
   *
   * Output:
   * - Snapshot enriched with `__vx/__vy/__recvTs`.
   */
  const applyPredictionToSnapshot = useCallback((id, normalized, previous) => {
    const now = Date.now();
    const isBot = id.startsWith(BOT_ID_PREFIX);

    if (!isBot && id !== myId && previous && typeof previous.x === 'number' && typeof previous.y === 'number') {
      const prevRecvTs = typeof previous.__recvTs === 'number' ? previous.__recvTs : now;
      const dtMs = Math.max(1, now - prevRecvTs);
      const dtSec = dtMs / 1000;
      const rawVx = (normalized.x - previous.x) / dtSec;
      const rawVy = (normalized.y - previous.y) / dtSec;
      // Cap velocity so occasional packet spikes do not overshoot render target.
      const speed = Math.hypot(rawVx, rawVy);
      const speedScale = speed > MAX_ESTIMATED_PLAYER_SPEED ? MAX_ESTIMATED_PLAYER_SPEED / speed : 1;
      normalized.__vx = rawVx * speedScale;
      normalized.__vy = rawVy * speedScale;
    } else {
      normalized.__vx = 0;
      normalized.__vy = 0;
    }

    normalized.__recvTs = now;
    return normalized;
  }, [myId]);

  /**
   * Inputs:
   * - id: entity id.
   * - target: raw snapshot enriched by `applyPredictionToSnapshot`.
   * - now: current client timestamp.
   *
   * Output:
   * - `{ x, y }` display target to feed interpolation.
   */
  const getPredictedTarget = useCallback((id, target, now) => {
    let displayTargetX = target.x;
    let displayTargetY = target.y;

    if (!id.startsWith(BOT_ID_PREFIX)) {
      const ageMs = typeof target.__recvTs === 'number' ? Math.max(0, now - target.__recvTs) : 0;
      const predictMs = Math.min(REMOTE_PREDICTION_MS, ageMs);
      const predictSec = predictMs / 1000;
      const vx = typeof target.__vx === 'number' ? target.__vx : 0;
      const vy = typeof target.__vy === 'number' ? target.__vy : 0;
      displayTargetX = Math.max(0, Math.min(WORLD_SIZE, target.x + vx * predictSec));
      displayTargetY = Math.max(0, Math.min(WORLD_SIZE, target.y + vy * predictSec));
    }

    return { x: displayTargetX, y: displayTargetY };
  }, []);

  return {
    applyPredictionToSnapshot,
    getPredictedTarget,
  };
};
