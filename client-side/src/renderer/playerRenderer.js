import {
  PLAYER_SIZE,
  SWORD_BASE_ANGLE,
  SWORD_SWEEP_ARC,
} from '../constants/gameConfig';
import { getSizeFromLevel } from '../utils/physics';

export const drawPlayer = (
  ctx,
  x,
  y,
  angle,
  color,
  leftPunch,
  rightPunch,
  label,
  isBoosting,
  level,
) => {
  const bodySize = typeof level === 'number' ? getSizeFromLevel(level) : PLAYER_SIZE;
  const swingP = Math.max(0, Math.min(1, Math.max(leftPunch || 0, rightPunch || 0)));
  const sweep = SWORD_BASE_ANGLE + swingP * SWORD_SWEEP_ARC;
  const handReach = bodySize * 0.35 + swingP * bodySize * 0.35;
  const bladeLength = bodySize * 1.0;
  const handSize = bodySize * 0.28;
  const armStartX = bodySize * 0.12;
  const armStartY = 0;
  const handX = Math.cos(sweep) * handReach;
  const handY = Math.sin(sweep) * handReach;
  const tipX = handX + Math.cos(sweep) * bladeLength;
  const tipY = handY + Math.sin(sweep) * bladeLength;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowOffsetY = 4;

  // Body
  ctx.fillStyle = color;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, bodySize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Eyes facing movement direction (+X after rotation)
  const eyeOffsetForward = bodySize * 0.16;
  const eyeOffsetSide = bodySize * 0.16;
  const eyeRadius = bodySize * 0.07;
  const pupilRadius = Math.max(1.5, bodySize * 0.03);
  const pupilForward = eyeRadius * 0.35;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(eyeOffsetForward, -eyeOffsetSide, eyeRadius, 0, Math.PI * 2);
  ctx.arc(eyeOffsetForward, eyeOffsetSide, eyeRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(eyeOffsetForward + pupilForward, -eyeOffsetSide, pupilRadius, 0, Math.PI * 2);
  ctx.arc(eyeOffsetForward + pupilForward, eyeOffsetSide, pupilRadius, 0, Math.PI * 2);
  ctx.fill();

  // Arm holding sword
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(4, bodySize * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(armStartX, armStartY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(handX, handY, handSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Sword
  const guardSize = bodySize * 0.22;
  const hiltLength = bodySize * 0.2;
  const hiltX = handX - Math.cos(sweep) * hiltLength;
  const hiltY = handY - Math.sin(sweep) * hiltLength;

  ctx.strokeStyle = '#5a3d1e';
  ctx.lineWidth = Math.max(4, bodySize * 0.08);
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(hiltX, hiltY);
  ctx.stroke();

  const perpX = -Math.sin(sweep);
  const perpY = Math.cos(sweep);
  ctx.strokeStyle = '#c9b037';
  ctx.lineWidth = Math.max(4, bodySize * 0.07);
  ctx.beginPath();
  ctx.moveTo(handX - perpX * guardSize * 0.5, handY - perpY * guardSize * 0.5);
  ctx.lineTo(handX + perpX * guardSize * 0.5, handY + perpY * guardSize * 0.5);
  ctx.stroke();

  ctx.strokeStyle = '#f5f5f5';
  ctx.lineWidth = Math.max(5, bodySize * 0.1);
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.strokeStyle = '#d6ecff';
  ctx.lineWidth = Math.max(2, bodySize * 0.04);
  ctx.beginPath();
  ctx.moveTo(handX + perpX * 2, handY + perpY * 2);
  ctx.lineTo(tipX + perpX * 2, tipY + perpY * 2);
  ctx.stroke();

  // Boost ring
  if (isBoosting) {
    const pulse = (Math.sin(Date.now() / 80) + 1) / 2;
    const radius = bodySize / 2 + 18 + pulse * 10;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 5;
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  // Label (upright)
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowBlur = 4;
  ctx.shadowColor = 'black';

  const baseY = bodySize / 2 + 20;
  let levelText = '';
  let nameText = label || '';

  if (label) {
    const parts = String(label).split(' ');
    if (parts[0].startsWith('Lv')) {
      levelText = parts[0].slice(2);
      nameText = parts.slice(1).join(' ');
    }
  }

  if (levelText) {
    const diamondSize = 18;
    const half = diamondSize / 2;
    const gap = 6;
    const badgeX = -half - gap;

    ctx.save();
    ctx.translate(badgeX, baseY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-half, -half, diamondSize, diamondSize);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(badgeX, baseY);
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(levelText, 0, 0);
    ctx.restore();

    if (nameText) {
      ctx.fillStyle = 'white';
      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(nameText, 6, baseY);
    }
  } else {
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label || '', 0, baseY);
  }

  ctx.restore();
};

export const drawAttackCooldownUnderLabel = (ctx, x, y, level, cooldownProgress) => {
  const bodySize = typeof level === 'number' ? getSizeFromLevel(level) : PLAYER_SIZE;
  const clamped = Math.max(0, Math.min(1, Number(cooldownProgress) || 0));
  if (clamped <= 0) return;

  const baseY = y + bodySize / 2 + 20;
  const barWidth = Math.max(48, bodySize * 1.15);
  const barHeight = 6;
  const barX = x - barWidth / 2;
  const barY = baseY + 11;

  ctx.save();
  ctx.shadowBlur = 4;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, 999);
  ctx.fill();

  ctx.fillStyle = 'rgba(239,68,68,0.95)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth * clamped, barHeight, 999);
  ctx.fill();

  ctx.restore();
};
