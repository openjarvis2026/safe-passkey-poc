import { useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import { getTokenBalances, formatTokenAmount, formatUSDValue, type TokenBalance } from '../lib/tokens';
import TokenIcon from './TokenIcon';

interface Props {
  safeAddress: `0x${string}`;
  ethBalance?: bigint;
  onTokenSelect?: (token: import('../lib/tokens').Token, balance: import('../lib/tokens').TokenBalance) => void;
}

export default function TokenList({ safeAddress, ethBalance, onTokenSelect }: Props) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch token balances
  useEffect(() => {
    const fetchBalances = async () => {
      try {
        setLoading(true);
        const tokenBalances = await getTokenBalances(safeAddress);
        setBalances(tokenBalances);
      } catch (error) {
        console.error('Error fetching token balances:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBalances();
    
    // Refresh balances every 30 seconds
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [safeAddress]);

  // Override ETH balance from parent if provided
  useEffect(() => {
    if (ethBalance !== undefined && balances.length > 0) {
      setBalances(prev => prev.map(b => {
        if (b.token.symbol === 'ETH') {
          return {
            ...b,
            balance: ethBalance,
            formattedBalance: formatUnits(ethBalance, b.token.decimals),
            usdValue: b.usdValue !== null && b.balance > 0n
              ? (b.usdValue / parseFloat(b.formattedBalance)) * parseFloat(formatUnits(ethBalance, b.token.decimals))
              : b.usdValue,
          };
        }
        return b;
      }));
    }
  }, [ethBalance]);

  // Calculate total portfolio value
  const totalUSD = balances.reduce((sum, balance) => {
    return sum + (balance.usdValue || 0);
  }, 0);

  if (loading) {
    return (
      <div className="card">
        <div className="flex-between" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div className="skeleton-shimmer" style={{ 
            height: 20, 
            width: 80, 
            borderRadius: 'var(--radius-sm)' 
          }} />
          <div className="skeleton-shimmer" style={{ 
            height: 16, 
            width: 60, 
            borderRadius: 'var(--radius-sm)' 
          }} />
        </div>

        <div className="token-list">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="token-item">
              <div className="skeleton-shimmer" style={{ 
                width: 48, 
                height: 48, 
                borderRadius: '50%',
                flexShrink: 0
              }} />
              
              <div className="token-info">
                <div className="skeleton-shimmer" style={{ 
                  height: 16, 
                  width: '60%', 
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 4
                }} />
                <div className="skeleton-shimmer" style={{ 
                  height: 12, 
                  width: '80%', 
                  borderRadius: 'var(--radius-sm)' 
                }} />
              </div>
              
              <div className="token-balance">
                <div className="skeleton-shimmer" style={{ 
                  height: 16, 
                  width: 60, 
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 4,
                  marginLeft: 'auto'
                }} />
                <div className="skeleton-shimmer" style={{ 
                  height: 12, 
                  width: 40, 
                  borderRadius: 'var(--radius-sm)',
                  marginLeft: 'auto'
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const ALWAYS_SHOW = ['ETH', 'USDT', 'USDC'];

  const allTokens = balances.filter(b => b.token.symbol !== 'WETH'); // Hide WETH

  // Always show ETH, USDT, USDC (even with 0 balance) + any token with balance
  const visibleTokens = allTokens.filter(b => {
    const hasBalance = parseFloat(b.formattedBalance) > 0;
    const isPinned = ALWAYS_SHOW.includes(b.token.symbol);
    return isPinned || hasBalance;
  // Sort: pinned order first, then by USD value
  }).sort((a, b) => {
    const aPin = ALWAYS_SHOW.indexOf(a.token.symbol);
    const bPin = ALWAYS_SHOW.indexOf(b.token.symbol);
    const aIsPinned = aPin !== -1;
    const bIsPinned = bPin !== -1;
    // Both pinned → keep ALWAYS_SHOW order
    if (aIsPinned && bIsPinned) return aPin - bPin;
    // Pinned first
    if (aIsPinned) return -1;
    if (bIsPinned) return 1;
    // Rest by USD value descending
    return (b.usdValue || 0) - (a.usdValue || 0);
  });

  return (
    <div className="card">
      {/* Header */}
      <div className="flex-between" style={{ marginBottom: 'var(--spacing-lg)' }}>
        <h3 className="text-heading">Assets</h3>
        {totalUSD > 0 && (
          <span className="text-secondary text-small" style={{ fontWeight: 500 }}>
            {formatUSDValue(totalUSD)}
          </span>
        )}
      </div>

      {/* Token List */}
      <div className="token-list">
        {visibleTokens.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: 'var(--spacing-xl) var(--spacing-lg)',
            color: 'var(--text-secondary)'
          }}>
            <div style={{ 
              fontSize: 32, 
              marginBottom: 'var(--spacing-sm)',
              opacity: 0.5 
            }}>
              💳
            </div>
            <p className="text-small">No tokens yet</p>
            <p className="text-xs text-muted">
              Receive tokens to see them here
            </p>
          </div>
        ) : (
          visibleTokens.map((balance, index) => {
            const { token, formattedBalance, usdValue } = balance;
            const hasBalance = parseFloat(formattedBalance) > 0;
            const isInteractive = !!onTokenSelect;
            
            return (
              <div 
                key={token.address} 
                className={`token-item ${!hasBalance ? 'token-item-zero' : ''} ${isInteractive ? 'card-interactive' : ''}`}
                onClick={() => onTokenSelect?.(token, balance)}
                style={{ 
                  cursor: isInteractive ? 'pointer' : 'default',
                  padding: 'var(--spacing-md) 0',
                  borderRadius: isInteractive ? 'var(--radius-lg)' : 0,
                  margin: isInteractive ? '0 calc(-1 * var(--spacing-md))' : 0,
                  paddingLeft: isInteractive ? 'var(--spacing-md)' : 0,
                  paddingRight: isInteractive ? 'var(--spacing-md)' : 0,
                  transition: 'all 0.2s ease',
                  animation: `fadeIn 0.3s ease-out ${index * 0.1}s both`,
                }}
              >
                <TokenIcon symbol={token.symbol} size={48} />
                
                <div className="token-info">
                  <div className="token-symbol" style={{ 
                    fontSize: 16, 
                    fontWeight: 600,
                    color: hasBalance ? 'var(--text-primary)' : 'var(--text-muted)'
                  }}>
                    {token.symbol}
                  </div>
                  <div className="token-name" style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    fontWeight: 400
                  }}>
                    {token.name}
                  </div>
                </div>
                
                <div className="token-balance">
                  <div className="balance-amount" style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: hasBalance ? 'var(--text-primary)' : 'var(--text-muted)',
                    textAlign: 'right',
                    fontFamily: hasBalance ? 'var(--font-body)' : 'var(--font-body)'
                  }}>
                    {hasBalance ? formatTokenAmount(balance.balance, token) : '0'}
                  </div>
                  {usdValue !== null && hasBalance && (
                    <div className="balance-usd" style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                      fontWeight: 500
                    }}>
                      {formatUSDValue(usdValue)}
                    </div>
                  )}
                  {!hasBalance && (
                    <div className="balance-usd" style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      textAlign: 'right'
                    }}>
                      No balance
                    </div>
                  )}
                </div>

                {/* Interactive arrow */}
                {isInteractive && hasBalance && (
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="var(--text-muted)" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    style={{ 
                      marginLeft: 'var(--spacing-sm)',
                      opacity: 0.6,
                      transition: 'opacity 0.2s ease'
                    }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* All tokens shown inline — no toggle needed */}
    </div>
  );
}