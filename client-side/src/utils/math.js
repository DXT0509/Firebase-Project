export const clamp = (val, min, max) => {
  return Math.max(min, Math.min(max, val));
};

export const lerp = (start, end, amt) => {
  return start + (end - start) * amt;
};

export const getAngle = (x1, y1, x2, y2) => {
  return Math.atan2(y2 - y1, x2 - x1);
};

export const getDistance = (x1, y1, x2, y2) => {
  return Math.hypot(x2 - x1, y2 - y1);
};

export const normalizeAngle = (angle) => {
  let normalized = angle;
  while (normalized <= -Math.PI) normalized += Math.PI * 2;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
};

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
