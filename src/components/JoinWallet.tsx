import { CHAIN_ID } from '../lib/chain';
import { useState, useEffect } from 'react';
import { createPasskey } from '../lib/webauthn';
import { deploySignerProxy, getSignerAddress } from '../lib/signer';
import { getOwners, getThreshold } from '../lib/safe';
import { saveSafe, arrayBufferToBase64, type SavedSafe, type SavedOwner } from '../lib/storage';

interface Props {
  safeAddress: `0x${string}`;
  onJoined: (safe: SavedSafe) => void;
}

type Phase = 'loading' | 'ready' | 'creating-passkey' | 'deploying-signer' | 'done' | 'error';

export default function JoinWallet({ safeAddress, onJoined }: Props) {
  const [owners, setOwners] = useState<`0x${string}`[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [signerAddress, setSignerAddress] = useState<`0x${string}` | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [o, t] = await Promise.all([getOwners(safeAddress), getThreshold(safeAddress)]);
        setOwners(o);
        setThreshold(Number(t));
        setPhase('ready');
      } catch (e: any) {
        setError(e.message);
        setPhase('error');
      }
    })();
  }, [safeAddress]);

  const handleJoin = async () => {
    setError('');
    
    try {
      // Step 1: Create passkey
      setPhase('creating-passkey');
      const cred = await createPasskey();
      
      // Step 2: Deploy signer proxy
      setPhase('deploying-signer');
      await deploySignerProxy(cred.publicKey.x, cred.publicKey.y);
      const addr = await getSignerAddress(cred.publicKey.x, cred.publicKey.y);
      setSignerAddress(addr);

      // Step 3: Done — the inviter must approve on their device
      // Do NOT redirect or auto-add. Show the address so the new signer can share it.
      setPhase('done');
      
      // Save wallet locally (marked as pending until inviter approves)
      const existingOwners: SavedOwner[] = owners.map(o => ({
        address: o, publicKey: { x: '', y: '' }, label: `Device ${o.slice(0, 8)}`,
      }));
      const localOwner: SavedOwner = {
        address: addr,
        publicKey: { x: cred.publicKey.x.toString(16), y: cred.publicKey.y.toString(16) },
        label: 'This Device',
        credentialId: arrayBufferToBase64(cred.rawId),
        pending: true, // Mark as pending approval
      };
      const saved: SavedSafe = {
        address: safeAddress, chainId: CHAIN_ID,
        owners: [...existingOwners, localOwner],
        threshold, deployTxHash: '',
        pending: true, // Mark entire safe as pending
      };
      saveSafe(saved);
    } catch (e: any) {
      setError(e.message);
      setPhase('error');
    }
  };

  const copyAddr = () => {
    if (signerAddress) {
      navigator.clipboard.writeText(signerAddress).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  if (phase === 'loading') return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner spinner-dark" />
    </div>
  );

  return (
    <div className="fade-in stack-lg" style={{ paddingTop: 40 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🤝</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Join Wallet</h1>
        <p className="text-secondary text-sm">You've been invited to co-sign a wallet</p>
      </div>

      {/* Progress Steps */}
      {(phase === 'creating-passkey' || phase === 'deploying-signer' || phase === 'done') && (
        <div className="invite-wizard">
          <div className="wizard-steps">
            <div className={`wizard-step ${phase === 'creating-passkey' ? 'active' : (phase === 'deploying-signer' || phase === 'done') ? 'done' : ''}`}>
              <div className="wizard-step-icon">1</div>
              <div className="wizard-step-content">
                <p className="wizard-step-title">Create Passkey</p>
                <p className="wizard-step-desc">Use Face ID or fingerprint</p>
              </div>
            </div>
            <div className={`wizard-step ${phase === 'deploying-signer' ? 'active' : phase === 'done' ? 'done' : ''}`}>
              <div className="wizard-step-icon">2</div>
              <div className="wizard-step-content">
                <p className="wizard-step-title">Deploy Signer</p>
                <p className="wizard-step-desc">Create your device signature</p>
              </div>
            </div>
            <div className={`wizard-step ${phase === 'done' ? 'done' : ''}`}>
              <div className="wizard-step-icon">3</div>
              <div className="wizard-step-content">
                <p className="wizard-step-title">Ready to Sign</p>
                <p className="wizard-step-desc">Waiting for wallet owner</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Safe info */}
      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Wallet Details</h3>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="text-secondary text-sm">Address</span>
          <span className="text-sm" style={{ fontFamily: 'monospace' }}>{shortAddr(safeAddress)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span className="text-secondary text-sm">Signatures required</span>
          <span className="text-sm">{threshold} of {owners.length + 1}</span>
        </div>
        <div>
          <p className="text-secondary text-xs mb-8">Current signers ({owners.length})</p>
          <div className="stack">
            {owners.slice(0, 3).map((o, i) => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="avatar" style={{ 
                  background: ['#6366F1', '#8B5CF6', '#EC4899'][i % 3], 
                  width: 32, 
                  height: 32,
                  fontSize: '12px'
                }}>
                  {o.slice(2, 4).toUpperCase()}
                </div>
                <span className="text-xs" style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {shortAddr(o)}
                </span>
              </div>
            ))}
            {owners.length > 3 && (
              <p className="text-xs text-muted">+{owners.length - 3} more signers...</p>
            )}
          </div>
        </div>
      </div>

      {/* Progress States */}
      {phase === 'creating-passkey' && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner spinner-dark" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Creating your passkey...</h3>
          <p className="text-secondary text-sm">
            Follow the prompts on your device to create a passkey using Face ID, Touch ID, or your device password.
          </p>
        </div>
      )}

      {phase === 'deploying-signer' && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner spinner-dark" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Deploying signer...</h3>
          <p className="text-secondary text-sm">
            Creating your device signature contract on the blockchain. This may take a few seconds.
          </p>
        </div>
      )}

      {/* Done state */}
      {phase === 'done' && signerAddress && (
        <div className="card fade-in">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Your device is ready!</h3>
            <p className="text-secondary text-sm">
              Your passkey has been created and your device signer is deployed.
            </p>
          </div>

          <div className="card info-card">
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>What happens next?</h4>
            <div className="text-sm text-secondary" style={{ lineHeight: 1.5 }}>
              1. The wallet owner will see your device address and decide whether to approve<br/>
              2. Once approved, your device will be added as a signer<br/>
              3. You'll then be able to sign transactions from this wallet
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <p className="text-secondary text-xs mb-8">Your device address (share with wallet owner):</p>
            <div className="addr-chip" style={{ marginBottom: 12 }}>{signerAddress}</div>
            <div className="row">
              <button className="btn btn-secondary btn-sm flex-1" onClick={copyAddr}>
                {copied ? 'Copied! ✅' : '📋 Copy Address'}
              </button>
              {typeof navigator.share === 'function' && (
                <button className="btn btn-secondary btn-sm flex-1" onClick={() => navigator.share?.({ text: signerAddress })}>
                  📤 Share
                </button>
              )}
            </div>
          </div>
          
          <button className="btn btn-primary" onClick={() => { window.location.hash = '#/'; }}>
            Go to Dashboard →
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="card fade-in">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--danger)' }}>
                Something went wrong
              </h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {error.includes('passkey') ? 
                  'Failed to create passkey. Make sure your device supports biometric authentication.' :
                  error.includes('deploy') ?
                  'Failed to deploy signer contract. Please check your internet connection and try again.' :
                  error
                }
              </p>
              <button className="btn btn-secondary btn-sm" onClick={() => setPhase('ready')}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Initial join button */}
      {phase === 'ready' && (
        <div className="stack">
          <button className="btn btn-primary" onClick={handleJoin}>
            🔐 Join Wallet
          </button>
          <p className="text-center text-xs text-muted">
            You'll be prompted to create a passkey using your device's biometric authentication
          </p>
        </div>
      )}
    </div>
  );
}
