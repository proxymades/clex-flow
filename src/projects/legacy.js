// Old connections remain visible and removable, but cannot create new connections.
export const LEGACY_COLOR = '#d6ac6c';
export const LEGACY_MESSAGE = 'Связь из старого проекта. Замените её событием или подключите доступный выход данных.';
export function legacyPorts(node, graph, ports) {
  const result = { inputs: [...ports.inputs], outputs: [...ports.outputs] };
  for (const edge of graph.edges.filter(edge => edge.legacy)) {
    for (const [direction, id, handle, label] of [
      ['inputs', edge.target, edge.targetHandle, edge.legacy.targetName],
      ['outputs', edge.source, edge.sourceHandle, edge.legacy.sourceName],
    ]) {
      if (id !== node.id || result[direction].some(port => port.id === handle)) continue;
      result[direction].push({ id: handle, name: label, type: edge.dataType, legacy: true, description: edge.legacy.message });
    }
  }
  return result;
}
export function assertNoLegacy(project) {
  if (project.logic.edges.some(edge => edge.legacy) || project.logic.nodes.some(node => node.legacy))
    throw new Error('Перед сборкой замените старые связи и блоки, отмеченные предупреждениями в «Логике». Проект можно редактировать и сохранять.');
}
