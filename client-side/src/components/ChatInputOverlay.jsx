import React from 'react';

function ChatInputOverlay({ value, onChange, inputRef }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(520px, 78vw)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          height: 44,
          borderRadius: 999,
          background: 'rgba(56, 48, 48, 0.75)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          pointerEvents: 'auto',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={onChange}
          placeholder="Nhap tin nhan... (Enter de gui)"
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: '#f5f5f5',
            fontSize: 14,
          }}
        />
      </div>
    </div>
  );
}

export default ChatInputOverlay;
