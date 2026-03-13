import { useState, useEffect, useRef } from 'react';
import { formatEther, parseUnits } from 'viem';
import QRCode from 'qrcode';
import { publicClient, EXPLORER } from '../lib/relayer';
import SlideToConfirm from './shared/SlideToConfirm';
import TokenList from './TokenList';
import TokenSelector from './TokenSelector';
import SafeSelector from './SafeSelector';
import TransactionHistory from './TransactionHistory';
import TransactionItem from './TransactionItem';
import SwapView from './SwapView';
import { getNonce, execTransaction, getOwners, getThreshold, encodeAddOwnerWithThreshold, encodeERC20Transfer } from '../lib/safe';
import { cacheLocalTransaction, fetchTransactionHistory, savePendingTransaction } from '../lib/history';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { type SavedSafe, saveSafe, clearSafe, base64ToArrayBuffer } from '../lib/storage';
import {
  type ShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
} from '../lib/multisig';
import { NATIVE_TOKEN, type Token, formatTokenAmount } from '../lib/tokens';
import { type SafeTransaction } from '../lib/history';

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
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const shareQrRef = useRef<HTMLCanvasElement>(null);

  // Receive
  const receiveQrRef = useRef<HTMLCanvasElement>(null);

  // Removed add owner state - now using InviteSigner component

  // Transaction history (recent activity)
  const [recentTxs, setRecentTxs] = useState<SafeTransaction[]>([]);
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
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>🔐 Passkey Wallet</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SafeSelector currentSafe={safe} onSafeChanged={onSafeChanged} />
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
        <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{formatEther(balance)} ETH</p>
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
          Swap
        </button>
      </div>

      {/* Token List */}
      <TokenList safeAddress={safe.address} />

      {/* Owners */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Authorized Devices</h3>
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
                  <p style={{ fontSize: 14, fontWeight: 500 }}>{isLocal ? 'This Device' : `Device ${addr.slice(2, 6)}`}</p>
                  <p className="text-muted text-xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortAddr(addr)}</p>
                </div>
                {isLocal && <span className="badge badge-success">You</span>}
              </div>
            );
          })}
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} onClick={() => window.location.hash = `#/invite?safe=${safe.address}`}>
          + Invite Signer
        </button>
      </div>

      {/* Invite */}
      <div className="card" style={{ textAlign: 'center' }}>
        <p className="text-secondary text-sm mb-8">Invite someone to add their device to this wallet</p>
        <button className="btn btn-secondary btn-sm" onClick={() => {
          const url = `${window.location.origin}${window.location.pathname}#/join?safe=${safe.address}`;
          copy(url);
        }}>
          📋 Copy Invite Link
        </button>
      </div>

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
          <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <div className="spinner spinner-dark" style={{ width: 20, height: 20 }} />
          </div>
        ) : recentTxs.length === 0 ? (
          <div className="card">
            <p className="text-muted text-sm" style={{ textAlign: 'center', padding: 12 }}>No transactions yet</p>
          </div>
        ) : (
          <div>
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
          setSelectedToken(NATIVE_TOKEN);
        }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Send</h2>
      </div>

      <div className="stack">
        <input className="input" placeholder="Recipient address (0x…)" value={sendTo} onChange={e => setSendTo(e.target.value)} />
        
        <div className="send-token-input">
          <button 
            className="send-token-selector"
            onClick={() => setShowTokenSelector(true)}
          >
            <span style={{ fontSize: 18 }}>
              {selectedToken.symbol === 'ETH' && '⚡'}
              {selectedToken.symbol === 'USDC' && '💙'}
              {selectedToken.symbol === 'USDT' && '💚'}
              {selectedToken.symbol === 'WETH' && '🔷'}
            </span>
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
        <div className="addr-chip" style={{ marginBottom: 12 }}>{safe.address}</div>
        <button className="btn btn-primary btn-sm" onClick={() => copy(safe.address)}>📋 Copy Address</button>
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
