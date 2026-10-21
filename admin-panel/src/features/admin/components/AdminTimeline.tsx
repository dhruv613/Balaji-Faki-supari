import { formatDateTime } from '../lib/formatDateTime';

export interface TimelineEntry {
  id: string;
  label: string;
  timestamp: string;
  description: string;
  actor?: string;
  isCurrent?: boolean;
}

export default function AdminTimeline({ items }: { items: TimelineEntry[] }) {
  if (items.length === 0) {
    return <p className="text-secondary text-small">No history events recorded yet.</p>;
  }

  return (
    <ol className="timeline" style={{ marginTop: 12 }}>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <li
            key={item.id}
            className={`timeline__item ${isLast ? 'stepper__item--current' : 'stepper__item--done'}`}
          >
            <span className="stepper__circle" aria-hidden="true">
              {isLast ? '•' : '✓'}
            </span>
            <div>
              <strong>{item.label}</strong>
              <p className="text-small text-secondary">
                {formatDateTime(item.timestamp)}
                {item.actor ? ` · Actor: ${item.actor}` : ''}
              </p>
              <p style={{ marginTop: 2 }}>{item.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
