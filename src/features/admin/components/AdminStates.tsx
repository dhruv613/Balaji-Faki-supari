import type { ReactNode } from 'react';
import Notice from '../../../components/common/Notice';

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card" role="status" aria-label="Loading data">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="admin-skeleton" style={{ width: `${92 - idx * 8}%` }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="card empty-state">
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      <p className="text-secondary" style={{ maxWidth: 460, margin: '0 auto 16px' }}>
        {description}
      </p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Unable to load live data',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Notice
      tone="error"
      title={title}
      actions={
        onRetry ? (
          <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
            Retry request
          </button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}
