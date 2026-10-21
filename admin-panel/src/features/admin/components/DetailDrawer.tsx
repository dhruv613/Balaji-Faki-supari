import { useId, type ReactNode } from 'react';
import useModalDialog from '../lib/useModalDialog';

export interface DetailDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export default function DetailDrawer({
  open,
  title,
  subtitle,
  onClose,
  footer,
  children,
}: DetailDrawerProps) {
  const titleId = useId();
  const dialogRef = useModalDialog<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="admin-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="admin-drawer">
        <header className="admin-drawer__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="text-small text-secondary">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn--outline btn--sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="admin-drawer__body">{children}</div>
        {footer && <footer className="admin-drawer__footer">{footer}</footer>}
      </aside>
    </div>
  );
}
