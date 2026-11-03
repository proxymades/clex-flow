import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, busy = false, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  const behavior = useRef({ onClose, busy });
  useEffect(() => { behavior.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]:not([disabled])')];
    (dialog.querySelector('input:not(:disabled), textarea:not(:disabled)') || focusable()[0])?.focus({ preventScroll: true });
    function keyDown(event) {
      if (event.key === 'Escape' && !behavior.current.busy) behavior.current.onClose();
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus({ preventScroll: true }); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }); }
      }
    }
    document.addEventListener('keydown', keyDown);
    return () => { document.removeEventListener('keydown', keyDown); previous?.focus({ preventScroll: true }); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Закрыть" onClick={onClose} disabled={busy}><X size={19} /></button></header>
      {children}
    </section>
  </div>;
}
