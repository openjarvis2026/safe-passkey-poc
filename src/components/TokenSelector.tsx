import { useState, useEffect } from 'react';
import { getTokenBalances, formatTokenAmount, formatUSDValue, type Token, type TokenBalance } from '../lib/tokens';
import TokenIcon from './TokenIcon';

interface Props {
  safeAddress: `0x${string}`;
  selectedToken: Token | null;
  onSelect: (token: Token) => void;
  onClose: () => void;
}

export default function TokenSelector({ safeAddress, selectedToken, onSelect, onClose }: Props) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchBalances = async () => {
      try {
        const tokenBalances = await getTokenBalances(safeAddress);
        setBalances(tokenBalances);
      } catch (error) {
        console.error('Error fetching token balances:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBalances();
  }, [safeAddress]);

  const handleSelect = (token: Token) => {
    onSelect(token);
    onClose();
  };

  // Filter tokens based on search query
  const filteredBalances = balances.filter(balance => {
    const query = searchQuery.toLowerCase();
    return (
      balance.token.symbol.toLowerCase().includes(query) ||
      balance.token.name.toLowerCase().includes(query)
    );
  });

  // Sort tokens: tokens with balance first, then by symbol
  const sortedBalances = filteredBalances.sort((a, b) => {
    const aHasBalance = parseFloat(a.formattedBalance) > 0;
    const bHasBalance = parseFloat(b.formattedBalance) > 0;
    
    if (aHasBalance && !bHasBalance) return -1;
    if (!aHasBalance && bHasBalance) return 1;
    
    return a.token.symbol.localeCompare(b.token.symbol);
  });

  return (
    <div className="token-selector-overlay">
      <div className="token-selector-modal slide-up">
        {/* Header */}
        <div className="token-selector-header">
          <h3 className="text-heading">Select Token</h3>
          <button 
            className="btn btn-ghost btn-sm" 
            style={{ width: 36, height: 36, padding: 0 }}
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ 
          padding: '0 var(--spacing-xl) var(--spacing-md)',
          borderBottom: '1px solid var(--border-light)'
        }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="input"
              placeholder="Search tokens..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                paddingLeft: 'calc(var(--spacing-md) + 20px + var(--spacing-sm))',
                fontSize: 14
              }}
            />
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
                position: 'absolute',
                left: 'var(--spacing-md)',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none'
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="token-selector-list">
            {[0, 1, 2, 3, 4].map(i => (
              <div 
                key={i} 
                className="token-selector-item"
                style={{ 
                  cursor: 'default',
                  opacity: 1 - (i * 0.1),
                  animation: `fadeIn 0.5s ease-out ${i * 0.1}s both`
                }}
              >
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
        ) : (
          <div className="token-selector-list">
            {sortedBalances.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: 'var(--spacing-2xl)',
                color: 'var(--text-secondary)'
              }}>
                <div style={{ 
                  fontSize: 32, 
                  marginBottom: 'var(--spacing-sm)',
                  opacity: 0.5 
                }}>
                  🔍
                </div>
                <p className="text-small">No tokens found</p>
                <p className="text-xs text-muted">
                  Try adjusting your search terms
                </p>
              </div>
            ) : (
              sortedBalances.map((balance, index) => {
                const { token, formattedBalance, usdValue } = balance;
                const hasBalance = parseFloat(formattedBalance) > 0;
                const isSelected = selectedToken?.address.toLowerCase() === token.address.toLowerCase();
                
                return (
                  <button
                    key={token.address}
                    className={`token-selector-item ${isSelected ? 'selected' : ''} ${!hasBalance ? 'zero-balance' : ''}`}
                    onClick={() => handleSelect(token)}
                    style={{
                      position: 'relative',
                      animation: `fadeIn 0.3s ease-out ${index * 0.05}s both`,
                      background: isSelected ? 'rgba(99, 102, 241, 0.1)' : undefined,
                      border: isSelected ? '1px solid var(--primary-from)' : undefined,
                    }}
                  >
                    <TokenIcon symbol={token.symbol} size={48} />
                    
                    <div className="token-info">
                      <div className="token-symbol" style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: hasBalance || isSelected ? 'var(--text-primary)' : 'var(--text-muted)'
                      }}>
                        {token.symbol}
                      </div>
                      <div className="token-name" style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
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
                      }}>
                        {hasBalance ? formatTokenAmount(balance.balance, token) : '0'}
                      </div>
                      {usdValue !== null && hasBalance ? (
                        <div className="balance-usd" style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          textAlign: 'right',
                          fontWeight: 500
                        }}>
                          {formatUSDValue(usdValue)}
                        </div>
                      ) : (
                        <div className="balance-usd" style={{
                          fontSize: 12,
                          color: 'var(--text-muted)',
                          textAlign: 'right',
                        }}>
                          No balance
                        </div>
                      )}
                    </div>

                    {/* Selection Indicator */}
                    {isSelected && (
                      <div style={{
                        position: 'absolute',
                        right: 'var(--spacing-md)',
                        color: 'var(--primary-from)',
                        fontWeight: 700,
                        fontSize: 18,
                        display: 'flex',
                        alignItems: 'center',
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}

                    {/* Hover Arrow */}
                    {!isSelected && (
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
                          position: 'absolute',
                          right: 'var(--spacing-md)',
                          opacity: 0.4,
                          transition: 'opacity 0.2s ease'
                        }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* Footer Info */}
        {!loading && sortedBalances.length > 0 && (
          <div style={{
            padding: 'var(--spacing-md) var(--spacing-xl)',
            borderTop: '1px solid var(--border-light)',
            background: 'var(--bg-secondary)',
          }}>
            <div className="flex-between">
              <span className="text-xs text-secondary">
                {sortedBalances.filter(b => parseFloat(b.formattedBalance) > 0).length} tokens with balance
              </span>
              <span className="text-xs text-muted">
                {sortedBalances.length} total
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}