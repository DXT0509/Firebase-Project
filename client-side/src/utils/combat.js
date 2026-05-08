import { BOT_ID_PREFIX } from '../constants/gameConfig';
import { getLevelFromScore, getScoreFloorForLevel, getSizeFromLevel, getSwordWorldPoints } from './physics';
import { getPointToSegmentDistance } from './math';

/**
 * Inputs:
 * - rawClients: authoritative room client snapshot.
 * - now: current timestamp.
 *
 * Output:
 * - Map of per-client patches that resolve hit detection deterministically.
 *
 * Critical rule:
 * - Use raw authoritative state only; never read interpolated/smoothed values.
 */
export const buildCombatHitPatches = (rawClients, now) => {
  const snapshot = rawClients || {};
  const mergedUpdates = {};
  const projected = { ...snapshot };

  const isInvulnerable = (entity) => {
    if (!entity) return false;
    const invulnerableUntil = typeof entity.invulnerableUntil === 'number' ? entity.invulnerableUntil : 0;
    return invulnerableUntil > now;
  };

  Object.entries(snapshot).forEach(([attackerId, attacker]) => {
    if (!attacker) return;
    if (attacker.isDead === true) return;
    if (isInvulnerable(attacker)) return;

    const isBot = attackerId.startsWith(BOT_ID_PREFIX);
    const swingProgress = typeof attacker.swordSwing === 'number'
      ? attacker.swordSwing
      : Math.max(attacker.leftPunch || 0, attacker.rightPunch || 0);
    if (swingProgress <= 0) return;

    const swingStamp = isBot
      ? (typeof attacker.lastPunchTime === 'number' ? attacker.lastPunchTime : 0)
      : (typeof attacker.lastSwingTime === 'number' ? attacker.lastSwingTime : 0);
    if (swingStamp <= 0) return;

    const memoKey = isBot ? 'lastPunchHit' : 'lastSwingHit';
    const hitMemo = attacker[memoKey] && typeof attacker[memoKey] === 'object'
      ? { ...attacker[memoKey] }
      : {};

    Object.entries(projected).forEach(([targetId, target]) => {
      if (targetId === attackerId) return;
      if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') return;

      const targetProjected = {
        ...target,
        ...(mergedUpdates[targetId] || {}),
      };

      if (targetProjected.isDead === true) return;
      if (isInvulnerable(targetProjected)) return;
      if (hitMemo[targetId] === swingStamp) return;

      const attackerScoreForGeometry = Number.isFinite(attacker.score) ? attacker.score : 0;
      const attackerSize = getSizeFromLevel(getLevelFromScore(attackerScoreForGeometry));
      const targetScoreForGeometry = Number.isFinite(targetProjected.score) ? targetProjected.score : 0;
      const targetSize = getSizeFromLevel(getLevelFromScore(targetScoreForGeometry));
      const swordAngle = typeof attacker.swordAngle === 'number'
        ? attacker.swordAngle
        : (typeof attacker.angle === 'number' ? attacker.angle : 0);
      const sword = getSwordWorldPoints(
        attacker.x,
        attacker.y,
        swordAngle,
        attackerSize,
        swingProgress,
        'left',
      );
      const bladeDistToTarget = getPointToSegmentDistance(
        targetProjected.x,
        targetProjected.y,
        sword.handX,
        sword.handY,
        sword.tipX,
        sword.tipY,
      );
      const targetRadius = targetSize / 2;
      if (bladeDistToTarget >= targetRadius + sword.impactRadius) return;

      hitMemo[targetId] = swingStamp;

      const victimScore = Number.isFinite(targetProjected.score) ? targetProjected.score : 0;
      const victimLevel = getLevelFromScore(victimScore);
      const victimLevelAfterDeath = Math.max(1, victimLevel - 2);
      const victimScoreAfterDeath = getScoreFloorForLevel(victimLevelAfterDeath);

      const attackerScoreBase = Number.isFinite((mergedUpdates[attackerId] || {}).score)
        ? (mergedUpdates[attackerId] || {}).score
        : attackerScoreForGeometry;
      mergedUpdates[attackerId] = {
        ...(mergedUpdates[attackerId] || {}),
        score: attackerScoreBase + victimScore,
        updatedAt: now,
        [memoKey]: hitMemo,
      };

      mergedUpdates[targetId] = {
        ...(mergedUpdates[targetId] || {}),
        score: victimScoreAfterDeath,
        isDead: true,
        killerId: attackerId,
        deathAt: now,
        updatedAt: now,
        respawnRequestedAt: 0,
        ...(targetId.startsWith(BOT_ID_PREFIX) ? { respawnAt: now + 3000 } : {}),
      };

      projected[targetId] = {
        ...targetProjected,
        ...mergedUpdates[targetId],
      };
    });

    mergedUpdates[attackerId] = {
      ...(mergedUpdates[attackerId] || {}),
      [memoKey]: hitMemo,
    };
  });

  return mergedUpdates;
};