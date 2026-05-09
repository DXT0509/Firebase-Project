/**
 * Purpose:
 * - Render radial emote selection wheel anchored to cursor position.
 *
 * Responsibilities:
 * - Draw wedge segments and icon states based on hovered option index.
 *
 * Key concepts:
 * - Pure presentation component; selection logic lives in App event handlers.
 */
import React from 'react';
import { EMOTE_OPTIONS } from '../constants/emotes';

/**
 * Inputs:
 * - visible: whether wheel should render.
 * - center: screen coordinate where wheel appears.
 * - hoveredIndex: currently highlighted emote index.
 *
 * Output:
 * - JSX radial wheel overlay.
 */
function EmoteWheel({ visible, center, hoveredIndex }) {
  if (!visible || !center) return null;

  const wheelSize = 246;
  const segmentCount = EMOTE_OPTIONS.length;
  const segmentAngle = 360 / segmentCount;
  const baseRotation = -90;
  const wheelCenter = wheelSize / 2;
  const outerRadius = 112;
  const innerRadius = 34;

  /** Input: degrees. Output: radians. */
  const toRadians = (deg) => (deg * Math.PI) / 180;

  /**
   * Inputs: center point, radius, and angle in degrees.
   * Output: cartesian point on the circle.
   */
  const polarToCartesian = (cx, cy, radius, angleDeg) => {
    const angle = toRadians(angleDeg);
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  };

  /**
   * Inputs: ring geometry and start/end angles.
   * Output: SVG path string for one wheel segment.
   */
  const describeWedge = (cx, cy, innerR, outerR, startAngle, endAngle) => {
    const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
    const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
    const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
    const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return [
      'M', innerStart.x, innerStart.y,
      'L', outerStart.x, outerStart.y,
      'A', outerR, outerR, 0, largeArcFlag, 1, outerEnd.x, outerEnd.y,
      'L', innerEnd.x, innerEnd.y,
      'A', innerR, innerR, 0, largeArcFlag, 0, innerStart.x, innerStart.y,
      'Z',
    ].join(' ');
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: center.x,
        top: center.y,
        transform: 'translate(-50%, -50%)',
        width: wheelSize,
        height: wheelSize,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      <svg
        viewBox={`0 0 ${wheelSize} ${wheelSize}`}
        width={wheelSize}
        height={wheelSize}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))',
        }}
      >
        <defs>
          <radialGradient id="emoteWheelCenterGlow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.45)" />
            <stop offset="65%" stopColor="rgba(0,0,0,0.25)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.05)" />
          </radialGradient>
        </defs>

        <circle cx={wheelCenter} cy={wheelCenter} r={outerRadius} fill="rgba(0,0,0,0.30)" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <circle cx={wheelCenter} cy={wheelCenter} r={innerRadius + 8} fill="url(#emoteWheelCenterGlow)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

        {EMOTE_OPTIONS.map((_, index) => {
          const start = baseRotation + index * segmentAngle;
          const end = start + segmentAngle;
          const isActive = hoveredIndex === index;
          return (
            <path
              key={`segment-${index}`}
              d={describeWedge(wheelCenter, wheelCenter, innerRadius, outerRadius, start, end)}
              fill={isActive ? 'rgba(250, 204, 21, 0.25)' : 'rgba(255,255,255,0.05)'}
              stroke={isActive ? 'rgba(250, 204, 21, 0.95)' : 'rgba(255,255,255,0.18)'}
              strokeWidth={isActive ? 2.5 : 1.25}
            />
          );
        })}
      </svg>
      {EMOTE_OPTIONS.map((item, index) => {
        const angle = baseRotation + index * segmentAngle + segmentAngle / 2;
        const isActive = hoveredIndex === index;
        const iconSize = isActive ? 42 : 30;
        const iconRadius = isActive ? 84 : 80;
        const iconPosition = polarToCartesian(wheelCenter, wheelCenter, iconRadius, angle);
        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: iconPosition.x,
              top: iconPosition.y,
              transform: 'translate(-50%, -50%)',
              width: iconSize,
              height: iconSize,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={item.label}
          >
            <div
              style={{
                color: '#fff',
                fontSize: isActive ? (item.id === 'gg' ? 18 : 22) : (item.id === 'gg' ? 14 : 18),
                fontWeight: 700,
                textShadow: isActive
                  ? '0 0 10px rgba(250, 204, 21, 0.85), 0 1px 2px rgba(0,0,0,0.7)'
                  : '0 1px 2px rgba(0,0,0,0.7)',
                transform: isActive ? 'scale(1.08)' : 'scale(1)',
                transition: 'transform 120ms ease, text-shadow 120ms ease',
              }}
            >
              {item.icon}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default EmoteWheel;
