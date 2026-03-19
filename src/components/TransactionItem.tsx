import { useState } from 'react';
import {
  type SafeTransaction,
  formatRelativeTime,
  getTransactionIcon,
  getTransactionTypeLabel
} from '../lib/history';
import { EXPLORER } from '../lib/relayer';
import { formatTokenAmount } from '../lib/tokens';
import { formatUnits } from 'viem';

interface Props {
  transaction: SafeTransaction;
  onResend?: (transaction: SafeTransaction) => void;
}

// Truncate address for display
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatSwapAmount(amount: bigint, decimals: number, symbol: string): string {
  const formatted = formatUnits(amount, decimals);
  const n = parseFloat(formatted);
  if (isNaN(n) || n === 0) return `0 ${symbol}`;
  const isStable = ['USDC', 'USDT', 'DAI'].includes(symbol);
  const display = isStable
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  return `${display} ${symbol}`;
}

export default function TransactionItem({ transaction, onResend }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { txHash, type, to, from, amount, token, timestamp, status, safe } = transaction;

  const isSwap = type === 'swap';

  // Determine the counterparty address (the other party in the transaction)
  const isOutgoing = type === 'send';
  const counterparty = isOutgoing ? to : from;
  const isCounterpartySafe = counterparty.toLowerCase() === safe.toLowerCase();

  // Format the amount for display
  const formattedAmount = formatTokenAmount(amount, token);
  const hasAmount = amount > 0n;

  // Transaction type styling
  const typeIcon = getTransactionIcon(type);
  const typeLabel = getTransactionTypeLabel(type);

  // Build swap title: "Swapped 1 ETH → 3,000 USDC"
  const getSwapTitle = () => {
    const { swapTokenIn, swapTokenOut, swapAmountIn, swapAmountOut } = transaction;
    if (swapTokenIn && swapTokenOut && swapAmountIn !== undefined && swapAmountOut !== undefined) {
      const inStr = formatSwapAmount(swapAmountIn, swapTokenIn.decimals, swapTokenIn.symbol);
      const outStr = formatSwapAmount(swapAmountOut, swapTokenOut.decimals, swapTokenOut.symbol);
      return `${inStr} → ${outStr}`;
    }
    return 'Swap';
  };

  // Create proper title
  const getTransactionTitle = () => {
    if (isSwap) return getSwapTitle();
    if (isCounterpartySafe) return typeLabel;
    return `${typeLabel} ${isOutgoing ? 'to' : 'from'} ${shortAddr(counterparty)}`;
  };

  // Icon styling based on transaction type
  const getIconStyle = () => {
    const baseStyle = {
      width: 48,
      height: 48,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 18,
      flexShrink: 0,
      fontWeight: 600,
    };

    switch (type) {
      case 'receive':
        return {
          ...baseStyle,
          background: 'rgba(16, 185, 129, 0.15)',
          color: 'var(--accent)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
        };
      case 'send':
        return {
          ...baseStyle,
          background: 'rgba(239, 68, 68, 0.15)',
          color: 'var(--danger)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        };
      case 'swap':
        return {
          ...baseStyle,
          background: 'rgba(99, 102, 241, 0.15)',
          color: 'var(--text-accent)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        };
      case 'thresholdChange':
        return {
          ...baseStyle,
          background: 'rgba(245, 158, 11, 0.15)',
          color: 'var(--warning)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
        };
      case 'ownerChange':
        return {
          ...baseStyle,
          background: 'rgba(99, 102, 241, 0.15)',
          color: 'var(--text-accent)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        };
      default:
        return {
          ...baseStyle,
          background: 'var(--card-bg-light)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        };
    }
  };

  // Status badge styling
  const getStatusStyle = () => {
    switch (status) {
      case 'confirmed':
        return {
          background: 'rgba(16, 185, 129, 0.15)',
          color: 'var(--accent)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
        };
      case 'pending':
        return {
          background: 'rgba(245, 158, 11, 0.15)',
          color: 'var(--warning)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
        };
      case 'failed':
        return {
          background: 'rgba(239, 68, 68, 0.15)',
          color: 'var(--danger)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
        };
      default:
        return {
          background: 'var(--card-bg-light)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border)',
        };
    }
  };

  // Amount color based on transaction type
  const getAmountColor = () => {
    switch (type) {
      case 'receive':
        return 'var(--accent)';
      case 'swap':
        return 'var(--text-accent)';
      case 'send':
        return 'var(--text-primary)';
      default:
        return 'var(--text-primary)';
    }
  };

  const getAmountPrefix = () => {
    return type === 'receive' ? '+' : type === 'send' ? '−' : '';
  };

  const getStatusLabel = () => {
    if (isSwap && status === 'pending') return 'Swapping...';
    if (isSwap && status === 'confirmed') return 'Completed';
    switch (status) {
      case 'confirmed':
        return 'Confirmed';
      case 'pending':
        return 'Pending';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  // Swap detail rows
  const renderSwapDetails = () => {
    const { swapTokenIn, swapTokenOut, swapAmountIn, swapAmountOut, exchangeRate, protocolFee, protocolFeeToken } = transaction;
    if (!swapTokenIn || !swapTokenOut || swapAmountIn === undefined || swapAmountOut === undefined) return null;

    return (
      <div style={{
        marginTop: 'var(--spacing-md)',
        paddingTop: 'var(--spacing-md)',
        borderTop: '1px solid var(--border-light)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="text-xs text-secondary">You paid</span>
          <span className="text-xs" style={{ fontWeight: 600 }}>
            {formatSwapAmount(swapAmountIn, swapTokenIn.decimals, swapTokenIn.symbol)}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="text-xs text-secondary">You received</span>
          <span className="text-xs" style={{ fontWeight: 600, color: 'var(--accent)' }}>
            {formatSwapAmount(swapAmountOut, swapTokenOut.decimals, swapTokenOut.symbol)}
          </span>
        </div>

        {exchangeRate && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="text-xs text-secondary">Exchange Rate</span>
            <span className="text-xs" style={{ fontWeight: 500 }}>{exchangeRate}</span>
          </div>
        )}

        {protocolFee !== undefined && protocolFeeToken && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="text-xs text-secondary">Protocol Fee (0.5%)</span>
            <span className="text-xs" style={{ fontWeight: 500 }}>
              {formatSwapAmount(protocolFee, protocolFeeToken.decimals, protocolFeeToken.symbol)}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="text-xs text-secondary">Network Fee</span>
          <span className="text-xs" style={{ fontWeight: 500, color: 'var(--accent)' }}>Sponsored ✨</span>
        </div>

        {txHash && (
          <div style={{
            paddingTop: 6,
            borderTop: '1px solid var(--border-light)',
            marginTop: 2
          }}>
            <a
              href={`${EXPLORER}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs"
              style={{
                color: 'var(--text-accent)',
                textDecoration: 'none',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              onClick={e => e.stopPropagation()}
            >
              View on Explorer
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        padding: 'var(--spacing-md) 0',
        borderBottom: '1px solid var(--border-light)',
        transition: 'background 0.2s ease',
        cursor: isSwap ? 'pointer' : 'default',
      }}
      className={isSwap ? 'card-interactive' : undefined}
      onClick={isSwap ? () => setExpanded(prev => !prev) : undefined}
    >
      <div className="flex-center" style={{ gap: 'var(--spacing-md)' }}>
        {/* Transaction Icon */}
        <div style={getIconStyle()}>
          {typeIcon}
        </div>

        {/* Transaction Details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 4,
            lineHeight: 1.2,
            wordBreak: 'break-word',
          }}>
            {isSwap ? (
              <>
                <span className="text-secondary" style={{ fontWeight: 400, fontSize: 12 }}>Swapped </span>
                {getSwapTitle()}
              </>
            ) : getTransactionTitle()}
          </div>

          {/* Metadata */}
          <div className="flex-center" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="text-xs text-secondary">
              {formatRelativeTime(timestamp)}
            </span>

            <div style={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: 'var(--text-muted)',
              opacity: 0.5,
            }} />

            <div
              className="badge"
              style={{
                ...getStatusStyle(),
                fontSize: 10,
                padding: '2px 6px',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {isSwap && status === 'pending' && (
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--warning)',
                  animation: 'pulse 2s infinite',
                }} />
              )}
              {getStatusLabel()}
            </div>

            {/* Explorer Link (non-swap or collapsed swap) */}
            {txHash && !isSwap && (
              <>
                <div style={{
                  width: 3,
                  height: 3,
                  borderRadius: '50%',
                  background: 'var(--text-muted)',
                  opacity: 0.5,
                }} />
                <a
                  href={`${EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs"
                  style={{
                    color: 'var(--text-accent)',
                    textDecoration: 'none',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  View
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </>
            )}

            {/* Expand/collapse chevron for swap */}
            {isSwap && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  color: 'var(--text-muted)',
                  transform: expanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease',
                  flexShrink: 0,
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </div>
        </div>

        {/* Amount (non-swap only) */}
        {hasAmount && !isSwap && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 16,
              fontWeight: 700,
              color: getAmountColor(),
              lineHeight: 1.2,
              fontFamily: 'var(--font-body)',
            }}>
              {getAmountPrefix()}{formattedAmount}
            </div>
            <div className="text-xs text-secondary" style={{
              marginTop: 2,
              fontWeight: 500
            }}>
              {token.symbol}
            </div>
          </div>
        )}
      </div>

      {/* Swap expanded details */}
      {isSwap && expanded && renderSwapDetails()}

      {/* Action Buttons (non-swap) */}
      {type === 'send' && status === 'confirmed' && onResend && (
        <div style={{
          marginTop: 'var(--spacing-md)',
          paddingTop: 'var(--spacing-md)',
          borderTop: '1px solid var(--border-light)'
        }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{
              fontSize: 12,
              padding: '6px 12px',
              height: 'auto',
              color: 'var(--text-accent)',
              background: 'var(--card-bg-light)',
              border: '1px solid var(--border)',
              width: 'auto',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onResend(transaction);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Send Again
          </button>
        </div>
      )}
    </div>
  );
}
