import { DEFAULT_BOARD_POSITION, DEFAULT_VIEWPORT } from '../assembly/model.js';

export const FORMAT_VERSION = 3;
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const validKey = value => typeof value === 'string' && KEY_PATTERN.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const semver = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const point = value => isObject(value) && ['x', 'y'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 5000);
const viewportValid = value => isObject(value) && ['x', 'y', 'zoom'].every(key => Number.isFinite(value[key])) && Math.abs(value.x) <= 50000 && Math.abs(value.y) <= 50000 && value.zoom >= 0.2 && value.zoom <= 3;

export function validateName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('Название должно содержать от 1 до 80 символов.');
  return value.trim();
}

export function createProject(name, description = '', boardId = 'waveshare-esp32-s3-eth') {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), name: validateName(name), description,
    formatVersion: FORMAT_VERSION, createdAt: now, updatedAt: now,
    boardId, boardSettings: boardId === 'waveshare-esp32-s3-eth' ? { camera: 'unknown' } : {},
    components: [], gpioAssignments: [],
    logic: { nodes: [], edges: [], viewport: { ...DEFAULT_VIEWPORT } },
    assembly: { positions: { board: { ...DEFAULT_BOARD_POSITION } }, connections: [], viewport: { ...DEFAULT_VIEWPORT } }, moduleVersions: {},
  };
}

export function migrateProject(project) {
  if (!isObject(project)) throw new Error('Ожидался объект проекта JSON.');
  if (project.formatVersion === 1) {
    if (project.boardId !== 'esp32-s3-generic' || !Array.isArray(project.components) || project.components.length || !Array.isArray(project.gpioAssignments) || project.gpioAssignments.length || !isObject(project.assembly) || !isObject(project.assembly.positions) || Object.keys(project.assembly.positions).length || !Array.isArray(project.assembly.connections) || project.assembly.connections.length || !isObject(project.moduleVersions) || Object.keys(project.moduleVersions).length) throw new Error('Неподдерживаемая схема в проекте формата 1. Исходный файл не изменён.');
    project = { ...project, formatVersion: 2, boardSettings: {}, assembly: { ...project.assembly, positions: { board: { ...DEFAULT_BOARD_POSITION } }, viewport: { ...DEFAULT_VIEWPORT } } };
  }
  if (project.formatVersion === 2) {
    if (!isObject(project.logic) || !Array.isArray(project.logic.nodes) || !Array.isArray(project.logic.edges) || project.logic.nodes.length || project.logic.edges.length) throw new Error('Проект формата 2 содержит неподдерживаемый граф. Исходный файл не изменён.');
    return { ...project, formatVersion: 3 };
  }
  return project;
}

export function validateProject(project) {
  if (!isObject(project)) throw new Error('Ожидался объект проекта JSON.');
  if (project.formatVersion !== FORMAT_VERSION) throw new Error(`Версия формата ${String(project.formatVersion)} не поддерживается. Ожидается версия 1, 2 или 3.`);
  if (typeof project.id !== 'string' || !ID_PATTERN.test(project.id)) throw new Error('Некорректный ID проекта.');
  validateName(project.name);
  if (typeof project.description !== 'string' || project.description.length > 4000) throw new Error('Описание должно содержать не более 4000 символов.');
  for (const field of ['createdAt', 'updatedAt']) if (typeof project[field] !== 'string' || !Number.isFinite(Date.parse(project[field]))) throw new Error(`Некорректная дата ${field}.`);
  if (!validKey(project.boardId) || !isObject(project.boardSettings)) throw new Error('Некорректная плата или настройки платы.');
  if (!Object.entries(project.boardSettings).every(([key, value]) => validKey(key) && typeof value === 'string')) throw new Error('Некорректные настройки платы.');
  if (!Array.isArray(project.components) || project.components.length > 100 || !Array.isArray(project.gpioAssignments)) throw new Error('Некорректные компоненты или назначения GPIO.');
  const ids = new Set();
  for (const component of project.components) {
    if (!isObject(component) || !validKey(component.id) || component.id === 'board' || ids.has(component.id) || !validKey(component.moduleId) || !semver(component.moduleVersion) || !isObject(component.parameters)) throw new Error('Некорректный или повторяющийся компонент.');
    validateName(component.name); ids.add(component.id);
    if (!Object.entries(component.parameters).every(([key, value]) => validKey(key) && (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)))) throw new Error('Некорректные параметры компонента.');
  }
  if (!isObject(project.logic) || !Array.isArray(project.logic.nodes) || !Array.isArray(project.logic.edges) || !viewportValid(project.logic.viewport)) throw new Error('Некорректный граф логики или масштаб.');
  if (project.logic.nodes.length > 100 || project.logic.edges.length > 300) throw new Error('Превышен лимит графа логики.');
  const nodeIds = new Set(), edgeIds = new Set(), inputs = new Set();
  for (const node of project.logic.nodes) {
    if (!isObject(node) || !validKey(node.id) || nodeIds.has(node.id) || !validKey(node.moduleId) || !semver(node.moduleVersion) || !point(node.position) || !isObject(node.parameters)) throw new Error('Некорректный или повторяющийся блок логики.');
    validateName(node.name); nodeIds.add(node.id);
    if (!Object.entries(node.parameters).every(([key, value]) => validKey(key) && (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)))) throw new Error('Некорректные параметры логического блока.');
  }
  for (const edge of project.logic.edges) {
    const input = `${edge?.target}/${edge?.targetHandle}`;
    if (!isObject(edge) || !validKey(edge.id) || edgeIds.has(edge.id) || !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || !validKey(edge.sourceHandle) || !validKey(edge.targetHandle) || !['event','boolean','number','text'].includes(edge.dataType) || inputs.has(input)) throw new Error('Некорректная, повторяющаяся или осиротевшая связь логики.');
    edgeIds.add(edge.id); inputs.add(input);
  }
  const assembly = project.assembly;
  if (!isObject(assembly) || !isObject(assembly.positions) || !Array.isArray(assembly.connections) || assembly.connections.length > 200 || !viewportValid(assembly.viewport)) throw new Error('Некорректное описание монтажа.');
  if (!point(assembly.positions.board) || [...ids].some(id => !point(assembly.positions[id])) || Object.entries(assembly.positions).some(([id, position]) => (id !== 'board' && !ids.has(id)) || !point(position))) throw new Error('Некорректные позиции монтажа.');
  const wireIds = new Set(), endpoints = new Set();
  for (const wire of assembly.connections) {
    const key = `${wire?.componentId}/${wire?.terminalId}`;
    if (!isObject(wire) || !validKey(wire.id) || wireIds.has(wire.id) || !ids.has(wire.componentId) || !validKey(wire.terminalId) || !validKey(wire.boardPinId) || endpoints.has(key)) throw new Error('Некорректное, повторяющееся или осиротевшее соединение.');
    wireIds.add(wire.id); endpoints.add(key);
  }
  const assigned = new Set();
  for (const assignment of project.gpioAssignments) {
    const key = `${assignment?.componentId}/${assignment?.terminalId}`;
    if (!isObject(assignment) || !Number.isInteger(assignment.gpio) || assignment.gpio < 0 || assignment.gpio > 48 || [22,23,24,25].includes(assignment.gpio) || !['input','output'].includes(assignment.mode) || assigned.has(key) || !assembly.connections.some(wire => wire.componentId === assignment.componentId && wire.terminalId === assignment.terminalId && wire.boardPinId === assignment.pinId)) throw new Error('Некорректное назначение GPIO.');
    assigned.add(key);
  }
  if (!isObject(project.moduleVersions) || !Object.entries(project.moduleVersions).every(([key, value]) => validKey(key) && semver(value))) throw new Error('Некорректные версии модулей.');
  for (const component of [...project.components, ...project.logic.nodes]) if (project.moduleVersions[component.moduleId] !== component.moduleVersion) throw new Error('Версии модулей в проекте не совпадают с компонентами.');
  return project;
}

export function serializeProject(project) {
  validateProject(project);
  const json = JSON.stringify(project, null, 2) + '\n';
  if (new TextEncoder().encode(json).length > MAX_PROJECT_BYTES) throw new Error('Размер проекта превышает 2 МБ.');
  return json;
}

export function parseProject(contents) {
  if (new TextEncoder().encode(contents).length > MAX_PROJECT_BYTES) throw new Error('Размер проекта превышает 2 МБ.');
  let project;
  try { project = JSON.parse(contents); } catch { throw new Error('Файл не содержит корректный JSON.'); }
  return validateProject(migrateProject(project));
}

export function sortedProjects(projects) {
  return [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}
