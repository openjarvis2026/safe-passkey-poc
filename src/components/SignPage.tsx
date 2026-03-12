import { useState, useEffect, useRef } from 'react';
import { formatEther } from 'viem';
import QRCode from 'qrcode';
import { EXPLORER } from '../lib/relayer';
import { execTransaction, getNonce } from '../lib/safe';
import { computeSafeTxHash } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { loadSafe, base64ToArrayBuffer } from '../lib/storage';
import {
  type ShareableTransaction,
  decodeShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
  packFromShareable,
} from '../lib/multisig';

interface SignPageProps {
  encodedData: string;
}

function TxLink({ hash }: { hash: string }) {
  return <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">🔗 {hash.slice(0, 10)}…</a>;
}

function AddrLink({ addr }: { addr: string }) {
  return <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">{addr.slice(0, 10)}…{addr.slice(-4)}</a>;
}

export default function SignPage({ encodedData }: SignPageProps) {
  const [tx, setTx] = useState<ShareableTransaction | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [txResult, setTxResult] = useState('');
  const [updatedShareUrl, setUpdatedShareUrl] = useState('');
  const qrRef = useRef<HTMLCanvasElement>(null);

  // Check if local device is an owner
  const savedSafe = loadSafe();
  const localOwner = savedSafe?.owners.find((o) => o.credentialId);
  const localCredentialId = localOwner?.credentialId
    ? base64ToArrayBuffer(localOwner.credentialId)
    : null;

  useEffect(() => {
    try {
      const decoded = decodeShareableTransaction(encodedData);
      setTx(decoded);
    } catch (e: any) {
      setError(`Failed to decode transaction: ${e.message}`);
    }
  }, [encodedData]);

  useEffect(() => {
    if (qrRef.current && updatedShareUrl) {
      QRCode.toCanvas(qrRef.current, updatedShareUrl, { width: 200 }).catch(console.error);
    }
  }, [updatedShareUrl]);

  if (error) return <div style={{ padding: 20, color: 'red' }}>{error}</div>;
  if (!tx) return <div style={{ padding: 20 }}>Loading…</div>;

  const sigCount = tx.signatures.length;
  const thresholdMet = sigCount >= tx.threshold;
  const alreadySigned = localOwner && tx.signatures.some(
    (s) => s.signer.toLowerCase() === localOwner.address.toLowerCase()
  );
  const isOwner = localOwner && savedSafe?.address.toLowerCase() === tx.safe.toLowerCase();

  const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
    const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
    return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
  };

  const handleSign = async () => {
    if (!localCredentialId || !localOwner || !tx) return;
    setStatus('Signing…');

    try {
      const safeTxHash = computeSafeTxHash(
        tx.safe as `0x${string}`,
        tx.to as `0x${string}`,
        BigInt(tx.value),
        tx.data as `0x${string}`,
        BigInt(tx.nonce)
      );
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);
      }

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);

      const sigData = packSingleSignerData(
        sig.authenticatorData,
        clientDataFields,
        sig.r,
        sig.s
      );

      const updatedTx: ShareableTransaction = {
        ...tx,
        signatures: [
          ...tx.signatures,
          { signer: localOwner.address, data: sigData },
        ],
      };
      setTx(updatedTx);

      if (updatedTx.signatures.length >= updatedTx.threshold) {
        setStatus(`All ${updatedTx.threshold} signatures collected! Ready to execute.`);
      } else {
        const encoded = encodeShareableTransaction(updatedTx);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setUpdatedShareUrl(url);
        setStatus(`Signed (${updatedTx.signatures.length}/${updatedTx.threshold}). Share the updated link.`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleExecute = async () => {
    if (!tx || tx.signatures.length < tx.threshold) return;
    setStatus('Executing…');

    try {
      const packed = packFromShareable(tx.signatures);
      const txHash = await execTransaction(
        tx.safe as `0x${string}`,
        tx.to as `0x${string}`,
        BigInt(tx.value),
        tx.data as `0x${string}`,
        packed
      );
      setTxResult(txHash);
      setStatus('Transaction executed ✅');
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div>
      <h2>✍️ Sign Transaction</h2>

      <div style={cardStyle}>
        <h3>Transaction Details</h3>
        <div><strong>Safe:</strong> <AddrLink addr={tx.safe} /></div>
        <div><strong>To:</strong> <AddrLink addr={tx.to} /></div>
        <div><strong>Value:</strong> {formatEther(BigInt(tx.value))} ETH</div>
        {tx.data !== '0x' && <div><strong>Data:</strong> {tx.data.slice(0, 20)}…</div>}
        <div><strong>Nonce:</strong> {tx.nonce}</div>
        <div style={{ marginTop: 8 }}>
          <strong>Signatures:</strong> {sigCount} / {tx.threshold}
          {tx.signatures.map((s) => (
            <div key={s.signer} style={{ fontSize: 12, padding: '2px 0' }}>
              ✅ <AddrLink addr={s.signer} />
            </div>
          ))}
        </div>
      </div>

      {/* Sign button */}
      {isOwner && !alreadySigned && !thresholdMet && (
        <div style={cardStyle}>
          <button onClick={handleSign} style={{ fontSize: 16, padding: '12px 24px' }}>
            🔐 Sign with Passkey
          </button>
        </div>
      )}

      {alreadySigned && !thresholdMet && (
        <div style={cardStyle}>
          <div style={{ color: '#666' }}>✅ You've already signed this transaction.</div>
        </div>
      )}

      {!isOwner && !localOwner && (
        <div style={cardStyle}>
          <div style={{ color: '#999' }}>
            No local signer found for this Safe. Join the Safe first via an invite link.
          </div>
        </div>
      )}

      {/* Execute button */}
      {tx.signatures.length >= tx.threshold && (
        <div style={cardStyle}>
          <button onClick={handleExecute} style={{ fontSize: 16, padding: '12px 24px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: 8 }}>
            🚀 Execute Transaction
          </button>
        </div>
      )}

      {/* Status */}
      {status && (
        <div style={cardStyle}>
          <div>{status}</div>
          {txResult && <div style={{ marginTop: 8 }}><TxLink hash={txResult} /></div>}
        </div>
      )}

      {/* Updated share URL */}
      {updatedShareUrl && (
        <div style={cardStyle}>
          <h3>📋 Share Updated Link</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input value={updatedShareUrl} readOnly style={{ flex: 1, fontSize: 11 }} />
            <button onClick={() => copyToClipboard(updatedShareUrl)}>Copy</button>
          </div>
          <canvas ref={qrRef} />
          {typeof navigator.share === 'function' && (
            <button onClick={() => navigator.share({ url: updatedShareUrl })} style={{ marginTop: 8 }}>
              📤 Share
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={() => { window.location.hash = '#/'; }}>← Back to Dashboard</button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};
