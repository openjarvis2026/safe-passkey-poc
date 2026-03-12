import { useState, useEffect } from 'react';
import { createPasskey, type PasskeyCredential } from '../lib/webauthn';
import { deploySignerProxy, getSignerAddress } from '../lib/signer';
import { getOwners, getThreshold } from '../lib/safe';
import { EXPLORER } from '../lib/relayer';
import { saveSafe, arrayBufferToBase64, type SavedSafe, type SavedOwner } from '../lib/storage';

interface JoinPageProps {
  safeAddress: `0x${string}`;
  onJoined: (safe: SavedSafe) => void;
}

function AddrLink({ addr }: { addr: string }) {
  return <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">{addr.slice(0, 10)}…{addr.slice(-4)}</a>;
}

export default function JoinPage({ safeAddress, onJoined }: JoinPageProps) {
  const [owners, setOwners] = useState<`0x${string}`[]>([]);
  const [threshold, setThreshold] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<PasskeyCredential | null>(null);
  const [signerAddress, setSignerAddress] = useState<`0x${string}` | null>(null);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const o = await getOwners(safeAddress);
        const t = await getThreshold(safeAddress);
        setOwners(o);
        setThreshold(Number(t));
        setLoading(false);
      } catch (e: any) {
        setError(`Failed to fetch Safe info: ${e.message}`);
        setLoading(false);
      }
    };
    fetchInfo();
  }, [safeAddress]);

  const handleCreatePasskey = async () => {
    setStatus('Creating Passkey…');
    try {
      const cred = await createPasskey();
      setCredential(cred);
      setStatus('Passkey created ✅');
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleDeploySigner = async () => {
    if (!credential) return;
    setStatus('Deploying signer proxy…');
    try {
      await deploySignerProxy(credential.publicKey.x, credential.publicKey.y);
      const addr = await getSignerAddress(credential.publicKey.x, credential.publicKey.y);
      setSignerAddress(addr);
      setStatus('Signer deployed ✅');

      // Save to localStorage (the joiner's local data for this Safe)
      const existingOwners: SavedOwner[] = owners.map((o) => ({
        address: o,
        publicKey: { x: '', y: '' },
        label: `Owner ${o.slice(0, 8)}`,
      }));
      const localOwner: SavedOwner = {
        address: addr,
        publicKey: {
          x: credential.publicKey.x.toString(16),
          y: credential.publicKey.y.toString(16),
        },
        label: 'This Device',
        credentialId: arrayBufferToBase64(credential.rawId),
      };
      const saved: SavedSafe = {
        address: safeAddress,
        chainId: 84532,
        owners: [...existingOwners, localOwner],
        threshold,
        deployTxHash: '',
      };
      saveSafe(saved);
      onJoined(saved);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const copyAddress = () => {
    if (signerAddress) {
      navigator.clipboard.writeText(signerAddress).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading Safe info…</div>;
  if (error) return <div style={{ padding: 20, color: 'red' }}>{error}</div>;

  return (
    <div>
      <h2>🤝 Join Safe</h2>

      <div style={cardStyle}>
        <div><strong>Safe:</strong> <AddrLink addr={safeAddress} /></div>
        <div><strong>Threshold:</strong> {threshold} of {owners.length}</div>
        <div style={{ marginTop: 8 }}>
          <strong>Current owners:</strong>
          {owners.map((o) => (
            <div key={o} style={{ padding: '2px 0', fontSize: 13 }}>
              👤 <AddrLink addr={o} />
            </div>
          ))}
        </div>
      </div>

      {!credential && (
        <div style={cardStyle}>
          <h3>Step 1: Create Your Passkey</h3>
          <p style={{ fontSize: 13, color: '#666' }}>Create a Passkey to use as your signer for this Safe.</p>
          <button onClick={handleCreatePasskey}>Create Passkey</button>
        </div>
      )}

      {credential && !signerAddress && (
        <div style={cardStyle}>
          <h3>Step 2: Deploy Signer Proxy</h3>
          <p style={{ fontSize: 13, color: '#666' }}>Deploy your signer contract on-chain.</p>
          <button onClick={handleDeploySigner}>Deploy Signer</button>
        </div>
      )}

      {signerAddress && (
        <div style={cardStyle}>
          <h3>✅ Your Signer is Ready</h3>
          <p style={{ fontSize: 13, color: '#666' }}>
            Share this address with the Safe owner so they can add you as a co-signer:
          </p>
          <div style={{
            padding: 12,
            background: '#e8f5e9',
            borderRadius: 8,
            fontSize: 14,
            fontFamily: 'monospace',
            wordBreak: 'break-all',
            marginBottom: 8,
          }}>
            {signerAddress}
          </div>
          <button onClick={copyAddress}>
            {copied ? 'Copied! ✅' : '📋 Copy Address'}
          </button>
          <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
            Once the Safe owner adds you, you'll be able to co-sign transactions from the dashboard.
          </p>
          <button onClick={() => { window.location.hash = '#/'; }} style={{ marginTop: 8 }}>
            Go to Dashboard →
          </button>
        </div>
      )}

      {status && <div style={{ marginTop: 12, color: '#666' }}>{status}</div>}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};
