import { useState, useEffect } from 'react';
import { parseAbiItem } from 'viem';
import { publicClient } from '../lib/relayer';
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

interface SignerEvent {
  description: string;
  timestamp: number;
  icon: string;
}

const SAFE_EVENTS = {
  AddedOwner: parseAbiItem('event AddedOwner(address indexed owner)'),
  RemovedOwner: parseAbiItem('event RemovedOwner(address indexed owner)'),
  ChangedThreshold: parseAbiItem('event ChangedThreshold(uint256 threshold)'),
} as const;

export default function SignersView({ safe, onBack }: Props) {
  const [owners, setOwners] = useState<`0x${string}`[]>([]);
  const [threshold, setThreshold] = useState(safe.threshold);
  const [newThreshold, setNewThreshold] = useState(safe.threshold);
  const [showThresholdChange, setShowThresholdChange] = useState(false);
  const [thresholdStatus, setThresholdStatus] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [signerHistory, setSignerHistory] = useState<SignerEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const localOwner = safe.owners.find(o => o.credentialId);
  const localCredentialId = localOwner?.credentialId ? base64ToArrayBuffer(localOwner.credentialId) : null;

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
      } catch {}
    };
    loadData();
  }, [safe.address]);

  // Fetch signer activity history from on-chain event logs
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        // Public RPCs limit eth_getLogs to ~10k blocks. Scan recent 9,999 blocks.
        // For a recently created Safe this covers all events.
        const currentBlock = await publicClient.getBlockNumber();
        const fromBlock = currentBlock > 9_999n ? currentBlock - 9_999n : 0n;
        const addr = safe.address as `0x${string}`;

        const [addedLogs, removedLogs, thresholdLogs] = await Promise.all([
          publicClient.getLogs({ address: addr, event: SAFE_EVENTS.AddedOwner, fromBlock, toBlock: currentBlock }),
          publicClient.getLogs({ address: addr, event: SAFE_EVENTS.RemovedOwner, fromBlock, toBlock: currentBlock }),
          publicClient.getLogs({ address: addr, event: SAFE_EVENTS.ChangedThreshold, fromBlock, toBlock: currentBlock }),
        ]);

        const events: (SignerEvent & { blockNumber: bigint; logIndex: number })[] = [];

        for (const log of addedLogs) {
          const addr = log.args.owner;
          if (!addr) continue;
          events.push({
            description: `${shortAddr(addr)} added`,
            timestamp: 0,
            icon: '👤',
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          });
        }

        for (const log of removedLogs) {
          const addr = log.args.owner;
          if (!addr) continue;
          events.push({
            description: `${shortAddr(addr)} removed`,
            timestamp: 0,
            icon: '🚫',
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          });
        }

        for (const log of thresholdLogs) {
          const t = log.args.threshold;
          if (t === undefined) continue;
          events.push({
            description: `Threshold → ${t}`,
            timestamp: 0,
            icon: '🔧',
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          });
        }

        // Sort by block (newest first), then by log index
        events.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
          return b.logIndex - a.logIndex;
        });

        // Fetch block timestamps for display
        const uniqueBlocks = [...new Set(events.map(e => e.blockNumber))];
        const blockTimestamps = new Map<bigint, number>();
        await Promise.all(
          uniqueBlocks.slice(0, 20).map(async (bn) => {
            try {
              const block = await publicClient.getBlock({ blockNumber: bn });
              blockTimestamps.set(bn, Number(block.timestamp) * 1000);
            } catch {}
          })
        );

        const finalEvents: SignerEvent[] = events.map(e => ({
          description: e.description,
          timestamp: blockTimestamps.get(e.blockNumber) || 0,
          icon: e.icon,
        }));

        console.log('[SignersView]', { safeAddr: safe.address, fromBlock: fromBlock.toString(), added: addedLogs.length, removed: removedLogs.length, threshold: thresholdLogs.length, finalEvents: finalEvents.length });
        setSignerHistory(finalEvents);
      } catch (err) {
        console.error('[SignersView] Failed to fetch signer history:', err);
      }
      setHistoryLoading(false);
    };
    fetchHistory();
  }, [safe.address]);

  const formatTimeAgo = (ts: number) => {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

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
          safe: safe.address, to: safe.address, value: '0', data: changeThresholdData,
          nonce: nonce.toString(), chainId: safe.chainId,
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

  const handleCopyAddress = (addr: string) => {
    copy(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1500);
  };

  const getOwnerLabel = (address: string) => {
    const savedOwner = safe.owners.find(o => o.address.toLowerCase() === address.toLowerCase());
    if (savedOwner && savedOwner.credentialId) return 'This Device';
    if (savedOwner && savedOwner.label) return savedOwner.label;
    return `Device ${address.slice(2, 6)}`;
  };

  const ownerCount = owners.length || safe.owners.length;

  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-icon" style={{ width: 44, height: 44, fontSize: 20 }} onClick={onBack}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700, flex: 1 }}>Signers</h2>
      </div>

      {/* Card 1 — Signers + Threshold + Add Device (unified) */}
      <div className="card">
        {/* Threshold summary row */}
        <div style={{ 
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--border)'
        }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600 }}>Required signatures</p>
            <p className="text-muted" style={{ fontSize: 12 }}>{threshold} of {ownerCount} to execute</p>
          </div>
          {ownerCount > 1 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12, padding: '6px 10px', height: 'auto', color: 'var(--primary-from)' }}
              onClick={() => setShowThresholdChange(!showThresholdChange)}
            >
              {showThresholdChange ? 'Cancel' : 'Change'}
            </button>
          )}
        </div>

        {/* Threshold change (inline, no separate card) */}
        {showThresholdChange && (
          <div style={{ 
            paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <label className="text-secondary text-sm" style={{ flex: 1 }}>New threshold:</label>
              <select className="select" style={{ width: 64 }} value={newThreshold} onChange={e => setNewThreshold(Number(e.target.value))}>
                {Array.from({ length: ownerCount }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                style={{ padding: '6px 14px' }}
                onClick={handleThresholdChange}
                disabled={newThreshold === threshold || thresholdStatus === 'Signing…' || thresholdStatus === 'Executing…'}
              >
                {thresholdStatus === 'Signing…' || thresholdStatus === 'Executing…' ?
                  <><div className="spinner" /> {thresholdStatus}</> :
                  'Apply'
                }
              </button>
            </div>
            {thresholdStatus && !thresholdStatus.includes('Signing') && !thresholdStatus.includes('Executing') && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12 }}>
                <p style={{ fontSize: 13 }}>{thresholdStatus}</p>
                {shareUrl && (
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => copy(shareUrl)}>📋 Copy Share Link</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Signer list */}
        <div className="stack" style={{ gap: 4 }}>
          {(owners.length > 0 ? owners : safe.owners.map(o => o.address)).map(addr => {
            const isLocal = localOwner && localOwner.address.toLowerCase() === addr.toLowerCase();
            const label = getOwnerLabel(addr);
            const isCopied = copiedAddr === addr;
            return (
              <div
                key={addr}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
                  transition: 'background 0.15s',
                  background: isCopied ? 'var(--bg-secondary)' : 'transparent',
                }}
                onClick={() => handleCopyAddress(addr)}
                role="button"
                tabIndex={0}
              >
                <div className="avatar" style={{ background: avatarColor(addr), width: 36, height: 36, fontSize: 12 }}>
                  {addr.slice(2, 4).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500 }}>{label}</p>
                  <p className="text-muted text-xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isCopied ? '✅ Copied!' : shortAddr(addr)}
                  </p>
                </div>
                {isLocal && <span className="badge badge-success" style={{ fontSize: 11 }}>You</span>}
              </div>
            );
          })}
        </div>

        {/* Add Device — inside the card */}
        <button
          className="btn btn-secondary"
          style={{ width: '100%', marginTop: 16 }}
          onClick={() => window.location.hash = `#/invite?safe=${safe.address}`}
        >
          + Add Device
        </button>
      </div>

      {/* Card 2 — Activity History */}
      <div className="card">
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Security Log</h3>
        {historyLoading ? (
          <div className="stack">
            {[0, 1].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="skeleton-shimmer" style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton-shimmer" style={{ height: 13, width: '65%', borderRadius: 4, marginBottom: 6 }} />
                  <div className="skeleton-shimmer" style={{ height: 11, width: '35%', borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        ) : signerHistory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 12px' }}>
            <p style={{ fontSize: 24, marginBottom: 8 }}>🛡️</p>
            <p className="text-muted text-sm">Your wallet security log will appear here</p>
            <p className="text-muted" style={{ fontSize: 11 }}>Signer additions, removals, and threshold changes are tracked automatically</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            {signerHistory.map((event, i) => (
              <div key={i} style={{ 
                display: 'flex', alignItems: 'center', gap: 10, 
                padding: '10px 0',
                borderBottom: i < signerHistory.length - 1 ? '1px solid var(--border)' : 'none' 
              }}>
                <div style={{ 
                  width: 32, height: 32, borderRadius: 16, 
                  background: 'var(--bg-secondary)', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', 
                  fontSize: 14, flexShrink: 0 
                }}>
                  {event.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500 }}>{event.description}</p>
                  <p className="text-muted" style={{ fontSize: 11 }}>{formatTimeAgo(event.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
