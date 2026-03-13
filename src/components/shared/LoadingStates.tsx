/** Standardized loading, empty, error, and skeleton states (UX-4) */

interface LoadingProps {
  text?: string;
}

export function LoadingSpinner({ text = 'Loading...' }: LoadingProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <div className="spinner" />
      <p className="text-muted" style={{ fontSize: 14 }}>{text}</p>
    </div>
  );
}

interface EmptyProps {
  icon?: string;
  title: string;
  message?: string;
}

export function EmptyState({ icon = '📭', title, message }: EmptyProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 }}>
      <p style={{ fontSize: 32 }}>{icon}</p>
      <p style={{ fontSize: 15, fontWeight: 600 }}>{title}</p>
      {message && <p className="text-muted" style={{ fontSize: 13, textAlign: 'center' }}>{message}</p>}
    </div>
  );
}

interface ErrorCardProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorCard({ message, onRetry }: ErrorCardProps) {
  return (
    <div className="card" style={{ borderColor: 'var(--danger)', borderWidth: 1, borderStyle: 'solid' }}>
      <div style={{ textAlign: 'center', padding: 16 }}>
        <p style={{ fontSize: 24, marginBottom: 8 }}>⚠️</p>
        <p style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 12 }}>{message}</p>
        {onRetry && (
          <button className="btn btn-secondary btn-sm" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function BalanceSkeleton() {
  return (
    <div className="card-gradient" style={{ textAlign: 'center' }}>
      <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>Total Balance</p>
      <div className="skeleton" style={{ width: 180, height: 40, margin: '0 auto', borderRadius: 8 }} />
      <div className="skeleton" style={{ width: 100, height: 16, margin: '8px auto 0', borderRadius: 4 }} />
    </div>
  );
}

export function TokenListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="skeleton" style={{ width: 80, height: 18, borderRadius: 4 }} />
      </div>
      <div className="stack">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 20 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: 80, height: 14, borderRadius: 4, marginBottom: 4 }} />
              <div className="skeleton" style={{ width: 50, height: 12, borderRadius: 4 }} />
            </div>
            <div>
              <div className="skeleton" style={{ width: 60, height: 14, borderRadius: 4, marginBottom: 4 }} />
              <div className="skeleton" style={{ width: 40, height: 12, borderRadius: 4, marginLeft: 'auto' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
