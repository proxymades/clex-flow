export default function ResizeHandle({ axis = 'x', onResize, label }) {
  return <div className={`resize-handle ${axis}`} role="separator" aria-label={label} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} tabIndex={0}
    onKeyDown={event => { const amount = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 16 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -16 : 0; if (amount) { event.preventDefault(); onResize(amount); } }}
    onPointerDown={event => {
      event.preventDefault(); const element = event.currentTarget; element.setPointerCapture(event.pointerId);
      let previous = axis === 'x' ? event.clientX : event.clientY;
      const move = e => { const next = axis === 'x' ? e.clientX : e.clientY; onResize(next - previous); previous = next; };
      const stop = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', stop); element.removeEventListener('pointercancel', stop); element.removeEventListener('lostpointercapture', stop); };
      element.addEventListener('pointermove', move); element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop); element.addEventListener('lostpointercapture', stop);
    }} />;
}
