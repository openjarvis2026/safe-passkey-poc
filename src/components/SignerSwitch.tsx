import { useState } from 'react';
import { type SavedSafe } from '../lib/storage';
import { encodeSwapOwner, getOwners } from '../lib/safe';

interface Props {
  safe: SavedSafe;
  onBack: () => void;
}

export default function SignerSwitch({ safe, onBack }: Props) {
  const [step, setStep] = useState<'select' | 'generate' | 'preview'>('select');
  const [encodedData, setEncodedData] = useState('');

  const localOwner = safe.owners.find(o => o.credentialId);

  const handleGenerateLedgerSwap = async () => {
    if (!localOwner) return;
    
    setStep('generate');
    
    try {
      // Get current owners to find the previous owner
      const currentOwners = await getOwners(safe.address);
      const localOwnerIndex = currentOwners.findIndex(
        addr => addr.toLowerCase() === localOwner.address.toLowerCase()
      );
      
      if (localOwnerIndex === -1) {
        throw new Error('Local owner not found in current owners');
      }
      
      // Find the previous owner in the linked list
      // For simplicity, we'll use the first owner as prevOwner if we're swapping the second owner
      // In a real implementation, you'd need to properly traverse the linked list
      const prevOwner = localOwnerIndex === 0 
        ? '0x0000000000000000000000000000000000000001' // SENTINEL_OWNERS
        : currentOwners[localOwnerIndex - 1];
      
      // For demo purposes, generate a mock Ledger address
      const mockLedgerAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
      
      const swapOwnerData = encodeSwapOwner(
        prevOwner,
        localOwner.address,
        mockLedgerAddress
      );
      
      setEncodedData(swapOwnerData);
      setStep('preview');
    } catch (error) {
      console.error('Failed to generate swap transaction:', error);
      alert('Failed to generate transaction. Please try again.');
      setStep('select');
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

          <button 
            className="btn btn-primary btn-sm" 
            onClick={handleGenerateLedgerSwap}
          >
            Generate Swap Transaction
          </button>
        </div>

        {/* Warning */}
        <div className="card" style={{ background: '#FEF3C7', border: '1px solid #F59E0B' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--warning-dark)' }}>
                Important
              </h3>
              <p style={{ fontSize: 13, color: 'var(--warning-dark)', lineHeight: 1.4 }}>
                Switching signers will replace your current Passkey with a Ledger device. 
                Make sure you have access to your Ledger and remember your PIN before proceeding.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'generate') {
    return (
      <div className="fade-in stack-lg">
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="spinner spinner-dark" style={{ width: 40, height: 40, marginBottom: 16 }} />
          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Generating Transaction</h3>
          <p className="text-muted">Creating Safe transaction to swap signers...</p>
        </div>
      </div>
    );
  }

  if (step === 'preview') {
    return (
      <div className="fade-in stack-lg">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="btn btn-icon" 
            style={{ width: 44, height: 44, fontSize: 20 }} 
            onClick={() => setStep('select')}
          >
            ←
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Transaction Preview</h2>
        </div>

        {/* Transaction Details */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Signer Swap Transaction</h3>
          
          <div className="stack">
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius-md)' }}>
              <p className="text-muted text-sm" style={{ marginBottom: 4 }}>From:</p>
              <p style={{ fontSize: 14, fontWeight: 500 }}>🔑 Passkey Signer</p>
              <p className="text-xs" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                {localOwner?.address}
              </p>
            </div>
            
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>↓</div>
            
            <div style={{ padding: 12, background: 'var(--success-light)', borderRadius: 'var(--radius-md)' }}>
              <p className="text-muted text-sm" style={{ marginBottom: 4 }}>To:</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--success-dark)' }}>💎 Ledger Signer</p>
              <p className="text-xs" style={{ fontFamily: 'monospace', color: 'var(--success)' }}>
                0x1234...7890 (placeholder)
              </p>
            </div>
          </div>
        </div>

        {/* Encoded Transaction */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Encoded Transaction Data</h3>
          <div className="addr-chip" style={{ marginBottom: 12, maxHeight: 80, overflow: 'auto' }}>
            {encodedData}
          </div>
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => navigator.clipboard.writeText(encodedData)}
          >
            📋 Copy Transaction Data
          </button>
        </div>

        {/* Coming Soon */}
        <div className="card" style={{ textAlign: 'center', background: 'var(--bg)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚧</div>
          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Ledger Connection Coming Soon</h3>
          <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
            The transaction has been encoded and is ready to execute. 
            Ledger device connection and signing will be available in the next release.
          </p>
          <p className="text-sm" style={{ color: 'var(--primary-from)', fontWeight: 500 }}>
            For now, you can copy the transaction data and execute it manually through other tools.
          </p>
        </div>

        {/* Actions */}
        <div className="row">
          <button 
            className="btn btn-secondary flex-1" 
            onClick={() => setStep('select')}
          >
            Back
          </button>
          <button 
            className="btn btn-ghost flex-1"
            onClick={onBack}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return null;
}