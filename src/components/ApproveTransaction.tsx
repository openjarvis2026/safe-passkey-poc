import { useState, useEffect, useRef } from 'react';
import { formatEther } from 'viem';
import QRCode from 'qrcode';
import { EXPLORER } from '../lib/relayer';
import { execTransaction } from '../lib/safe';
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
import SlideToConfirm from './shared/SlideToConfirm';

interface Props { encodedData: string; }

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
  const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
  return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
};

export default function ApproveTransaction({ encodedData }: Props) {
  const [tx, setTx] = useState<ShareableTransaction | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [txResult, setTxResult] = useState('');
  const [updatedShareUrl, setUpdatedShareUrl] = useState('');
  const qrRef = useRef<HTMLCanvasElement>(null);

  const savedSafe = loadSafe();
  const localOwner = savedSafe?.owners.find(o => o.credentialId);
  const localCredentialId = localOwner?.credentialId ? base64ToArrayBuffer(localOwner.credentialId) : null;

  useEffect(() => {
    try {
      setTx(decodeShareableTransaction(encodedData));
    } catch (e: any) {
      setError(e.message);
    }
  }, [encodedData]);

  useEffect(() => {
    if (qrRef.current && updatedShareUrl) {
      QRCode.toCanvas(qrRef.current, updatedShareUrl, { width: 200, margin: 2 }).catch(() => {});
    }
  }, [updatedShareUrl]);

  if (error) return (
    <div className="fade-in stack-lg" style={{ paddingTop: 60, textAlign: 'center' }}>
      <p style={{ fontSize: 48 }}>⚠️</p>
      <p style={{ color: 'var(--danger)' }}>{error}</p>
      <button className="btn btn-secondary" onClick={() => { window.location.hash = '#/'; }}>Go Home</button>
    </div>
  );
  if (!tx) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner spinner-dark" />
    </div>
  );

  const sigCount = tx.signatures.length;
  const thresholdMet = sigCount >= tx.threshold;
  const alreadySigned = localOwner && tx.signatures.some(s => s.signer.toLowerCase() === localOwner.address.toLowerCase());
  const isOwner = localOwner && savedSafe?.address.toLowerCase() === tx.safe.toLowerCase();

  const handleSign = async () => {
    if (!localCredentialId || !localOwner || !tx) return;
    setStatus('Signing…');
    try {
      const safeTxHash = computeSafeTxHash(
        tx.safe as `0x${string}`, tx.to as `0x${string}`,
        BigInt(tx.value), tx.data as `0x${string}`, BigInt(tx.nonce)
      );
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);
      const sigData = packSingleSignerData(sig.authenticatorData, clientDataFields, sig.r, sig.s);

      const updatedTx: ShareableTransaction = {
        ...tx,
        signatures: [...tx.signatures, { signer: localOwner.address, data: sigData }],
      };
      setTx(updatedTx);

      if (updatedTx.signatures.length >= updatedTx.threshold) {
        setStatus('All signatures collected! Ready to execute.');
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
      const hash = await execTransaction(
        tx.safe as `0x${string}`, tx.to as `0x${string}`,
        BigInt(tx.value), tx.data as `0x${string}`, packed
      );
      setTxResult(hash);
      setStatus('Transaction executed ✅');
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  return (
    <div className="fade-in stack-lg" style={{ paddingTop: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>✍️</div>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Approve Transaction</h1>
      </div>

      {/* Transaction summary */}
      <div className="card">
        <div className="stack">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-secondary text-sm">To</span>
            <a href={`${EXPLORER}/address/${tx.to}`} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontFamily: 'monospace', color: 'var(--primary-from)' }}>
              {shortAddr(tx.to)}
            </a>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-secondary text-sm">Value</span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{formatEther(BigInt(tx.value))} ETH</span>
          </div>
          {tx.data !== '0x' && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-secondary text-sm">Data</span>
              <span className="text-xs text-muted" style={{ fontFamily: 'monospace' }}>{tx.data.slice(0, 20)}…</span>
            </div>
          )}
        </div>
      </div>

      {/* Signatures progress */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Signatures</span>
          <span className="badge badge-success">{sigCount} / {tx.threshold}</span>
        </div>
        {/* Progress bar */}
        <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 12 }}>
          <div style={{ height: '100%', width: `${Math.min(100, (sigCount / tx.threshold) * 100)}%`, background: 'var(--success)', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        {tx.signatures.map(s => (
          <div key={s.signer} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ color: 'var(--success)' }}>✅</span>
            <span className="text-xs" style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{shortAddr(s.signer)}</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      {isOwner && !alreadySigned && !thresholdMet && sigCount + 1 >= tx.threshold && !txResult && (
        <SlideToConfirm
          label="Slide to approve & execute"
          onConfirm={async () => {
            if (!localCredentialId || !localOwner || !tx) return;
            const safeTxHash = computeSafeTxHash(
              tx.safe as `0x${string}`, tx.to as `0x${string}`,
              BigInt(tx.value), tx.data as `0x${string}`, BigInt(tx.nonce)
            );
            const hashBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);

            const sig = await signWithPasskey(localCredentialId, hashBytes);
            const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);
            const sigData = packSingleSignerData(sig.authenticatorData, clientDataFields, sig.r, sig.s);

            const updatedTx: ShareableTransaction = {
              ...tx,
              signatures: [...tx.signatures, { signer: localOwner.address, data: sigData }],
            };
            setTx(updatedTx);

            const packed = packFromShareable(updatedTx.signatures);
            const hash = await execTransaction(
              tx.safe as `0x${string}`, tx.to as `0x${string}`,
              BigInt(tx.value), tx.data as `0x${string}`, packed
            );
            setTxResult(hash);
            setStatus('Transaction executed ✅');
          }}
        />
      )}

      {isOwner && !alreadySigned && !thresholdMet && sigCount + 1 < tx.threshold && (
        <button className="btn btn-primary" onClick={handleSign} disabled={status === 'Signing…'}>
          {status === 'Signing…' ? <><div className="spinner" /> Signing…</> : 'Approve'}
        </button>
      )}

      {alreadySigned && !thresholdMet && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="text-secondary text-sm">✅ You've already signed. Waiting for more approvals…</p>
        </div>
      )}

      {!isOwner && !localOwner && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="text-secondary text-sm">No signer found for this wallet. Join first via an invite link.</p>
        </div>
      )}

      {thresholdMet && !txResult && (
        <button className="btn btn-success" onClick={handleExecute} disabled={status === 'Executing…'}>
          {status === 'Executing…' ? <><div className="spinner" /> Executing…</> : '🚀 Execute Transaction'}
        </button>
      )}

      {txResult && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Transaction executed ✅</p>
          <a href={`${EXPLORER}/tx/${txResult}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-from)', fontSize: 14 }}>
            View on Explorer ↗
          </a>
        </div>
      )}

      {status && !status.includes('Signing') && !status.includes('Executing') && !txResult && (
        <p className="text-secondary text-sm text-center">{status}</p>
      )}

      {updatedShareUrl && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Share updated link</p>
          <canvas ref={qrRef} style={{ marginBottom: 12 }} />
          <div className="row">
            <button className="btn btn-secondary btn-sm flex-1" onClick={() => copy(updatedShareUrl)}>📋 Copy</button>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-primary btn-sm flex-1" onClick={() => navigator.share?.({ url: updatedShareUrl })}>📤 Share</button>
            )}
          </div>
        </div>
      )}

      <button className="btn btn-ghost" onClick={() => { window.location.hash = '#/'; }}>
        ← Back to Dashboard
      </button>
    </div>
  );
}
