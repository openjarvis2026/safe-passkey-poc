import { type PendingTransaction, formatRelativeTime } from '../lib/history';
import { formatTokenAmount } from '../lib/tokens';

interface Props {
  pendingTx: PendingTransaction;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function PendingTransactionItem({ pendingTx }: Props) {
  const { to, value, token, createdAt, threshold, signatureCount, shareUrl } = pendingTx;
  const formattedAmount = formatTokenAmount(BigInt(value), token);

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ url: shareUrl }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
  };

  return (
    <div className="card" style={{
      padding: '16px',
      marginBottom: '8px',
      borderLeft: '3px solid rgba(245, 158, 11, 0.6)',
      background: 'rgba(245, 158, 11, 0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '50%',
          background: 'rgba(245, 158, 11, 0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '18px', flexShrink: 0,
        }}>⏳</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Waiting for signatures
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>To {shortAddr(to)}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>·</span>
            <span style={{
              fontSize: '11px', fontWeight: 600, padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: 'var(--warning, #f59e0b)',
            }}>{signatureCount}/{threshold} signed</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>·</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{formatRelativeTime(createdAt)}</span>
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>−{formattedAmount}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{token.symbol}</div>
        </div>
      </div>

      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(226, 232, 240, 0.5)' }}>
        <button className="btn btn-ghost btn-sm" style={{
          fontSize: '13px', padding: '8px 12px', height: 'auto',
          color: 'var(--text-secondary)',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 'var(--radius-md)',
        }} onClick={handleShare}>
          <span style={{ fontSize: '11px' }}>📤</span>
          <span>Share for approval</span>
        </button>
      </div>
    </div>
  );
}
