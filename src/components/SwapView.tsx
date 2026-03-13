import { useState, useEffect } from 'react';
import { type SavedSafe } from '../lib/storage';
import { type Token, NATIVE_TOKEN, TOKENS, getTokenBalances, type TokenBalance } from '../lib/tokens';
import { getSwapQuote, encodeSwapTransaction, formatSwapQuote, type SwapQuote } from '../lib/swap';
import { getNonce, execTransaction } from '../lib/safe';
import { EXPLORER } from '../lib/relayer';
import { savePendingTransaction } from '../lib/history';
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
  const [tokenFrom, setTokenFrom] = useState<Token>(NATIVE_TOKEN);
  const [tokenTo, setTokenTo] = useState<Token>(TOKENS.find(t => t.symbol === 'USDC') || TOKENS[1]);
  const [amountIn, setAmountIn] = useState('');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);
  const [swapStatus, setSwapStatus] = useState('');
  const [slippage, setSlippage] = useState(0.5); // 0.5% default slippage
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

  // Debounced quote fetching
  useEffect(() => {
    if (!amountIn || parseFloat(amountIn) <= 0 || tokenFrom.address === tokenTo.address) {
      setQuote(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoadingQuote(true);
      try {
        const newQuote = await getSwapQuote(tokenFrom, tokenTo, amountIn);
        setQuote(newQuote);
      } catch (error) {
        console.error('Error fetching quote:', error);
        setQuote(null);
      } finally {
        setIsLoadingQuote(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [amountIn, tokenFrom, tokenTo]);

  const handleSwapTokens = () => {
    const temp = tokenFrom;
    setTokenFrom(tokenTo);
    setTokenTo(temp);
    setAmountIn(''); // Clear amount when swapping
    setQuote(null);
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
      // Generate swap transaction
      const swapTx = encodeSwapTransaction(safe.address, quote, slippage);
      
      setSwapStatus('Signing transaction...');
      
      const nonce = await getNonce(safe.address);
      // MultiSend requires DELEGATECALL (operation=1)
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
          operation: 1, // DELEGATECALL for MultiSend
        };
        const encoded = encodeShareableTransaction(shareable);
        const url = `${window.location.origin}${window.location.pathname}#/sign?data=${encoded}`;
        setShareUrl(url);
        savePendingTransaction(safe.address, {
          id: `${safe.address}-${nonce}-${Date.now()}`,
          to: swapTx.to, value: swapTx.value.toString(), data: swapTx.data,
          token: tokenFrom,
          nonce: nonce.toString(),
          createdAt: new Date().toISOString(),
          threshold, signatureCount: 1, shareUrl: url,
        });
        setSwapStatus(`Swap signed (1/${threshold}). Share with other devices.`);
      }
    } catch (error: any) {
      setSwapStatus(`Error: ${error.message}`);
      console.error('Swap error:', error);
    }
  };

  const resetSwap = () => {
    setAmountIn('');
    setQuote(null);
    setSwapStatus('');
    setTxHash('');
    setShareUrl('');
  };

  const sourceBalance = balances.find(b => b.token.address.toLowerCase() === tokenFrom.address.toLowerCase());
  const sourceBalanceFormatted = sourceBalance ? sourceBalance.formattedBalance : '0';

  const handleMax = () => {
    if (!sourceBalance) return;
    let max = parseFloat(sourceBalance.formattedBalance);
    // Reserve gas buffer for ETH
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
    // Crypto: up to 6 decimals, trim trailing zeros
    if (amount > 0 && amount < 0.000001) return '< 0.000001';
    const formatted = amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
    return formatted;
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
  const canSwap = quote && amountIn && parseFloat(amountIn) > 0 && !isLoadingQuote;

  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button 
          className="btn btn-icon" 
          style={{ width: 44, height: 44, fontSize: 20 }} 
          onClick={() => { onBack(); resetSwap(); }}
        >
          ←
        </button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Convert</h2>
        <div style={{ marginLeft: 'auto' }}>
          <button 
            className="btn btn-icon" 
            style={{ width: 36, height: 36, fontSize: 14 }}
            onClick={() => setShowSettings(!showSettings)}
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="card fade-in">
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Settings</h3>
          <div>
            <label style={{ fontSize: 14, fontWeight: 500, marginBottom: 8, display: 'block' }}>
              Price Flexibility
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[0.1, 0.5, 1.0, 3.0].map(value => (
                <button
                  key={value}
                  className={`btn btn-sm ${slippage === value ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 12 }}
                  onClick={() => setSlippage(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
            <div style={{ position: 'relative', marginTop: 8 }}>
              <input
                type="text"
                inputMode="decimal"
                className="input"
                style={{ fontSize: 14, paddingRight: 32 }}
                placeholder="Custom"
                value={slippage}
                onChange={e => {
                  const val = e.target.value.replace(',', '.');
                  const num = parseFloat(val);
                  if (!isNaN(num) && num >= 0 && num <= 50) setSlippage(num);
                  else if (val === '' || val === '0' || val === '0.') setSlippage(0.5);
                }}
              />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>%</span>
            </div>
          </div>
        </div>
      )}

      {/* Swap Card */}
      <div className="card">
        {/* From Token */}
        <div className="swap-token-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>From</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Available: {formatNumber(parseFloat(sourceBalanceFormatted), 6)} {tokenFrom.symbol}
              </span>
              <button
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary-from)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                onClick={handleMax}
              >
                Max
              </button>
            </div>
          </div>
          
          <div className="swap-input-row">
            <button
              className="swap-token-selector"
              onClick={() => setShowFromSelector(true)}
            >
              <TokenIcon symbol={tokenFrom.symbol} size={32} />
              <div className="swap-token-info">
                <span className="swap-token-symbol">{tokenFrom.symbol}</span>
                <span className="swap-token-name">{tokenFrom.name}</span>
              </div>
              <span className="swap-dropdown-arrow">▼</span>
            </button>
            
            <input
              className="swap-amount-input"
              placeholder="0"
              value={amountIn}
              onChange={e => setAmountIn(e.target.value)}
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
            />
          </div>
        </div>

        {/* Swap Direction Button */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
          <button
            className="swap-direction-btn"
            onClick={handleSwapTokens}
            disabled={isLoadingQuote}
          >
            ↕
          </button>
        </div>

        {/* To Token */}
        <div className="swap-token-section">
          <div className="swap-section-header">
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>To</span>
          </div>
          
          <div className="swap-input-row">
            <button
              className="swap-token-selector"
              onClick={() => setShowToSelector(true)}
            >
              <TokenIcon symbol={tokenTo.symbol} size={32} />
              <div className="swap-token-info">
                <span className="swap-token-symbol">{tokenTo.symbol}</span>
                <span className="swap-token-name">{tokenTo.name}</span>
              </div>
              <span className="swap-dropdown-arrow">▼</span>
            </button>
            
            <div className="swap-amount-output">
              {isLoadingQuote ? (
                <div className="spinner" style={{ width: 16, height: 16 }} />
              ) : formattedQuote ? (
                <span>{formatOutputAmount(formattedQuote.amountOut, tokenTo.symbol)}</span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>0</span>
              )}
            </div>
          </div>
        </div>

        {/* Quote Details */}
        {formattedQuote && (
          <div className="swap-quote-details fade-in">
            <div className="swap-quote-row">
              <span>Exchange Rate</span>
              <span>{formattedQuote.rate}</span>
            </div>
            <div className="swap-quote-row">
              <span>Service Fee (0.5%)</span>
              <span>{formatTokenAmount(parseFloat(formattedQuote.feeAmount), tokenFrom.symbol)} {tokenFrom.symbol}</span>
            </div>
            <div className="swap-quote-row">
              <span>Rate variance</span>
              <span className="text-success">{formattedQuote.priceImpact}</span>
            </div>
            <div className="swap-quote-row">
              <span>You'll get at least</span>
              <span>{formatOutputAmount(String(parseFloat(formattedQuote.amountOut) * (100 - slippage) / 100), tokenTo.symbol)} {tokenTo.symbol}</span>
            </div>
          </div>
        )}
      </div>

      {/* Swap Button — hidden after success */}
      {!txHash && threshold <= 1 ? (
        <SlideToConfirm
          label="Slide to convert"
          disabled={!amountIn || parseFloat(amountIn) <= 0 || !quote || isLoadingQuote}
          onConfirm={handleSwap}
          testId="swap-slide"
        />
      ) : !txHash ? (
        <button 
          className="btn btn-primary" 
          onClick={handleSwap} 
          disabled={!canSwap || swapStatus === 'Preparing swap...' || swapStatus === 'Signing transaction...' || swapStatus === 'Executing swap...'}
        >
          {swapStatus === 'Preparing swap...' || swapStatus === 'Signing transaction...' || swapStatus === 'Executing swap...' ? (
            <>
              <div className="spinner" />
              {swapStatus}
            </>
          ) : (
            'Convert'
          )}
        </button>
      ) : null}

      {/* Success State */}
      {txHash && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Swap Complete!</p>
          <p className="text-secondary" style={{ fontSize: 14, marginBottom: 4 }}>
            {amountIn} {tokenFrom.symbol} → {formattedQuote ? formatTokenAmount(parseFloat(formattedQuote.amountOut), tokenTo.symbol) : '?'} {tokenTo.symbol}
          </p>
          <a 
            href={`${EXPLORER}/tx/${txHash}`} 
            target="_blank" 
            rel="noreferrer" 
            style={{ color: 'var(--primary-from)', fontSize: 14 }}
          >
            View on Explorer ↗
          </a>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => { onBack(); resetSwap(); }}>Done</button>
          </div>
        </div>
      )}

      {/* Status (non-success) */}
      {swapStatus && !swapStatus.includes('...') && !txHash && (
        <div className="card fade-in">
          <p style={{ fontSize: 14, marginBottom: 8 }}>{swapStatus}</p>
        </div>
      )}

      {/* Share URL for multi-sig */}
      {shareUrl && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Share for approval</p>
          <div className="row">
            <button 
              className="btn btn-secondary btn-sm flex-1" 
              onClick={() => navigator.clipboard.writeText(shareUrl)}
            >
              📋 Copy
            </button>
            {typeof navigator.share === 'function' && (
              <button 
                className="btn btn-primary btn-sm flex-1" 
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