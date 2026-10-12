import { useCallback, useEffect, useState } from 'react';
import { createHistory } from './history.js';

export default function useLogicHistory(graph, onChange, screens) {
  const [history] = useState(() => createHistory({...graph,_screens:screens},80,['_screens']));
  const [, render] = useState(0);
  useEffect(() => {
    const value={...graph,_screens:screens};
    if (JSON.stringify(history.current) !== JSON.stringify(value)) history.reset(value);
  }, [graph, screens, history]);
  const publish = useCallback(value => { const {_screens,...logic}=value;onChange(logic,_screens);render(count => count + 1); }, [onChange]);
  return {
    change: (next, options={}) => publish(history.change(current=>{
      const value=typeof next==='function'?next(current):next;
      return {...value,_screens:Object.hasOwn(options,'screens')?options.screens:current._screens};
    },options)),
    begin: () => history.begin(),
    end: () => { history.end(); render(count => count + 1); },
    undo: () => publish(history.undo()), redo: () => publish(history.redo()),
    canUndo: history.canUndo, canRedo: history.canRedo,
  };
}
