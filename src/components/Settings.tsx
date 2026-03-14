import { type SavedSafe } from '../lib/storage';
import { EXPLORER } from '../lib/relayer';

interface Props {
  safe: SavedSafe;
  onBack: () => void;
}

const SettingItem = ({ 
  icon, 
  title, 
  description, 
  onClick, 
  value,
  external = false 
}: { 
  icon: string; 
  title: string; 
  description: string; 
  onClick: () => void;
  value?: string;
  external?: boolean;
}) => (
  <div 
    className="card-interactive"
    onClick={onClick}
    style={{
      padding: 'var(--spacing-lg)',
      cursor: 'pointer',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--card-bg)',
    }}
  >
    <div className="flex-between">
      <div className="flex-center" style={{ gap: 'var(--spacing-md)', flex: 1 }}>
        <div style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--card-bg-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          flexShrink: 0,
        }}>
          {icon}
        </div>
        
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex-between" style={{ marginBottom: 2 }}>
            <h3 className="text-small" style={{ fontWeight: 600, margin: 0 }}>
              {title}
            </h3>
            {value && (
              <span className="text-xs text-accent" style={{ fontWeight: 500 }}>
                {value}
              </span>
            )}
          </div>
          <p className="text-xs text-secondary" style={{ margin: 0, lineHeight: 1.4 }}>
            {description}
          </p>
        </div>
      </div>
      
      <div className="flex-center" style={{ marginLeft: 'var(--spacing-sm)' }}>
        {external ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
    </div>
  </div>
);

const InfoRow = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex-between" style={{ 
    padding: 'var(--spacing-sm) 0',
    borderBottom: '1px solid var(--border-light)',
  }}>
    <span className="text-small text-secondary">{label}</span>
    <span 
      className="text-small" 
      style={{ 
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-body)',
        fontWeight: 500,
        color: 'var(--text-primary)'
      }}
    >
      {value}
    </span>
  </div>
);

export default function Settings({ safe, onBack }: Props) {
  const shortAddress = `${safe.address.slice(0, 6)}…${safe.address.slice(-4)}`;
  const signerCount = safe.owners.length;
  const threshold = safe.threshold;

  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div className="flex-center" style={{ gap: 'var(--spacing-md)' }}>
        <button 
          className="btn btn-icon"
          onClick={onBack}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2 className="text-title">Settings</h2>
        <div style={{ width: 48 }} /> {/* Spacer */}
      </div>

      {/* Main Settings */}
      <div className="stack-md">
        <SettingItem
          icon="👥"
          title="Signers & Security"
          description={`${signerCount} signer${signerCount === 1 ? '' : 's'} • ${threshold} required to approve`}
          value={`${threshold}/${signerCount}`}
          onClick={() => window.location.hash = '#/signers'}
        />

        <SettingItem
          icon="📋"
          title="Transaction History"
          description="View all your transaction activity"
          onClick={() => window.location.hash = '#/history'}
        />

        <SettingItem
          icon="🔗"
          title="View on Explorer"
          description="Check your wallet on Base Sepolia explorer"
          external
          onClick={() => window.open(`${EXPLORER}/address/${safe.address}`, '_blank')}
        />
      </div>

      {/* Wallet Information Card */}
      <div className="card">
        <h3 className="text-heading" style={{ marginBottom: 'var(--spacing-lg)' }}>
          Wallet Information
        </h3>
        
        <div style={{ marginBottom: 'var(--spacing-sm)' }}>
          <InfoRow 
            label="Address" 
            value={shortAddress}
            mono
          />
          <InfoRow 
            label="Network" 
            value="Base Sepolia"
          />
          <InfoRow 
            label="Chain ID" 
            value={safe.chainId.toString()}
          />
          <div className="flex-between" style={{ padding: 'var(--spacing-sm) 0' }}>
            <span className="text-small text-secondary">Status</span>
            <div className="flex-center" style={{ gap: 6 }}>
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
                boxShadow: '0 0 6px var(--accent)',
              }} />
              <span className="text-small text-accent" style={{ fontWeight: 500 }}>
                Active
              </span>
            </div>
          </div>
        </div>

        {/* Copy Address Button */}
        <button 
          className="btn btn-secondary btn-sm"
          onClick={() => {
            navigator.clipboard.writeText(safe.address);
            // Could add a toast notification here
          }}
          style={{
            marginTop: 'var(--spacing-md)',
            fontSize: 12,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy Full Address
        </button>
      </div>

      {/* Security Notice */}
      <div className="card" style={{
        background: 'rgba(16, 185, 129, 0.1)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
      }}>
        <div className="flex-center" style={{ gap: 'var(--spacing-md)', alignItems: 'flex-start' }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(16, 185, 129, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
          }}>
            🛡️
          </div>
          
          <div style={{ flex: 1 }}>
            <h3 className="text-small" style={{ 
              fontWeight: 600, 
              marginBottom: 'var(--spacing-xs)',
              color: 'var(--accent)'
            }}>
              Security Information
            </h3>
            <ul style={{ 
              fontSize: 12, 
              color: 'var(--text-secondary)', 
              lineHeight: 1.5,
              margin: 0,
              paddingLeft: 'var(--spacing-md)',
            }}>
              <li>Threshold cannot exceed the number of signers</li>
              <li>Cannot remove the last remaining signer</li>
              <li>All changes require threshold signatures</li>
              <li>Your passkey is stored securely on this device</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Version Info */}
      <div style={{ 
        textAlign: 'center', 
        marginTop: 'var(--spacing-lg)',
        paddingBottom: 'var(--spacing-xl)'
      }}>
        <p className="text-xs text-muted">
          Simply Wallet v1.0 • Built with Safe Protocol
        </p>
        <p className="text-xs text-muted" style={{ marginTop: 4 }}>
          Powered by passkeys and account abstraction
        </p>
      </div>
    </div>
  );
}