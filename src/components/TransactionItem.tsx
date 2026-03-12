import { formatUnits } from 'viem';
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
}

// Truncate address for display
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Get token icon based on symbol
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

export default function TransactionItem({ transaction }: Props) {
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
  const iconColor = type === 'receive' ? 'var(--success)' : type === 'send' ? 'var(--danger)' : 'var(--text-secondary)';
  
  // Amount color based on transaction type
  const amountColor = type === 'receive' ? 'var(--success)' : type === 'send' ? 'var(--danger)' : 'var(--text-primary)';

  return (
    <div className="card" style={{ padding: '16px', marginBottom: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        {/* Transaction type icon */}
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          backgroundColor: iconColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          color: 'white',
          flexShrink: 0
        }}>
          {typeIcon}
        </div>
        
        {/* Transaction details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* First row: Title and Amount */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
              {getTransactionTitle()}
            </div>
            {hasAmount && (
              <div style={{ 
                fontSize: '16px', 
                fontWeight: 700, 
                color: amountColor,
                textAlign: 'right',
                flexShrink: 0,
                marginLeft: '8px'
              }}>
                {type === 'send' ? '-' : '+'}{formattedAmount} {token.symbol}
              </div>
            )}
          </div>
          
          {/* Second row: Timestamp and Status */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                {formatRelativeTime(timestamp)}
              </span>
              <a 
                href={`${EXPLORER}/tx/${txHash}`} 
                target="_blank" 
                rel="noreferrer" 
                className="tx-hash-link"
                style={{
                  fontSize: '12px',
                  color: 'var(--primary-from)',
                  textDecoration: 'none',
                  fontFamily: 'monospace'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {shortAddr(txHash)}
              </a>
            </div>
            
            {/* Status badge */}
            <div style={{
              padding: '4px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: status === 'confirmed' ? 'var(--success)' : status === 'pending' ? '#F59E0B' : 'var(--danger)',
              color: 'white'
            }}>
              {status === 'confirmed' && '✅ Confirmed'}
              {status === 'pending' && '⏳ Pending'}
              {status === 'failed' && '❌ Failed'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}