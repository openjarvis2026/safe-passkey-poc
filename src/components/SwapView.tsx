import { useState, useEffect } from 'react';
import { type SavedSafe } from '../lib/storage';
import { type Token, NATIVE_TOKEN, TOKENS, getTokenBalances, type TokenBalance } from '../lib/tokens';
import { encodeSwapTransaction, formatSwapQuote } from '../lib/swap';
import { useSwapQuote } from '../lib/useSwapQuote';
import { getNonce, execTransaction } from '../lib/safe';
import { EXPLORER } from '../lib/relayer';
import { savePendingTransaction, cacheLocalSwapTransaction } from '../lib/history';
import { isSwapSupported } from '../lib/chain';
import { computeSafeTxHash, packSafeSignature } from '../lib/encoding';
import { signWithPasskey } from '../lib/webauthn';
import { base64ToArrayBuffer } from '../lib/storage';
import {
  type ShareableTransaction,
  encodeShareableTransaction,
  packSingleSignerData,
} from '../lib/multisig';
import SlideToConfirm from './shared/SlideToConfirm';
import TokenSelector from './TokenSelector';
import TokenIcon from './TokenIcon';

interface Props {
  safe: SavedSafe;
  onBack: () => void;
}

export default function SwapView({ safe, onBack }: Props) {
  const swapSupported = isSwapSupported(safe.chainId);
  const [tokenFrom, setTokenFrom] = useState<Token>(NATIVE_TOKEN);
  const [tokenTo, setTokenTo] = useState<Token>(TOKENS.find(t => t.symbol === 'USDC') || TOKENS[1]);
  const [amountIn, setAmountIn] = useState('');
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [swapStatus, setSwapStatus] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [balances, setBalances] = useState<TokenBalance[]>([]);

  // Fetch balances
  useEffect(() => {
    getTokenBalances(safe.address as `0x${string}`).then(setBalances).catch(console.error);
  }, [safe.address]);

  const localOwner = safe.owners.find(o => o.credentialId);
  const localCredentialId = localOwner?.credentialId ? base64ToArrayBuffer(localOwner.credentialId) : null;
  const threshold = safe.threshold;

  // Real-time quote management: debounce + 10 s polling + 30 s expiry
  const {
    quote,
    isLoading: isLoadingQuote,
    error: quoteError,
    isStale: isQuoteStale,
    refetch: refetchQuote,
  } = useSwapQuote(tokenFrom, tokenTo, amountIn);

  const handleSwapTokens = () => {
    const temp = tokenFrom;
    setTokenFrom(tokenTo);
    setTokenTo(temp);
    setAmountIn('');
  };

  const extractClientDataFields = (clientDataJSON: string, challengeOffset: number): string => {
    const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
    return clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
  };

  const handleSwap = async () => {
    if (!localCredentialId || !localOwner || !quote) return;

    setSwapStatus('Preparing swap...');
    setTxHash('');
    setShareUrl('');

    try {
      // If the displayed quote is stale, fetch a fresh one before building the tx
      let activeQuote = quote;
      if (isQuoteStale) {
        setSwapStatus('Refreshing quote...');
        const freshQuote = await refetchQuote();
        if (!freshQuote) {
          setSwapStatus('Error: Could not refresh quote. Please try again.');
          return;
        }
        activeQuote = freshQuote;
      }

      const swapTx = encodeSwapTransaction(safe.address, activeQuote, slippage);
      setSwapStatus('Signing transaction...');
      
      const nonce = await getNonce(safe.address);
      const safeTxHash = computeSafeTxHash(safe.address, swapTx.to, swapTx.value, swapTx.data, nonce, 1);
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);

      const sig = await signWithPasskey(localCredentialId, hashBytes);
      const clientDataFields = extractClientDataFields(sig.clientDataJSON, sig.challengeOffset);

      if (threshold <= 1) {
        setSwapStatus('Executing swap...');
        const packed = packSafeSignature(localOwner.address, sig.authenticatorData, sig.clientDataJSON, sig.challengeOffset, sig.r, sig.s);
        const hash = await execTransaction(safe.address, swapTx.to, swapTx.value, swapTx.data, packed, 1);
        setTxHash(hash);
        setSwapStatus('Swap completed! ✅');

        // Cache the completed swap in transaction history
        const activeFormattedQuote = formatSwapQuote(activeQuote);
        const confirmedRateStr = activeFormattedQuote.rate ?? `1 ${tokenFrom.symbol} = ? ${tokenTo.symbol}`;
        cacheLocalSwapTransaction(
          safe.address,
          hash,
          activeQuote.tokenIn,
          activeQuote.tokenOut,
          activeQuote.amountIn,
          activeQuote.amountOut,
          activeQuote.feeAmount,
          confirmedRateStr,
          'confirmed'
        );
      } else {
        const sigData = packSingleSignerData(sig.authenticatorData, clientDataFields, sig.r, sig.s);
        const shareable: ShareableTransaction = {
          safe: safe.address,
          to: swapTx.to,
          value: swapTx.value.toString(),
          data: swapTx.data,
          nonce: nonce.toString(),
          chainId: safe.chainId,
          signatures: [{ signer: localOwner.address, data: sigData }],
          threshold,
          operation: 1,
        };
        const encoded = encodeShareableTransaction(shareable);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setShareUrl(url);
        const pendingId = `${safe.address}-${nonce}-${Date.now()}`;
        savePendingTransaction(safe.address, {
          id: pendingId,
          to: swapTx.to, value: swapTx.value.toString(), data: swapTx.data,
          token: tokenFrom,
          nonce: nonce.toString(),
          createdAt: new Date().toISOString(),
          threshold, signatureCount: 1, shareUrl: url,
        });

        // Cache the pending swap in transaction history
        const pendingFormattedQuote = formatSwapQuote(activeQuote);
        const pendingRateStr = pendingFormattedQuote.rate ?? `1 ${tokenFrom.symbol} = ? ${tokenTo.symbol}`;
        cacheLocalSwapTransaction(
          safe.address,
          pendingId,
          activeQuote.tokenIn,
          activeQuote.tokenOut,
          activeQuote.amountIn,
          activeQuote.amountOut,
          activeQuote.feeAmount,
          pendingRateStr,
          'pending'
        );

        setSwapStatus(`Swap signed (1/${threshold}). Share with other devices.`);
      }
    } catch (error: any) {
      setSwapStatus(`Error: ${error.message}`);
      console.error('Swap error:', error);
    }
  };

  const resetSwap = () => {
    setAmountIn('');
    setSwapStatus('');
    setTxHash('');
    setShareUrl('');
  };

  const sourceBalance = balances.find(b => b.token.address.toLowerCase() === tokenFrom.address.toLowerCase());
  const sourceBalanceFormatted = sourceBalance ? sourceBalance.formattedBalance : '0';

  const handleMax = () => {
    if (!sourceBalance) return;
    let max = parseFloat(sourceBalance.formattedBalance);
    if (tokenFrom.symbol === 'ETH') max = Math.max(0, max - 0.001);
    setAmountIn(max > 0 ? max.toString() : '');
  };

  const formatTokenAmount = (amount: number, symbol: string): string => {
    if (isNaN(amount)) return '0';
    if (amount === 0) return '0';
    const isStable = ['USDC', 'USDT', 'DAI'].includes(symbol);
    if (isStable) {
      return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (amount > 0 && amount < 0.000001) return '< 0.000001';
    return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  };

  const formatOutputAmount = (value: string, symbol: string): string => {
    const n = parseFloat(value);
    if (isNaN(n) || n === 0) return '0';
    return formatTokenAmount(n, symbol);
  };

  const formatNumber = (n: number, maxDecimals = 6): string => {
    if (n === 0) return '0';
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
  };

  const formattedQuote = quote ? formatSwapQuote(quote) : null;
  const canSwap = swapSupported && quote && amountIn && parseFloat(amountIn) > 0 && !isLoadingQuote && !quoteError;

  return (
    <div className="fade-in stack-lg" style={{ flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="btn btn-icon" 
            style={{ width: 44, height: 44, fontSize: 20 }}
            onClick={() => { onBack(); resetSwap(); }}
          >
            ←
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Convert</h2>
        </div>
        
        <button 
          className="btn btn-icon"
          onClick={() => setShowSettings(!showSettings)}
          style={{ 
            background: showSettings ? 'var(--primary-from)' : 'var(--card-bg)',
            color: showSettings ? 'white' : 'var(--text-secondary)'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Unsupported Chain Banner */}
      {!swapSupported && (
        <div className="card fade-in" style={{
          background: 'rgba(255, 170, 0, 0.1)',
          border: '1px solid rgba(255, 170, 0, 0.4)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--spacing-md)',
          padding: 'var(--spacing-lg)',
        }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
          <div className="stack-sm">
            <p className="text-small" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Swaps are only available on mainnet.
            </p>
            <p className="text-xs text-secondary">
              Connect to Base Mainnet to use the swap feature.
            </p>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div 
          className="token-selector-overlay"
          onClick={() => setShowSettings(false)}
          style={{ background: 'rgba(0, 0, 0, 0.6)' }}
        >
          <div 
            className="token-selector-modal" 
            onClick={e => e.stopPropagation()}
            style={{ maxHeight: '50vh' }}
          >
            <div className="token-selector-header">
              <h3 className="text-heading">Slippage Settings</h3>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: 32, height: 32, padding: 0 }}
                onClick={() => setShowSettings(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            
            <div style={{ padding: 'var(--spacing-xl)' }}>
              <div className="stack">
                <label className="text-small text-secondary">
                  Maximum price slippage you're willing to accept
                </label>
                
                <div className="row">
                  {[0.1, 0.5, 1.0, 3.0].map(value => (
                    <button
                      key={value}
                      className={`btn btn-sm ${slippage === value ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, fontSize: 12 }}
                      onClick={() => setSlippage(value)}
                    >
                      {value}%
                    </button>
                  ))}
                </div>
                
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input"
                    style={{ paddingRight: 32 }}
                    placeholder="Custom percentage"
                    value={slippage}
                    onChange={e => {
                      const val = e.target.value.replace(',', '.');
                      const num = parseFloat(val);
                      if (!isNaN(num) && num >= 0 && num <= 50) setSlippage(num);
                      else if (val === '' || val === '0' || val === '0.') setSlippage(0.5);
                    }}
                  />
                  <span className="text-secondary text-small" style={{ 
                    position: 'absolute', 
                    right: 'var(--spacing-md)', 
                    top: '50%', 
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none' 
                  }}>
                    %
                  </span>
                </div>
                
                <button
                  className="btn btn-primary"
                  onClick={() => setShowSettings(false)}
                >
                  Apply Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Swap Card */}
      <div className="card">
        {/* From Token Section */}
        <div className="stack" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div className="flex-between">
            <label className="text-small text-secondary">From</label>
            <div className="flex-center" style={{ gap: 'var(--spacing-xs)' }}>
              <span className="text-xs text-muted">
                Available: {formatNumber(parseFloat(sourceBalanceFormatted), 6)} {tokenFrom.symbol}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ 
                  fontSize: 10,
                  padding: '2px 6px',
                  height: 'auto',
                  color: 'var(--text-accent)'
                }}
                onClick={handleMax}
              >
                MAX
              </button>
            </div>
          </div>
          
          <div style={{
            display: 'flex',
            gap: 'var(--spacing-sm)',
            alignItems: 'center',
          }}>
            <button
              className="swap-token-selector"
              onClick={() => setShowFromSelector(true)}
              style={{
                minWidth: 120,
                background: 'var(--card-bg-light)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--spacing-md)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-sm)',
              }}
            >
              <TokenIcon symbol={tokenFrom.symbol} size={32} />
              <div style={{ textAlign: 'left' }}>
                <div className="text-small" style={{ fontWeight: 600 }}>
                  {tokenFrom.symbol}
                </div>
                <div className="text-xs text-muted">
                  {tokenFrom.name.length > 12 ? tokenFrom.name.slice(0, 12) + '...' : tokenFrom.name}
                </div>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            
            <input
              className="input"
              style={{
                flex: 1,
                textAlign: 'right',
                fontSize: 20,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
              }}
              placeholder="0.00"
              value={amountIn}
              onChange={e => setAmountIn(e.target.value)}
              inputMode="decimal"
            />
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="flex-center" style={{ margin: 'var(--spacing-sm) 0' }}>
          <button
            onClick={handleSwapTokens}
            disabled={isLoadingQuote}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--card-bg-light)',
              border: '2px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontSize: 20,
              color: 'var(--text-secondary)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ 
              transform: isLoadingQuote ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.3s ease'
            }}>
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>

        {/* To Token Section */}
        <div className="stack">
          <label className="text-small text-secondary">To</label>
          
          <div style={{
            display: 'flex',
            gap: 'var(--spacing-sm)',
            alignItems: 'center',
          }}>
            <button
              className="swap-token-selector"
              onClick={() => setShowToSelector(true)}
              style={{
                minWidth: 120,
                background: 'var(--card-bg-light)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--spacing-md)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-sm)',
              }}
            >
              <TokenIcon symbol={tokenTo.symbol} size={32} />
              <div style={{ textAlign: 'left' }}>
                <div className="text-small" style={{ fontWeight: 600 }}>
                  {tokenTo.symbol}
                </div>
                <div className="text-xs text-muted">
                  {tokenTo.name.length > 12 ? tokenTo.name.slice(0, 12) + '...' : tokenTo.name}
                </div>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            
            <div style={{
              flex: 1,
              padding: 'var(--spacing-lg) var(--spacing-md)',
              background: quoteError ? 'var(--error-bg, rgba(239,68,68,0.08))' : 'var(--card-bg-light)',
              border: quoteError ? '1px solid var(--error, #ef4444)' : '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              textAlign: 'right',
              fontSize: quoteError ? 12 : 20,
              fontWeight: 600,
              minHeight: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}>
              {isLoadingQuote ? (
                <div className="spinner-accent" style={{ width: 20, height: 20 }} />
              ) : quoteError ? (
                <span style={{ color: 'var(--error, #ef4444)', fontWeight: 500, textAlign: 'right' }}>
                  ⚠️ {quoteError}
                </span>
              ) : formattedQuote ? (
                <span>{formatOutputAmount(formattedQuote.amountOut, tokenTo.symbol)}</span>
              ) : (
                <span className="text-muted">0.00</span>
              )}
            </div>
          </div>
        </div>

        {/* Quote Details */}
        {formattedQuote && (
          <div className="card-light fade-in" style={{
            marginTop: 'var(--spacing-lg)',
            padding: 'var(--spacing-md)',
            background: 'var(--bg-secondary)',
          }}>
            <div className="stack-sm">
              {/* Stale quote warning */}
              {isQuoteStale && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-xs)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(255, 170, 0, 0.12)',
                  border: '1px solid rgba(255, 170, 0, 0.35)',
                }}>
                  <span style={{ fontSize: 12 }}>⚠️</span>
                  <span className="text-xs" style={{ color: '#f59e0b' }}>
                    Quote is refreshing…
                  </span>
                  {isLoadingQuote && (
                    <div className="spinner-accent" style={{ width: 12, height: 12, marginLeft: 'auto' }} />
                  )}
                </div>
              )}

              <div className="flex-between">
                <span className="text-xs text-secondary">Exchange Rate</span>
                <span className="text-xs" style={{ fontWeight: 500 }}>{formattedQuote.rate}</span>
              </div>
              
              <div className="flex-between">
                <span className="text-xs text-secondary">Network Fee</span>
                <span className="text-xs text-accent" style={{ fontWeight: 500 }}>Sponsored ✨</span>
              </div>
              
              <div className="flex-between">
                <span className="text-xs text-secondary">Price Impact</span>
                <span className="text-xs text-accent" style={{ fontWeight: 500 }}>
                  {formattedQuote.priceImpact}
                </span>
              </div>
              
              <div 
                className="flex-between"
                style={{ 
                  paddingTop: 'var(--spacing-sm)', 
                  borderTop: '1px solid var(--border-light)',
                  marginTop: 'var(--spacing-sm)'
                }}
              >
                <span className="text-xs text-secondary">Minimum received</span>
                <span className="text-xs" style={{ fontWeight: 600 }}>
                  {formatOutputAmount(String(parseFloat(formattedQuote.amountOut) * (100 - slippage) / 100), tokenTo.symbol)} {tokenTo.symbol}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Button */}
      {!txHash && (
        <div className="mt-auto">
          {threshold <= 1 ? (
            <SlideToConfirm
              label="Slide to convert"
              disabled={!canSwap}
              onConfirm={handleSwap}
            />
          ) : (
            <button 
              className="btn btn-primary" 
              onClick={handleSwap} 
              disabled={!canSwap || swapStatus.includes('...')}
            >
              {swapStatus.includes('...') ? (
                <>
                  <div className="spinner" />
                  {swapStatus}
                </>
              ) : (
                'Convert Tokens'
              )}
            </button>
          )}
        </div>
      )}

      {/* Success State */}
      {txHash && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <div className="flex-center" style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--accent)',
            margin: '0 auto var(--spacing-lg)',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          
          <h3 className="text-title" style={{ marginBottom: 'var(--spacing-sm)' }}>
            Conversion Complete!
          </h3>
          
          <p className="text-secondary" style={{ marginBottom: 'var(--spacing-md)' }}>
            {amountIn} {tokenFrom.symbol} → {formattedQuote ? formatTokenAmount(parseFloat(formattedQuote.amountOut), tokenTo.symbol) : '?'} {tokenTo.symbol}
          </p>
          
          <a 
            href={`${EXPLORER}/tx/${txHash}`} 
            target="_blank" 
            rel="noreferrer" 
            className="text-accent text-small"
            style={{ 
              fontWeight: 500,
              marginBottom: 'var(--spacing-xl)',
              display: 'block'
            }}
          >
            View on Explorer ↗
          </a>
          
          <button 
            className="btn btn-primary" 
            onClick={() => { onBack(); resetSwap(); }}
          >
            Back to Wallet
          </button>
        </div>
      )}

      {/* Status Messages */}
      {swapStatus && !swapStatus.includes('...') && !txHash && (
        <div className="card fade-in">
          <p className="text-small">{swapStatus}</p>
        </div>
      )}

      {/* Share URL for Multi-sig */}
      {shareUrl && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <h3 className="text-heading" style={{ marginBottom: 'var(--spacing-md)' }}>
            Share for Approval
          </h3>
          <div className="action-buttons">
            <button 
              className="btn btn-secondary" 
              onClick={() => navigator.clipboard.writeText(shareUrl)}
            >
              📋 Copy Link
            </button>
            {typeof navigator.share === 'function' && (
              <button 
                className="btn btn-primary" 
                onClick={() => navigator.share({ url: shareUrl })}
              >
                📤 Share
              </button>
            )}
          </div>
        </div>
      )}

      {/* Token Selectors */}
      {showFromSelector && (
        <TokenSelector
          safeAddress={safe.address}
          selectedToken={tokenFrom}
          onSelect={token => {
            if (token.address !== tokenTo.address) {
              setTokenFrom(token);
            }
          }}
          onClose={() => setShowFromSelector(false)}
        />
      )}

      {showToSelector && (
        <TokenSelector
          safeAddress={safe.address}
          selectedToken={tokenTo}
          onSelect={token => {
            if (token.address !== tokenFrom.address) {
              setTokenTo(token);
            }
          }}
          onClose={() => setShowToSelector(false)}
        />
      )}
    </div>
  );
}