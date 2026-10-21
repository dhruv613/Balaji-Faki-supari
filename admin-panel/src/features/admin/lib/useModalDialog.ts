import { useEffect, useRef } from 'react';

/**
 * Keyboard behaviour shared by every Admin Panel dialog (confirm dialog, detail drawer,
 * image preview, profile modal):
 *  - on open: remember the opener and move focus into the dialog ([data-autofocus] first, else the first control);
 *  - Tab / Shift+Tab stay inside the dialog;
 *  - Escape closes it (unless `closeOnEscape` is false, e.g. while a request is running);
 *  - only the topmost open dialog reacts, so Escape in a confirmation opened from a drawer leaves the drawer open;
 *  - on close: focus returns to the opener if it is still on the page.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const openDialogs: symbol[] = [];

export function isTopmostDialog(token: symbol, stack: readonly symbol[] = openDialogs): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}

/**
 * Where Tab should go next so focus never leaves the dialog, or null to let the browser move focus normally.
 */
export function nextTabTarget<T>(params: {
  items: readonly T[];
  active: T | null;
  shiftKey: boolean;
  activeInside: boolean;
}): T | null {
  const { items, active, shiftKey, activeInside } = params;
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (shiftKey) return !activeInside || active === first ? last : null;
  return !activeInside || active === last ? first : null;
}

export default function useModalDialog<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  closeOnEscape = true,
) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const escapeRef = useRef(closeOnEscape);
  onCloseRef.current = onClose;
  escapeRef.current = closeOnEscape;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('admin-dialog');
    openDialogs.push(token);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;

    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
        : [];
    const preferred = node?.querySelector<HTMLElement>('[data-autofocus]');
    (preferred ?? focusables()[0] ?? node)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopmostDialog(token)) return;
      if (event.key === 'Escape') {
        if (escapeRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const target = nextTabTarget({
        items,
        active: document.activeElement as HTMLElement | null,
        shiftKey: event.shiftKey,
        activeInside: node.contains(document.activeElement),
      });
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openDialogs.indexOf(token);
      if (index >= 0) openDialogs.splice(index, 1);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  return ref;
}
