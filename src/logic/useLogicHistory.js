import { useCallback, useEffect, useState } from 'react';
import { createHistory } from './history.js';

export default function useLogicHistory(graph, onChange) {
  const [history] = useState(() => createHistory(graph));
  const [, render] = useState(0);
  useEffect(() => {
    if (JSON.stringify(history.current) !== JSON.stringify(graph)) history.reset(graph);
  }, [graph, history]);
  const publish = useCallback(value => { onChange(value); render(count => count + 1); }, [onChange]);
  return {
    change: (next, options) => publish(history.change(next, options)),
    begin: () => history.begin(),
    end: () => { history.end(); render(count => count + 1); },
    undo: () => publish(history.undo()), redo: () => publish(history.redo()),
    canUndo: history.canUndo, canRedo: history.canRedo,
  };
}
