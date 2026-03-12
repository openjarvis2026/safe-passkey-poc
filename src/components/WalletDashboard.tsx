import { useState, useEffect, useRef } from 'react';
import { formatEther, parseEther, parseAbiItem } from 'viem';
import QRCode from 'qrcode';
import { publicClient, EXPLORER } from '../lib/relayer';
import SlideToConfirm from './shared/SlideToConfirm';
import { getNonce, execTransaction, getOwners, getThreshold, encodeAddOwnerWithThreshold } from '../lib/safe';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { type SavedSafe, saveSafe, clearSafe, base64ToArrayBuffer } from '../lib/storage';
import {
  type ShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
} from '../lib/multisig';

type View = 'home' | 'send' | 'receive' | 'add-owner';

interface Props {
  safe: SavedSafe;
  onDisconnect: () => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
const avatarColor = (addr: string) => COLORS[parseInt(addr.slice(2, 6), 16) % COLORS.length];
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
  const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
  return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
};

export default function WalletDashboard({ safe, onDisconnect }: Props) {
  const [view, setView] = useState<View>('home');
  const [balance, setBalance] = useState<bigint>(0n);
  const [owners, setOwners] = useState<`0x${string}`[]>([]);
  const [threshold, setThreshold] = useState(safe.threshold);

  // Send
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendStatus, setSendStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const shareQrRef = useRef<HTMLCanvasElement>(null);

  // Receive
  const receiveQrRef = useRef<HTMLCanvasElement>(null);

  // Add owner
  const [newOwnerAddr, setNewOwnerAddr] = useState('');
  const [newThreshold, setNewThreshold] = useState(2);
  const [addStatus, setAddStatus] = useState('');

  // Transaction history
  const [txHistory, setTxHistory] = useState<Array<{ hash: string; timestamp: number; value: bigint }>>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const localOwner = safe.owners.find(o => o.credentialId);
  const localCredentialId = localOwner?.credentialId ? base64ToArrayBuffer(localOwner.credentialId) : null;

  // Poll balance + owners + history
  useEffect(() => {
    const refresh = async () => {
      try {
        const [b, o, t] = await Promise.all([
          publicClient.getBalance({ address: safe.address }),
          getOwners(safe.address),
          getThreshold(safe.address),
        ]);
        setBalance(b);
        setOwners(o);
        setThreshold(Number(t));
        // Fetch tx history
        try {
          const logs = await publicClient.getLogs({
            address: safe.address,
            event: parseAbiItem('event ExecutionSuccess(bytes32 txHash, uint256 payment)'),
            fromBlock: 'earliest',
            toBlock: 'latest',
          });
          const txs = await Promise.all(
            logs.slice(-10).reverse().map(async (log) => {
              const [block, txData] = await Promise.all([
                publicClient.getBlock({ blockNumber: log.blockNumber }),
                publicClient.getTransaction({ hash: log.transactionHash }),
              ]);
              return { hash: log.transactionHash, timestamp: Number(block.timestamp), value: txData.value };
            })
          );
          setTxHistory(txs);
        } catch {}
        setHistoryLoading(false);
      } catch {}
    };
    refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [safe.address]);

  // QR for receive
  useEffect(() => {
    if (view === 'receive' && receiveQrRef.current) {
      QRCode.toCanvas(receiveQrRef.current, safe.address, { width: 200, margin: 2 }).catch(() => {});
    }
  }, [view, safe.address]);

  // QR for share
  useEffect(() => {
    if (shareQrRef.current && shareUrl) {
      QRCode.toCanvas(shareQrRef.current, shareUrl, { width: 200, margin: 2 }).catch(() => {});
    }
  }, [shareUrl]);

  const handleSend = async () => {
    if (!localCredentialId || !localOwner || !sendTo || !sendAmount) return;
    setSendStatus('Signing…');
    setTxHash('');
    setShareUrl('');
    try {
      const to = sendTo as `0x${string}`;
      const value = parseEther(sendAmount);
      const data = '0x' as `0x${string}`;
      const nonce = await getNonce(safe.address);
      const safeTxHash = computeSafeTxHash(safe.address, to, value, data, nonce);
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);

      if (threshold <= 1) {
        setSendStatus('Executing…');
        const packed = packSafeSignature(localOwner.address, sig.authenticatorData, sig.clientDataJSON, sig.challengeOffset, sig.r, sig.s);
        const hash = await execTransaction(safe.address, to, value, data, packed);
        setTxHash(hash);
        setSendStatus('Sent! ✅');
      } else {
        const sigData = packSingleSignerData(sig.authenticatorData, clientDataFields, sig.r, sig.s);
        const shareable: ShareableTransaction = {
          safe: safe.address, to, value: value.toString(), data, nonce: nonce.toString(),
          chainId: safe.chainId,
          signatures: [{ signer: localOwner.address, data: sigData }],
          threshold,
        };
        const encoded = encodeShareableTransaction(shareable);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setShareUrl(url);
        setSendStatus(`Signed (1/${threshold}). Share with co-signers.`);
      }
    } catch (e: any) {
      setSendStatus(`Error: ${e.message}`);
    }
  };

  const handleAddOwner = async () => {
    if (!localCredentialId || !localOwner || !newOwnerAddr) return;
    setAddStatus('Adding owner…');
    try {
      const ownerAddr = newOwnerAddr as `0x${string}`;
      const addOwnerData = encodeAddOwnerWithThreshold(ownerAddr, BigInt(newThreshold));
      const nonce = await getNonce(safe.address);
      const safeTxHash = computeSafeTxHash(safe.address, safe.address, 0n, addOwnerData, nonce);
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);

      if (threshold <= 1) {
        setAddStatus('Executing…');
        const packed = packSafeSignature(localOwner.address, sig.authenticatorData, sig.clientDataJSON, sig.challengeOffset, sig.r, sig.s);
        await execTransaction(safe.address, safe.address, 0n, addOwnerData, packed);
        const newOwners = await getOwners(safe.address);
        const newT = await getThreshold(safe.address);
        const updatedSafe: SavedSafe = {
          ...safe, threshold: Number(newT),
          owners: safe.owners.concat(
            newOwners.filter(o => !safe.owners.some(so => so.address.toLowerCase() === o.toLowerCase()))
              .map(o => ({ address: o, publicKey: { x: '', y: '' }, label: `Co-signer ${o.slice(0, 8)}` }))
          ),
        };
        saveSafe(updatedSafe);
        setThreshold(Number(newT));
        setAddStatus('Owner added ✅');
        setNewOwnerAddr('');
      } else {
        const sigData = packSingleSignerData(sig.authenticatorData, clientDataFields, sig.r, sig.s);
        const shareable: ShareableTransaction = {
          safe: safe.address, to: safe.address, value: '0', data: addOwnerData, nonce: nonce.toString(),
          chainId: safe.chainId,
          signatures: [{ signer: localOwner.address, data: sigData }],
          threshold,
        };
        const encoded = encodeShareableTransaction(shareable);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setShareUrl(url);
        setAddStatus(`Signed (1/${threshold}). Share with co-signers.`);
      }
    } catch (e: any) {
      setAddStatus(`Error: ${e.message}`);
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  const share = (url: string) => navigator.share?.({ url }).catch(() => {});

  // ── HOME VIEW ──
  if (view === 'home') return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>🔐 Passkey Wallet</h2>
        <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => { clearSafe(); onDisconnect(); }}>
          Disconnect
        </button>
      </div>

      {/* Balance Card */}
      <div className="card-gradient" style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>Total Balance</p>
        <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{formatEther(balance)} ETH</p>
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Base Sepolia</p>
      </div>

      {/* Action Buttons */}
      <div className="row">
        <button className="btn btn-primary flex-1" onClick={() => setView('send')}>
          ↑ Send
        </button>
        <button className="btn btn-secondary flex-1" onClick={() => setView('receive')}>
          ↓ Receive
        </button>
      </div>

      {/* Owners */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Signers</h3>
          <span className="badge badge-success">{threshold} of {owners.length || safe.owners.length}</span>
        </div>
        <div className="stack">
          {(owners.length > 0 ? owners : safe.owners.map(o => o.address)).map(addr => {
            const isLocal = localOwner && localOwner.address.toLowerCase() === addr.toLowerCase();
            return (
              <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="avatar" style={{ background: avatarColor(addr) }}>
                  {addr.slice(2, 4).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500 }}>{isLocal ? 'This Device' : `Signer ${addr.slice(2, 6)}`}</p>
                  <p className="text-muted text-xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortAddr(addr)}</p>
                </div>
                {isLocal && <span className="badge badge-success">You</span>}
              </div>
            );
          })}
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} onClick={() => setView('add-owner')}>
          + Add Co-Signer
        </button>
      </div>

      {/* Invite */}
      <div className="card" style={{ textAlign: 'center' }}>
        <p className="text-secondary text-sm mb-8">Invite someone to create a signer for this wallet</p>
        <button className="btn btn-secondary btn-sm" onClick={() => {
          const url = `${window.location.origin}${window.location.pathname}#/join?safe=${safe.address}`;
          copy(url);
        }}>
          📋 Copy Invite Link
        </button>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span>📜</span>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Recent Activity</h3>
        </div>
        {historyLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <div className="spinner spinner-dark" style={{ width: 20, height: 20 }} />
          </div>
        ) : txHistory.length === 0 ? (
          <p className="text-muted text-sm" style={{ textAlign: 'center', padding: 12 }}>No transactions yet</p>
        ) : (
          <div>
            {txHistory.map(tx => (
              <div key={tx.hash} className="tx-history-item">
                <span style={{ color: 'var(--success)', fontSize: 14 }}>✅</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--primary-from)' }}>
                    {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
                  </a>
                  {tx.value > 0n && (
                    <span className="text-sm" style={{ marginLeft: 8, fontWeight: 600 }}>{formatEther(tx.value)} ETH</span>
                  )}
                </div>
                <span className="text-muted text-xs">{timeAgo(tx.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Safe address */}
      <div style={{ textAlign: 'center' }}>
        <a href={`${EXPLORER}/address/${safe.address}`} target="_blank" rel="noreferrer" className="text-muted text-xs">
          {shortAddr(safe.address)} ↗
        </a>
      </div>
    </div>
  );

  // ── SEND VIEW ──
  if (view === 'send') return (
    <div className="fade-in stack-lg">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-icon" style={{ width: 44, height: 44, fontSize: 20 }} onClick={() => { setView('home'); setSendStatus(''); setTxHash(''); setShareUrl(''); }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Send</h2>
      </div>

      <div className="stack">
        <input className="input" placeholder="Recipient address (0x…)" value={sendTo} onChange={e => setSendTo(e.target.value)} />
        <input className="input" placeholder="Amount (ETH)" value={sendAmount} onChange={e => setSendAmount(e.target.value)} inputMode="decimal" />
      </div>

      {threshold <= 1 ? (
        <SlideToConfirm
          label="Slide to send"
          disabled={!sendTo || !sendAmount}
          onConfirm={async () => { await handleSend(); }}
        />
      ) : (
        <button className="btn btn-primary" onClick={handleSend} disabled={!sendTo || !sendAmount || sendStatus === 'Signing…' || sendStatus === 'Executing…'}>
          {sendStatus === 'Signing…' || sendStatus === 'Executing…' ? <><div className="spinner" /> {sendStatus}</> : 'Send'}
        </button>
      )}

      {sendStatus && sendStatus !== 'Signing…' && sendStatus !== 'Executing…' && (
        <div className="card fade-in">
          <p style={{ fontSize: 14, marginBottom: 8 }}>{sendStatus}</p>
          {txHash && <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-from)', fontSize: 14 }}>View transaction ↗</a>}
        </div>
      )}

      {shareUrl && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Share for co-signing</p>
          <canvas ref={shareQrRef} style={{ marginBottom: 12 }} />
          <div className="row">
            <button className="btn btn-secondary btn-sm flex-1" onClick={() => copy(shareUrl)}>📋 Copy</button>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-primary btn-sm flex-1" onClick={() => share(shareUrl)}>📤 Share</button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ── RECEIVE VIEW ──
  if (view === 'receive') return (
    <div className="fade-in stack-lg">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-icon" style={{ width: 44, height: 44, fontSize: 20 }} onClick={() => setView('home')}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Receive</h2>
      </div>

      <div className="card" style={{ textAlign: 'center' }}>
        <p className="text-secondary text-sm mb-8">Send Base Sepolia ETH to this address</p>
        <canvas ref={receiveQrRef} style={{ marginBottom: 16 }} />
        <div className="addr-chip" style={{ marginBottom: 12 }}>{safe.address}</div>
        <button className="btn btn-primary btn-sm" onClick={() => copy(safe.address)}>📋 Copy Address</button>
      </div>
    </div>
  );

  // ── ADD OWNER VIEW ──
  if (view === 'add-owner') return (
    <div className="fade-in stack-lg">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-icon" style={{ width: 44, height: 44, fontSize: 20 }} onClick={() => { setView('home'); setAddStatus(''); }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Add Co-Signer</h2>
      </div>

      <div className="card">
        <p className="text-secondary text-sm mb-8">Paste the signer address from the co-signer's device</p>
        <div className="stack">
          <input className="input" placeholder="0x… signer address" value={newOwnerAddr} onChange={e => setNewOwnerAddr(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="text-secondary text-sm">New threshold:</label>
            <select className="select" value={newThreshold} onChange={e => setNewThreshold(Number(e.target.value))}>
              {Array.from({ length: (owners.length || safe.owners.length) + 1 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button className="btn btn-primary" onClick={handleAddOwner} disabled={!newOwnerAddr || addStatus === 'Adding owner…' || addStatus === 'Executing…'}>
        {addStatus === 'Adding owner…' || addStatus === 'Executing…' ? <><div className="spinner" /> {addStatus}</> : 'Add Owner'}
      </button>

      {addStatus && addStatus !== 'Adding owner…' && addStatus !== 'Executing…' && (
        <div className="card fade-in">
          <p style={{ fontSize: 14 }}>{addStatus}</p>
        </div>
      )}

      {shareUrl && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Share for co-signing</p>
          <canvas ref={shareQrRef} style={{ marginBottom: 12 }} />
          <div className="row">
            <button className="btn btn-secondary btn-sm flex-1" onClick={() => copy(shareUrl)}>📋 Copy</button>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-primary btn-sm flex-1" onClick={() => share(shareUrl)}>📤 Share</button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return null;
}
