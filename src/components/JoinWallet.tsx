import { useState, useEffect } from 'react';
import { createPasskey } from '../lib/webauthn';
import { deploySignerProxy, getSignerAddress } from '../lib/signer';
import { getOwners, getThreshold } from '../lib/safe';
import { saveSafe, arrayBufferToBase64, type SavedSafe, type SavedOwner } from '../lib/storage';

interface Props {
  safeAddress: `0x${string}`;
  onJoined: (safe: SavedSafe) => void;
}

type Phase = 'loading' | 'ready' | 'joining' | 'done' | 'error';

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
    setPhase('joining');
    setError('');
    try {
      const cred = await createPasskey();
      await deploySignerProxy(cred.publicKey.x, cred.publicKey.y);
      const addr = await getSignerAddress(cred.publicKey.x, cred.publicKey.y);
      setSignerAddress(addr);

      const existingOwners: SavedOwner[] = owners.map(o => ({
        address: o, publicKey: { x: '', y: '' }, label: `Device ${o.slice(0, 8)}`,
      }));
      const localOwner: SavedOwner = {
        address: addr,
        publicKey: { x: cred.publicKey.x.toString(16), y: cred.publicKey.y.toString(16) },
        label: 'This Device',
        credentialId: arrayBufferToBase64(cred.rawId),
      };
      const saved: SavedSafe = {
        address: safeAddress, chainId: 84532,
        owners: [...existingOwners, localOwner],
        threshold, deployTxHash: '',
      };
      saveSafe(saved);
      setPhase('done');
      onJoined(saved);
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

      {/* Safe info */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="text-secondary text-sm">Wallet</span>
          <span className="text-sm" style={{ fontFamily: 'monospace' }}>{shortAddr(safeAddress)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span className="text-secondary text-sm">Threshold</span>
          <span className="text-sm">{threshold} of {owners.length}</span>
        </div>
        <div>
          <p className="text-secondary text-xs mb-8">Authorized devices</p>
          {owners.map(o => (
            <p key={o} className="text-xs" style={{ fontFamily: 'monospace', padding: '2px 0', color: 'var(--text-secondary)' }}>
              {shortAddr(o)}
            </p>
          ))}
        </div>
      </div>

      {/* Done state */}
      {phase === 'done' && signerAddress && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>✅ Your device is ready!</p>
          <p className="text-secondary text-xs mb-8">Share this address with the wallet owner to add your device</p>
          <div className="addr-chip" style={{ marginBottom: 12 }}>{signerAddress}</div>
          <div className="row">
            <button className="btn btn-primary btn-sm flex-1" onClick={copyAddr}>
              {copied ? 'Copied! ✅' : '📋 Copy'}
            </button>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-secondary btn-sm flex-1" onClick={() => navigator.share?.({ text: signerAddress })}>
                📤 Share
              </button>
            )}
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => { window.location.hash = '#/'; }}>
            Go to Dashboard →
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card fade-in">
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>⚠️ {error}</p>
        </div>
      )}

      {/* Join button */}
      {(phase === 'ready' || phase === 'error') && (
        <button className="btn btn-primary" onClick={handleJoin}>
          Join Wallet
        </button>
      )}

      {phase === 'joining' && (
        <button className="btn btn-primary" disabled>
          <div className="spinner" /> Setting up…
        </button>
      )}
    </div>
  );
}
