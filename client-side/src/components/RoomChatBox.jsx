import React, { useEffect, useRef } from 'react';

function RoomChatBox({ messages }) {
  const listRef = useRef(null);

  const formatTime = (ts) => {
    if (!Number.isFinite(ts)) return '--:--';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '--:--';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        right: 20,
        background: 'rgba(56, 48, 48, 0.75)',
        padding: '0px 14px',
        borderRadius: '16px',
        pointerEvents: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        width: 300,
        maxWidth: 'min(300px, 40vw)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#dbd0d0',
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Room Chat</div>
      <div
        ref={listRef}
        style={{
          maxHeight: 180,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginBottom: 8,
          paddingRight: 4,
        }}
      >
        {(messages || []).length === 0 ? (
          <div style={{ opacity: 0.65, fontStyle: 'italic', paddingBottom: 8 }}>
            Chua co tin nhan
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                lineHeight: 1.35,
                width: '100%',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              <span style={{ opacity: 0.65, marginRight: 6 }}>[{formatTime(msg.ts)}]</span>
              <span style={{ color: '#facc15', fontWeight: 600 }}>{msg.senderName || 'USER'}:</span>{' '}
              <span
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              >
                {msg.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RoomChatBox;
