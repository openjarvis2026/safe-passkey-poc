import { useState, useEffect } from 'react';
import { type SavedSafe } from '../lib/storage';
import { getOwners, getThreshold, getNonce, execTransaction, encodeChangeThreshold } from '../lib/safe';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { base64ToArrayBuffer } from '../lib/storage';
import {
  type ShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
} from '../lib/multisig';
import SignerSwitch from './SignerSwitch';

interface Props {
  safe: SavedSafe;
  onBack: () => void;
}

const COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
const avatarColor = (addr: string) => COLORS[parseInt(addr.slice(2, 6), 16) % COLORS.length];
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
  const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
  return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
};

export default function Settings({ safe, onBack }: Props) {
  const [owners, setOwners] = useState<`0x${string}`[]>([]);
  const [threshold, setThreshold] = useState(safe.threshold);
  const [newThreshold, setNewThreshold] = useState(safe.threshold);
  const [showThresholdChange, setShowThresholdChange] = useState(false);
  const [showSignerSwitch, setShowSignerSwitch] = useState(false);
  const [thresholdStatus, setThresholdStatus] = useState('');
  const [shareUrl, setShareUrl] = useState('');

  const localOwner = safe.owners.find(o => o.credentialId);
  const localCredentialId = localOwner?.credentialId ? base64ToArrayBuffer(localOwner.credentialId) : null;

  // Load current owners and threshold
  useEffect(() => {
    const loadData = async () => {
      try {
        const [currentOwners, currentThreshold] = await Promise.all([
          getOwners(safe.address),
          getThreshold(safe.address)
        ]);
        setOwners(currentOwners);
        setThreshold(Number(currentThreshold));
        setNewThreshold(Number(currentThreshold));
      } catch (error) {
        console.error('Failed to load settings data:', error);
      }
    };
    loadData();
  }, [safe.address]);

  const handleThresholdChange = async () => {
    if (!localCredentialId || !localOwner || newThreshold === threshold) return;
    
    setThresholdStatus('Signing…');
    setShareUrl('');
    
    try {
      const changeThresholdData = encodeChangeThreshold(BigInt(newThreshold));
      const nonce = await getNonce(safe.address);
      const safeTxHash = computeSafeTxHash(safe.address, safe.address, 0n, changeThresholdData, nonce);
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);

      if (threshold <= 1) {
        setThresholdStatus('Executing…');
        const packed = packSafeSignature(localOwner.address, sig.authenticatorData, sig.clientDataJSON, sig.challengeOffset, sig.r, sig.s);
        await execTransaction(safe.address, safe.address, 0n, changeThresholdData, packed);
        setThreshold(newThreshold);
        setThresholdStatus('Threshold updated ✅');
        setShowThresholdChange(false);
      } else {
        const sigData = packSingleSignerData(sig.authenticatorData, clientDataFields, sig.r, sig.s);
        const shareable: ShareableTransaction = {
          safe: safe.address, 
          to: safe.address, 
          value: '0', 
          data: changeThresholdData, 
          nonce: nonce.toString(),
          chainId: safe.chainId,
          signatures: [{ signer: localOwner.address, data: sigData }],
          threshold,
        };
        const encoded = encodeShareableTransaction(shareable);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setShareUrl(url);
        setThresholdStatus(`Signed (1/${threshold}). Share with co-signers.`);
      }
    } catch (e: any) {
      setThresholdStatus(`Error: ${e.message}`);
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const getOwnerLabel = (address: string) => {
    const savedOwner = safe.owners.find(o => o.address.toLowerCase() === address.toLowerCase());
    if (savedOwner && savedOwner.credentialId) return 'This Device';
    if (savedOwner && savedOwner.label) return savedOwner.label;
    return `Signer ${address.slice(2, 6)}`;
  };

  if (showSignerSwitch) {
    return (
      <SignerSwitch 
        safe={safe} 
        onBack={() => setShowSignerSwitch(false)} 
      />
    );
  }

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

      {/* Current Owners */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Signers</h3>
          <span className="badge badge-success">{threshold} of {owners.length || safe.owners.length}</span>
        </div>
        <div className="stack">
          {(owners.length > 0 ? owners : safe.owners.map(o => o.address)).map(addr => {
            const isLocal = localOwner && localOwner.address.toLowerCase() === addr.toLowerCase();
            const label = getOwnerLabel(addr);
            return (
              <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="avatar" style={{ background: avatarColor(addr) }}>
                  {addr.slice(2, 4).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500 }}>{label}</p>
                  <p className="text-muted text-xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shortAddr(addr)}
                  </p>
                </div>
                {isLocal && <span className="badge badge-success">You</span>}
              </div>
            );
          })}
        </div>
        
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <button 
            className="btn btn-primary btn-sm flex-1" 
            onClick={() => window.location.hash = `#/invite?safe=${safe.address}`}
          >
            📧 Invite Signer
          </button>
        </div>
      </div>

      {/* Threshold Settings */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Signature Threshold</h3>
            <p className="text-muted text-sm">Signatures required to execute transactions</p>
          </div>
          <span className="badge badge-success">{threshold}</span>
        </div>
        
        {!showThresholdChange ? (
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => setShowThresholdChange(true)}
            disabled={owners.length <= 1}
          >
            Change Threshold
          </button>
        ) : (
          <div className="stack">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label className="text-secondary text-sm">New threshold:</label>
              <select 
                className="select" 
                value={newThreshold} 
                onChange={e => setNewThreshold(Number(e.target.value))}
              >
                {Array.from({ length: owners.length || safe.owners.length }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="row">
              <button 
                className="btn btn-secondary btn-sm flex-1" 
                onClick={() => {
                  setShowThresholdChange(false);
                  setNewThreshold(threshold);
                  setThresholdStatus('');
                  setShareUrl('');
                }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary btn-sm flex-1" 
                onClick={handleThresholdChange}
                disabled={newThreshold === threshold || thresholdStatus === 'Signing…' || thresholdStatus === 'Executing…'}
              >
                {thresholdStatus === 'Signing…' || thresholdStatus === 'Executing…' ? 
                  <><div className="spinner" /> {thresholdStatus}</> : 
                  'Update Threshold'
                }
              </button>
            </div>
            {thresholdStatus && !thresholdStatus.includes('Signing') && !thresholdStatus.includes('Executing') && (
              <div className="card fade-in">
                <p style={{ fontSize: 14 }}>{thresholdStatus}</p>
                {shareUrl && (
                  <div style={{ marginTop: 12 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => copy(shareUrl)}>
                      📋 Copy Share Link
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signer Type */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Signer Type</h3>
            <p className="text-muted text-sm">How you sign transactions</p>
          </div>
          <span className="badge badge-success">
            {localOwner?.credentialId ? 'Passkey' : 'Ledger'}
          </span>
        </div>
        {localOwner?.credentialId && (
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => setShowSignerSwitch(true)}
          >
            Switch to Ledger
          </button>
        )}
      </div>

      {/* Safety Notice */}
      <div className="card" style={{ background: 'var(--success-light)', border: '1px solid var(--success)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#065F46' }}>Safety Note</h3>
            <p style={{ fontSize: 13, color: '#065F46', lineHeight: 1.4 }}>
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