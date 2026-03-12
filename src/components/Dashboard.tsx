import { useState, useEffect, useRef } from 'react';
import { formatEther, parseEther } from 'viem';
import QRCode from 'qrcode';
import { publicClient, EXPLORER } from '../lib/relayer';
import { getNonce, execTransaction, getOwners, getThreshold, encodeAddOwnerWithThreshold } from '../lib/safe';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { type SavedSafe, saveSafe, clearSafe, base64ToArrayBuffer } from '../lib/storage';
import {
  type ShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
  packFromShareable,
} from '../lib/multisig';

interface DashboardProps {
  safe: SavedSafe;
  onDisconnect: () => void;
}

function AddrLink({ addr }: { addr: string }) {
  return <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">{addr.slice(0, 10)}…{addr.slice(-4)}</a>;
}

function TxLink({ hash }: { hash: string }) {
  return <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">🔗 {hash.slice(0, 10)}…</a>;
}

export default function Dashboard({ safe, onDisconnect }: DashboardProps) {
  const [balance, setBalance] = useState<bigint>(0n);
  const [owners, setOwners] = useState<`0x${string}`[]>([]);
  const [threshold, setThreshold] = useState<number>(safe.threshold);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [newOwnerAddr, setNewOwnerAddr] = useState('');
  const [newThreshold, setNewThreshold] = useState(2);
  const [status, setStatus] = useState('');
  const [txResult, setTxResult] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const inviteQrCanvasRef = useRef<HTMLCanvasElement>(null);

  // Get local signer info
  const localOwner = safe.owners.find((o) => o.credentialId);
  const localCredentialId = localOwner?.credentialId
    ? base64ToArrayBuffer(localOwner.credentialId)
    : null;

  // Poll balance + owners
  useEffect(() => {
    const refresh = async () => {
      try {
        const b = await publicClient.getBalance({ address: safe.address });
        setBalance(b);
        const o = await getOwners(safe.address);
        setOwners(o);
        const t = await getThreshold(safe.address);
        setThreshold(Number(t));
      } catch (e) {
        console.error('Failed to refresh Safe info', e);
      }
    };
    refresh();
    const poll = setInterval(refresh, 6000);
    return () => clearInterval(poll);
  }, [safe.address]);

  // Generate invite URL
  useEffect(() => {
    const url = `${window.location.origin}${window.location.pathname}#/join?safe=${safe.address}`;
    setInviteUrl(url);
  }, [safe.address]);

  // Render invite QR
  useEffect(() => {
    if (inviteQrCanvasRef.current && inviteUrl) {
      QRCode.toCanvas(inviteQrCanvasRef.current, inviteUrl, { width: 200 }).catch(console.error);
    }
  }, [inviteUrl]);

  // Render share QR
  useEffect(() => {
    if (qrCanvasRef.current && shareUrl) {
      QRCode.toCanvas(qrCanvasRef.current, shareUrl, { width: 200 }).catch(console.error);
    }
  }, [shareUrl]);

  const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
    const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
    return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
  };

  const handleSendTransaction = async () => {
    if (!localCredentialId || !localOwner || !sendTo || !sendAmount) return;
    setStatus('Signing…');
    setTxResult('');
    setShareUrl('');

    try {
      const to = sendTo as `0x${string}`;
      const value = parseEther(sendAmount);
      const data = '0x' as `0x${string}`;
      const nonce = await getNonce(safe.address);

      const safeTxHash = computeSafeTxHash(safe.address, to, value, data, nonce);
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);
      }

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);

      if (threshold <= 1) {
        // Execute immediately (single signer)
        setStatus('Executing…');
        const packed = packSafeSignature(
          localOwner.address,
          sig.authenticatorData,
          sig.clientDataJSON,
          sig.challengeOffset,
          sig.r,
          sig.s
        );
        const txHash = await execTransaction(safe.address, to, value, data, packed);
        setTxResult(txHash);
        setStatus('Done ✅');
      } else {
        // Multi-sig: create shareable blob
        const sigData = packSingleSignerData(
          sig.authenticatorData,
          clientDataFields,
          sig.r,
          sig.s
        );

        const shareable: ShareableTransaction = {
          safe: safe.address,
          to,
          value: value.toString(),
          data,
          nonce: nonce.toString(),
          chainId: safe.chainId,
          signatures: [{
            signer: localOwner.address,
            data: sigData,
          }],
          threshold,
        };

        const encoded = encodeShareableTransaction(shareable);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setShareUrl(url);
        setStatus(`Signed (${1}/${threshold}). Share the link for co-signing.`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleAddOwner = async () => {
    if (!localCredentialId || !localOwner || !newOwnerAddr) return;
    setStatus('Adding owner…');
    setTxResult('');
    setShareUrl('');

    try {
      const ownerAddr = newOwnerAddr as `0x${string}`;
      const addOwnerData = encodeAddOwnerWithThreshold(ownerAddr, BigInt(newThreshold));
      const nonce = await getNonce(safe.address);

      const safeTxHash = computeSafeTxHash(safe.address, safe.address, 0n, addOwnerData, nonce);
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);
      }

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);

      if (threshold <= 1) {
        // Execute immediately
        setStatus('Executing addOwnerWithThreshold…');
        const packed = packSafeSignature(
          localOwner.address,
          sig.authenticatorData,
          sig.clientDataJSON,
          sig.challengeOffset,
          sig.r,
          sig.s
        );
        const txHash = await execTransaction(safe.address, safe.address, 0n, addOwnerData, packed);
        setTxResult(txHash);

        // Re-fetch owners and update localStorage
        const newOwners = await getOwners(safe.address);
        const newThresholdVal = await getThreshold(safe.address);

        const updatedSafe: SavedSafe = {
          ...safe,
          threshold: Number(newThresholdVal),
          owners: safe.owners.concat(
            newOwners
              .filter((o) => !safe.owners.some((so) => so.address.toLowerCase() === o.toLowerCase()))
              .map((o) => ({
                address: o,
                publicKey: { x: '', y: '' },
                label: `Co-signer ${o.slice(0, 8)}`,
              }))
          ),
        };
        saveSafe(updatedSafe);
        setThreshold(Number(newThresholdVal));
        setStatus('Owner added ✅');
        setNewOwnerAddr('');
      } else {
        // Multi-sig needed
        const sigData = packSingleSignerData(
          sig.authenticatorData,
          clientDataFields,
          sig.r,
          sig.s
        );

        const shareable: ShareableTransaction = {
          safe: safe.address,
          to: safe.address,
          value: '0',
          data: addOwnerData,
          nonce: nonce.toString(),
          chainId: safe.chainId,
          signatures: [{
            signer: localOwner.address,
            data: sigData,
          }],
          threshold,
        };

        const encoded = encodeShareableTransaction(shareable);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setShareUrl(url);
        setStatus(`Signed (1/${threshold}). Share the link for co-signing.`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleDisconnect = () => {
    clearSafe();
    onDisconnect();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>🔐 Safe Dashboard</h2>
        <div>
          <button onClick={handleDisconnect} style={{ marginLeft: 8 }}>Disconnect</button>
        </div>
      </div>

      {/* Safe Info */}
      <div style={cardStyle}>
        <div><strong>Safe:</strong> <AddrLink addr={safe.address} /></div>
        <div><strong>Chain:</strong> Base Sepolia</div>
        <div><strong>Balance:</strong> {formatEther(balance)} ETH</div>
        <div><strong>Threshold:</strong> {threshold} of {owners.length || safe.owners.length}</div>
      </div>

      {/* Owners */}
      <div style={cardStyle}>
        <h3>👥 Owners</h3>
        {(owners.length > 0 ? owners : safe.owners.map((o) => o.address)).map((addr) => {
          const isLocal = localOwner && localOwner.address.toLowerCase() === addr.toLowerCase();
          return (
            <div key={addr} style={{ padding: '4px 0' }}>
              {isLocal ? '✅' : '👤'} <AddrLink addr={addr} />
              {isLocal && <span style={{ color: '#666', marginLeft: 8 }}>(this device)</span>}
            </div>
          );
        })}
      </div>

      {/* Invite Co-Signer */}
      <div style={cardStyle}>
        <h3>🔗 Invite Co-Signer</h3>
        <p style={{ fontSize: 13, color: '#666' }}>Share this link so another device can create their Passkey signer:</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={inviteUrl} readOnly style={{ flex: 1, fontSize: 12 }} />
          <button onClick={() => copyToClipboard(inviteUrl)}>Copy</button>
        </div>
        <canvas ref={inviteQrCanvasRef} style={{ marginTop: 12 }} />
      </div>

      {/* Add Owner */}
      <div style={cardStyle}>
        <h3>➕ Add Co-Signer</h3>
        <p style={{ fontSize: 13, color: '#666' }}>Paste the signer address from the co-signer's device:</p>
        <input
          placeholder="0x… signer address"
          value={newOwnerAddr}
          onChange={(e) => setNewOwnerAddr(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <div style={{ marginBottom: 8 }}>
          <label>New threshold: </label>
          <select value={newThreshold} onChange={(e) => setNewThreshold(Number(e.target.value))}>
            {Array.from({ length: (owners.length || safe.owners.length) + 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <button onClick={handleAddOwner} disabled={!newOwnerAddr}>
          Add Owner & Set Threshold
        </button>
      </div>

      {/* Send Transaction */}
      <div style={cardStyle}>
        <h3>📤 Send Transaction</h3>
        <input
          placeholder="Recipient 0x…"
          value={sendTo}
          onChange={(e) => setSendTo(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <input
          placeholder="Amount (ETH)"
          value={sendAmount}
          onChange={(e) => setSendAmount(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <button onClick={handleSendTransaction} disabled={!sendTo || !sendAmount}>
          Create & Sign
        </button>
      </div>

      {/* Status */}
      {status && (
        <div style={cardStyle}>
          <div>{status}</div>
          {txResult && <div style={{ marginTop: 8 }}><TxLink hash={txResult} /></div>}
        </div>
      )}

      {/* Share URL for multisig */}
      {shareUrl && (
        <div style={cardStyle}>
          <h3>📋 Share for Co-Signing</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input value={shareUrl} readOnly style={{ flex: 1, fontSize: 11 }} />
            <button onClick={() => copyToClipboard(shareUrl)}>Copy</button>
          </div>
          <canvas ref={qrCanvasRef} />
          {typeof navigator.share === 'function' && (
            <button onClick={() => navigator.share({ url: shareUrl })} style={{ marginTop: 8 }}>
              📤 Share
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};
