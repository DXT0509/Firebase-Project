import {
  PLAYER_SIZE,
  EVOWARS_XP_TABLE,
  MAX_LEVEL,
  PUNCH_EXTRA,
  PUNCH_CONVERGENCE,
  SWORD_BASE_ANGLE,
  SWORD_SWEEP_ARC,
} from '../constants/gameConfig';

export const getLevelFromScore = (score) => {
  if (!Number.isFinite(score) || score <= 0) return 1;
  let level = 1;
  for (let i = 0; i < EVOWARS_XP_TABLE.length; i++) {
    if (score >= EVOWARS_XP_TABLE[i].score) {
      level = EVOWARS_XP_TABLE[i].level;
    } else {
      break;
    }
  }
  if (level < 1) return 1;
  if (level > MAX_LEVEL) return MAX_LEVEL;
  return level;
};

export const getSizeFromLevel = (level) => {
  const safeLevel = Math.max(1, Number.isFinite(level) ? level : 1);
  return PLAYER_SIZE + (safeLevel - 1) * 4;
};

export const getSwordWorldPoints = (x, y, angle, size, progress, side = 'left') => {
  const clampedProgress = Math.max(0, Math.min(1, progress || 0));
  const dir = side === 'right' ? -1 : 1;
  const sweep = SWORD_BASE_ANGLE + dir * clampedProgress * SWORD_SWEEP_ARC;
  const handReach = size * 0.35 + clampedProgress * size * 0.35;
  const bladeLength = size * 1.0;

  const handLocalX = Math.cos(sweep) * handReach;
  const handLocalY = Math.sin(sweep) * handReach;
  const tipLocalX = handLocalX + Math.cos(sweep) * bladeLength;
  const tipLocalY = handLocalY + Math.sin(sweep) * bladeLength;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  return {
    handX: x + handLocalX * cosA - handLocalY * sinA,
    handY: y + handLocalX * sinA + handLocalY * cosA,
    tipX: x + tipLocalX * cosA - tipLocalY * sinA,
    tipY: y + tipLocalX * sinA + tipLocalY * cosA,
    impactRadius: size * 0.22,
  };
};

export const checkCollision = (obj1, obj2, dist) => {
  if (!obj1 || !obj2 || typeof dist !== 'number') return false;
  if (
    typeof obj1.x !== 'number' ||
    typeof obj1.y !== 'number' ||
    typeof obj2.x !== 'number' ||
    typeof obj2.y !== 'number'
  ) {
    return false;
  }
  return Math.hypot(obj1.x - obj2.x, obj1.y - obj2.y) < dist;
};

const resolveEntitySize = (entity) => {
  if (!entity) return PLAYER_SIZE;
  if (typeof entity.size === 'number') return entity.size;
  if (typeof entity.bodySize === 'number') return entity.bodySize;
  if (typeof entity.score === 'number') {
    return getSizeFromLevel(getLevelFromScore(entity.score));
  }
  return PLAYER_SIZE;
};

export const isPunchHit = (attacker, target, leftP, rightP) => {
  if (!attacker || !target) return false;
  if (
    typeof attacker.x !== 'number' ||
    typeof attacker.y !== 'number' ||
    typeof target.x !== 'number' ||
    typeof target.y !== 'number'
  ) {
    return false;
  }

  const attackerSize = resolveEntitySize(attacker);
  const targetSize = resolveEntitySize(target);
  const handOffsetSide = attackerSize * 0.35;
  const baseForward = attackerSize * 0.45;
  const handRadius = attackerSize * 0.175;
  const targetBodyRadius = targetSize / 2;
  const angle = typeof attacker.angle === 'number' ? attacker.angle : 0;

  if (leftP > 0) {
    const leftF = baseForward + leftP * PUNCH_EXTRA;
    const leftS = handOffsetSide * (1 - leftP * PUNCH_CONVERGENCE);
    const lxLocal = leftF;
    const lyLocal = -leftS;
    const lxWorld = attacker.x + lxLocal * Math.cos(angle) - lyLocal * Math.sin(angle);
    const lyWorld = attacker.y + lxLocal * Math.sin(angle) + lyLocal * Math.cos(angle);
    if (checkCollision(target, { x: lxWorld, y: lyWorld }, targetBodyRadius + handRadius)) {
      return true;
    }
  }

  if (rightP > 0) {
    const rightF = baseForward + rightP * PUNCH_EXTRA;
    const rightS = handOffsetSide * (1 - rightP * PUNCH_CONVERGENCE);
    const rxLocal = rightF;
    const ryLocal = rightS;
    const rxWorld = attacker.x + rxLocal * Math.cos(angle) - ryLocal * Math.sin(angle);
    const ryWorld = attacker.y + rxLocal * Math.sin(angle) + ryLocal * Math.cos(angle);
    if (checkCollision(target, { x: rxWorld, y: ryWorld }, targetBodyRadius + handRadius)) {
      return true;
    }
  }

  return false;
};
