import { gpioAssignments } from './model.js';
import { withLogic } from '../logic/model.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stateOf = project => {
  const { viewport: _viewport, ...assembly } = project.assembly;
  return { boardId: project.boardId, boardSettings: project.boardSettings, components: project.components, assembly };
};
const snapshot = project => structuredClone(stateOf(project));
const removedScreens = (before, after) => Object.fromEntries(before.components
  .filter(component => !after.components.some(item => item.id === component.id) && before.screens?.[component.id])
  .map(component => [component.id, structuredClone(before.screens[component.id])]));

// История монтажа не владеет графом, метаданными проекта или камерой холста.
// Экраны записываются только при их изменении самим действием (удаление дисплея).
export function createAssemblyHistory(initial, catalog, limit = 80) {
  let projectId = initial.id, current = snapshot(initial), past = [], future = [], group = null;
  const restore = (project, entry, direction) => {
    const state = structuredClone(entry[direction]);
    let next = { ...project, ...state, assembly: { ...state.assembly, viewport: project.assembly.viewport } };
    // При повторном удалении сохраняем и правки экрана, сделанные после отмены.
    Object.assign(entry.screens, removedScreens(project, next));
    const screens = { ...project.screens };
    let changedScreens = false;
    for (const component of project.components) if (!next.components.some(item => item.id === component.id) && Object.hasOwn(screens, component.id)) {
      delete screens[component.id]; changedScreens = true;
    }
    for (const component of next.components) if (!project.components.some(item => item.id === component.id) && entry.screens[component.id]) {
      screens[component.id] = structuredClone(entry.screens[component.id]); changedScreens = true;
    }
    if (changedScreens) next.screens = screens;
    next = withLogic(next, project.logic);
    next.gpioAssignments = gpioAssignments(next, catalog);
    current = snapshot(next);
    group = null;
    return next;
  };
  return {
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    matches(project) { return project.id === projectId && same(stateOf(project), current); },
    sync(project) {
      if (this.matches(project)) return false;
      projectId = project.id; current = snapshot(project); past = []; future = []; group = null;
      return true;
    },
    change(project, update, options = {}) {
      this.sync(project);
      const next = typeof update === 'function' ? update(project) : update;
      const after = snapshot(next);
      if (same(current, after)) return next;
      const entry = { before: current, after, screens: removedScreens(project, next) };
      const merge = options.group && group?.key === options.group && Date.now() - group.time < 800;
      if (merge && past.length) {
        const previous = past.at(-1);
        past[past.length - 1] = { before: previous.before, after, screens: { ...previous.screens, ...entry.screens } };
      } else past = [...past.slice(-limit + 1), entry];
      current = after; future = [];
      group = options.group ? { key: options.group, time: Date.now() } : null;
      return next;
    },
    undo(project) {
      this.sync(project);
      if (!past.length) return project;
      const entry = past.at(-1), next = restore(project, entry, 'before');
      past.pop(); future.push(entry);
      return next;
    },
    redo(project) {
      this.sync(project);
      if (!future.length) return project;
      const entry = future.at(-1), next = restore(project, entry, 'after');
      future.pop(); past.push(entry);
      return next;
    },
  };
}
