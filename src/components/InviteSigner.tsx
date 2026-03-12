import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { getOwners, getThreshold, encodeAddOwnerWithThreshold, execTransaction, getNonce } from '../lib/safe';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { type SavedSafe, base64ToArrayBuffer } from '../lib/storage';

interface Props {
  safe: SavedSafe;
  onBack: () => void;
}

type Phase = 'generating' | 'ready' | 'waiting' | 'confirming' | 'adding' | 'done' | 'error';

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function InviteSigner({ safe, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('generating');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [owners, setOwners] = useState<`0x${string}`[]>([]);
  const [threshold, setThreshold] = useState(safe.threshold);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [newSignerAddress, setNewSignerAddress] = useState<`0x${string}` | null>(null);

  // Generate invite URL and QR code
  useEffect(() => {
    const generateInvite = async () => {
      try {
        // Fetch current owners and threshold
        const [currentOwners, currentThreshold] = await Promise.all([
          getOwners(safe.address),
          getThreshold(safe.address)
        ]);
        
        setOwners(currentOwners);
        setThreshold(Number(currentThreshold));

        // Generate invite URL (ensure full URL with domain)
        const url = `${window.location.origin}${window.location.pathname}#/join?safe=${safe.address}`;
        setInviteUrl(url);
        
        // Generate QR code using toDataURL (more reliable than canvas)
        try {
          const qrDataUrl = await QRCode.toDataURL(url, { 
            width: 256, 
            margin: 2,
            color: {
              dark: '#0F172A',
              light: '#FFFFFF'
            }
          });
          setQrDataUrl(qrDataUrl);
        } catch (qrError) {
          console.error('QR code generation failed:', qrError);
          setError('Failed to generate QR code');
          setPhase('error');
          return;
        }
        
        setPhase('ready');
      } catch (err: any) {
        console.error('Failed to generate invite:', err);
        setError(err.message || 'Failed to generate invite');
        setPhase('error');
      }
    };

    generateInvite();
  }, [safe.address]);

  // Poll for new signers (detect new addresses without adding them as owners yet)
  useEffect(() => {
    if (phase !== 'waiting') return;

    const checkForNewSigners = async () => {
      try {
        // Check URL hash for new signer notification
        const hash = window.location.hash;
        const match = hash.match(/newSigner=0x[a-fA-F0-9]{40}/);
        if (match) {
          const address = match[0].split('=')[1] as `0x${string}`;
          if (!owners.includes(address) && address !== newSignerAddress) {
            setNewSignerAddress(address);
            setPhase('confirming');
            // Clear the hash
            window.location.hash = window.location.hash.replace(/[?&]newSigner=0x[a-fA-F0-9]{40}/, '');
          }
        }
      } catch (error) {
        console.error('Error checking for new signers:', error);
      }
    };

    const interval = setInterval(checkForNewSigners, 2000); // Check every 2 seconds
    return () => clearInterval(interval);
  }, [phase, owners, newSignerAddress]);

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleShare = () => {
    if (typeof navigator.share === 'function') {
      navigator.share({
        title: 'Join my wallet',
        text: 'You\'ve been invited to join my passkey wallet',
        url: inviteUrl,
      }).catch(() => {});
    }
  };

  const handleWaitForSigner = () => {
    setPhase('waiting');
  };

  const handleApproveSigner = async () => {
    if (!newSignerAddress) return;
    
    setPhase('adding');
    setError('');

    try {
      // Find the current owner for this device (to sign the tx)
      const deviceOwner = safe.owners.find(owner => owner.credentialId);
      if (!deviceOwner) {
        throw new Error('No device signer found to approve transaction');
      }

      // Prepare addOwnerWithThreshold transaction
      const addOwnerData = encodeAddOwnerWithThreshold(newSignerAddress, BigInt(threshold));
      
      // Get current nonce and compute tx hash
      const nonce = await getNonce(safe.address);
      
      const safeTxHash = computeSafeTxHash(
        safe.address,
        safe.address,
        0n,
        addOwnerData,
        nonce
      );

      // Convert hash to bytes for signing
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);
      }

      // Sign the transaction with the device owner's passkey
      const localCredentialId = base64ToArrayBuffer(deviceOwner.credentialId!);
      const sig = await signWithPasskey(localCredentialId, hashBytes);
      
      // Pack signature for Safe
      const packedSig = packSafeSignature(
        deviceOwner.address,
        sig.authenticatorData,
        sig.clientDataJSON,
        sig.challengeOffset,
        sig.r,
        sig.s
      );

      // Execute the transaction
      await execTransaction(safe.address, safe.address, 0n, addOwnerData, packedSig);
      
      setPhase('done');
    } catch (err: any) {
      console.error('Failed to add signer:', err);
      setError(err.message || 'Failed to add signer');
      setPhase('confirming');
    }
  };

  const handleRejectSigner = () => {
    setNewSignerAddress(null);
    setPhase('waiting');
  };

  if (phase === 'generating') {
    return (
      <div className="fade-in stack-lg">
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn btn-icon" onClick={onBack}>
            ←
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginLeft: 8 }}>Invite Signer</h2>
        </div>

        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div className="spinner spinner-dark" />
          <p className="text-secondary text-sm" style={{ marginTop: 16 }}>Generating invite...</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="fade-in stack-lg">
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn btn-icon" onClick={onBack}>
            ←
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginLeft: 8 }}>Invite Signer</h2>
        </div>

        <div className="card warning-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h3 style={{ marginBottom: 8 }}>Error</h3>
          <p className="text-sm">{error}</p>
          <button className="btn btn-secondary" onClick={() => {
            setError('');
            setPhase('generating');
          }} style={{ marginTop: 16 }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn btn-icon" onClick={onBack}>
          ←
        </button>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginLeft: 8 }}>Invite Signer</h2>
      </div>

      {/* Progress Steps */}
      <div className="invite-wizard">
        <div className="wizard-steps">
          <div className={`wizard-step ${phase === 'ready' ? 'active' : phase === 'waiting' ? 'done' : ''}`}>
            <div className="wizard-step-icon">1</div>
            <div className="wizard-step-content">
              <p className="wizard-step-title">Share Invite</p>
              <p className="wizard-step-desc">Send QR code or link</p>
            </div>
          </div>
          <div className={`wizard-step ${phase === 'waiting' ? 'active' : (phase === 'confirming' || phase === 'adding' || phase === 'done') ? 'done' : ''}`}>
            <div className="wizard-step-icon">2</div>
            <div className="wizard-step-content">
              <p className="wizard-step-title">Wait for Join</p>
              <p className="wizard-step-desc">New signer creates passkey</p>
            </div>
          </div>
          <div className={`wizard-step ${phase === 'confirming' ? 'active' : phase === 'adding' ? 'active' : phase === 'done' ? 'done' : ''}`}>
            <div className="wizard-step-icon">3</div>
            <div className="wizard-step-content">
              <p className="wizard-step-title">{phase === 'confirming' ? 'Verify Signer' : 'Add to Wallet'}</p>
              <p className="wizard-step-desc">{phase === 'confirming' ? 'Approve or reject' : 'Execute transaction'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Wallet Info */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="text-secondary text-sm">Wallet</span>
          <span className="text-sm addr-chip" style={{ padding: 4, fontSize: 12 }}>{shortAddr(safe.address)}</span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="text-secondary text-sm">Current threshold</span>
          <span className="text-sm">{threshold} of {owners.length}</span>
        </div>
      </div>

      {/* Ready State - Show QR and Share Options */}
      {phase === 'ready' && (
        <>
          <div className="card invite-card text-center">
            <div className="mb-8">
              <div style={{ fontSize: 32, marginBottom: 8 }}>📱</div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Scan to Join</h3>
              <p className="text-secondary text-sm">
                New signer can scan this code or use the link below
              </p>
            </div>
            
            <div className="qr-container">
              {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className="qr-code" style={{ width: 256, height: 256 }} />}
            </div>

            <div className="invite-url">
              <p className="text-xs text-muted mb-8">Invite URL:</p>
              <div className="invite-url-display">
                {inviteUrl.replace(window.location.origin, '')}
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="row">
              <button className="btn btn-secondary flex-1" onClick={handleCopy}>
                {copied ? '✅ Copied!' : '📋 Copy Link'}
              </button>
              
              {typeof navigator.share === 'function' && (
                <button className="btn btn-secondary flex-1" onClick={handleShare}>
                  📤 Share
                </button>
              )}
            </div>
            
            <button className="btn btn-primary" onClick={handleWaitForSigner}>
              Continue →
            </button>
          </div>
        </>
      )}

      {/* Waiting State */}
      {phase === 'waiting' && (
        <>
          <div className="card text-center">
            <div className="status-icon">
              <div className="waiting-pulse">⏱️</div>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 600 }} className="mb-8">Waiting for new signer...</h3>
            <p className="text-secondary text-sm mb-8">
              When they join, you'll be prompted to add them to the wallet
            </p>
            
            <div className="status-details">
              <div className="status-row">
                <span className="text-secondary text-sm">Invite sent</span>
                <span className="text-success text-sm">✅ Ready</span>
              </div>
              <div className="status-row">
                <span className="text-secondary text-sm">Waiting for join</span>
                <div className="status-waiting">
                  <div className="spinner spinner-dark" style={{ width: 16, height: 16 }} />
                  <span className="text-secondary text-sm">Pending...</span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center">
            <button className="btn btn-ghost" onClick={() => setPhase('ready')}>
              ← Back to share options
            </button>
          </div>
        </>
      )}

      {/* Confirming State */}
      {phase === 'confirming' && newSignerAddress && (
        <>
          <div className="card">
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>New Signer Detected!</h3>
              <p className="text-secondary text-sm">
                A new device has created a passkey and is ready to join your wallet.
              </p>
            </div>

            <div className="card info-card">
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Signer Address</h4>
              <div className="addr-chip" style={{ fontFamily: 'monospace', fontSize: 13, marginBottom: 12 }}>
                {newSignerAddress}
              </div>
              <p className="text-secondary text-xs">
                Verify this address with the person you invited before approving.
              </p>
            </div>

            <div className="card warning-card">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Security Check</h4>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Only approve signers you trust. Once added, they can sign transactions from your wallet.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="row">
              <button className="btn btn-secondary flex-1" onClick={handleRejectSigner}>
                ❌ Reject
              </button>
              <button className="btn btn-primary flex-1" onClick={handleApproveSigner}>
                ✅ Approve
              </button>
            </div>
            <div className="text-center">
              <button className="btn btn-ghost" onClick={() => setPhase('waiting')}>
                ← Back to waiting
              </button>
            </div>
          </div>
        </>
      )}

      {/* Adding State */}
      {phase === 'adding' && (
        <>
          <div className="card text-center">
            <div className="spinner spinner-dark" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Adding signer...</h3>
            <p className="text-secondary text-sm">
              Executing transaction to add the new signer to your wallet.
            </p>
          </div>
        </>
      )}

      {/* Done State */}
      {phase === 'done' && (
        <>
          <div className="card text-center">
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Signer Added!</h3>
            <p className="text-secondary text-sm mb-8">
              The new device has been successfully added to your wallet.
            </p>
            
            <button className="btn btn-primary" onClick={onBack}>
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}