import { useCallback, useEffect, useRef, useState } from 'react';
import { createProject, sortedProjects, validateName } from './model.js';
import { withLogic } from '../logic/model.js';
import { createWriteQueue, acknowledgeWrite } from './writeQueue.js';
import * as storage from './storage.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function useProjects() {
  const [projects, setProjects] = useState([]), [active, setActiveState] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [damaged, setDamaged] = useState([]);
  const [notice, setNotice] = useState(''), [path, setPath] = useState('');
  const [autoState, setAutoState] = useState('idle'), [autoSaving, setAutoSaving] = useState(false);
  const activeRef = useRef(null), projectsRef = useRef([]), inFlight = useRef(false), autoInFlight = useRef(0);
  const timer = useRef(null), generation = useRef(0), paused = useRef(false), interacting = useRef(false), live = useRef(true);
  const [write] = useState(() => createWriteQueue(storage.saveProject));
  const saved = projects.find(project => project.id === active?.id);
  const dirty = Boolean(active && !same(active, saved));
  const isWriting = useCallback(() => inFlight.current || autoInFlight.current > 0, []);

  const cancelAuto = useCallback(() => { generation.current++; clearTimeout(timer.current); timer.current = null; }, []);
  const setActive = useCallback(value => {
    const previous = activeRef.current, next = typeof value === 'function' ? value(previous) : value;
    if (previous?.id !== next?.id || !same(previous?.logic, next?.logic)) { cancelAuto(); setAutoState('idle'); }
    activeRef.current = next; setActiveState(next);
  }, [cancelAuto]);

  useEffect(() => {
    live.current = true;
    let current = true;
    Promise.all([storage.listProjects(), storage.storagePath()]).then(([data, path]) => {
      if (current) { projectsRef.current = sortedProjects(data.projects); setProjects(projectsRef.current); setDamaged(data.errors); setPath(path); }
    }).catch(error => { if (current) setError(String(error.message || error)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; live.current = false; cancelAuto(); };
  }, [cancelAuto]);

  const persist = useCallback(async snapshot => {
    const project = { ...snapshot, name: validateName(snapshot.name), updatedAt: new Date().toISOString() };
    await write(project);
    if (!live.current) return project;
    projectsRef.current = sortedProjects([...projectsRef.current.filter(item => item.id !== project.id), project]);
    setProjects(projectsRef.current);
    // Подтверждение старой записи не заменяет новые правки формы.
    const acknowledged = acknowledgeWrite(activeRef.current, snapshot, project);
    if (acknowledged !== activeRef.current) { activeRef.current = acknowledged; setActiveState(acknowledged); }
    return project;
  }, [write]);

  const armAuto = useCallback(project => {
    cancelAuto();
    if (!project || !live.current || paused.current || interacting.current) return;
    const ticket = generation.current, id = project.id, signature = JSON.stringify(project.logic);
    setAutoState('waiting');
    timer.current = setTimeout(async () => {
      const snapshot = activeRef.current;
      if (!snapshot || snapshot.id !== id || JSON.stringify(snapshot.logic) !== signature || paused.current || interacting.current || ticket !== generation.current) return;
      if (same(snapshot, projectsRef.current.find(project => project.id === id))) { setAutoState('saved'); return; }
      autoInFlight.current++; setAutoSaving(true); setAutoState('saving');
      try {
        await persist(snapshot);
        if (live.current && ticket === generation.current && activeRef.current?.id === id) { setAutoState('saved'); setNotice('Граф сохранён автоматически'); setError(''); }
      } catch (error) {
        if (live.current && ticket === generation.current) { setAutoState('error'); setError(`Автосохранение не выполнено: ${String(error.message || error)}. Правки остаются в редакторе.`); }
      } finally { autoInFlight.current--; if (live.current) setAutoSaving(autoInFlight.current > 0); }
    }, 2000);
  }, [cancelAuto, persist]);

  const updateLogic = useCallback(logic => {
    const current = activeRef.current;
    if (!current || same(current.logic, logic)) return;
    const project = withLogic(current, logic);
    activeRef.current = project; setActiveState(project); armAuto(project);
  }, [armAuto]);
  const setLogicInteracting = useCallback(value => {
    if (interacting.current === value) return;
    interacting.current = value;
    if (value) cancelAuto();
    else {
      const current = activeRef.current, saved = projectsRef.current.find(project => project.id === current?.id);
      if (current && !same(current.logic, saved?.logic)) armAuto(current);
    }
  }, [armAuto, cancelAuto]);
  const pauseAutosave = useCallback(() => { paused.current = true; cancelAuto(); }, [cancelAuto]);
  const resumeAutosave = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    const current = activeRef.current, saved = projectsRef.current.find(project => project.id === current?.id);
    if (current && !same(current.logic, saved?.logic)) armAuto(current);
  }, [armAuto]);

  const run = useCallback(async task => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { return await task(); }
    catch (error) { setError(String(error.message || error)); return false; }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  }, []);

  const create = (name, description, boardId) => run(async () => {
    const project = await persist(createProject(name, description, boardId));
    setActive(project); setNotice('Проект создан и сохранён'); return true;
  });
  const save = useCallback(() => run(async () => {
    const snapshot = activeRef.current;
    if (!snapshot) return false;
    cancelAuto();
    await persist(snapshot); setAutoState('saved'); setNotice('Проект сохранён'); return true;
  }), [cancelAuto, persist, run]);
  const rename = (project, name) => run(async () => {
    const updated = await persist({ ...project, name: validateName(name) });
    if (activeRef.current?.id === project.id) setActive(updated);
    setNotice('Название обновлено'); return true;
  });
  const remove = project => run(async () => {
    if (activeRef.current?.id === project.id) cancelAuto();
    await storage.deleteProject(project.id);
    projectsRef.current = projectsRef.current.filter(item => item.id !== project.id); setProjects(projectsRef.current);
    if (activeRef.current?.id === project.id) setActive(null);
    setNotice('Проект удалён'); return true;
  });
  const openFile = () => run(async () => {
    let project = await storage.importProject();
    if (!project) return false;
    project = { ...project, id: crypto.randomUUID() };
    project = await persist(project); setActive(project); setNotice('Локальная копия проекта открыта'); return true;
  });
  const exportFile = () => run(async () => {
    if (!activeRef.current) return false;
    const result = await storage.exportProject(activeRef.current);
    if (result) setNotice('JSON проекта экспортирован'); return result;
  });
  return { projects, active, setActive, loading, busy, error, setError, damaged, notice, path, dirty, create, save, rename, remove, openFile, exportFile, updateLogic, setLogicInteracting, autoState, autoSaving, isWriting, pauseAutosave, resumeAutosave };
}
