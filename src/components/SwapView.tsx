import { useState, useEffect } from 'react';
import { type SavedSafe } from '../lib/storage';
import { type Token, NATIVE_TOKEN, TOKENS } from '../lib/tokens';
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
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Swap Tokens</h2>
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
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Swap Settings</h3>
          <div>
            <label style={{ fontSize: 14, fontWeight: 500, marginBottom: 8, display: 'block' }}>
              Slippage Tolerance
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
            <input
              type="number"
              className="input"
              style={{ marginTop: 8, fontSize: 14 }}
              placeholder="Custom %"
              value={slippage}
              onChange={e => setSlippage(parseFloat(e.target.value) || 0.5)}
              min="0.01"
              max="50"
              step="0.01"
            />
          </div>
        </div>
      )}

      {/* Swap Card */}
      <div className="card">
        {/* From Token */}
        <div className="swap-token-section">
          <div className="swap-section-header">
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>From</span>
          </div>
          
          <div className="swap-input-row">
            <button
              className="swap-token-selector"
              onClick={() => setShowFromSelector(true)}
            >
              <div className="swap-token-icon">
                {tokenFrom.symbol === 'ETH' && '⚡'}
                {tokenFrom.symbol === 'USDC' && '💙'}
                {tokenFrom.symbol === 'USDT' && '💚'}
                {tokenFrom.symbol === 'WETH' && '🔷'}
              </div>
              <div className="swap-token-info">
                <span className="swap-token-symbol">{tokenFrom.symbol}</span>
                <span className="swap-token-name">{tokenFrom.name}</span>
              </div>
              <span className="swap-dropdown-arrow">▼</span>
            </button>
            
            <input
              className="swap-amount-input"
              placeholder="0.0"
              value={amountIn}
              onChange={e => setAmountIn(e.target.value)}
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
            />
          </div>
        </div>

        {/* Swap Direction Button */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0' }}>
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
              <div className="swap-token-icon">
                {tokenTo.symbol === 'ETH' && '⚡'}
                {tokenTo.symbol === 'USDC' && '💙'}
                {tokenTo.symbol === 'USDT' && '💚'}
                {tokenTo.symbol === 'WETH' && '🔷'}
              </div>
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
                <span>{parseFloat(formattedQuote.amountOut).toFixed(6)}</span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>0.0</span>
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
              <span>Protocol Fee (0.5%)</span>
              <span>{(() => { const fee = parseFloat(formattedQuote.feeAmount); return fee > 0 && fee < 0.000001 ? '< 0.000001' : fee.toFixed(6); })()} {tokenFrom.symbol}</span>
            </div>
            <div className="swap-quote-row">
              <span>Price Impact</span>
              <span className="text-success">{formattedQuote.priceImpact}</span>
            </div>
            <div className="swap-quote-row">
              <span>Min. Received</span>
              <span>{(parseFloat(formattedQuote.amountOut) * (100 - slippage) / 100).toFixed(6)} {tokenTo.symbol}</span>
            </div>
          </div>
        )}
      </div>

      {/* Swap Button */}
      {threshold <= 1 ? (
        <SlideToConfirm
          label="Slide to swap"
          disabled={!canSwap}
          onConfirm={handleSwap}
          testId="swap-slide"
        />
      ) : (
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
            'Swap Tokens'
          )}
        </button>
      )}

      {/* Success State */}
      {txHash && (
        <div className="card fade-in" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Swap Complete!</p>
          <p className="text-secondary" style={{ fontSize: 14, marginBottom: 4 }}>
            {amountIn} {tokenFrom.symbol} → {formattedQuote ? parseFloat(formattedQuote.amountOut).toFixed(6) : '?'} {tokenTo.symbol}
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