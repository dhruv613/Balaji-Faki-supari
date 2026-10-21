import { useId, type ReactNode } from 'react';
import useModalDialog from '../lib/useModalDialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'dark' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const dialogRef = useModalDialog<HTMLDivElement>(open, onCancel, !busy);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="admin-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="admin-modal">
        <h2 id={titleId}>{title}</h2>
        <div className="text-secondary" style={{ marginBottom: children ? 16 : 0 }}>
          {description}
        </div>
        {children}
        <div className="admin-modal__actions">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--sm ${tone === 'dark' ? 'btn--dark' : 'btn--primary'}`}
            style={
              tone === 'danger'
                ? { background: '#B42318', borderColor: '#B42318', color: '#fff' }
                : undefined
            }
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
