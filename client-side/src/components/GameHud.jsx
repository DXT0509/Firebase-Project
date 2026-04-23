/**
 * Purpose:
 * - Render gameplay HUD panels (XP progress + leaderboard).
 *
 * Responsibilities:
 * - Display player progression and compact ranking context.
 *
 * Key concepts:
 * - Component is display-only; upstream `buildHudState` owns calculations.
 */
import React from 'react';
import { getLevelFromScore } from '../utils/physics';

/**
 * Input: `hud` object produced by `buildHudState`.
 * Output: HUD JSX overlay.
 */
function GameHud({ hud }) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 20,
          transform: 'translateX(-50%)',
          minWidth: 260,
          maxWidth: 360,
          padding: '8px 14px',
          borderRadius: 16,
          background: 'rgba(0,0,0,0.5)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          color: '#f5f5f5',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 12,
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontWeight: 700 }}>Level {hud.myLevel}</span>
          <span style={{ opacity: 0.8 }}>
            {hud.myScoreValue} / {hud.nextScoreForLevel} XP
          </span>
        </div>
        <div
          style={{
            width: '100%',
            height: 10,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.15)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${hud.levelProgress * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #4ade80, #22c55e, #16a34a)',
              transition: 'width 0.15s linear',
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          background: 'rgba(56, 48, 48, 0.75)',
          padding: '0px 14px',
          borderRadius: '16px',
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          minWidth: 220,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#dbd0d0',
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Leaderboard</div>
        <div style={{ display: 'flex', fontWeight: 600, opacity: 0.7, marginBottom: 4 }}>
          <div style={{ width: 24, textAlign: 'left' }}>#</div>
          <div style={{ flex: 1, textAlign: 'left' }}>Name</div>
          <div style={{ width: 60, textAlign: 'right' }}>Score</div>
        </div>

        {hud.leaderboardRows.map((row) => {
          const isMe = row.id === hud.myId;
          const rowLevel = getLevelFromScore(row.score);
          return (
            <div
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 2,
                padding: '2px 4px',
                background: isMe ? 'rgba(107, 104, 104, 0.8)' : 'transparent',
                color: '#dbd0d0',
              }}
            >
              <div style={{ width: 24, textAlign: 'left' }}>{hud.rankMap[row.id]}</div>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  textAlign: 'left',
                  overflow: 'hidden',
                  paddingRight: 4,
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    marginLeft: 3,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(135deg, #facc15, #f97316)',
                      transform: 'rotate(45deg)',
                      borderRadius: 3,
                      boxShadow: '0 0 4px rgba(0,0,0,0.45)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontWeight: 700,
                      color: '#1f2933',
                    }}
                  >
                    {rowLevel}
                  </div>
                </div>

                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.name}
                </span>
              </div>
              <div style={{ width: 60, textAlign: 'right' }}>{row.score}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default GameHud;
