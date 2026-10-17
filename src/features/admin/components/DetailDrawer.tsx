import { useEffect, type ReactNode } from 'react';

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
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="admin-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="admin-drawer">
        <header className="admin-drawer__header">
          <div>
            <h2 id="drawer-title">{title}</h2>
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
