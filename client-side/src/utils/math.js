/**
 * Purpose:
 * - Small math primitives shared across simulation, sync, and rendering.
 *
 * Responsibilities:
 * - Provide reusable clamp/interpolation/geometry helpers.
 *
 * Key concepts:
 * - Helpers are intentionally allocation-light for per-frame usage.
 */
/** Input: value + min/max bounds. Output: clamped value in [min, max]. */
export const clamp = (val, min, max) => {
  return Math.max(min, Math.min(max, val));
};

/** Input: start/end values + ratio. Output: linear interpolation result. */
export const lerp = (start, end, amt) => {
  return start + (end - start) * amt;
};

/** Inputs: two points. Output: angle (radians) from p1 to p2. */
export const getAngle = (x1, y1, x2, y2) => {
  return Math.atan2(y2 - y1, x2 - x1);
};

/** Inputs: two points. Output: Euclidean distance between them. */
export const getDistance = (x1, y1, x2, y2) => {
  return Math.hypot(x2 - x1, y2 - y1);
};

/**
 * Input: arbitrary angle in radians.
 * Output: equivalent angle normalized to (-PI, PI].
 * WHY: avoid long-arc interpolation artifacts.
 */
export const normalizeAngle = (angle) => {
  let normalized = angle;
  while (normalized <= -Math.PI) normalized += Math.PI * 2;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
};

/**
 * Inputs:
 * - Point `p` and segment endpoints `(x1,y1)-(x2,y2)`.
 *
 * Output:
 * - Shortest distance from point to segment.
 */
export const getPointToSegmentDistance = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
};
