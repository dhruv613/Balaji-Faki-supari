import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  subtitle?: string;
  to?: string;
  compact?: boolean;
}

export default function StatCard({ label, value, subtitle, to, compact }: StatCardProps) {
  const content = (
    <>
      <div className="stat-card__label">{label}</div>
      <div className={compact ? 'stat-card__value stat-card__value--sm' : 'stat-card__value'}>
        {value}
      </div>
      {(subtitle || to) && (
        <div className="stat-card__meta">
          <span>{subtitle}</span>
          {to && <span style={{ color: 'var(--color-primary-dark)', fontWeight: 600 }}>View →</span>}
        </div>
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="stat-card stat-card--link">
        {content}
      </Link>
    );
  }

  return <div className="stat-card">{content}</div>;
}
