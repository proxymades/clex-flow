import { connectionProblem as physicalConnectionProblem, boardFor } from '../assembly/model.js';

export const PORT_TYPES = ['event', 'boolean', 'number', 'text'];
export const TYPE_NAMES = { event: 'Событие', boolean: 'Логическое', number: 'Число', text: 'Текст' };
export const TYPE_COLORS = { event: '#34d399', boolean: '#38bdf8', number: '#fbbf24', text: '#a78bfa' };
export const graphModule = (node, catalog) => catalog.modules.find(module => module.id === node.moduleId && module.kind === 'logic');
export const logicData = graph => ({ nodes: graph.nodes, edges: graph.edges });

export function withLogic(project, logic) {
  const versions = {};
  for (const element of [...project.components, ...logic.nodes]) {
    if (versions[element.moduleId] && versions[element.moduleId] !== element.moduleVersion) throw new Error('В проекте нельзя смешивать версии одного модуля.');
    versions[element.moduleId] = element.moduleVersion;
  }
  return { ...project, logic, moduleVersions: versions };
}

export function addNode(graph, module, components = []) {
  if (graph.nodes.length >= 100) throw new Error('В одном графе поддерживается до 100 блоков.');
  if (graph.nodes.some(node => node.moduleId === module.id && node.moduleVersion !== module.version)) throw new Error('Проект использует другую версию этого модуля.');
  const parameters = Object.fromEntries(Object.entries(module.parameters).map(([key, parameter]) => [key, parameter.default]));
  if (module.constraints.hardware) parameters.componentId = components.find(component => module.constraints.hardware.modules.includes(component.moduleId))?.id || '';
  let number = 1;
  while (graph.nodes.some(node => node.name === `${module.name} ${number}`)) number++;
  let slot = 0, position;
  do { position = { x: 60 + (slot % 2) * 330 + Math.floor(slot / 20) * 660, y: 100 + (Math.floor(slot / 2) % 10) * 310 }; slot++; }
  while (graph.nodes.some(node => node.position.x === position.x && node.position.y === position.y));
  return { ...graph, nodes: [...graph.nodes, { id: crypto.randomUUID(), moduleId: module.id, moduleVersion: module.version, name: `${module.name} ${number}`, position, parameters }] };
}

export function updateNode(graph, id, patch) {
  return { ...graph, nodes: graph.nodes.map(node => node.id === id ? { ...node, ...patch } : node) };
}

export function removeElements(graph, nodeIds = [], edgeIds = []) {
  const nodes = new Set(nodeIds), edges = new Set(edgeIds);
  return { ...graph, nodes: graph.nodes.filter(node => !nodes.has(node.id)), edges: graph.edges.filter(edge => !edges.has(edge.id) && !nodes.has(edge.source) && !nodes.has(edge.target)) };
}

export function selectionSnapshot(graph, ids) {
  const chosen = new Set(ids);
  return structuredClone({ nodes: graph.nodes.filter(node => chosen.has(node.id)), edges: graph.edges.filter(edge => chosen.has(edge.source) && chosen.has(edge.target)) });
}

export function pasteNodes(graph, snapshot) {
  if (!snapshot?.nodes.length) return { graph, ids: [] };
  if (graph.nodes.length + snapshot.nodes.length > 100 || graph.edges.length + snapshot.edges.length > 300) throw new Error('Превышен лимит графа: 100 блоков или 300 связей.');
  const mapping = new Map(snapshot.nodes.map(node => [node.id, crypto.randomUUID()]));
  const nodes = snapshot.nodes.map(node => ({ ...structuredClone(node), id: mapping.get(node.id), name: `${node.name.slice(0, 70)} (копия)`, position: { x: Math.min(5000, node.position.x + 40), y: Math.min(5000, node.position.y + 40) } }));
  const edges = snapshot.edges.map(edge => ({ ...edge, id: crypto.randomUUID(), source: mapping.get(edge.source), target: mapping.get(edge.target) }));
  return { graph: { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] }, ids: nodes.map(node => node.id) };
}

export function hasPath(edges, start, end, onlyEvents = false) {
  const visited = new Set(), pending = [start];
  while (pending.length) {
    const id = pending.pop();
    if (id === end) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...edges.filter(edge => edge.source === id && (!onlyEvents || edge.dataType === 'event')).map(edge => edge.target));
  }
  return false;
}

export function connectionProblem(graph, catalog, connection, ignoreId = null) {
  const source = graph.nodes.find(node => node.id === connection.source), target = graph.nodes.find(node => node.id === connection.target);
  if (!source || !target) return 'Оба блока соединения должны существовать.';
  if (source.id === target.id) return 'Нельзя соединить блок с самим собой.';
  const sourceModule = graphModule(source, catalog), targetModule = graphModule(target, catalog);
  if (!sourceModule || !targetModule || sourceModule.version !== source.moduleVersion || targetModule.version !== target.moduleVersion) return 'Соединение требует установленных совместимых версий модулей.';
  const output = sourceModule.outputs.find(port => port.id === connection.sourceHandle), input = targetModule.inputs.find(port => port.id === connection.targetHandle);
  if (!output || !input) return 'Соединяйте выход блока со входом; выбранный порт отсутствует.';
  if (output.type !== input.type) return `Несовместимые типы: ${TYPE_NAMES[output.type]} → ${TYPE_NAMES[input.type]}.`;
  const remaining = graph.edges.filter(edge => edge.id !== ignoreId);
  if (remaining.some(edge => edge.source === source.id && edge.target === target.id && edge.sourceHandle === output.id && edge.targetHandle === input.id)) return 'Такое соединение уже существует.';
  if (remaining.some(edge => edge.target === target.id && edge.targetHandle === input.id)) return 'У входа может быть только одно соединение.';
  if (hasPath(remaining, target.id, source.id)) return 'Циклические связи не поддерживаются в первой версии.';
  return null;
}

export function connectNodes(graph, catalog, connection) {
  const problem = connectionProblem(graph, catalog, connection);
  if (problem) throw new Error(problem);
  if (graph.edges.length >= 300) throw new Error('В графе поддерживается до 300 связей.');
  const node = graph.nodes.find(node => node.id === connection.source);
  const dataType = graphModule(node, catalog).outputs.find(port => port.id === connection.sourceHandle).type;
  return { ...graph, edges: [...graph.edges, { id: crypto.randomUUID(), source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle, dataType }] };
}

export function hardwareBinding(node, project, catalog) {
  const module = graphModule(node, catalog), requirement = module?.constraints.hardware;
  if (!requirement) return { component: null, gpio: null, error: null };
  const component = project.components.find(component => component.id === node.parameters.componentId);
  if (!component || !requirement.modules.includes(component.moduleId)) return { component: null, gpio: null, error: 'Выберите подходящий компонент монтажа.' };
  const assignment = project.gpioAssignments.find(assignment => assignment.componentId === component.id && assignment.terminalId === requirement.terminal);
  if (!assignment || assignment.mode !== requirement.mode) return { component, gpio: null, error: 'Сначала назначьте GPIO этому компоненту во вкладке «Монтаж».' };
  const wire = project.assembly.connections.find(wire => wire.componentId === component.id && wire.terminalId === requirement.terminal && wire.boardPinId === assignment.pinId);
  if (!wire) return { component, gpio: assignment.gpio, error: 'Назначение GPIO не совпадает с монтажом.' };
  const problem = physicalConnectionProblem(project, catalog, component.id, requirement.terminal, assignment.pinId);
  const physicalModule = catalog.modules.find(module => module.id === component.moduleId);
  const grounded = physicalModule?.terminals.filter(terminal => terminal.kind === 'ground').every(terminal => {
    const wire = project.assembly.connections.find(wire => wire.componentId === component.id && wire.terminalId === terminal.id);
    return wire && !physicalConnectionProblem(project, catalog, component.id, terminal.id, wire.boardPinId);
  });
  return { component, gpio: assignment.gpio, error: problem || (!grounded ? 'Подключите общий контакт компонента к GND во вкладке «Монтаж».' : null) };
}

export function validateGraph(project, catalog) {
  const graph = project.logic, issues = [];
  const add = (severity, code, message, extra = {}) => issues.push({ severity, code, message, ...extra });
  if (!graph.nodes.length) add('warning', 'logic-empty', 'Граф логики пуст. Добавьте таймер и действие.');
  for (const node of graph.nodes) {
    const module = graphModule(node, catalog), fields = { nodeId: node.id };
    if (!module || module.version !== node.moduleVersion || module.compatibility.projectFormat !== 3 || !module.compatibility.targets.includes('esp32s3') || module.compatibility.espIdf !== boardFor(project, catalog)?.espIdfVersion) { add('error', 'logic-module', `${node.name}: модуль отсутствует или версия несовместима.`, fields); continue; }
    if (!node.name.trim()) add('error', 'logic-name', 'Укажите название блока.', fields);
    for (const [key, parameter] of Object.entries(module.parameters)) {
      const value = node.parameters[key];
      if (parameter.type === 'integer' && (!Number.isInteger(value) || value < parameter.min || value > parameter.max)) add('error', 'logic-parameter', `${node.name}: «${parameter.label}» должен быть целым числом ${parameter.min}-${parameter.max}.`, fields);
      if (parameter.type === 'boolean' && typeof value !== 'boolean') add('error', 'logic-parameter', `${node.name}: неверное логическое значение.`, fields);
      if (parameter.type === 'text' && (typeof value !== 'string' || value.length > parameter.maxLength)) add('error', 'logic-parameter', `${node.name}: текст не должен превышать ${parameter.maxLength} символов.`, fields);
    }
    const binding = hardwareBinding(node, project, catalog);
    if (binding.error) add('error', 'logic-hardware', `${node.name}: ${binding.error}`, fields);
    for (const port of module.inputs.filter(port => port.required)) if (!graph.edges.some(edge => edge.target === node.id && edge.targetHandle === port.id)) add('error', 'logic-input', `${node.name}: подключите вход «${port.name}».`, fields);
    if (module.id === 'clex.logic.timer' && !graph.edges.some(edge => edge.source === node.id && edge.dataType === 'event')) add('warning', 'timer-unused', `${node.name}: такт пока не подключён к действию.`, fields);
  }
  for (const edge of graph.edges) {
    const problem = connectionProblem(graph, catalog, edge, edge.id);
    if (problem) { add('error', 'logic-connection', problem, { edgeId: edge.id, nodeId: edge.target }); continue; }
    const source = graph.nodes.find(node => node.id === edge.source), port = graphModule(source, catalog).outputs.find(port => port.id === edge.sourceHandle);
    if (edge.dataType !== port.type) add('error', 'logic-type', 'Сохранённый тип связи не совпадает с типом портов.', { edgeId: edge.id });
    if (port.readyOn && !hasPath(graph.edges, source.id, edge.target, true)) add('error', 'logic-order', 'Значение должно передаваться после события «Готово» его источника. Соедините также события.', { edgeId: edge.id, nodeId: edge.target });
  }
  const roots = graph.nodes.filter(node => node.moduleId === 'clex.logic.timer').map(node => node.id);
  for (const node of graph.nodes.filter(node => node.moduleId !== 'clex.logic.timer')) if (!roots.some(root => hasPath(graph.edges, root, node.id, true))) add('warning', 'logic-unreachable', `${node.name}: нет событийного пути от таймера.`, { nodeId: node.id });
  return issues;
}
