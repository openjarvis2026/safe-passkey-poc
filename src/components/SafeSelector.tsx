import { useState } from 'react';
import { type SavedSafe, getAllSafes, setActiveSafe, removeSafe, clearAllSafes } from '../lib/storage';

interface Props {
  currentSafe: SavedSafe;
  onSafeChanged: (safe: SavedSafe | null) => void;
}

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
const avatarColor = (addr: string) => COLORS[parseInt(addr.slice(2, 6), 16) % COLORS.length];

export default function SafeSelector({ currentSafe, onSafeChanged }: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showDisconnectMenu, setShowDisconnectMenu] = useState(false);
  
  const allSafes = getAllSafes();
  const safeList = Object.values(allSafes);
  
  // Only show selector if there are multiple safes
  if (safeList.length <= 1) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="avatar" style={{ background: avatarColor(currentSafe.address), width: 28, height: 28, fontSize: 10 }}>
          {currentSafe.address.slice(2, 4).toUpperCase()}
        </div>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{shortAddr(currentSafe.address)}</span>
        <button
          className="btn btn-ghost btn-sm"
          style={{ width: 'auto', fontSize: 12 }}
          onClick={() => setShowDisconnectMenu(!showDisconnectMenu)}
        >
          ⋯
        </button>
        
        {/* Disconnect Menu */}
        {showDisconnectMenu && (
          <div className="dropdown-menu fade-in" style={{ 
            position: 'absolute', 
            right: 0, 
            top: '100%', 
            marginTop: 4,
            zIndex: 1000,
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: 4,
            minWidth: 140,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)'
          }}>
            <button
              className="dropdown-item"
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                fontSize: 14,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer'
              }}
              onClick={() => {
                removeSafe(currentSafe.address);
                setShowDisconnectMenu(false);
                onSafeChanged(null);
              }}
            >
              🚪 Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Current Safe Button */}
      <button
        className="safe-selector-btn"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-full)',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 500,
          transition: 'all 0.2s ease'
        }}
        onClick={() => setShowDropdown(!showDropdown)}
      >
        <div className="avatar" style={{ background: avatarColor(currentSafe.address), width: 28, height: 28, fontSize: 10 }}>
          {currentSafe.address.slice(2, 4).toUpperCase()}
        </div>
        <span>{shortAddr(currentSafe.address)}</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {showDropdown ? '▴' : '▾'}
        </span>
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
        <div className="dropdown-menu fade-in" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 8,
          background: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-xl)',
          padding: 8,
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
          maxHeight: 300,
          overflowY: 'auto'
        }}>
          {/* Safe Options */}
          {safeList.map(safe => (
            <button
              key={safe.address}
              className="dropdown-item"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px',
                background: safe.address === currentSafe.address ? 'var(--primary-bg)' : 'none',
                border: 'none',
                borderRadius: 'var(--radius-lg)',
                cursor: 'pointer',
                fontSize: 14,
                textAlign: 'left',
                marginBottom: 4,
                transition: 'background 0.2s ease'
              }}
              onClick={() => {
                setActiveSafe(safe.address);
                setShowDropdown(false);
                onSafeChanged(safe);
              }}
            >
              <div className="avatar" style={{ background: avatarColor(safe.address), width: 32, height: 32, fontSize: 10 }}>
                {safe.address.slice(2, 4).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{shortAddr(safe.address)}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  {safe.threshold} of {safe.owners.length} signers
                </div>
              </div>
              {safe.address === currentSafe.address && (
                <span style={{ color: 'var(--primary-color)', fontSize: 16 }}>✓</span>
              )}
            </button>
          ))}
          
          {/* Divider */}
          <div style={{
            height: 1,
            background: 'var(--border-color)',
            margin: '8px 0'
          }} />
          
          {/* Disconnect Options */}
          <button
            className="dropdown-item"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              fontSize: 14,
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              color: 'var(--warning-color)',
              marginBottom: 4
            }}
            onClick={() => {
              removeSafe(currentSafe.address);
              setShowDropdown(false);
              onSafeChanged(null);
            }}
          >
            🚪 Disconnect Current
          </button>
          
          <button
            className="dropdown-item"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              fontSize: 14,
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              color: 'var(--error-color)'
            }}
            onClick={() => {
              if (confirm('Disconnect all wallets? This cannot be undone.')) {
                clearAllSafes();
                setShowDropdown(false);
                onSafeChanged(null);
              }
            }}
          >
            🗑️ Disconnect All
          </button>
        </div>
      )}
      
      {/* Backdrop to close dropdown */}
      {showDropdown && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={() => setShowDropdown(false)}
        />
      )}
      
      {/* Backdrop for disconnect menu */}
      {showDisconnectMenu && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={() => setShowDisconnectMenu(false)}
        />
      )}
    </div>
  );
}