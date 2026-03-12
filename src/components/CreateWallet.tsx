import { useState } from 'react';
import { createPasskey } from '../lib/webauthn';
import { deploySignerProxy, getSignerAddress } from '../lib/signer';
import { deploySafe } from '../lib/safe';
import { saveSafe, arrayBufferToBase64, type SavedSafe } from '../lib/storage';

interface Props { onSafeCreated: (safe: SavedSafe) => void; }

type Phase = 'idle' | 'biometrics' | 'signer' | 'safe' | 'done' | 'error';

const STEPS: { phase: Phase; label: string }[] = [
  { phase: 'biometrics', label: 'Setting up biometrics…' },
  { phase: 'signer', label: 'Creating your signer…' },
  { phase: 'safe', label: 'Deploying your wallet…' },
  { phase: 'done', label: 'Done! ✅' },
];

export default function CreateWallet({ onSafeCreated }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    try {
      // Step 1: Passkey
      setPhase('biometrics');
      const cred = await createPasskey();

      // Step 2: Signer
      setPhase('signer');
      await deploySignerProxy(cred.publicKey.x, cred.publicKey.y);
      const signerAddr = await getSignerAddress(cred.publicKey.x, cred.publicKey.y);

      // Step 3: Safe
      setPhase('safe');
      const { txHash, safeAddress } = await deploySafe(signerAddr);

      setPhase('done');

      const saved: SavedSafe = {
        address: safeAddress,
        chainId: 84532,
        owners: [{
          address: signerAddr,
          publicKey: {
            x: cred.publicKey.x.toString(16),
            y: cred.publicKey.y.toString(16),
          },
          label: 'This Device',
          credentialId: arrayBufferToBase64(cred.rawId),
        }],
        threshold: 1,
        deployTxHash: txHash,
      };
      saveSafe(saved);

      setTimeout(() => onSafeCreated(saved), 800);
    } catch (e: any) {
      setPhase('error');
      setError(e.message || 'Something went wrong');
    }
  };

  const isWorking = phase !== 'idle' && phase !== 'error';
  const currentIdx = STEPS.findIndex(s => s.phase === phase);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 32 }}>
      {/* Hero */}
      <div>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🔐</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Passkey Wallet</h1>
        <p className="text-secondary" style={{ fontSize: 15 }}>
          Secured by Face ID • Powered by Safe
        </p>
      </div>

      {/* Progress */}
      {isWorking && (
        <div className="card fade-in" style={{ width: '100%' }}>
          <div className="progress-dots" style={{ marginBottom: 20 }}>
            {STEPS.map((s, i) => (
              <div
                key={s.phase}
                className={`progress-dot ${i < currentIdx ? 'done' : i === currentIdx ? 'active' : ''}`}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {phase !== 'done' && <div className="spinner spinner-dark" />}
            <span className="text-secondary" style={{ fontSize: 15, fontWeight: 500 }}>
              {STEPS.find(s => s.phase === phase)?.label}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card fade-in" style={{ width: '100%', textAlign: 'left' }}>
          <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 12 }}>⚠️ {error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => { setPhase('idle'); setError(''); }}>
            Try Again
          </button>
        </div>
      )}

      {/* CTA */}
      <div style={{ width: '100%' }}>
        {phase === 'idle' && (
          <button className="btn btn-primary" onClick={handleCreate}>
            Get Started
          </button>
        )}
        {phase === 'error' && (
          <button className="btn btn-primary" onClick={handleCreate}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
