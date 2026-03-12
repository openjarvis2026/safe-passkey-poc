import { useState, useEffect, useRef } from 'react';
import { formatEther, parseEther, parseAbiItem, parseUnits } from 'viem';
import QRCode from 'qrcode';
import { publicClient, EXPLORER } from '../lib/relayer';
import SlideToConfirm from './shared/SlideToConfirm';
import TokenList from './TokenList';
import TokenSelector from './TokenSelector';
import SafeSelector from './SafeSelector';
import TransactionHistory from './TransactionHistory';
import { getNonce, execTransaction, getOwners, getThreshold, encodeAddOwnerWithThreshold, encodeERC20Transfer } from '../lib/safe';
import { computeSafeTxHash, packSafeSignature, packLedgerSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { type SavedSafe, saveSafe, clearSafe, base64ToArrayBuffer, getSignerType } from '../lib/storage';
import { connectLedger, signTransactionHash, disconnectLedger, getLedgerErrorMessage, type LedgerDevice } from '../lib/ledger';
import {
  type ShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
} from '../lib/multisig';
import { NATIVE_TOKEN, type Token } from '../lib/tokens';

type View = 'home' | 'send' | 'receive' | 'add-owner' | 'history';

interface Props {
  safe: SavedSafe;
  onDisconnect: () => void;
  onSafeChanged: (safe: SavedSafe | null) => void;
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

  // Transaction history
  const [txHistory, setTxHistory] = useState<Array<{ hash: string; timestamp: number; value: bigint }>>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Ledger signing state
  const [ledgerDevice, setLedgerDevice] = useState<LedgerDevice | null>(null);
  const [ledgerStep, setLedgerStep] = useState<'connect' | 'open-app' | 'confirm' | 'done'>('connect');
  const [ledgerError, setLedgerError] = useState('');
  const [isLedgerFlow, setIsLedgerFlow] = useState(false);

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
    if (!localOwner || !sendTo || !sendAmount || !selectedToken) return;
    
    // Reset states
    setTxHash('');
    setShareUrl('');
    setLedgerError('');
    
    const signerType = getSignerType(safe);
    
    if (signerType === 'ledger') {
      setIsLedgerFlow(true);
      setLedgerStep('connect');
      setSendStatus('');
      await handleLedgerSend();
    } else {
      if (!localCredentialId) {
        setSendStatus('Error: No passkey available');
        return;
      }
      await handlePasskeySend();
    }
  };

  const handlePasskeySend = async () => {
    if (!localCredentialId || !localOwner || !sendTo || !sendAmount || !selectedToken) return;
    setSendStatus('Signing…');
    
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
        setSendStatus(`Signed (1/${threshold}). Share with other devices.`);
      }
    } catch (e: any) {
      setSendStatus(`Error: ${e.message}`);
    }
  };

  // handleAddOwner removed - now using InviteSigner component
  const handleLedgerSend = async () => {
    if (!localOwner || !sendTo || !sendAmount || !selectedToken) return;
    
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

      // Step 1: Connect Ledger
      let device: LedgerDevice;
      try {
        device = await connectLedger();
        setLedgerDevice(device);
        setLedgerStep('open-app');
      } catch (error: any) {
        setLedgerError(getLedgerErrorMessage(error));
        setIsLedgerFlow(false);
        return;
      }

      // Step 2: Open Ethereum App (already validated in connectLedger)
      setLedgerStep('confirm');

      // Step 3: Sign transaction
      try {
        const nonce = await getNonce(safe.address);
        const safeTxHash = computeSafeTxHash(safe.address, to, value, data, nonce);
        const hashBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);

        const signature = await signTransactionHash(device, hashBytes);
        setLedgerStep('done');

        if (threshold <= 1) {
          setSendStatus('Executing…');
          // Pack Ledger signature for Safe execution
          const packed = packLedgerSignature(localOwner.address, signature.r, signature.s, signature.v);
          const hash = await execTransaction(safe.address, to, value, data, packed);
          setTxHash(hash);
          setSendStatus('Sent! ✅');
        } else {
          // For multi-sig, create shareable transaction
          // Note: For Ledger in multi-sig, we need to handle this differently
          // For now, multi-sig Ledger is not fully supported in this implementation
          setSendStatus('Multi-sig Ledger support coming soon');
        }
      } catch (error: any) {
        setLedgerError(getLedgerErrorMessage(error));
      } finally {
        if (device) {
          await disconnectLedger(device);
          setLedgerDevice(null);
        }
        setIsLedgerFlow(false);
      }
    } catch (e: any) {
      setLedgerError(`Error: ${e.message}`);
      setIsLedgerFlow(false);
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
              .map(o => ({ address: o, publicKey: { x: '', y: '' }, label: `Device ${o.slice(0, 8)}` }))
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
        setAddStatus(`Signed (1/${threshold}). Share with other devices.`);
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
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Base Sepolia</p>
      </div>

      {/* Action Buttons */}
      <div className="action-buttons">
        <button className="btn btn-primary flex-1" onClick={() => setView('send')}>
          ↑ Send
        </button>
        <button className="btn btn-secondary flex-1" onClick={() => setView('receive')}>
          ↓ Receive
        </button>
        <button className="btn btn-secondary flex-1" onClick={() => setView('history')}>
          📜 History
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
        <button className="btn btn-icon" style={{ width: 44, height: 44, fontSize: 20 }} onClick={() => { 
          setView('home'); 
          setSendStatus(''); 
          setTxHash(''); 
          setShareUrl('');
          setSendTo('');
          setSendAmount('');
          setSelectedToken(NATIVE_TOKEN);
          setIsLedgerFlow(false);
          setLedgerStep('connect');
          setLedgerError('');
          if (ledgerDevice) {
            disconnectLedger(ledgerDevice);
            setLedgerDevice(null);
          }
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

      {/* Ledger Step-by-Step UI */}
      {isLedgerFlow && (
        <div className="stack">
          {/* Step 1: Connect Ledger */}
          <div className={`card ${ledgerStep === 'connect' ? 'active-step' : (ledgerStep === 'open-app' || ledgerStep === 'confirm' || ledgerStep === 'done') && !ledgerError ? 'completed-step' : ''}`} 
               style={{ border: ledgerStep === 'connect' ? '2px solid var(--primary-from)' : (ledgerStep === 'open-app' || ledgerStep === 'confirm' || ledgerStep === 'done') && !ledgerError ? '2px solid var(--success)' : '2px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="step-number" style={{ 
                width: 32, height: 32, borderRadius: '50%', 
                background: ledgerStep === 'connect' ? 'var(--primary-from)' : (ledgerStep === 'open-app' || ledgerStep === 'confirm' || ledgerStep === 'done') && !ledgerError ? 'var(--success)' : 'var(--border)',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 600
              }}>
                {ledgerStep === 'connect' && !ledgerError && <div className="spinner" style={{ width: 16, height: 16 }} />}
                {(ledgerStep === 'open-app' || ledgerStep === 'confirm' || ledgerStep === 'done') && !ledgerError && '✅'}
                {(ledgerError || ledgerStep === 'connect') && '1'}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Connect Ledger</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Plug in and unlock your Ledger</p>
              </div>
            </div>
          </div>

          {/* Step 2: Open Ethereum App */}
          <div className={`card ${ledgerStep === 'open-app' ? 'active-step' : ledgerStep === 'confirm' || ledgerStep === 'done' ? 'completed-step' : ''}`}
               style={{ border: ledgerStep === 'open-app' ? '2px solid var(--primary-from)' : (ledgerStep === 'confirm' || ledgerStep === 'done') ? '2px solid var(--success)' : '2px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="step-number" style={{ 
                width: 32, height: 32, borderRadius: '50%', 
                background: ledgerStep === 'open-app' ? 'var(--primary-from)' : (ledgerStep === 'confirm' || ledgerStep === 'done') ? 'var(--success)' : 'var(--border)',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 600
              }}>
                {ledgerStep === 'open-app' && <div className="spinner" style={{ width: 16, height: 16 }} />}
                {(ledgerStep === 'confirm' || ledgerStep === 'done') && '✅'}
                {ledgerStep !== 'open-app' && ledgerStep !== 'confirm' && ledgerStep !== 'done' && '2'}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Open Ethereum App</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Launch Ethereum app on your Ledger</p>
              </div>
            </div>
          </div>

          {/* Step 3: Confirm Transaction */}
          <div className={`card ${ledgerStep === 'confirm' ? 'active-step' : ledgerStep === 'done' ? 'completed-step' : ''}`}
               style={{ border: ledgerStep === 'confirm' ? '2px solid var(--primary-from)' : ledgerStep === 'done' ? '2px solid var(--success)' : '2px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="step-number" style={{ 
                width: 32, height: 32, borderRadius: '50%', 
                background: ledgerStep === 'confirm' ? 'var(--primary-from)' : ledgerStep === 'done' ? 'var(--success)' : 'var(--border)',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 600
              }}>
                {ledgerStep === 'confirm' && <div className="spinner" style={{ width: 16, height: 16 }} />}
                {ledgerStep === 'done' && '✅'}
                {ledgerStep !== 'confirm' && ledgerStep !== 'done' && '3'}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Confirm Transaction</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Review and approve on your Ledger</p>
              </div>
            </div>
          </div>

          {/* Ledger Error */}
          {ledgerError && (
            <div className="card" style={{ border: '2px solid var(--error)', background: 'rgba(239, 68, 68, 0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, color: 'var(--error)' }}>Connection Error</p>
                  <p style={{ fontSize: 13, margin: 0 }}>{ledgerError}</p>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => {
                setLedgerError('');
                setIsLedgerFlow(false);
                setLedgerStep('connect');
              }}>
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Regular Send UI (when not in Ledger flow) */}
      {!isLedgerFlow && (
        <>
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
        </>
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
        <p className="text-secondary text-sm mb-8">Send Base Sepolia ETH to this address</p>
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
    />
  );

  return null;
}
