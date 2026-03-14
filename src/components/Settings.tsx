import { type SavedSafe } from '../lib/storage';

interface Props {
  safe: SavedSafe;
  onBack: () => void;
}

export default function Settings({ safe, onBack }: Props) {
  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button 
          className="btn btn-icon" 
          style={{ width: 44, height: 44, fontSize: 20 }} 
          onClick={onBack}
        >
          ←
        </button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Settings</h2>
      </div>

      {/* Signers shortcut */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => window.location.hash = '#/signers'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>👥</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 600 }}>Signers & Threshold</p>
            <p className="text-muted text-sm">Manage devices and approval rules</p>
          </div>
          <span style={{ fontSize: 16, opacity: 0.5 }}>→</span>
        </div>
      </div>

      {/* Wallet Info */}
      <div className="card">
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Wallet Info</h3>
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-secondary text-sm">Address</span>
            <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{safe.address.slice(0, 6)}…{safe.address.slice(-4)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-secondary text-sm">Network</span>
            <span style={{ fontSize: 13 }}>Base Sepolia</span>
          </div>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="card" style={{ background: 'var(--success-light)', border: '1px solid var(--success)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--success-dark)' }}>Safety Note</h3>
            <p style={{ fontSize: 12, color: 'var(--success-dark)', lineHeight: 1.4 }}>
              • Cannot set threshold higher than number of owners<br/>
              • Cannot remove the last owner<br/>
              • Changes require threshold signatures to execute
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}