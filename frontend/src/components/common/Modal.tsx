import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible dialog: Escape and backdrop click close it, focus is kept inside and returned to the opener, page scroll is locked. */
export default function Modal({ labelledBy, closeLabel, onClose, children }: {
  labelledBy: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { close.current(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={dialog}>
        <button type="button" className="modal__close btn btn--sm" aria-label={closeLabel} onClick={onClose}>✕ Close</button>
        {children}
      </div>
    </div>
  );
}
