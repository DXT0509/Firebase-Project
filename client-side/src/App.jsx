import React, { useEffect, useRef, useState } from 'react';
import { ref as dbRef, set as dbSet, onValue, remove as dbRemove } from 'firebase/database';
import { db } from './firebase/config';

function App() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [clients, setClients] = useState({}); // other clients' positions
  const containerRef = useRef(null);
  const posRef = useRef({ x: 0, y: 0 });
  const mouse = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);
  const lastRef = useRef(null);
  // Firebase realtime DB will store clients under /clients/{id}
  const idRef = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const colorRef = useRef((() => {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h},70%,50%)`;
  })());
  const lastSentRef = useRef(0);

  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => {
    // Initialize at center of viewport
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    setPos({ x: cx, y: cy });
  }, []);

  // removed keyboard handling — movement follows mouse

  useEffect(() => {
    // Track mouse position
    function onMouseMove(e) {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    }
    window.addEventListener('mousemove', onMouseMove);

    // Setup Firebase listeners/writers
    const clientsRef = dbRef(db, 'clients');
    const userRef = dbRef(db, `clients/${idRef.current}`);

    const unsubscribe = onValue(clientsRef, (snapshot) => {
      const val = snapshot.val() || {};
      setClients(val);
    });

    // write initial state
    try {
      dbSet(userRef, { x: posRef.current.x || window.innerWidth/2, y: posRef.current.y || window.innerHeight/2, color: colorRef.current, lastSeen: Date.now() });
    } catch (e) {}

    const speed = 300; // pixels per second

    function step(ts) {
      if (!lastRef.current) lastRef.current = ts;
      const dt = (ts - lastRef.current) / 1000; // seconds
      lastRef.current = ts;

      setPos(prev => {
        const tx = mouse.current.x;
        const ty = mouse.current.y;
        const dx = tx - prev.x;
        const dy = ty - prev.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) {
          const now = Date.now();
          if (now - lastSentRef.current > 100) {
            lastSentRef.current = now;
            try { dbSet(userRef, { x: tx, y: ty, color: colorRef.current, lastSeen: Date.now() }); } catch (e) {}
          }
          return { x: tx, y: ty };
        }
        const maxStep = speed * dt;
        const stepLen = Math.min(maxStep, dist);
        const nx = prev.x + (dx / dist) * stepLen;
        const ny = prev.y + (dy / dist) * stepLen;

        const now = Date.now();
        if (now - lastSentRef.current > 50) { // throttle updates ~20Hz
          lastSentRef.current = now;
          try { dbSet(userRef, { x: nx, y: ny, color: colorRef.current, lastSeen: Date.now() }); } catch (e) {}
        }

        return { x: nx, y: ny };
      });

      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);

    function onBeforeUnload() {
      try { dbRemove(userRef); } catch (e) {}
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { dbRemove(userRef); } catch (e) {}
      unsubscribe();
      lastRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#f3f4f6',
        position: 'relative',
      }}
      tabIndex={0}
    >
      {/* Render all clients (including self) */}
      {(() => {
        const all = { ...clients };
        all[idRef.current] = { x: pos.x, y: pos.y, color: colorRef.current };
        return Object.entries(all).map(([id, info]) => {
          const isMe = id === idRef.current;
          return (
            <div
              key={id}
              title={isMe ? 'Bạn' : `User ${id.slice(0,6)}`}
              style={{
                position: 'absolute',
                left: info.x,
                top: info.y,
                width: isMe ? 56 : 44,
                height: isMe ? 56 : 44,
                borderRadius: '50%',
                background: info.color || 'gray',
                transform: 'translate(-50%, -50%)',
                boxShadow: isMe ? '0 8px 26px rgba(0,0,0,0.18)' : '0 4px 10px rgba(0,0,0,0.12)',
                border: isMe ? '3px solid rgba(255,255,255,0.8)' : '2px solid rgba(255,255,255,0.9)'
              }}
            />
          );
        });
      })()}

      <div style={{ position: 'absolute', left: 12, top: 12 }}>
        <div style={{ padding: '6px 10px', background: 'white', borderRadius: 6 }}>
          Di chuyển chuột (không cần click) để điều khiển vòng tròn của bạn — người dùng: {Object.keys(clients).length + 1}
        </div>
      </div>
    </div>
  );
}

export default App;