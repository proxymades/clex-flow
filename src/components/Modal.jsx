import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, busy = false, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input, textarea, select, [tabindex="0"]')];
    (dialog.querySelector('input, textarea') || focusable()[0])?.focus();
    function keyDown(event) {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', keyDown);
    return () => { document.removeEventListener('keydown', keyDown); previous?.focus(); };
  }, [onClose, busy]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Закрыть" onClick={onClose} disabled={busy}><X size={19} /></button></header>
      {children}
    </section>
  </div>;
}
