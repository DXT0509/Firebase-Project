import React, { useEffect, useRef, useState } from 'react';
import { onChildAdded, onChildChanged, onChildRemoved, ref as dbRef } from 'firebase/database';
import { db } from '../firebase/config';
import { getRoomCollectionPath } from '../firebase/paths';

const PLAYER_NAME_STORAGE_KEY = 'arena-player-name';

const menuStyles = {
  root: {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    background: '#0a0a0a',
    color: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  bgCanvas: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    opacity: 0.22,
  },
  shell: {
    position: 'relative',
    zIndex: 1,
    minHeight: '100vh',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 300px)',
    alignItems: 'center',
    gap: 36,
    padding: 'clamp(24px, 5vw, 72px)',
  },
  main: {
    maxWidth: 620,
    justifySelf: 'center',
    width: '100%',
    textAlign: 'center',
  },
  deathNotice: {
    margin: '0 auto 18px',
    width: 'fit-content',
    maxWidth: '100%',
    padding: '10px 14px',
    border: '1px solid rgba(248, 113, 113, 0.55)',
    background: 'rgba(127, 29, 29, 0.32)',
    color: '#fecaca',
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 1.4,
  },
  title: {
    margin: 0,
    fontSize: 'clamp(3rem, 8vw, 6.5rem)',
    lineHeight: 0.92,
    letterSpacing: 0,
    fontWeight: 900,
    color: '#ffffff',
    textShadow: '0 0 26px rgba(74, 222, 128, 0.24)',
  },
  tagline: {
    margin: '14px 0 34px',
    color: '#94a3b8',
    fontSize: 'clamp(0.95rem, 2vw, 1.1rem)',
    fontWeight: 600,
  },
  form: {
    display: 'grid',
    gap: 12,
    maxWidth: 420,
    margin: '0 auto',
  },
  input: {
    height: 52,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(15, 23, 42, 0.82)',
    color: '#f8fafc',
    outline: 'none',
    padding: '0 16px',
    fontSize: 16,
    fontWeight: 650,
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.24)',
  },
  error: {
    minHeight: 18,
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'left',
  },
  button: {
    height: 56,
    borderRadius: 8,
    border: '1px solid rgba(134, 239, 172, 0.82)',
    background: 'linear-gradient(135deg, #22c55e, #86efac)',
    color: '#04130a',
    cursor: 'pointer',
    fontSize: 17,
    fontWeight: 900,
    letterSpacing: 0,
    boxShadow: '0 0 0 rgba(34, 197, 94, 0)',
    transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
  },
  panel: {
    alignSelf: 'center',
    justifySelf: 'end',
    width: '100%',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(10, 10, 10, 0.68)',
    borderRadius: 8,
    padding: 16,
    boxShadow: '0 18px 42px rgba(0,0,0,0.34)',
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'baseline',
    marginBottom: 12,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 900,
    color: '#e2e8f0',
    textTransform: 'uppercase',
  },
  online: {
    fontSize: 12,
    color: '#86efac',
    fontWeight: 800,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '28px minmax(0, 1fr) 64px',
    gap: 8,
    alignItems: 'center',
    padding: '7px 0',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    fontSize: 13,
  },
  muted: {
    color: '#64748b',
    fontSize: 13,
    paddingTop: 8,
  },
};

function MainMenu({ mode = 'menu', killerName, roomId, onPlay }) {
  const canvasRef = useRef(null);
  const inputRef = useRef(null);
  const [playerName, setPlayerName] = useState(() => {
    const savedName = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    return savedName ? savedName.slice(0, 16) : '';
  });
  const [error, setError] = useState('');
  const [isPlayHovered, setIsPlayHovered] = useState(false);
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 760);
  const [clients, setClients] = useState({});

  useEffect(() => {
    const updateLayout = () => {
      setIsCompact(window.innerWidth < 760);
    };
    window.addEventListener('resize', updateLayout);

    return () => {
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    let raf = 0;
    let width = 0;
    let height = 0;
    let offset = 0;
    const foods = Array.from({ length: 7 }, (_, index) => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      radius: 4 + Math.random() * 5,
      color: ['#22c55e', '#facc15', '#38bdf8', '#fb7185', '#a78bfa', '#f97316', '#f8fafc'][index],
    }));

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, width, height);

      offset = (offset - 0.22) % 72;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      for (let x = offset; x < width + 72; x += 72) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height + 72; y += 72) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      foods.forEach((food) => {
        food.x += food.vx;
        food.y += food.vy;
        if (food.x < -20) food.x = width + 20;
        if (food.x > width + 20) food.x = -20;
        if (food.y < -20) food.y = height + 20;
        if (food.y > height + 20) food.y = -20;

        ctx.save();
        ctx.shadowBlur = 16;
        ctx.shadowColor = food.color;
        ctx.fillStyle = food.color;
        ctx.beginPath();
        ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const clientsRef = dbRef(db, getRoomCollectionPath(roomId, 'clients'));

    const upsertClient = (snap) => {
      setClients((current) => ({
        ...current,
        [snap.key]: snap.val(),
      }));
    };
    const removeClient = (snap) => {
      setClients((current) => {
        const next = { ...current };
        delete next[snap.key];
        return next;
      });
    };

    const unsubscribeAdded = onChildAdded(clientsRef, upsertClient);
    const unsubscribeChanged = onChildChanged(clientsRef, upsertClient);
    const unsubscribeRemoved = onChildRemoved(clientsRef, removeClient);

    return () => {
      unsubscribeAdded();
      unsubscribeChanged();
      unsubscribeRemoved();
    };
  }, [roomId]);

  const leaderboardRows = Object.entries(clients)
    .map(([id, client]) => ({
      id,
      name: client?.name || (id ? id.slice(0, 4).toUpperCase() : 'USER'),
      score: typeof client?.score === 'number' ? client.score : 0,
      isDead: client?.isDead === true,
    }))
    .filter((row) => !row.isDead)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const onlineCount = Object.keys(clients).length;

  const submit = (event) => {
    event.preventDefault();
    const trimmedName = playerName.trim().slice(0, 16);
    if (!trimmedName) {
      setError('Vui lòng nhập tên trước khi vào trận.');
      inputRef.current?.focus();
      return;
    }

    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, trimmedName);
    setError('');
    onPlay(trimmedName);
  };

  const buttonLabel = mode === 'dead' ? 'Chơi lại' : 'Play';
  const safeKillerName = killerName || 'Unknown';

  return (
    <div style={menuStyles.root}>
      <canvas ref={canvasRef} style={menuStyles.bgCanvas} />
      <div
        style={{
          ...menuStyles.shell,
          gridTemplateColumns: isCompact ? 'minmax(0, 1fr)' : menuStyles.shell.gridTemplateColumns,
          alignItems: isCompact ? 'start' : menuStyles.shell.alignItems,
          gap: isCompact ? 22 : menuStyles.shell.gap,
          padding: isCompact ? '28px 18px' : menuStyles.shell.padding,
        }}
      >
        <main style={menuStyles.main}>
          {mode === 'dead' && (
            <div style={menuStyles.deathNotice}>
              Bạn đã bị tiêu diệt bởi <strong>{safeKillerName}</strong>
            </div>
          )}

          <h1 style={menuStyles.title}>ARENA SYNC</h1>
          <p style={menuStyles.tagline}>Survive. Grow. Dominate.</p>

          <form style={menuStyles.form} onSubmit={submit}>
            <input
              ref={inputRef}
              value={playerName}
              maxLength={16}
              onChange={(event) => {
                setPlayerName(event.target.value.slice(0, 16));
                if (error) setError('');
              }}
              placeholder="Nhập tên của bạn"
              style={{
                ...menuStyles.input,
                border: error ? '1px solid rgba(248, 113, 113, 0.82)' : menuStyles.input.border,
              }}
            />
            <div style={menuStyles.error}>{error}</div>
            <button
              type="submit"
              onMouseEnter={() => setIsPlayHovered(true)}
              onMouseLeave={() => setIsPlayHovered(false)}
              style={{
                ...menuStyles.button,
                transform: isPlayHovered ? 'scale(1.025)' : 'scale(1)',
                boxShadow: isPlayHovered
                  ? '0 0 28px rgba(34, 197, 94, 0.32), 0 12px 30px rgba(0,0,0,0.36)'
                  : '0 10px 24px rgba(0,0,0,0.28)',
              }}
            >
              {buttonLabel}
            </button>
          </form>
        </main>

        <aside
          style={{
            ...menuStyles.panel,
            justifySelf: isCompact ? 'center' : menuStyles.panel.justifySelf,
            maxWidth: isCompact ? 420 : 'none',
          }}
        >
          <div style={menuStyles.panelHeader}>
            <div style={menuStyles.panelTitle}>Leaderboard</div>
            <div style={menuStyles.online}>{onlineCount} online</div>
          </div>
          {leaderboardRows.length === 0 ? (
            <div style={menuStyles.muted}>Chưa có người chơi nào.</div>
          ) : (
            leaderboardRows.map((row, index) => (
              <div key={row.id} style={menuStyles.row}>
                <span style={{ color: '#94a3b8', fontWeight: 800 }}>#{index + 1}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 750 }}>
                  {row.name}
                </span>
                <span style={{ textAlign: 'right', color: '#facc15', fontWeight: 850 }}>{row.score}</span>
              </div>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

export default MainMenu;
