import {compatibleVersion} from '../catalog/versions.js';
import { parseProject, serializeProject, MAX_PROJECT_BYTES } from './model.js';
import { nodePorts } from '../logic/model.js';
import { DEFAULT_BOARD_POSITION, DEFAULT_VIEWPORT } from '../assembly/model.js';
import { LEGACY_MESSAGE } from './legacy.js';
import { upgradeVoice } from './upgradeVoice.js';

const OUTPUTS = ['clex.logic.gpio-set', 'clex.logic.gpio-toggle', 'clex.logic.relay'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const oldLabels = {
  trigger:'Выполнить', value:'Задать состояние', level:'Высокий уровень?', state:'Выход включён?',
  rising:'Вход стал высоким', falling:'Вход стал низким', changed:'Состояние изменилось', done:'Выполнено',
  ready:'Радио готово?', online:'Устройство на связи?', result:'Условие выполнено?', valid:'Результат достоверен?',
  isBelow:'Ниже диапазона?', isInside:'В диапазоне?', isAbove:'Выше диапазона?',
  isConnected:'Есть соединение?', running:'Работает?', wanUp:'WAN имеет IP?', internet:'Интернет доступен?',
  apEnabled:'Точка доступа включена?', available:'Ресурс доступен?', link:'Есть соединение?', hasIp:'Есть IP-адрес?',
  success:'Успешно?', moving:'Движение выполняется?', enabled:'Обмотки включены?', retain:'Retain',
  rssiValid:'RSSI актуален?', statisticsValid:'Статистика актуальна?',
};
const label = (id,port) => oldLabels[id] || port?.name || id;

// Only replace a sampled Boolean when its update signal comes directly from the same source.
function predicate(node, handle, project) {
  if (node.moduleVersion !== '1.0.0' && node.moduleId !== 'clex.logic.espnow-control') return null;
  if (node.moduleId === 'clex.logic.compare-number') {
    const range = node.parameters.mode === 'range';
    const results = range ? ['below','inside','above'] : ['matched','unmatched'];
    const positive = { result:['matched'], isBelow:['below'], isInside:['inside'], isAbove:['above'], valid:results }[handle];
    if (!positive || positive.some(id => !results.includes(id))) return null;
    return { ready:['changed'], branches:[...results,'failed'].map(id => [id,positive.includes(id)]) };
  }
  if (['clex.logic.gpio-read','clex.logic.gpio-edge'].includes(node.moduleId) && ['level','activeState'].includes(handle)) {
    const component = project.components.find(c => c.id === node.parameters.componentId);
    if (!component || !['clex.hardware.button','clex.hardware.touch-button'].includes(component.moduleId)) return null;
    const high = handle==='activeState'||component.moduleId !== 'clex.hardware.button';
    return { ready:[node.moduleId === 'clex.logic.gpio-read' ? 'done' : 'changed'], branches:[['active',high],['inactive',!high]] };
  }
  if (['clex.logic.gpio-toggle','clex.logic.relay'].includes(node.moduleId) && handle === 'state')
    return { ready:['done'], branches:[['on',true],['off',false]] };
  if (node.moduleId === 'clex.logic.router') {
    const branches = { wanUp:[['wanConnected',true],['wanDisconnected',false]], internet:[['internetUp',true],['internetDown',false]], apEnabled:[['apStarted',true],['apStopped',false]] }[handle];
    if (branches) return { ready:['changed'], branches };
  }
  return null;
}

function upgrade(project, catalog) {
  const version = project?.formatVersion;
  if (![1,2,3].includes(version)) return project;
  let p = structuredClone(project);
  if (!Array.isArray(p.components) || !Array.isArray(p.logic?.nodes) || !Array.isArray(p.logic?.edges) ||
      [...p.components,...p.logic.nodes].some(n => !object(n) || !object(n.parameters)) || !object(p.assembly) || !object(p.moduleVersions))
    throw new Error('Некорректная структура старого проекта. Исходные данные сохранены.');
  if (version === 1) {
    p.boardSettings ??= {};
    p.assembly.positions = { board: { ...DEFAULT_BOARD_POSITION }, ...p.assembly.positions };
    p.assembly.viewport ??= { ...DEFAULT_VIEWPORT };
  }
  p.logic.viewport ??= { ...DEFAULT_VIEWPORT };
  p = upgradeVoice(p);
  for (const item of [...p.components,...p.logic.nodes]) {
    if (['clex.hardware.xgzp6897d','clex.logic.xgzp6897d'].includes(item.moduleId) && item.moduleVersion === '1.0.0') {
      item.moduleId = item.moduleId.replace('xgzp6897d','xgzp6847d');
      if (/^XGZP6897D(?: – Измерение)? \d+$/.test(item.name)) item.name = item.name.replace('XGZP6897D','XGZP6847D');
    }
  }
  for(const edge of p.logic.edges)if(edge.dataType==='boolean'&&edge.sourceHandle==='available'&&p.logic.nodes.some(n=>n.id===edge.source&&n.moduleId==='clex.logic.internet-check'&&n.moduleVersion==='1.0.0'))edge.sourceHandle='isAvailable';
  for(const edge of p.logic.edges)if(edge.dataType==='boolean'&&edge.sourceHandle==='level'){
    const source=p.logic.nodes.find(n=>n.id===edge.source);
    if(source?.moduleVersion==='1.0.0'&&['clex.logic.gpio-read','clex.logic.gpio-edge'].includes(source.moduleId)&&p.components.some(c=>c.id===source.parameters.componentId&&c.moduleId==='clex.hardware.touch-button'&&c.moduleVersion==='1.0.0'))edge.sourceHandle='activeState';
  }
  const originals = new Map(p.logic.nodes.map(node => [node.id,structuredClone(node)]));
  const nodes = new Map(p.logic.nodes.map(node => [node.id,node]));
  const oldEdges = structuredClone(p.logic.edges);
  const ids = new Set(p.logic.edges.map(edge => edge.id));
  function nextId(base) {
    let number = 1, id;
    do { id = String(base).slice(0,75) + '-upgrade-' + number++; } while (ids.has(id));
    ids.add(id); return id;
  }
  const events = (edge, branches, target = edge.target, targetHandle = null) => branches.map(([sourceHandle,value],i) =>
    ({ ...edge, id:i ? nextId(edge.id) : edge.id, sourceHandle, target, targetHandle:targetHandle ? targetHandle(value) : edge.targetHandle, dataType:'event' }));
  function replaceEdges(removed, added) {
    const remaining = p.logic.edges.filter(edge => !removed.includes(edge.id));
    if (remaining.length + added.length > 300) return false;
    p.logic.edges = [...remaining,...added]; return true;
  }
  const booleans = new Set();
  for (const [componentId,screen] of Object.entries(p.screens || {})) for (const element of screen.elements || []) {
    if (element.valueType !== 'boolean') continue;
    booleans.add(componentId + '/' + element.id);
  }
  for (const edge of oldEdges.filter(edge => edge.dataType === 'boolean')) {
    const source = originals.get(edge.source), target = originals.get(edge.target);
    if (!source || !target || target.moduleVersion !== '1.0.0') continue; // Unknown versions keep their original connections.
    const result = predicate(source,edge.sourceHandle,p);
    if (!result) continue;
    if (OUTPUTS.includes(target.moduleId) && edge.targetHandle === 'value' && (target.parameters.action || 'set') === 'set') {
      const triggers = oldEdges.filter(e => e.target === target.id && e.targetHandle === 'trigger');
      if (triggers.length !== 1 || triggers[0].source !== source.id || !result.ready.includes(triggers[0].sourceHandle)) continue;
      replaceEdges([edge.id,triggers[0].id],events(edge,result.branches,target.id,value => value ? 'on' : 'off'));
    } else if (target.moduleId === 'clex.logic.display') {
      const componentId = target.parameters.componentId;
      const element = p.screens?.[componentId]?.elements?.find(e => e.id === edge.targetHandle);
      if (element?.type !== 'indicator' || element.mode !== 'dynamic' || !booleans.has(componentId + '/' + element.id)) continue;
      const states = [false,true].map(value => element.states.find(state => state.value === value));
      const updates = oldEdges.filter(e => e.target === target.id && ['trigger','update.' + element.id].includes(e.targetHandle));
      // Shared screen definitions or externally scheduled refreshes require manual review.
      if (p.logic.nodes.filter(n => n.moduleId === target.moduleId && n.parameters.componentId === componentId).length !== 1 ||
          states.some(state => !state) || updates.length !== 1 || updates[0].source !== source.id || !result.ready.includes(updates[0].sourceHandle)) continue;
      if (replaceEdges([edge.id,...updates.filter(e => e.targetHandle !== 'trigger').map(e => e.id)],
        events(edge,result.branches,target.id,value => 'show.' + element.id + '.' + states[Number(value)].id))) {
        element.mode = 'events';
        element.staticStateId = (states[Number(element.initialValue)] || states[0]).id;
      }
    }
  }
  for (const node of p.logic.nodes) {
    const old = originals.get(node.id);
    if (old.moduleVersion !== '1.0.0') continue;
    if (OUTPUTS.includes(old.moduleId)) {
      const pendingValue = p.logic.edges.some(edge => edge.target === node.id && edge.targetHandle === 'value');
      const action = old.moduleId === 'clex.logic.gpio-toggle' ? 'toggle' : old.parameters.action || 'set';
      const command = action === 'set' ? (typeof old.parameters.defaultValue === 'boolean' ? old.parameters.defaultValue ? 'on' : 'off' : null) : action;
      node.moduleId = 'clex.logic.gpio-set';
      for (const edge of p.logic.edges.filter(e => e.target === node.id && e.targetHandle === 'trigger')) {
        if (!pendingValue && ['on','off','toggle'].includes(command)) edge.targetHandle = command;
      }
      if (!pendingValue && (['on','off','toggle'].includes(command) || p.logic.edges.some(e => e.target === node.id && ['on','off'].includes(e.targetHandle)))) { delete node.parameters.action; delete node.parameters.defaultValue; }
    }
    if (old.moduleId === 'clex.logic.gpio-edge' || old.moduleId === 'clex.logic.gpio-read') {
      const component = p.components.find(c => c.id === node.parameters.componentId);
      if (!component || !['clex.hardware.button','clex.hardware.touch-button'].includes(component.moduleId)) continue;
      for (const edge of [...p.logic.edges].filter(e => e.source === node.id && e.dataType === 'event')) {
        if (old.moduleId === 'clex.logic.gpio-edge' && ['rising','falling'].includes(edge.sourceHandle)) {
          edge.sourceHandle = (edge.sourceHandle === 'falling') === (component.moduleId === 'clex.hardware.button') ? 'active' : 'inactive';
        } else if (edge.sourceHandle === (old.moduleId === 'clex.logic.gpio-edge' ? 'changed' : 'done')) {
          replaceEdges([edge.id],events(edge,[['active'],['inactive']]));
        }
      }
    }
  }
  // Remove a screen-wide refresh only when every value it used to refresh was converted.
  p.logic.edges = p.logic.edges.filter(edge => {
    const target = nodes.get(edge.target);
    if (target?.moduleId !== 'clex.logic.display' || edge.targetHandle !== 'trigger') return true;
    const elements = p.screens?.[target.parameters.componentId]?.elements || [];
    return !elements.length || elements.some(e => e.mode === 'dynamic' || e.captionDynamic) ||
      !elements.some(e => e.mode === 'events');
  });
  for (const node of p.logic.nodes) {
    const module = catalog.modules.find(m => m.id === node.moduleId && m.kind === 'logic');
    if (!module || !compatibleVersion(node.moduleVersion,module.version))
      node.legacy = 'Блок из старого проекта. Замените его доступным блоком из библиотеки.';
  }
  for (const edge of p.logic.edges) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) continue;
    const output = nodePorts(source,catalog,p).outputs.find(port => port.id === edge.sourceHandle);
    const input = nodePorts(target,catalog,p).inputs.find(port => port.id === edge.targetHandle);
    if (!output || !input || output.type !== edge.dataType || input.type !== edge.dataType || source.legacy || target.legacy) {
      edge.legacy = { sourceName:label(edge.sourceHandle,output), targetName:label(edge.targetHandle,input), message:LEGACY_MESSAGE };
    }
  }
  p.formatVersion = 4;
  p.moduleVersions = { ...p.moduleVersions };
  for (const item of [...p.components,...p.logic.nodes]) p.moduleVersions[item.moduleId] = item.moduleVersion;
  return p;
}

export function openProject(contents, catalog) {
  if (new TextEncoder().encode(contents).length > MAX_PROJECT_BYTES) throw new Error('Размер проекта превышает 2 МБ.');
  let raw;
  try { raw = JSON.parse(contents); } catch { throw new Error('Файл не содержит корректный JSON.'); }
  if (![1,2,3].includes(raw?.formatVersion)) return { project:parseProject(contents), upgraded:false };
  const project = upgrade(raw,catalog);
  return { project:parseProject(serializeProject(project)), upgraded:true };
}
