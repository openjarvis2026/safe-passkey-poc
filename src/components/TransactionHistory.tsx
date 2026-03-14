import { useState, useEffect } from 'react';
import { type SafeTransaction, fetchTransactionHistory, fetchSafeNonce, type PendingTransaction, getPendingTransactions, cleanupExecutedPendingTxs } from '../lib/history';
import { TOKENS, type Token, NATIVE_TOKEN } from '../lib/tokens';
import TransactionItem from './TransactionItem';
import PendingTransactionItem from './PendingTransactionItem';
import TokenIcon from './TokenIcon';

interface Props {
  safeAddress: `0x${string}`;
  onBack: () => void;
  onResend?: (transaction: SafeTransaction) => void;
}

type FilterOption = 'all' | Token['address'];

export default function TransactionHistory({ safeAddress, onBack, onResend }: Props) {
  const [transactions, setTransactions] = useState<SafeTransaction[]>([]);
  const [pendingTxs, setPendingTxs] = useState<PendingTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<FilterOption>('all');
  
  // Shared fetch + cleanup logic
  const fetchAndCleanup = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError('');
    }
    
    try {
      const [txs, currentNonce] = await Promise.all([
        fetchTransactionHistory(safeAddress),
        fetchSafeNonce(safeAddress).catch(() => undefined),
      ]);
      setTransactions(txs);
      
      // Auto-cleanup pending txs whose nonce has been executed or is below current Safe nonce
      const confirmedNonces = new Set(
        txs.filter(t => t.status === 'confirmed' && t.nonce).map(t => t.nonce!).filter(Boolean)
      );
      cleanupExecutedPendingTxs(safeAddress, confirmedNonces, currentNonce);
      setPendingTxs(getPendingTransactions(safeAddress));
    } catch (err: any) {
      console.error('Failed to fetch transaction history:', err);
      if (showLoading) {
        setError(err.message || 'Failed to load transaction history');
      }
      setPendingTxs(getPendingTransactions(safeAddress));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Fetch transaction history
  useEffect(() => {
    fetchAndCleanup(true);
  }, [safeAddress]);

  // Poll every 30s to auto-update pending tx status
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAndCleanup(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [safeAddress]);
  
  // Filter transactions by selected token
  const filteredTransactions = transactions.filter(tx => {
    if (selectedFilter === 'all') return true;
    return tx.token.address.toLowerCase() === selectedFilter.toLowerCase();
  });
  
  // Get unique tokens that have transactions
  const tokensWithTransactions = Array.from(
    new Set(transactions.map(tx => tx.token.address.toLowerCase()))
  ).map(address => 
    TOKENS.find(token => token.address.toLowerCase() === address) || 
    transactions.find(tx => tx.token.address.toLowerCase() === address)?.token
  ).filter((token): token is Token => token !== undefined);
  
  // Show filter chips only if there are multiple tokens
  const showFilters = tokensWithTransactions.length > 1;

  const handleRetry = () => {
    setError('');
    fetchAndCleanup(true);
  };

  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div className="flex-center" style={{ gap: 'var(--spacing-md)' }}>
        <button 
          className="btn btn-icon"
          onClick={onBack}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2 className="text-title">Transaction History</h2>
        <div style={{ width: 48 }} /> {/* Spacer */}
      </div>
      
      {/* Filter Chips */}
      {showFilters && (
        <div className="filter-chips">
          <button
            className={`filter-chip ${selectedFilter === 'all' ? 'filter-chip-active' : ''}`}
            onClick={() => setSelectedFilter('all')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M7 12h10" />
              <path d="M10 18h4" />
            </svg>
            All
          </button>
          {tokensWithTransactions.map(token => (
            <button
              key={token.address}
              className={`filter-chip ${selectedFilter === token.address ? 'filter-chip-active' : ''}`}
              onClick={() => setSelectedFilter(token.address)}
            >
              <TokenIcon symbol={token.symbol} size={14} />
              <span>{token.symbol}</span>
            </button>
          ))}
        </div>
      )}
      
      {/* Content */}
      {loading ? (
        <div className="card">
          <div className="flex-center" style={{ 
            flexDirection: 'column',
            padding: 'var(--spacing-2xl)',
            gap: 'var(--spacing-md)'
          }}>
            <div className="spinner-accent" style={{ width: 24, height: 24 }} />
            <div style={{ textAlign: 'center' }}>
              <p className="text-small" style={{ fontWeight: 500, marginBottom: 4 }}>
                Loading transactions...
              </p>
              <p className="text-xs text-muted">
                Fetching your transaction history
              </p>
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="card">
          <div style={{ 
            textAlign: 'center', 
            padding: 'var(--spacing-2xl)',
            color: 'var(--text-secondary)'
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto var(--spacing-lg)',
              fontSize: 24,
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            
            <h3 className="text-heading text-danger" style={{ marginBottom: 'var(--spacing-sm)' }}>
              Failed to Load
            </h3>
            <p className="text-small text-secondary" style={{ 
              marginBottom: 'var(--spacing-lg)',
              maxWidth: 280,
              margin: '0 auto var(--spacing-lg)'
            }}>
              {error}
            </p>
            
            <button 
              className="btn btn-secondary"
              onClick={handleRetry}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              Try Again
            </button>
          </div>
        </div>
      ) : filteredTransactions.length === 0 && pendingTxs.length === 0 ? (
        <div className="card">
          <div style={{ 
            textAlign: 'center', 
            padding: 'var(--spacing-2xl)',
          }}>
            <div style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'var(--card-bg-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto var(--spacing-lg)',
              fontSize: 32,
              opacity: 0.7,
            }}>
              📜
            </div>
            
            <h3 className="text-heading" style={{ marginBottom: 'var(--spacing-sm)' }}>
              {selectedFilter === 'all' ? 'No Transactions Yet' : 'No Transactions Found'}
            </h3>
            
            <p className="text-small text-secondary" style={{ 
              marginBottom: 'var(--spacing-lg)',
              maxWidth: 280,
              margin: '0 auto var(--spacing-lg)',
              lineHeight: 1.5,
            }}>
              {selectedFilter === 'all' 
                ? 'Your transaction history will appear here once you start using your wallet.'
                : `No transactions found for ${tokensWithTransactions.find(t => t.address === selectedFilter)?.symbol || 'this token'}.`
              }
            </p>
            
            {selectedFilter !== 'all' && (
              <button 
                className="btn btn-ghost"
                onClick={() => setSelectedFilter('all')}
              >
                Show All Transactions
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="stack">
          {/* Pending Transactions Section */}
          {pendingTxs.length > 0 && (
            <div className="card" style={{ paddingBottom: 0 }}>
              <div style={{ 
                marginBottom: 'var(--spacing-lg)',
                paddingBottom: 'var(--spacing-md)',
                borderBottom: '1px solid var(--border-light)'
              }}>
                <div className="flex-center" style={{ gap: 'var(--spacing-sm)' }}>
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--warning)',
                    animation: 'pulse 2s infinite',
                  }} />
                  <h4 className="text-small" style={{ 
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Pending Transactions ({pendingTxs.length})
                  </h4>
                </div>
              </div>
              
              <div className="stack-sm">
                {pendingTxs.map((ptx, index) => (
                  <div 
                    key={ptx.id}
                    style={{ 
                      animation: `fadeIn 0.3s ease-out ${index * 0.1}s both`,
                      padding: 'var(--spacing-sm) 0'
                    }}
                  >
                    <PendingTransactionItem pendingTx={ptx} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completed Transactions */}
          {filteredTransactions.length > 0 && (
            <div className="card" style={{ paddingBottom: 0 }}>
              {(pendingTxs.length > 0 || selectedFilter !== 'all') && (
                <div style={{ 
                  marginBottom: 'var(--spacing-lg)',
                  paddingBottom: 'var(--spacing-md)',
                  borderBottom: '1px solid var(--border-light)'
                }}>
                  <h4 className="text-small" style={{ 
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {selectedFilter === 'all' ? 'Completed' : `${tokensWithTransactions.find(t => t.address === selectedFilter)?.symbol} Transactions`}
                  </h4>
                </div>
              )}
              
              <div>
                {filteredTransactions.map((tx, index) => (
                  <div 
                    key={tx.txHash}
                    style={{ 
                      animation: `fadeIn 0.3s ease-out ${(index + pendingTxs.length) * 0.05}s both`,
                    }}
                  >
                    <TransactionItem transaction={tx} onResend={onResend} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div style={{ 
            textAlign: 'center', 
            padding: 'var(--spacing-md) 0'
          }}>
            <p className="text-xs text-muted">
              {filteredTransactions.length === transactions.length ? (
                <>
                  {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} total
                  {pendingTxs.length > 0 && ` • ${pendingTxs.length} pending`}
                </>
              ) : (
                <>
                  Showing {filteredTransactions.length} of {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
                  {pendingTxs.length > 0 && ` • ${pendingTxs.length} pending`}
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}