import { useCallback, useEffect, useState } from 'react';
import { createAssemblyHistory } from './history.js';

export default function useAssemblyHistory(project, catalog, setProject) {
  const [history] = useState(() => createAssemblyHistory(project, catalog));
  const [, render] = useState(0);
  useEffect(() => {
    history.sync(project);
  }, [project, history]);
  const change = useCallback((next, options) => {
    setProject(current => history.change(current, next, options));
    render(count => count + 1);
  }, [history, setProject]);
  const undo = useCallback(() => {
    setProject(current => history.undo(current));
    render(count => count + 1);
  }, [history, setProject]);
  const redo = useCallback(() => {
    setProject(current => history.redo(current));
    render(count => count + 1);
  }, [history, setProject]);
  return { change, undo, redo, canUndo: history.matches(project) && history.canUndo, canRedo: history.matches(project) && history.canRedo };
}
