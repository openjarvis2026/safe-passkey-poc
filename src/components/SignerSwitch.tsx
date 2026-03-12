import { useState, useEffect } from 'react';
import { type SavedSafe, saveSafe } from '../lib/storage';
import { encodeSwapOwner, getOwners, execTransaction, getNonce } from '../lib/safe';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { base64ToArrayBuffer } from '../lib/storage';
import {
  connectLedger,
  disconnectLedger,
  signTransactionHash,
  isLedgerSupported,
  getLedgerErrorMessage,
  type LedgerDevice,
  type LedgerConnectionState,
} from '../lib/ledger';

interface Props {
  safe: SavedSafe;
  onBack: () => void;
}

type Step = 'select' | 'connect' | 'connected' | 'confirm' | 'executing' | 'success';

const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
  const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
  return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
};

export default function SignerSwitch({ safe, onBack }: Props) {
  const [step, setStep] = useState<Step>('select');
  const [ledgerState, setLedgerState] = useState<LedgerConnectionState>({ status: 'idle' });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const localOwner = safe.owners.find(o => o.credentialId);
  const localCredentialId = localOwner?.credentialId ? base64ToArrayBuffer(localOwner.credentialId) : null;

  // Check Ledger support on component mount
  useEffect(() => {
    if (!isLedgerSupported()) {
      setError('Ledger connection requires Chrome, Edge, or Opera browser with WebHID support');
    }
  }, []);

  const handleConnectLedger = async () => {
    setError('');
    setStatus('Connecting to Ledger...');
    setLedgerState({ status: 'connecting' });
    setStep('connect');

    try {
      const device = await connectLedger();
      setLedgerState({ status: 'connected', device });
      setStatus(`Connected: ${device.deviceInfo}`);
      setStep('connected');
    } catch (err: any) {
      const errorMessage = getLedgerErrorMessage(err);
      setError(errorMessage);
      setLedgerState({ status: 'error', error: errorMessage });
      setStatus('');
      setStep('select');
    }
  };

  const handleSwitchToLedger = async () => {
    if (!ledgerState.device || !localOwner || !localCredentialId) return;

    setError('');
    setStatus('Preparing transaction...');
    setStep('confirm');

    try {
      // Get current owners to find the previous owner in the linked list
      const currentOwners = await getOwners(safe.address);
      const localOwnerIndex = currentOwners.findIndex(
        addr => addr.toLowerCase() === localOwner.address.toLowerCase()
      );

      if (localOwnerIndex === -1) {
        throw new Error('Your device is no longer an owner of this Safe');
      }

      // Find the previous owner in the linked list
      // Safe owners are stored as a linked list, need to find the correct prevOwner
      let prevOwner: `0x${string}` = '0x0000000000000000000000000000000000000001'; // SENTINEL_OWNERS

      if (localOwnerIndex > 0) {
        prevOwner = currentOwners[localOwnerIndex - 1];
      }

      // Create swap owner transaction data
      const swapOwnerData = encodeSwapOwner(
        prevOwner,
        localOwner.address,
        ledgerState.device.address
      );

      // Get nonce and compute transaction hash
      const nonce = await getNonce(safe.address);
      const safeTxHash = computeSafeTxHash(safe.address, safe.address, 0n, swapOwnerData, nonce);
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);
      }

      setStatus('Sign with your current passkey...');

      // Sign with current passkey
      const passkeySig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(passkeySig.clientDataJSON, passkeySig.challengeOffset);

      setStatus('Confirm on Ledger device...');

      // Sign with Ledger device  
      const ledgerSig = await signTransactionHash(ledgerState.device, hashBytes);

      setStatus('Executing transaction...');
      setStep('executing');

      // For single-owner safes, execute immediately
      if (safe.threshold <= 1) {
        const packed = packSafeSignature(
          localOwner.address,
          passkeySig.authenticatorData,
          passkeySig.clientDataJSON,
          passkeySig.challengeOffset,
          passkeySig.r,
          passkeySig.s
        );

        await execTransaction(safe.address, safe.address, 0n, swapOwnerData, packed);

        // Update saved Safe with new owner info
        const newOwners = safe.owners.map(owner =>
          owner.address.toLowerCase() === localOwner.address.toLowerCase()
            ? { 
                address: ledgerState.device!.address, 
                label: 'Ledger Device',
                // For Ledger devices, we don't have the public key in the same format
                // Using placeholder values since this is just for storage purposes
                publicKey: { x: '0x', y: '0x' }
                // Note: No credentialId field for Ledger owners
              }
            : owner
        );

        const updatedSafe = { ...safe, owners: newOwners };
        saveSafe(updatedSafe);

        setStatus('Successfully switched to Ledger! 🎉');
        setStep('success');
      } else {
        // For multi-sig safes, would need to create shareable transaction
        // This is a simplified implementation for single-owner safes
        throw new Error('Multi-signature Safe owner swap requires additional co-signer approval. This feature is coming soon.');
      }

    } catch (err: any) {
      const errorMessage = getLedgerErrorMessage(err);
      setError(errorMessage);
      setStatus('');
      setStep('connected');
    }
  };

  const handleDisconnect = async () => {
    if (ledgerState.device) {
      await disconnectLedger(ledgerState.device);
    }
    setLedgerState({ status: 'idle' });
    setStep('select');
    setStatus('');
    setError('');
  };

  const handleBack = () => {
    if (step === 'connected' || step === 'confirm') {
      handleDisconnect();
    } else {
      onBack();
    }
  };

  if (step === 'select') {
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
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Switch Signer</h2>
        </div>

        {/* Current Signer */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 24 }}>🔑</div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Current: Passkey</h3>
              <p className="text-muted text-sm">Using Face ID / Touch ID</p>
            </div>
            <span className="badge badge-success">Active</span>
          </div>
        </div>

        {/* Ledger Option */}
        <div className="card" style={{ border: '2px solid var(--primary-from)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 24 }}>💎</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--primary-from)' }}>
                Switch to Ledger
              </h3>
              <p className="text-muted text-sm">Hardware wallet for maximum security</p>
            </div>
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Benefits:</h4>
            <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 20 }}>
              <li>Private keys never leave the device</li>
              <li>Physical confirmation for transactions</li>
              <li>Protection against malware</li>
              <li>Industry standard for institutional security</li>
            </ul>
          </div>

          {error && (
            <div className="card" style={{ background: '#FEF2F2', border: '1px solid var(--danger)', marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: '#DC2626' }}>⚠️ {error}</p>
            </div>
          )}

          <button 
            className="btn btn-primary btn-sm" 
            onClick={handleConnectLedger}
            disabled={!isLedgerSupported() || !!error}
          >
            Connect Ledger
          </button>
        </div>

        {/* Requirements */}
        <div className="card" style={{ background: '#F0F9FF', border: '1px solid #0EA5E9' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 16 }}>📋</span>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#0369A1' }}>
                Requirements
              </h3>
              <ul style={{ fontSize: 13, color: '#0369A1', lineHeight: 1.4, paddingLeft: 16 }}>
                <li>Ledger device connected via USB</li>
                <li>Device unlocked with PIN</li>
                <li>Ethereum app opened</li>
                <li>Chrome, Edge, or Opera browser</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Warning */}
        <div className="card" style={{ background: '#FEF3C7', border: '1px solid #F59E0B' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#92400E' }}>
                Important
              </h3>
              <p style={{ fontSize: 13, color: '#92400E', lineHeight: 1.4 }}>
                Switching signers will replace your current Passkey with a Ledger device. 
                Make sure you have access to your Ledger and remember your PIN before proceeding.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'connect') {
    return (
      <div className="fade-in stack-lg">
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="spinner spinner-dark" style={{ width: 40, height: 40, marginBottom: 16 }} />
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Connecting to Ledger</h3>
          <p className="text-muted">{status}</p>
          {error && (
            <div className="card fade-in" style={{ background: '#FEF2F2', border: '1px solid var(--danger)', marginTop: 16 }}>
              <p style={{ fontSize: 14, color: '#DC2626' }}>⚠️ {error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step === 'connected') {
    return (
      <div className="fade-in stack-lg">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="btn btn-icon" 
            style={{ width: 44, height: 44, fontSize: 20 }} 
            onClick={handleBack}
          >
            ←
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Ledger Connected</h2>
        </div>

        {/* Connection Success */}
        <div className="card" style={{ background: 'var(--success-light)', border: '1px solid var(--success)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 24 }}>✅</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#065F46' }}>
                {ledgerState.device?.deviceInfo || 'Ledger Device'}
              </h3>
              <p style={{ fontSize: 13, color: '#065F46' }}>{status}</p>
            </div>
          </div>
        </div>

        {/* Ledger Address */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Ledger Address</h3>
          <div className="addr-chip" style={{ marginBottom: 12 }}>
            {ledgerState.device?.address}
          </div>
          <p className="text-muted text-sm">
            Derived from path: m/44'/60'/0'/0/0
          </p>
        </div>

        {/* Transaction Preview */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Signer Swap Preview</h3>
          
          <div className="stack">
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
              <p className="text-muted text-sm" style={{ marginBottom: 4 }}>Replace:</p>
              <p style={{ fontSize: 14, fontWeight: 500 }}>🔑 Passkey Signer</p>
              <p className="text-xs" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                {localOwner?.address}
              </p>
            </div>
            
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>↓</div>
            
            <div style={{ padding: 12, background: 'var(--success-light)', borderRadius: 8 }}>
              <p className="text-muted text-sm" style={{ marginBottom: 4 }}>With:</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#065F46' }}>💎 Ledger Signer</p>
              <p className="text-xs" style={{ fontFamily: 'monospace', color: '#059669' }}>
                {ledgerState.device?.address}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="card fade-in" style={{ background: '#FEF2F2', border: '1px solid var(--danger)' }}>
            <p style={{ fontSize: 14, color: '#DC2626' }}>⚠️ {error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="row">
          <button 
            className="btn btn-secondary flex-1" 
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
          <button 
            className="btn btn-primary flex-1" 
            onClick={handleSwitchToLedger}
            disabled={!ledgerState.device || !!error}
          >
            Switch to Ledger
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm' || step === 'executing') {
    // Determine current step based on status
    let currentStep = 1;
    if (status.includes('Confirm on Ledger') || status.includes('Ledger device')) currentStep = 2;
    if (status.includes('Executing') || step === 'executing') currentStep = 3;

    const getStepStatus = (stepNum: number) => {
      if (stepNum < currentStep) return 'done';
      if (stepNum === currentStep) return 'active';
      return 'pending';
    };

    const getStepIcon = (stepNum: number) => {
      const stepStatus = getStepStatus(stepNum);
      if (stepStatus === 'done') return '✅';
      if (stepStatus === 'active') return '🔄';
      return '⏳';
    };

    const getStepStyle = (stepNum: number) => {
      const stepStatus = getStepStatus(stepNum);
      if (stepStatus === 'done') return { background: '#D1FAE5', border: '1px solid #10B981' };
      if (stepStatus === 'active') return { background: '#EFF6FF', border: '1px solid #3B82F6' };
      return { background: '#F9FAFB', border: '1px solid #D1D5DB' };
    };

    const getStepTextColor = (stepNum: number) => {
      const stepStatus = getStepStatus(stepNum);
      if (stepStatus === 'done') return { color: '#065F46' };
      if (stepStatus === 'active') return { color: '#1E40AF' };
      return { color: '#6B7280' };
    };

    return (
      <div className="fade-in stack-lg">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Switching to Ledger</h2>
        </div>

        {/* Step-by-step progress */}
        <div className="stack">
          {/* Step 1: Passkey */}
          <div className="card" style={getStepStyle(1)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 24 }}>{getStepIcon(1)}</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, ...getStepTextColor(1) }}>
                  Step 1: Sign with Passkey
                </h3>
                <p style={{ fontSize: 14, ...getStepTextColor(1), marginBottom: 0 }}>
                  {getStepStatus(1) === 'done' ? 'Signed successfully' :
                   getStepStatus(1) === 'active' ? 'Use Face ID / Touch ID to sign' :
                   'Waiting...'}
                </p>
              </div>
              {getStepStatus(1) === 'active' && (
                <div className="spinner" style={{ width: 20, height: 20 }} />
              )}
            </div>
          </div>

          {/* Step 2: Ledger */}
          <div className="card" style={getStepStyle(2)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 24 }}>{getStepIcon(2)}</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, ...getStepTextColor(2) }}>
                  Step 2: Confirm on Ledger
                </h3>
                <p style={{ fontSize: 14, ...getStepTextColor(2), marginBottom: 0 }}>
                  {getStepStatus(2) === 'done' ? 'Confirmed on device' :
                   getStepStatus(2) === 'active' ? 'Check your Ledger device' :
                   'Waiting...'}
                </p>
              </div>
              {getStepStatus(2) === 'active' && (
                <div className="spinner" style={{ width: 20, height: 20 }} />
              )}
            </div>
          </div>

          {/* Step 3: Execute */}
          <div className="card" style={getStepStyle(3)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 24 }}>{getStepIcon(3)}</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, ...getStepTextColor(3) }}>
                  Step 3: Execute Transaction
                </h3>
                <p style={{ fontSize: 14, ...getStepTextColor(3), marginBottom: 0 }}>
                  {getStepStatus(3) === 'done' ? 'Transaction completed' :
                   getStepStatus(3) === 'active' ? 'Sending to blockchain...' :
                   'Waiting...'}
                </p>
              </div>
              {getStepStatus(3) === 'active' && (
                <div className="spinner" style={{ width: 20, height: 20 }} />
              )}
            </div>
          </div>
        </div>

        {/* Current status */}
        <div className="card" style={{ background: '#F0F9FF', border: '1px solid #0EA5E9' }}>
          <p style={{ fontSize: 14, color: '#0369A1', marginBottom: 0 }}>
            💡 {status}
          </p>
        </div>

        {error && (
          <div className="card fade-in" style={{ background: '#FEF2F2', border: '1px solid var(--danger)' }}>
            <p style={{ fontSize: 14, color: '#DC2626' }}>⚠️ {error}</p>
          </div>
        )}
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="fade-in stack-lg">
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Switch Complete!</h3>
          <p className="text-muted" style={{ marginBottom: 24 }}>
            Your Safe now uses Ledger for signing transactions
          </p>
          
          <div className="card" style={{ background: 'var(--success-light)', border: '1px solid var(--success)', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 24 }}>💎</div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <h4 style={{ fontSize: 16, fontWeight: 600, color: '#065F46', marginBottom: 4 }}>
                  New Signer: Ledger Device
                </h4>
                <p style={{ fontSize: 13, color: '#065F46', fontFamily: 'monospace' }}>
                  {ledgerState.device?.address}
                </p>
              </div>
            </div>
          </div>

          <button 
            className="btn btn-primary" 
            onClick={onBack}
          >
            Back to Settings
          </button>
        </div>
      </div>
    );
  }

  return null;
}