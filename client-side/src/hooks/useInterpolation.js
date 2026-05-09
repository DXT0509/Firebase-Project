/**
 * Purpose:
 * - Apply per-frame smoothing from display targets to render state.
 *
 * Responsibilities:
 * - Interpolate position, facing, and combat animation values.
 * - Keep authoritative combat timing fields copied without interpolation.
 *
 * Key concepts:
 * - Bot and non-bot entities intentionally use different lerp factors.
 * - This module mutates `current` in place for performance.
 */
import { useCallback } from 'react';
import { BOT_ID_PREFIX } from '../constants/gameConfig';
import { lerp, normalizeAngle } from '../utils/math';

const POSITION_LERP = 0.55;
const ANGLE_LERP = 0.5;
const COMBAT_LERP = 0.75;
const BOT_POSITION_LERP = 0.28;
const BOT_ANGLE_LERP = 0.24;
const BOT_COMBAT_LERP = 0.6;

/**
 * Input:
 * - None.
 *
 * Output:
 * - `interpolateClientState` callback used by the sync orchestrator.
 */
export const useInterpolation = () => {
  /**
   * Inputs:
   * - id: entity id (used for bot/non-bot smoothing profile).
   * - current: mutable render state object.
   * - target: latest raw snapshot.
   * - displayTarget: predicted/clamped target position.
   *
   * Output:
   * - None; mutates `current` in place.
   *
   * Critical rule:
   * - Do not interpolate `lastPunchTime/punchStart/...`; hit logic depends on exact values.
   */
  const interpolateClientState = useCallback((id, current, target, displayTarget) => {
    const isBot = id.startsWith(BOT_ID_PREFIX);
    const positionLerp = isBot ? BOT_POSITION_LERP : POSITION_LERP;
    const angleLerp = isBot ? BOT_ANGLE_LERP : ANGLE_LERP;
    const combatLerp = isBot ? BOT_COMBAT_LERP : COMBAT_LERP;

    current.x = lerp(current.x ?? displayTarget.x, displayTarget.x, positionLerp);
    current.y = lerp(current.y ?? displayTarget.y, displayTarget.y, positionLerp);
    current.angle = (current.angle ?? target.angle ?? 0) +
      normalizeAngle((target.angle ?? 0) - (current.angle ?? target.angle ?? 0)) * angleLerp;

    const targetSwordAngle = typeof target.swordAngle === 'number' ? target.swordAngle : (target.angle || 0);
    current.swordAngle = (current.swordAngle ?? targetSwordAngle) +
      normalizeAngle(targetSwordAngle - (current.swordAngle ?? targetSwordAngle)) * angleLerp;

    current.leftPunch = lerp(current.leftPunch ?? 0, typeof target.leftPunch === 'number' ? target.leftPunch : 0, combatLerp);
    current.rightPunch = lerp(current.rightPunch ?? 0, typeof target.rightPunch === 'number' ? target.rightPunch : 0, combatLerp);
    current.swordSwing = lerp(
      current.swordSwing ?? 0,
      typeof target.swordSwing === 'number' ? target.swordSwing : Math.max(target.leftPunch || 0, target.rightPunch || 0),
      combatLerp,
    );

    if (typeof target.punchHand === 'number') current.punchHand = target.punchHand;
    if (typeof target.punchStart === 'number') current.punchStart = target.punchStart;
    if (typeof target.nextPunchHand === 'number') current.nextPunchHand = target.nextPunchHand;
    if (typeof target.lastPunchTime === 'number') current.lastPunchTime = target.lastPunchTime;
    if (target.lastPunchHit && typeof target.lastPunchHit === 'object') {
      current.lastPunchHit = target.lastPunchHit;
    } else {
      delete current.lastPunchHit;
    }
    current.color = target.color;
    current.score = target.score;
    current.boost = target.boost;
    current.name = target.name;
    current.lastSeen = target.lastSeen;
    current.activeEmote = target.activeEmote;
    current.emoteUntil = target.emoteUntil;
    current.emoteAt = target.emoteAt;
  }, []);

  return {
    interpolateClientState,
  };
};
