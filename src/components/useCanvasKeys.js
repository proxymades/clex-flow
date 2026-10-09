import { useEffect, useRef, useState } from 'react';

export default function useCanvasKeys({ onFit, onEscape, busy }) {
  const space = useRef(false), actions = useRef({ onFit, onEscape, busy });
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => { actions.current = { onFit, onEscape, busy }; }, [onFit, onEscape, busy]);
  useEffect(() => {
    const reset = () => { space.current = false; setSpaceHeld(false); };
    const keyDown = event => {
      if ((event.defaultPrevented && event.code !== 'Space') || actions.current.busy || document.querySelector('[role="dialog"]') || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space' && event.target.closest('button, [data-handleid], [data-terminal], [data-pin], [data-wire]')) return;
      if (event.code === 'Space') { event.preventDefault(); space.current = true; setSpaceHeld(true); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); actions.current.onFit(); }
      else if (event.key === 'Escape') actions.current.onEscape();
    };
    const keyUp = event => { if (event.code === 'Space') reset(); };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', reset);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', reset); };
  }, []);
  return { space, spaceHeld };
}
