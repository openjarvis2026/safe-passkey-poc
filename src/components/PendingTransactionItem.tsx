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
      padding: 16,
      marginBottom: 8,
      borderLeft: '3px solid var(--warning)',
      background: 'var(--warning-light, rgba(245, 158, 11, 0.04))',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'var(--warning-light, rgba(245, 158, 11, 0.15))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>⏳</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Waiting for signatures
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <span className="text-muted text-xs">To {shortAddr(to)}</span>
            <span className="text-muted text-xs">·</span>
            <span className="badge" style={{
              fontSize: 12, fontWeight: 600,
              backgroundColor: 'var(--warning-light, rgba(245, 158, 11, 0.15))',
              color: 'var(--warning)',
            }}>{signatureCount}/{threshold} signed</span>
            <span className="text-muted text-xs">·</span>
            <span className="text-muted text-xs">{formatRelativeTime(createdAt)}</span>
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>−{formattedAmount}</div>
          <div className="text-muted text-xs" style={{ marginTop: 2 }}>{token.symbol}</div>
        </div>
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-ghost btn-sm" style={{
          fontSize: 12, padding: '8px 12px', height: 'auto',
          color: 'var(--text-secondary)',
          background: 'var(--warning-light, rgba(245, 158, 11, 0.08))',
          border: '1px solid var(--warning)',
          borderRadius: 'var(--radius-md)',
        }} onClick={handleShare}>
          📤 Share for approval
        </button>
      </div>
    </div>
  );
}
