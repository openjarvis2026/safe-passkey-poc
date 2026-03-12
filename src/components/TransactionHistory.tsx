import { useState, useEffect } from 'react';
import { type SafeTransaction, fetchTransactionHistory } from '../lib/history';
import { TOKENS, type Token, NATIVE_TOKEN } from '../lib/tokens';
import TransactionItem from './TransactionItem';

interface Props {
  safeAddress: `0x${string}`;
  onBack: () => void;
}

type FilterOption = 'all' | Token['address'];

// Get token icon for filter chips
function getTokenIcon(symbol: string): string {
  switch (symbol) {
    case 'ETH':
      return '⚡';
    case 'USDC':
      return '💙';
    case 'USDT':
      return '💚';
    case 'WETH':
      return '🔷';
    default:
      return '🪙';
  }
}

export default function TransactionHistory({ safeAddress, onBack }: Props) {
  const [transactions, setTransactions] = useState<SafeTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<FilterOption>('all');
  
  // Fetch transaction history
  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError('');
      
      try {
        const txs = await fetchTransactionHistory(safeAddress);
        setTransactions(txs);
      } catch (err: any) {
        console.error('Failed to fetch transaction history:', err);
        setError(err.message || 'Failed to load transaction history');
      } finally {
        setLoading(false);
      }
    };
    
    fetchHistory();
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

  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button 
          className="btn btn-icon" 
          style={{ width: 44, height: 44, fontSize: 20 }} 
          onClick={onBack}
        >
          ←
        </button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Transaction History</h2>
      </div>
      
      {/* Token Filter Chips */}
      {showFilters && (
        <div className="filter-chips">
          <button
            className={`filter-chip ${selectedFilter === 'all' ? 'filter-chip-active' : ''}`}
            onClick={() => setSelectedFilter('all')}
          >
            All
          </button>
          {tokensWithTransactions.map(token => (
            <button
              key={token.address}
              className={`filter-chip ${selectedFilter === token.address ? 'filter-chip-active' : ''}`}
              onClick={() => setSelectedFilter(token.address)}
            >
              <span style={{ fontSize: 14 }}>{getTokenIcon(token.symbol)}</span>
              <span>{token.symbol}</span>
            </button>
          ))}
        </div>
      )}
      
      {/* Transaction List */}
      {loading ? (
        <div className="card">
          <div className="tx-loading">
            <div className="spinner spinner-dark" style={{ width: 20, height: 20 }} />
            <span style={{ marginLeft: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
              Loading transactions...
            </span>
          </div>
        </div>
      ) : error ? (
        <div className="card">
          <div className="tx-error">
            <span style={{ fontSize: 18, marginBottom: 8 }}>⚠️</span>
            <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 4 }}>
              Failed to load transactions
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {error}
            </p>
            <button 
              className="btn btn-secondary btn-sm" 
              style={{ marginTop: 12 }}
              onClick={() => {
                setError('');
                setLoading(true);
                fetchTransactionHistory(safeAddress)
                  .then(setTransactions)
                  .catch(err => setError(err.message))
                  .finally(() => setLoading(false));
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="card">
          <div className="tx-empty">
            <span style={{ fontSize: 32, marginBottom: 12, opacity: 0.5 }}>📜</span>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              {selectedFilter === 'all' ? 'No transactions yet' : 'No transactions found'}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {selectedFilter === 'all' 
                ? 'Transactions will appear here once you start using your wallet'
                : `No transactions found for ${tokensWithTransactions.find(t => t.address === selectedFilter)?.symbol || 'this token'}`
              }
            </p>
            {selectedFilter !== 'all' && (
              <button 
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => setSelectedFilter('all')}
              >
                Show all transactions
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="transaction-list">
          {filteredTransactions.map(tx => (
            <TransactionItem key={tx.txHash} transaction={tx} />
          ))}
          
          {/* Show count */}
          <div style={{ padding: '16px 0 8px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Showing {filteredTransactions.length} of {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}