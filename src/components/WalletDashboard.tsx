import { useState, useEffect, useRef } from 'react';
import { formatEther, parseUnits, formatUnits } from 'viem';
import QRCode from 'qrcode';
import { publicClient, EXPLORER } from '../lib/relayer';
import SlideToConfirm from './shared/SlideToConfirm';
import TokenList from './TokenList';
import TokenSelector from './TokenSelector';
import SafeSelector from './SafeSelector';
import TransactionHistory from './TransactionHistory';
import TransactionItem from './TransactionItem';
import TokenIcon from './TokenIcon';
import SwapView from './SwapView';
import { getNonce, execTransaction, getOwners, getThreshold, encodeAddOwnerWithThreshold, encodeERC20Transfer } from '../lib/safe';
import { cacheLocalTransaction, fetchTransactionHistory, savePendingTransaction, fetchPendingApprovals, type PendingApproval } from '../lib/history';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { type SavedSafe, saveSafe, clearSafe, base64ToArrayBuffer } from '../lib/storage';
import {
  type ShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
} from '../lib/multisig';
import { NATIVE_TOKEN, type Token, formatTokenAmount, formatUSDValue, getTokenBalances, type TokenBalance } from '../lib/tokens';
import { type SafeTransaction } from '../lib/history';
import { cacheGet } from '../lib/cache';

type View = 'home' | 'send' | 'receive' | 'add-owner' | 'history' | 'swap';

interface Props {
  safe: SavedSafe;
  onDisconnect: () => void;
  onSafeChanged: (safe: SavedSafe | null) => void;
}

const COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
const avatarColor = (addr: string) => COLORS[parseInt(addr.slice(2, 6), 16) % COLORS.length];
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
  const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
  return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
};

export default function WalletDashboard({ safe, onDisconnect, onSafeChanged }: Props) {
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
  const [selectedToken, setSelectedToken] = useState<Token>(NATIVE_TOKEN);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>(() => {
    const cached = cacheGet<Array<TokenBalance & { balance: string }>>(`token_balances_${safe.address.toLowerCase()}`);
    if (cached) return cached.map(b => ({ ...b, balance: BigInt(b.balance) }));
    return [];
  });
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [sendMemo, setSendMemo] = useState('');
  const [showReview, setShowReview] = useState(false);
  const shareQrRef = useRef<HTMLCanvasElement>(null);

  // Receive
  const receiveQrRef = useRef<HTMLCanvasElement>(null);

  // Removed add owner state - now using InviteSigner component

  // Transaction history (recent activity) — seed from cache for instant display
  const [recentTxs, setRecentTxs] = useState<SafeTransaction[]>(() => {
    const cached = cacheGet<Array<SafeTransaction & { amount: string }>>(`tx_history_${safe.address.toLowerCase()}`);
    if (cached) return cached.map(tx => ({ ...tx, amount: BigInt(tx.amount) }));
    return [];
  });
  const [historyLoading, setHistoryLoading] = useState(() => {
    return !cacheGet(`tx_history_${safe.address.toLowerCase()}`);
  });
  const [copied, setCopied] = useState(false);
  const [headerCopied, setHeaderCopied] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

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
        // Fetch token balances
        try {
          const tb = await getTokenBalances(safe.address);
          setTokenBalances(tb);
        } catch {}
        // Fetch recent transactions
        try {
          const txs = await fetchTransactionHistory(safe.address, 5);
          setRecentTxs(txs);
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

  // Fetch pending approvals from Safe Transaction Service
  useEffect(() => {
    const fetchApprovals = async () => {
      const approvals = await fetchPendingApprovals(safe.address);
      const myAddresses = safe.owners.map(o => o.address.toLowerCase());
      const needsMyApproval = approvals.filter(a =>
        !a.confirmations.some(c => myAddresses.includes(c.owner.toLowerCase()))
      );
      setPendingApprovals(needsMyApproval);
    };
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 30000);
    return () => clearInterval(interval);
  }, [safe.address]);

  const handleSend = async () => {
    if (!localCredentialId || !localOwner || !sendTo || !sendAmount || !selectedToken) return;
    setSendStatus('Signing…');
    setTxHash('');
    setShareUrl('');
    try {
      const recipientAddress = sendTo as `0x${string}`;
      let to: `0x${string}`;
      let value: bigint;
      let data: `0x${string}`;

      // Determine transaction parameters based on token type
      if (selectedToken.address === '0x0000000000000000000000000000000000000000') {
        // Native ETH transfer
        to = recipientAddress;
        value = parseUnits(sendAmount, selectedToken.decimals);
        data = '0x';
      } else {
        // ERC-20 token transfer
        to = selectedToken.address;
        value = 0n;
        const tokenAmount = parseUnits(sendAmount, selectedToken.decimals);
        data = encodeERC20Transfer(recipientAddress, tokenAmount);
      }

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
        // Cache locally so it shows in history immediately
        const sentAmount = selectedToken.address === '0x0000000000000000000000000000000000000000'
          ? value : parseUnits(sendAmount, selectedToken.decimals);
        cacheLocalTransaction(safe.address, hash, recipientAddress, sentAmount, selectedToken);
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
        savePendingTransaction(safe.address, {
          id: `${safe.address}-${nonce}-${Date.now()}`,
          to, value: value.toString(), data,
          token: selectedToken,
          nonce: nonce.toString(),
          createdAt: new Date().toISOString(),
          threshold, signatureCount: 1, shareUrl: url,
        });
        setSendStatus(`Signed (1/${threshold}). Share with other devices.`);
      }
    } catch (e: any) {
      setSendStatus(`Error: ${e.message}`);
    }
  };

  // handleAddOwner removed - now using InviteSigner component

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});
  const share = (url: string) => navigator.share?.({ url }).catch(() => {});

  // Handle resend from transaction history
  const handleResend = (transaction: SafeTransaction) => {
    // Pre-fill the send form with transaction data
    setSendTo(transaction.to);
    setSendAmount(formatTokenAmount(transaction.amount, transaction.token));
    setSelectedToken(transaction.token);
    
    // Clear any previous status/results
    setSendStatus('');
    setTxHash('');
    setShareUrl('');
    
    // Switch to send view
    setView('send');
  };

  // ── HOME VIEW ──
  if (view === 'home') return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 
          style={{ fontSize: 20, fontWeight: 700, cursor: 'pointer' }} 
          onClick={() => {
            copy(safe.address);
            setHeaderCopied(true);
            setTimeout(() => setHeaderCopied(false), 2000);
          }}
          title="Tap to copy address"
        >{headerCopied ? '✅ Copied!' : '🔐 My Wallet'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SafeSelector currentSafe={safe} onSafeChanged={onSafeChanged} />
          <button 
            className="btn btn-icon" 
            style={{ width: 40, height: 40, fontSize: 14, position: 'relative' }} 
            onClick={() => window.location.hash = '#/signers'}
            title="Signers"
          >
            👥 {owners.length || safe.owners.length}
            {pendingApprovals.some(a => a.dataDecoded && ['addOwnerWithThreshold', 'removeOwner', 'swapOwner', 'changeThreshold'].includes(a.dataDecoded.method)) && (
              <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }} />
            )}
          </button>
          <button 
            className="btn btn-icon" 
            style={{ width: 40, height: 40, fontSize: 16 }} 
            onClick={() => window.location.hash = '#/settings'}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Balance Card */}
      <div className="card-gradient" style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>Total Balance</p>
        {(() => {
          const totalUSD = tokenBalances.reduce((sum, b) => sum + (b.usdValue || 0), 0);
          return totalUSD > 0 ? (
            <>
              <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{formatUSDValue(totalUSD)}</p>
              <p style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>{formatEther(balance)} ETH</p>
            </>
          ) : (
            <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{formatEther(balance)} ETH</p>
          );
        })()}
      </div>

      {/* Action Buttons */}
      <div className="action-buttons">
        <button className="btn btn-primary flex-1" onClick={() => setView('send')}>
          Send
        </button>
        <button className="btn btn-secondary flex-1" onClick={() => setView('receive')}>
          Receive
        </button>
        <button className="btn btn-secondary flex-1" onClick={() => setView('swap')}>
          Convert
        </button>
      </div>

      {/* Token List */}
      <TokenList safeAddress={safe.address} ethBalance={balance} />

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              ⏳ Needs Your Approval ({pendingApprovals.length})
            </h3>
          </div>
          {pendingApprovals.map(approval => {
            const sigCount = approval.confirmations.length;
            const sigRequired = approval.confirmationsRequired;
            let icon = '📤';
            let description = 'Contract interaction';

            if (approval.dataDecoded) {
              const method = approval.dataDecoded.method;
              if (method === 'changeThreshold') {
                icon = '🔧';
                const newThreshold = approval.dataDecoded.parameters.find(p => p.name === '_threshold')?.value || '?';
                description = `Change threshold to ${newThreshold}`;
              } else if (method === 'addOwnerWithThreshold') {
                icon = '👤';
                description = 'Add signer';
              } else if (method === 'removeOwner' || method === 'removeOwnerWithThreshold') {
                icon = '🚫';
                description = 'Remove signer';
              } else if (method === 'transfer') {
                icon = '💸';
                const valuePar = approval.dataDecoded.parameters.find(p => p.name === 'value' || p.name === 'amount');
                const toPar = approval.dataDecoded.parameters.find(p => p.name === 'to' || p.name === 'recipient');
                description = `Send tokens to ${toPar?.value ? toPar.value.slice(0, 6) + '…' + toPar.value.slice(-4) : 'unknown'}`;
                if (valuePar) description += ` (${valuePar.value})`;
              } else {
                description = method;
              }
            } else if (!approval.data || approval.data === '0x' || approval.data === null) {
              // Native ETH send
              icon = '💸';
              const ethValue = BigInt(approval.value || '0');
              description = `Send ${formatEther(ethValue)} ETH to ${approval.to.slice(0, 6)}…${approval.to.slice(-4)}`;
            }

            const proposerShort = approval.proposer === 'Unknown' ? 'Unknown' : `${approval.proposer.slice(0, 6)}…${approval.proposer.slice(-4)}`;
            const timeAgo = (() => {
              const diff = Date.now() - new Date(approval.submissionDate).getTime();
              const mins = Math.floor(diff / 60000);
              if (mins < 60) return `${mins}m ago`;
              const hrs = Math.floor(mins / 60);
              if (hrs < 24) return `${hrs}h ago`;
              return `${Math.floor(hrs / 24)}d ago`;
            })();

            return (
              <div key={approval.safeTxHash} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                  {icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{description}</p>
                  <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                    by {proposerShort} · {timeAgo} · {sigCount}/{sigRequired} signed
                  </p>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flexShrink: 0, fontSize: 12, padding: '6px 12px' }}
                  onClick={() => { window.location.hash = `#/approve?safeTxHash=${approval.safeTxHash}&safe=${safe.address}`; }}
                >
                  Review
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Activity */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Recent Activity</h3>
          {recentTxs.length > 0 && (
            <button 
              className="btn btn-ghost btn-sm" 
              style={{ width: 'auto', fontSize: 12, padding: '6px 12px', color: 'var(--primary-from)' }}
              onClick={() => setView('history')}
            >
              View All →
            </button>
          )}
        </div>
        {historyLoading ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div className="skeleton-shimmer" style={{ width: 40, height: 40, borderRadius: 20, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton-shimmer" style={{ height: 14, width: '60%', borderRadius: 4, marginBottom: 6 }} />
                  <div className="skeleton-shimmer" style={{ height: 12, width: '40%', borderRadius: 4 }} />
                </div>
                <div className="skeleton-shimmer" style={{ height: 14, width: 50, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        ) : recentTxs.length === 0 ? (
          <div className="card">
            <p className="text-muted text-sm" style={{ textAlign: 'center', padding: 12 }}>No activity yet — send or receive to get started</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {recentTxs.slice(0, 5).map(tx => (
              <TransactionItem key={tx.txHash} transaction={tx} />
            ))}
          </div>
        )}
      </div>

      {/* Safe address */}
      <div style={{ textAlign: 'center' }}>
        <a href={`${EXPLORER}/address/${safe.address}`} target="_blank" rel="noreferrer" className="text-muted text-xs">
          View on Explorer ↗
        </a>
      </div>
    </div>
  );

  // ── SEND VIEW ──
  if (view === 'send') return (
    <div className="fade-in stack-lg">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-icon" style={{ width: 44, height: 44, fontSize: 20 }} onClick={() => { 
          setView('home'); 
          setSendStatus(''); 
          setTxHash(''); 
          setShareUrl('');
          setSendTo('');
          setSendAmount('');
          setSendMemo('');
          setShowReview(false);
          setSelectedToken(NATIVE_TOKEN);
        }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Send</h2>
      </div>

      {!showReview && !txHash && (
        <>
          <div className="stack">
            <input className="input" placeholder="Recipient address" value={sendTo} onChange={e => setSendTo(e.target.value)} />
            
            <div className="send-token-input">
              <button 
                className="send-token-selector"
                onClick={() => setShowTokenSelector(true)}
              >
                <TokenIcon symbol={selectedToken.symbol} size={24} />
                <span>{selectedToken.symbol}</span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>▼</span>
              </button>
              
              <input 
                className="send-amount-input"
                placeholder={`Amount (${selectedToken.symbol})`}
                value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
                inputMode="decimal"
              />
            </div>

            {/* Available balance + Max */}
            {(() => {
              const tb = tokenBalances.find(b => b.token.address.toLowerCase() === selectedToken.address.toLowerCase());
              if (!tb) return null;
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-muted text-xs">
                    Available: {formatTokenAmount(tb.balance, tb.token)}{tb.usdValue ? ` (${formatUSDValue(tb.usdValue)})` : ''}
                  </span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '4px 8px', height: 'auto', color: 'var(--primary-from)' }} onClick={() => {
                    if (selectedToken.address === '0x0000000000000000000000000000000000000000') {
                      const max = Math.max(0, parseFloat(tb.formattedBalance) - 0.0005);
                      setSendAmount(max > 0 ? max.toString() : '');
                    } else {
                      setSendAmount(tb.formattedBalance);
                    }
                  }}>
                    Max
                  </button>
                </div>
              );
            })()}

            {/* Memo */}
            <input className="input" placeholder="Add a note (optional)" value={sendMemo} onChange={e => setSendMemo(e.target.value)} style={{ fontSize: 14 }} />
          </div>

          {/* Burn address / self-send warnings */}
          {sendTo && sendTo.toLowerCase().startsWith('0x000000000000') && (
            <div className="card" style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid var(--danger)', padding: 12 }}>
              <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>⚠️ Warning: This appears to be a burn address. Funds sent here cannot be recovered.</p>
            </div>
          )}
          {sendTo && sendTo.toLowerCase() === safe.address.toLowerCase() && (
            <div className="card" style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid var(--danger)', padding: 12 }}>
              <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>⚠️ You're sending to your own wallet address.</p>
            </div>
          )}

          <button className="btn btn-primary" disabled={!sendTo || !sendAmount} onClick={() => setShowReview(true)}>
            Review
          </button>
        </>
      )}

      {/* Review card */}
      {showReview && !txHash && (
        <div className="card fade-in">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Review Transaction</h3>
          <div className="stack" style={{ gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-secondary text-sm">Sending</span>
              <span style={{ fontWeight: 600 }}>
                {sendAmount} {selectedToken.symbol}
                {(() => {
                  const tb = tokenBalances.find(b => b.token.address.toLowerCase() === selectedToken.address.toLowerCase());
                  if (!tb || !tb.usdValue) return null;
                  const ratio = tb.balance > 0n ? tb.usdValue / parseFloat(tb.formattedBalance) : 0;
                  const usd = parseFloat(sendAmount) * ratio;
                  return usd > 0 ? <span className="text-muted" style={{ fontWeight: 400 }}> ({formatUSDValue(usd)})</span> : null;
                })()}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-secondary text-sm">To</span>
              <span style={{ fontSize: 14, fontFamily: 'monospace' }}>{shortAddr(sendTo)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-secondary text-sm">Network fee</span>
              <span style={{ fontSize: 14 }}>Sponsored ✨</span>
            </div>
            {sendMemo && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary text-sm">Note</span>
                <span className="text-sm">{sendMemo}</span>
              </div>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => setShowReview(false)}>← Edit</button>
            {threshold <= 1 ? (
              <SlideToConfirm
                label="Slide to send"
                onConfirm={async () => { await handleSend(); }}
                disabled={
                  !sendTo || sendTo.length !== 42 || !sendTo.startsWith('0x') ||
                  !sendAmount || parseFloat(sendAmount) <= 0 ||
                  (() => {
                    const tb = tokenBalances.find(b => b.token.address.toLowerCase() === selectedToken.address.toLowerCase());
                    return tb ? parseFloat(sendAmount) > parseFloat(tb.formattedBalance) : true;
                  })()
                }
              />
            ) : (
              <button className="btn btn-primary" onClick={handleSend} disabled={sendStatus === 'Signing…' || sendStatus === 'Executing…'}>
                {sendStatus === 'Signing…' || sendStatus === 'Executing…' ? <><div className="spinner" /> {sendStatus}</> : 'Confirm & Sign'}
              </button>
            )}
          </div>
        </div>
      )}

      {txHash && (
        <div className="card fade-in" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <p style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Sent!</p>
          <p className="text-secondary" style={{ fontSize: 15, marginBottom: 16 }}>
            {sendAmount} {selectedToken.symbol} to {shortAddr(sendTo)}
          </p>
          <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-from)', fontSize: 14, fontWeight: 500 }}>
            View on Explorer ↗
          </a>
          <div className="row" style={{ marginTop: 20, gap: 12 }}>
            <button className="btn btn-secondary flex-1" onClick={() => { setSendStatus(''); setTxHash(''); setSendTo(''); setSendAmount(''); setSendMemo(''); setShareUrl(''); setShowReview(false); }}>Send More</button>
            <button className="btn btn-primary flex-1" onClick={() => { setView('home'); setSendStatus(''); setTxHash(''); setSendTo(''); setSendAmount(''); setSendMemo(''); setShareUrl(''); setShowReview(false); setSelectedToken(NATIVE_TOKEN); }}>Back to Wallet</button>
          </div>
        </div>
      )}

      {sendStatus && sendStatus !== 'Signing…' && sendStatus !== 'Executing…' && !txHash && (
        <div className="card fade-in">
          <p style={{ fontSize: 14, marginBottom: 8 }}>{sendStatus}</p>
        </div>
      )}

      {shareUrl && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Share for approval</p>
          <canvas ref={shareQrRef} style={{ marginBottom: 12 }} />
          <div className="row">
            <button className="btn btn-secondary btn-sm flex-1" onClick={() => copy(shareUrl)}>📋 Copy</button>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-primary btn-sm flex-1" onClick={() => share(shareUrl)}>📤 Share</button>
            )}
          </div>
        </div>
      )}

      {/* Token Selector Modal */}
      {showTokenSelector && (
        <TokenSelector
          safeAddress={safe.address}
          selectedToken={selectedToken}
          onSelect={setSelectedToken}
          onClose={() => setShowTokenSelector(false)}
        />
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
        <canvas ref={receiveQrRef} style={{ marginBottom: 16 }} />
        <p className="text-secondary text-sm" style={{ marginBottom: 12 }}>Share this address to receive funds</p>
        <div className="addr-chip" style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', letterSpacing: '0.5px' }}>
          {safe.address.slice(0, 6) + ' ' + safe.address.slice(6).match(/.{1,4}/g)!.join(' ')}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-sm flex-1" onClick={() => {
            copy(safe.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}>{copied ? 'Copied! ✓' : '📋 Copy Address'}</button>
          {typeof navigator.share === 'function' && (
            <button className="btn btn-secondary btn-sm flex-1" onClick={() => navigator.share({ text: safe.address }).catch(() => {})}>📤 Share</button>
          )}
        </div>
      </div>
    </div>
  );

  // Add-owner view removed - now using InviteSigner component

  // ── HISTORY VIEW ──
  if (view === 'history') return (
    <TransactionHistory 
      safeAddress={safe.address} 
      onBack={() => setView('home')} 
      onResend={handleResend}
    />
  );

  // ── SWAP VIEW ──
  if (view === 'swap') return (
    <SwapView 
      safe={safe}
      onBack={() => setView('home')}
    />
  );

  return null;
}
