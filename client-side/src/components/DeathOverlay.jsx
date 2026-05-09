/**
 * Purpose:
 * - Render the local-player death screen overlay and respawn action.
 *
 * Responsibilities:
 * - Show killer attribution and provide a respawn trigger button.
 *
 * Key concepts:
 * - Pure UI component; game loop and authoritative logic stay outside.
 */
import React from 'react';

/**
 * Inputs:
 * - visible: whether overlay is shown.
 * - killerName: display name of the killer.
 * - onRespawn: callback invoked when Respawn button is clicked.
 *
 * Output:
 * - Fullscreen overlay JSX when visible.
 */
function DeathOverlay({ visible, killerName, onRespawn }) {
  if (!visible) return null;

  const safeKillerName = killerName || 'Unknown';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(420px, 92vw)',
          borderRadius: 18,
          padding: '24px 20px',
          background: 'rgba(20, 20, 24, 0.92)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.42)',
          color: '#f3f4f6',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 10 }}>You Died</div>
        <div style={{ fontSize: 15, opacity: 0.9, marginBottom: 18 }}>
          You were killed by {safeKillerName}
        </div>
        <button
          type="button"
          onClick={onRespawn}
          style={{
            minWidth: 140,
            height: 40,
            borderRadius: 999,
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 700,
            color: '#0f172a',
            background: 'linear-gradient(135deg, #facc15, #fb7185)',
            boxShadow: '0 8px 20px rgba(250, 204, 21, 0.28)',
          }}
        >
          Respawn
        </button>
      </div>
    </div>
  );
}

export default DeathOverlay;
