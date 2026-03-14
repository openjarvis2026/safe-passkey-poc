import { CHAIN_ID } from '../lib/chain';
import { useState } from 'react';
import { createPasskey } from '../lib/webauthn';
import { deploySignerProxy, getSignerAddress } from '../lib/signer';
import { deploySafe } from '../lib/safe';
import { saveSafe, arrayBufferToBase64, type SavedSafe } from '../lib/storage';

interface Props { onSafeCreated: (safe: SavedSafe) => void; }

type Phase = 'idle' | 'biometrics' | 'signer' | 'safe' | 'done' | 'error';

const STEPS: { phase: Phase; label: string; description: string }[] = [
  { phase: 'biometrics', label: 'Setting up biometrics', description: 'Creating your secure passkey' },
  { phase: 'signer', label: 'Setting up device', description: 'Deploying signer contract' },
  { phase: 'safe', label: 'Creating wallet', description: 'Deploying your Safe wallet' },
  { phase: 'done', label: 'Ready to go!', description: 'Your wallet is ready' },
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
        chainId: CHAIN_ID,
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

      setTimeout(() => onSafeCreated(saved), 1200);
    } catch (e: any) {
      setPhase('error');
      setError(e.message || 'Something went wrong');
    }
  };

  const isWorking = phase !== 'idle' && phase !== 'error';
  const currentIdx = STEPS.findIndex(s => s.phase === phase);

  return (
    <div className="flex-center" style={{ 
      flex: 1, 
      flexDirection: 'column', 
      justifyContent: 'center',
      textAlign: 'center', 
      padding: 'var(--spacing-xl) 0',
      gap: 'var(--spacing-2xl)' 
    }}>
      {/* Hero Section */}
      <div className="fade-in" style={{ 
        animationDelay: '0.1s',
        animationFillMode: 'both'
      }}>
        {/* Icon */}
        <div style={{
          width: 96,
          height: 96,
          borderRadius: 'var(--radius-2xl)',
          background: 'var(--primary-gradient)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 48,
          marginBottom: 'var(--spacing-xl)',
          margin: '0 auto var(--spacing-xl)',
          boxShadow: 'var(--shadow-lg)',
          border: '2px solid rgba(255, 255, 255, 0.1)',
        }}>
          🔐
        </div>

        {/* Title */}
        <h1 className="text-display" style={{ 
          marginBottom: 'var(--spacing-md)',
          background: 'var(--primary-gradient)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Simply Wallet
        </h1>
        
        {/* Subtitle */}
        <p className="text-body text-secondary" style={{ 
          maxWidth: 320,
          lineHeight: 1.6,
          margin: '0 auto'
        }}>
          Send and receive money with just your fingerprint or Face ID. 
          No seed phrases, no passwords.
        </p>
      </div>

      {/* Progress Steps */}
      {isWorking && (
        <div className="card fade-in" style={{ 
          width: '100%',
          animationDelay: '0.2s',
          animationFillMode: 'both'
        }}>
          <div className="stack-md">
            {STEPS.map((step, i) => {
              const isDone = i < currentIdx;
              const isActive = i === currentIdx;
              const isPending = i > currentIdx;

              return (
                <div 
                  key={step.phase} 
                  className="flex-center" 
                  style={{ 
                    gap: 'var(--spacing-md)',
                    opacity: isPending ? 0.4 : 1,
                    transition: 'all 0.4s ease',
                    transform: isActive ? 'translateX(2px)' : 'translateX(0)',
                  }}
                >
                  {/* Step Icon */}
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    fontWeight: 600,
                    background: isDone ? 'var(--accent)' : 
                               isActive ? 'var(--primary-gradient)' : 
                               'var(--card-bg-light)',
                    color: isDone || isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: `2px solid ${isDone ? 'var(--accent)' : 
                                        isActive ? 'transparent' : 
                                        'var(--border)'}`,
                    boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                    transition: 'all 0.4s ease',
                    flexShrink: 0,
                  }}>
                    {isDone ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isActive ? (
                      <div className="spinner" style={{ width: 20, height: 20 }} />
                    ) : (
                      i + 1
                    )}
                  </div>

                  {/* Step Content */}
                  <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <p className="text-small" style={{ 
                      fontWeight: isActive ? 600 : 500,
                      color: isDone ? 'var(--accent)' : 
                             isActive ? 'var(--text-primary)' : 
                             'var(--text-muted)',
                      marginBottom: 2,
                      transition: 'color 0.4s ease'
                    }}>
                      {step.label}
                    </p>
                    <p className="text-xs text-muted" style={{
                      opacity: isActive ? 1 : 0.7,
                      transition: 'opacity 0.4s ease'
                    }}>
                      {step.description}
                    </p>
                  </div>

                  {/* Progress Line */}
                  {i < STEPS.length - 1 && (
                    <div style={{
                      position: 'absolute',
                      left: 22,
                      top: 44,
                      width: 2,
                      height: 32,
                      background: isDone ? 'var(--accent)' : 'var(--border-light)',
                      transition: 'background 0.4s ease',
                      zIndex: 0,
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Success State */}
      {phase === 'done' && (
        <div className="fade-in" style={{ 
          animationDelay: '0.3s',
          animationFillMode: 'both'
        }}>
          <div className="flex-center" style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--accent)',
            margin: '0 auto var(--spacing-lg)',
            animation: 'pulse 2s infinite',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-heading text-accent" style={{ marginBottom: 'var(--spacing-sm)' }}>
            Welcome to Simply Wallet!
          </p>
          <p className="text-small text-secondary">
            Taking you to your new wallet...
          </p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card fade-in" style={{ 
          width: '100%',
          border: '1px solid var(--danger)',
          background: 'rgba(239, 68, 68, 0.05)'
        }}>
          <div className="flex-center" style={{ gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <p className="text-danger text-small" style={{ fontWeight: 500 }}>
              Something went wrong
            </p>
          </div>
          <p className="text-xs text-secondary" style={{ marginBottom: 'var(--spacing-md)' }}>
            {error}
          </p>
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => { setPhase('idle'); setError(''); }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ width: '100%', gap: 'var(--spacing-md)' }} className="stack">
        {phase === 'idle' && (
          <>
            <button 
              className="btn btn-primary fade-in" 
              onClick={handleCreate}
              style={{ 
                animationDelay: '0.4s',
                animationFillMode: 'both'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v16m8-8H4" />
              </svg>
              Create New Wallet
            </button>
            
            <button 
              className="btn btn-ghost fade-in" 
              onClick={() => { window.location.hash = '#/join'; }}
              style={{ 
                animationDelay: '0.5s',
                animationFillMode: 'both'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Join Existing Wallet
            </button>
          </>
        )}
        
        {phase === 'error' && (
          <button className="btn btn-primary" onClick={handleCreate}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Retry Setup
          </button>
        )}
      </div>

      {/* Feature Pills */}
      {phase === 'idle' && (
        <div className="fade-in" style={{ 
          display: 'flex', 
          gap: 'var(--spacing-sm)', 
          flexWrap: 'wrap', 
          justifyContent: 'center',
          animationDelay: '0.6s',
          animationFillMode: 'both'
        }}>
          {[
            { icon: '🔒', text: 'Biometric Security' },
            { icon: '⚡', text: 'Gasless Transactions' },
            { icon: '🌐', text: 'Multi-device Support' }
          ].map(({ icon, text }, i) => (
            <div 
              key={text}
              className="badge"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                padding: '6px 12px',
                gap: 6,
                textTransform: 'none',
                letterSpacing: 0,
              }}
            >
              <span style={{ fontSize: 12 }}>{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}