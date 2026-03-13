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
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Activity History</h2>
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
              <TokenIcon symbol={token.symbol} size={16} />
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
            <span style={{ fontSize: 20, marginBottom: 8 }}>⚠️</span>
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
          {pendingTxs.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', paddingLeft: '4px' }}>
                ⏳ Pending
              </div>
              {pendingTxs.map(ptx => (
                <PendingTransactionItem key={ptx.id} pendingTx={ptx} />
              ))}
            </div>
          )}
          {filteredTransactions.map(tx => (
            <TransactionItem key={tx.txHash} transaction={tx} onResend={onResend} />
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