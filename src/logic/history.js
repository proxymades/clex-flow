const snapshot = graph => structuredClone({ nodes: graph.nodes, edges: graph.edges });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// История только узлов/связей. Панорама сохраняется, но не расходует Undo.
export function createHistory(initial, limit = 80) {
  let current = structuredClone(initial), past = [], future = [], transaction = null, group = null;
  const push = before => { past = [...past.slice(-limit + 1), before]; future = []; };
  return {
    get current() { return current; },
    get canUndo() { return past.length > 0 || Boolean(transaction && !same(transaction, snapshot(current))); },
    get canRedo() { return future.length > 0; },
    reset(graph) { current = structuredClone(graph); past = []; future = []; transaction = null; group = null; },
    begin() { transaction = snapshot(current); group = null; },
    end() { if (transaction && !same(transaction, snapshot(current))) push(transaction); transaction = null; group = null; return current; },
    change(next, options = {}) {
      const value = typeof next === 'function' ? next(current) : next;
      if (same(value, current)) return current;
      const before = snapshot(current), changed = !same(before, snapshot(value));
      const merge = options.group && group?.key === options.group && Date.now() - group.time < 800;
      if (changed && options.track !== false && !transaction && !merge) push(before);
      if (changed) future = [];
      group = changed && options.group ? { key: options.group, time: Date.now() } : null;
      current = structuredClone(value); return current;
    },
    undo() { if (transaction) this.end(); if (!past.length) return current; future.push(snapshot(current)); current = { ...current, ...past.pop() }; group = null; return current; },
    redo() { if (!future.length) return current; past.push(snapshot(current)); current = { ...current, ...future.pop() }; group = null; return current; },
  };
}
