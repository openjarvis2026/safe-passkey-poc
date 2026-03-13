import { 
  type SafeTransaction, 
  formatRelativeTime, 
  getTransactionIcon, 
  getTransactionTypeLabel 
} from '../lib/history';
import { EXPLORER } from '../lib/relayer';
import { formatTokenAmount } from '../lib/tokens';

interface Props {
  transaction: SafeTransaction;
  onResend?: (transaction: SafeTransaction) => void;
}

// Truncate address for display
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}


export default function TransactionItem({ transaction, onResend }: Props) {
  const { txHash, type, to, from, amount, token, timestamp, status, safe } = transaction;
  
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
  
  // Create proper title with space
  const getTransactionTitle = () => {
    if (isCounterpartySafe) {
      return typeLabel;
    }
    return `${typeLabel} ${isOutgoing ? 'to' : 'from'} ${shortAddr(counterparty)}`;
  };

  // Icon color based on transaction type
  const iconColor = type === 'receive' ? 'var(--success)' : type === 'send' ? 'var(--danger)' : type === 'thresholdChange' ? 'var(--warning, #f59e0b)' : 'var(--text-secondary)';
  
  // Amount color based on transaction type
  const amountColor = type === 'receive' ? 'var(--success)' : type === 'send' ? 'var(--danger)' : 'var(--text-primary)';

  return (
    <div className="card" style={{ padding: '16px', marginBottom: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Transaction type icon */}
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: type === 'receive' 
            ? 'rgba(52, 199, 89, 0.15)' 
            : type === 'send' 
              ? 'rgba(255, 59, 48, 0.15)' 
              : type === 'thresholdChange'
                ? 'rgba(245, 158, 11, 0.15)'
                : type === 'ownerChange'
                  ? 'rgba(99, 102, 241, 0.15)'
                  : 'rgba(142, 142, 147, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          color: iconColor,
          flexShrink: 0,
          fontWeight: 700
        }}>
          {typeIcon}
        </div>
        
        {/* Middle: title + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {getTransactionTitle()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {formatRelativeTime(timestamp)}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>·</span>
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: status === 'confirmed' ? 'rgba(52, 199, 89, 0.15)' : status === 'pending' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 59, 48, 0.15)',
              color: status === 'confirmed' ? 'var(--success)' : status === 'pending' ? 'var(--warning)' : 'var(--danger)'
            }}>
              {status === 'confirmed' ? 'Confirmed' : status === 'pending' ? 'Pending' : 'Failed'}
            </span>
          </div>
        </div>

        {/* Right: amount */}
        {hasAmount && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ 
              fontSize: '14px', 
              fontWeight: 700, 
              color: amountColor
            }}>
              {type === 'send' ? '−' : '+'}{formattedAmount}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {token.symbol}
            </div>
          </div>
        )}
      </div>
      
      {/* Send again button for outgoing transactions */}
      {type === 'send' && status === 'confirmed' && onResend && (
        <div style={{ 
          marginTop: '12px', 
          paddingTop: '12px', 
          borderTop: '1px solid rgba(226, 232, 240, 0.5)' 
        }}>
          <button 
            className="btn btn-ghost btn-sm" 
            style={{ 
              fontSize: '13px', 
              padding: '8px 12px',
              height: 'auto',
              color: 'var(--text-secondary)',
              background: 'rgba(248, 250, 252, 0.8)',
              border: '1px solid rgba(226, 232, 240, 0.8)',
              borderRadius: 'var(--radius-md)'
            }}
            onClick={() => onResend(transaction)}
          >
            <span style={{ fontSize: '11px' }}>↻</span>
            <span>Send again</span>
          </button>
        </div>
      )}
    </div>
  );
}