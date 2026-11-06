import {moduleVersionIndex} from '../catalog/versions.js';
import {logicVersionProblem} from './versions.js';
import {SELECTION_MODULE,selectionType,selectionOutputs,selectionIssues} from './selection.js';
import {conditionPorts,conditionIssues,CONDITION_MODULE} from './conditions.js';
import {SYNCHRONIZE_MODULE,synchronizationPorts} from './synchronization.js';
import {portRowCount} from './portGroups.js';
import {OUTPUT_MODULE,outputChannelCount,outputTerminalId} from '../gpio/model.js';
import {recordingIssues} from '../audio/model.js';
import {VOICE_LOGIC,voicePorts} from '../voice/model.js';
import {numericLogicIssues} from './numeric.js';
import {mqttLogicIssues} from '../mqtt/model.js';
import {stepperLogicIssues} from '../stepper/model.js';
import {ESPNOW_MODULE,espNowSupported,espNowLogicIssues,espNowAckIssues} from '../espnow/model.js';
import { moduleSupportsBoard,moduleIsEventSource } from '../catalog/compatibility.js';
import { formatCount } from '../utils/plural.js';
import { hardwareProvider } from '../hardware/resources.js';
import { networkProvider, probeUrl } from '../network/model.js';
import { displayDescription, screenFor, screenIssues, screenPorts, screenBindings, screenCommands, elementUpdatePort } from '../displays/model.js';
import { connectionProblem as physicalConnectionProblem, moduleProblem, boardFor } from '../assembly/model.js';

export const LOGIC_NODE_WIDTH = 336;
export const PORT_TYPES = ['event', 'number', 'text', 'boolean'];
export const TYPE_NAMES = { event: 'Сигнал', number: 'Число', text: 'Текст', boolean: 'Да/Нет' };
export const TYPE_COLORS = { event: '#34d399', number: '#fbbf24', text: '#a78bfa', boolean: '#60a5fa' };
export const graphModule = (node, catalog) => catalog.modules.find(module => module.id === node.moduleId && module.kind === 'logic');
export function nodePorts(node, catalog, project) {
  const module = graphModule(node, catalog);
  const versionProblem=logicVersionProblem(node,catalog);
  if(versionProblem){
    const ports={inputs:[],outputs:[]};
    for(const edge of project?.logic.edges||[]){
      for(const [direction,id,handle,label] of [['inputs',edge.target,edge.targetHandle,edge.legacy?.targetName],['outputs',edge.source,edge.sourceHandle,edge.legacy?.sourceName]]){
        if(id!==node.id||ports[direction].some(port=>port.id===handle))continue;
        const current=module?.[direction].find(port=>port.id===handle&&port.type===edge.dataType);
        ports[direction].push({id:handle,name:label||current?.name||handle,type:edge.dataType,legacy:true,description:versionProblem});
      }
    }
    return ports;
  }
  const parameters=node.parameters;
  const active=port=>!port.when||(port.when.values||[port.when.value]).includes(parameters[port.when.field]);
  let inputs = (module?.inputs || []).filter(active);
  let outputs = (module?.outputs || []).filter(active);
  if(node.moduleId===CONDITION_MODULE&&parameters.mode==='conditions')inputs=[...inputs.filter(port=>port.type==='event'),...conditionPorts(node)];
  if(node.moduleId===SELECTION_MODULE){inputs=inputs.map(port=>port.id==='value'?{...port,type:selectionType(node)}:port);outputs=selectionOutputs(node);}
  if(node.moduleId===SYNCHRONIZE_MODULE)inputs=[...inputs,...synchronizationPorts(node)];
  if(node.moduleId===VOICE_LOGIC&&project)outputs=[...voicePorts(project.components.find(c=>c.id===node.parameters.componentId)),...outputs];
  if(node.moduleId==='clex.logic.espnow-receive'&&node.parameters.transferType==='command')outputs=outputs.map(port=>port.readyOn==='messageReceived'?{...port,readyOn:'commandReceived'}:port);
  if (module?.editor === 'screen' && project) {
    const screen = screenFor(project, node.parameters.componentId);
    inputs = screenPorts(screen);
  }
  return { inputs, outputs };
}
export const logicData = graph => ({ nodes: graph.nodes, edges: graph.edges });

export function withLogic(project, logic) {
  const versions = moduleVersionIndex([...project.components,...logic.nodes]);
  return { ...project, logic, moduleVersions: versions };
}

export function hardwareMatches(component,requirement,catalog){
 if(!component||!requirement)return false;
 const definition=catalog?.modules.find(module=>module.id===component.moduleId);
 if(requirement.kind==='display')return Boolean(definition?.display);
 if(requirement.kind==='gpio')return !definition?.display&&!definition?.i2c&&!definition?.stepper&&!definition?.microphone&&!definition?.hardwareInterface&&!definition?.softwareInterface&&Boolean(definition?.terminals?.some(terminal=>terminal.kind===(requirement.mode==='input'?'gpio-input':'gpio-output')));
 return Boolean(requirement.modules?.includes(component.moduleId));
}

// Adding hardware-dependent logic requires a mounted component, not completed wiring.
export function logicAdditionProblem(module, project, catalog) {
  const board = boardFor(project, catalog);
  if (!moduleSupportsBoard(module, board)) return 'Для выбранной платформы блок пока не поддерживается.';
  const components = project.components.filter(component => !moduleProblem(component, catalog, board));
  const requirement = module.constraints.hardware;
  if (requirement && !components.some(component => hardwareMatches(component, requirement, catalog))) {
    const name = requirement.kind === 'display' ? 'дисплей'
      : requirement.kind === 'gpio' ? (requirement.mode === 'input' ? 'входной компонент' : 'выходной компонент')
      : requirement.modules.map(id => '«' + (catalog.modules.find(item => item.id === id)?.name || id) + '»').join(' или ');
    return `Сначала добавьте ${name} во вкладке «Монтаж».`;
  }
  if (module.constraints.network && !components.some(component => (catalog.modules.find(item => item.id === component.moduleId)?.network||['clex.hardware.router','clex.hardware.wifi'].includes(component.moduleId)))) {
    return 'Сначала добавьте сетевой интерфейс во вкладке «Монтаж».';
  }
  return null;
}

export function addNode(graph, module, components = [], project = null, catalog = null) {
  if (graph.nodes.length >= 100) throw new Error('В одном графе поддерживается до 100 блоков.');
  const parameters = Object.fromEntries(Object.entries(module.parameters).map(([key, parameter]) => [key, parameter.default]));
  if (module.constraints.hardware) parameters.componentId = components.find(component => hardwareMatches(component,module.constraints.hardware,catalog))?.id || '';
  let number = 1;
  while (graph.nodes.some(node => node.name === `${module.name} ${number}`)) number++;
  const height = node => {
    const definition = node && catalog ? graphModule(node, catalog) : node ? null : module;
    const ports = catalog ? nodePorts(node||{moduleId:module.id,moduleVersion:module.version,parameters},catalog,project) : definition || { inputs: [], outputs: [] };
    return (definition?.editor === 'screen' ? 360 : 160) + portRowCount(ports) * 44 + 48;
  };
  const newHeight = height(null), width = LOGIC_NODE_WIDTH, gap = 32, columnStep = width + 84;
  let slot = 0, position;
  do { position = { x: 60 + (slot % 2) * columnStep + Math.floor(slot / 20) * columnStep * 2, y: 100 + (Math.floor(slot / 2) % 10) * 310 }; slot++; }
  while (graph.nodes.some(node => node.position.x < position.x + width + gap && position.x < node.position.x + width + gap && node.position.y < position.y + newHeight + gap && position.y < node.position.y + height(node) + gap));
  return { ...graph, nodes: [...graph.nodes, { id: crypto.randomUUID(), moduleId: module.id, moduleVersion: module.version, name: `${module.name} ${number}`, position, parameters }] };
}

export function updateNode(graph, id, patch, catalog = null, project = null) {
  const previous=graph.nodes.find(node=>node.id===id);
  if(catalog&&previous&&patch.parameters){
    const problem=logicVersionProblem(previous,catalog);
    if(problem)throw new Error(problem);
  }
  if(catalog&&previous?.moduleId==='clex.logic.espnow-control'&&patch.parameters?.action==='peer'){
    const module=graphModule(previous,catalog);
    patch={...patch,parameters:{...patch.parameters}};
    for(const [key,parameter] of Object.entries(module?.parameters||{}))if(parameter.when?.field==='action'&&parameter.when.value==='peer'&&patch.parameters[key]===undefined)patch.parameters[key]=parameter.default;
  }
  if(catalog&&previous&&patch.parameters){
    const component=project?.components.find(component=>component.id===patch.parameters.componentId);
    for(const [key,parameter] of Object.entries(graphModule(previous,catalog)?.parameters||{}))if((parameter.componentModules?.includes(component?.moduleId)||parameter.componentChannels&&outputChannelCount(component))&&patch.parameters[key]===undefined)patch={...patch,parameters:{...patch.parameters,[key]:parameter.default}};
  }
  if(catalog&&previous?.moduleId===CONDITION_MODULE&&patch.parameters?.mode==='conditions'){
    patch={...patch,parameters:{...patch.parameters}};
    const module=graphModule(previous,catalog);
    for(const key of ['conditions','combine'])if(patch.parameters[key]===undefined)patch.parameters[key]=module.parameters[key].default;
  }
  const next={...graph,nodes:graph.nodes.map(node=>node.id===id?{...node,...patch}:node)};
  if(!catalog||!previous||!patch.parameters)return next;
  const changedPorts=previous.moduleId===SELECTION_MODULE?['valueType','cases'].some(key=>previous.parameters[key]!==patch.parameters[key]):previous.moduleId===SYNCHRONIZE_MODULE?['eventCount'].some(key=>previous.parameters[key]!==patch.parameters[key]):previous.moduleId==='clex.logic.compare-number'?['mode','conditions'].some(key=>previous.parameters[key]!==patch.parameters[key]):previous.moduleId.startsWith('clex.logic.espnow-')&&['transferType','action'].some(key=>previous.parameters[key]!==patch.parameters[key]);
  if(!changedPorts)return next;
  const current=next.nodes.find(node=>node.id===id), before=nodePorts(previous,catalog,project), after=nodePorts(current,catalog,project);
  // Different purposes have different port IDs; retain only the same purpose and data type.
  const typeChanged=previous.moduleId===SELECTION_MODULE&&selectionType(previous)!==selectionType(current);
  const keep=(direction,handle,type)=>!(typeChanged&&direction==='outputs')&&before[direction].some(port=>port.id===handle&&port.type===type)&&after[direction].some(port=>port.id===handle&&port.type===type);
  return {...next,edges:graph.edges.filter(edge=>(edge.source!==id||keep('outputs',edge.sourceHandle,edge.dataType))&&(edge.target!==id||keep('inputs',edge.targetHandle,edge.dataType)))};
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
  const offset={x:Math.min(40,5000-Math.max(...snapshot.nodes.map(node=>node.position.x))),y:Math.min(40,5000-Math.max(...snapshot.nodes.map(node=>node.position.y)))};
  const nodes = snapshot.nodes.map(node => ({ ...structuredClone(node), id: mapping.get(node.id), name: `${node.name.slice(0, 70)} (копия)`, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } }));
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

export function connectionProblem(graph, catalog, connection, ignoreId = null, project = null) {
  const source = graph.nodes.find(node => node.id === connection.source), target = graph.nodes.find(node => node.id === connection.target);
  if (!source || !target) return 'Оба блока соединения должны существовать.';
  if (source.id === target.id) return 'Нельзя соединить блок с самим собой.';
  const versionProblem=logicVersionProblem(source,catalog)||logicVersionProblem(target,catalog);
  if(versionProblem)return versionProblem;
  const output = nodePorts(source, catalog, project).outputs.find(port => port.id === connection.sourceHandle), input = nodePorts(target, catalog, project).inputs.find(port => port.id === connection.targetHandle);
  if (!output || !input) return 'Соединяйте выход блока со входом; выбранный порт отсутствует.';
  if (output.type !== input.type) return `Несовместимые типы: ${TYPE_NAMES[output.type]} → ${TYPE_NAMES[input.type]}.`;
  const remaining = graph.edges.filter(edge => edge.id !== ignoreId && !edge.legacy);
  if (graph.edges.some(edge => edge.id !== ignoreId && edge.source === source.id && edge.target === target.id && edge.sourceHandle === output.id && edge.targetHandle === input.id)) return 'Такое соединение уже существует.';
  if (input.type !== 'event' && remaining.some(edge => edge.target === target.id && edge.targetHandle === input.id)) return 'У входа может быть только одно соединение.';
  if (hasPath(remaining, target.id, source.id)) return 'Циклические связи не поддерживаются в первой версии.';
  return null;
}

export function connectNodes(graph, catalog, connection, project = null) {
  const problem = connectionProblem(graph, catalog, connection, null, project);
  if (problem) throw new Error(problem);
  if (graph.edges.length >= 300) throw new Error('В графе поддерживается до 300 связей.');
  const node = graph.nodes.find(node => node.id === connection.source);
  const dataType = nodePorts(node,catalog,project).outputs.find(port => port.id === connection.sourceHandle).type;
  return { ...graph, edges: [...graph.edges, { id: crypto.randomUUID(), source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle, dataType }] };
}

export function hardwareBinding(node, project, catalog) {
  const module = graphModule(node, catalog), requirement = module?.constraints.hardware;
  if(requirement?.kind==='i2c'){const component=project.components.find(c=>c.id===node.parameters.componentId);return {component,gpio:null,error:hardwareMatches(component,requirement,catalog)?null:'Выберите датчик из монтажа.'};}
  if(requirement?.kind==='voice'||requirement?.kind==='wifi'||requirement?.kind==='stepper'||requirement?.kind==='router'||requirement?.kind==='mqtt'){const component=project.components.find(c=>c.id===node.parameters.componentId);return {component,gpio:null,error:hardwareMatches(component,requirement,catalog)?null:'Выберите совместимый компонент из монтажа.'};}
  if (requirement?.kind === 'peripheral') {
    const component=project.components.find(component=>component.id===node.parameters.componentId),definition=catalog.modules.find(module=>module.id===component?.moduleId);
    return {component,gpio:null,error:component && requirement.modules.includes(component.moduleId) && hardwareProvider(component,definition,boardFor(project,catalog)) ? null : 'Выберите аппаратный компонент и его интерфейс в монтаже.'};
  }
  if(requirement?.kind==='radio'){const component=project.components.find(c=>c.id===node.parameters.componentId&&c.moduleId===ESPNOW_MODULE);return {component,gpio:null,error:component&&espNowSupported(boardFor(project,catalog))?null:'Выберите ESP-NOW из монтажа.'};}
  if (requirement?.kind === 'network') {
    const component=project.components.find(component=>component.id===node.parameters.componentId),definition=catalog.modules.find(module=>module.id===component?.moduleId);
    return {component,gpio:null,error:component&&requirement.modules.includes(component.moduleId)&&networkProvider(component,boardFor(project,catalog),definition)?null:'Выберите сетевой интерфейс из монтажа.'};
  }
  if (requirement?.kind === 'display') {
    const component = project.components.find(component => component.id === node.parameters.componentId);
    return { component, gpio: null, error: displayDescription(component, catalog) ? null : 'Выберите дисплей из монтажа.' };
  }
  if (!requirement) return { component: null, gpio: null, error: null };
  const component = project.components.find(component => component.id === node.parameters.componentId);
  if (!component || !hardwareMatches(component,requirement,catalog)) return { component: null, gpio: null, error: 'Выберите подходящий компонент монтажа.' };
  if(node.moduleId===OUTPUT_MODULE&&outputChannelCount(component)&&!outputTerminalId(node,component,catalog))return {component,gpio:null,error:'Выберите существующий канал выходного компонента.'};
  const terminalId=(node.moduleId===OUTPUT_MODULE?outputTerminalId(node,component,catalog):requirement.terminal)||catalog.modules.find(module=>module.id===component.moduleId)?.terminals.find(terminal=>terminal.kind===(requirement.mode==='input'?'gpio-input':'gpio-output'))?.id;
  const assignment = project.gpioAssignments.find(assignment => assignment.componentId === component.id && assignment.terminalId === terminalId);
  if (!assignment || assignment.mode !== requirement.mode) return { component, gpio: null, error: 'Сначала назначьте GPIO этому компоненту во вкладке «Монтаж».' };
  const wire = project.assembly.connections.find(wire => wire.componentId === component.id && wire.terminalId === terminalId && wire.boardPinId === assignment.pinId);
  if (!wire) return { component, gpio: assignment.gpio, error: 'Назначение GPIO не совпадает с монтажом.' };
  const problem = physicalConnectionProblem(project, catalog, component.id, terminalId, assignment.pinId);
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
  if (!graph.nodes.length) add('warning', 'logic-empty', 'Добавьте блоки во вкладке «Логика».');
  for (const node of graph.nodes) {
    const module = graphModule(node, catalog), fields = { nodeId: node.id };
    const versionProblem=logicVersionProblem(node,catalog);
    if(versionProblem){add('error','logic-module',node.name+': '+versionProblem,fields);continue;}
    if (node.legacy) { add('warning','logic-legacy-block',node.name + ': ' + node.legacy,fields); continue; }
    if (module.compatibility.projectFormat !== 4 || !moduleSupportsBoard(module,boardFor(project,catalog))) { add('error', 'logic-module',`${node.name}: модуль несовместим с выбранной платой.`, fields); continue; }
    if (!node.name.trim()) add('error', 'logic-name', 'Укажите название блока.', fields);
    for (const [key, parameter] of Object.entries(module.id===SELECTION_MODULE?{}:module.parameters)) {
      if(parameter.when&&node.parameters[parameter.when.field]!==parameter.when.value)continue;
      const component=project.components.find(component=>component.id===node.parameters.componentId);
      if(parameter.componentModules&&!parameter.componentModules.includes(component?.moduleId)||parameter.componentChannels&&!outputChannelCount(component))continue;
      const value = node.parameters[key];
      if (parameter.type === 'integer' && (!Number.isInteger(value) || value < parameter.min || value > parameter.max)) add('error', 'logic-parameter', `${node.name}: «${parameter.label}» должен быть целым числом ${parameter.min}-${parameter.max}.`, fields);
      if (parameter.type === 'number' && (!Number.isFinite(value) || value < parameter.min || value > parameter.max)) add('error', 'logic-parameter', node.name+': «'+parameter.label+'» должен быть конечным числом от '+parameter.min+' до '+parameter.max+'.', fields);
      if (parameter.type === 'boolean' && typeof value !== 'boolean') add('error', 'logic-parameter', `${node.name}: неверное логическое значение.`, fields);
      if (parameter.type === 'select' && !parameter.options.some(option=>option.value===value)) add('error','logic-parameter',node.name+': выберите допустимый вариант «'+parameter.label+'».',fields);
      if (parameter.type === 'text' && (typeof value !== 'string' || value.length > parameter.maxLength)) add('error', 'logic-parameter', `${node.name}: текст не должен превышать ${formatCount(parameter.maxLength, ['символ', 'символа', 'символов'])}.`, fields);
    }
    for(const message of selectionIssues(node))add('error','logic-parameter',node.name+': '+message,fields);
    for(const message of recordingIssues(node))add('error','audio-recording',node.name+': '+message,fields);
    for(const message of [...numericLogicIssues(node,project),...conditionIssues(node)])add('error','numeric-logic',node.name+': '+message,fields);
    for(const message of mqttLogicIssues(node,project))add('error','mqtt-logic',node.name+': '+message,fields);
    for(const message of stepperLogicIssues(node,project,catalog))add('error','stepper-logic',node.name+': '+message,fields);
    for(const message of [...espNowLogicIssues(node,project,boardFor(project,catalog)),...espNowAckIssues(node,project,catalog)])add('error','espnow-logic',node.name+': '+message,fields);
    if(module.constraints.network){if(!project.components.some(component=>(catalog.modules.find(module=>module.id===component.moduleId)?.network||['clex.hardware.router','clex.hardware.wifi'].includes(component.moduleId))))add('error','probe-network',node.name+': добавьте сетевой интерфейс в монтаж.',fields);if(!probeUrl(node.parameters.url))add('error','probe-url',node.name+': укажите HTTP/HTTPS-адрес без логина, пароля и фрагмента.',fields);}
    const binding = hardwareBinding(node, project, catalog);
    if (module.editor === 'screen' && binding.component) {
      if (!project.screens?.[binding.component.id]) add('error', 'display-interface', node.name + ': создайте и сохраните интерфейс экрана.', fields);
      else {
        const screen = screenFor(project, binding.component.id);
        for (const message of screenIssues(screen, displayDescription(binding.component, catalog))) add('error', 'display-interface', node.name + ': ' + message, fields);
        for(const element of screen.elements.filter(element=>element.type==='indicator'&&element.mode==='events')){
          const commands=screenCommands(screen).filter(command=>command.element.id===element.id);
          if(!graph.edges.some(edge=>edge.target===node.id&&commands.some(command=>command.id===edge.targetHandle)))add('error','logic-input',node.name+': подключите событие к состоянию индикатора «'+element.name+'».',fields);
        }
        const dynamic = screenBindings(screen);
        for (const element of dynamic) if (!graph.edges.some(edge => edge.target === node.id && edge.dataType === 'event' && ['trigger', elementUpdatePort(element.id)].includes(edge.targetHandle))) add('error', 'logic-input', node.name + ': подключите событие обновления элемента «' + (element.name || 'Текст') + '».', fields);
      }
    }
    if (module.id === OUTPUT_MODULE && !graph.edges.some(edge => edge.target === node.id && (['on','off','toggle'].includes(edge.targetHandle) || edge.legacy))) add('error','logic-input',node.name + ': подключите команду включения, выключения или переключения.',fields);
    if (binding.error) add('error', 'logic-hardware', `${node.name}: ${binding.error}`, fields);
    for (const port of nodePorts(node, catalog, project).inputs.filter(port => port.required)) if (!graph.edges.some(edge => edge.target === node.id && edge.targetHandle === port.id)) add('error', 'logic-input', `${node.name}: подключите вход «${port.name}».`, fields);
    if (module.id === 'clex.logic.timer' && !graph.edges.some(edge => edge.source === node.id && edge.dataType === 'event')) add('warning', 'timer-unused', `${node.name}: такт пока не подключен к действию.`, fields);
  }
  for (const edge of graph.edges) {
    if (edge.legacy) { add('warning','logic-legacy-connection',edge.legacy.sourceName + ' → ' + edge.legacy.targetName + ': ' + edge.legacy.message,{edgeId:edge.id,nodeId:edge.target}); continue; }
    if([edge.source,edge.target].some(id=>{const node=graph.nodes.find(item=>item.id===id);return node&&logicVersionProblem(node,catalog);}))continue;
    const problem = connectionProblem(graph, catalog, edge, edge.id, project);
    if (problem) { add('error', 'logic-connection', problem, { edgeId: edge.id, nodeId: edge.target }); continue; }
    const source = graph.nodes.find(node => node.id === edge.source), port = nodePorts(source,catalog,project).outputs.find(port => port.id === edge.sourceHandle);
    if (edge.dataType !== port.type) add('error', 'logic-type', 'Сохраненный тип связи не совпадает с типом портов.', { edgeId: edge.id });
    const orderedEdges = graphModule(graph.nodes.find(node => node.id === edge.target), catalog)?.editor === 'screen' ? graph.edges.filter(item => item.target !== edge.target || item.dataType !== 'event' || ['trigger', elementUpdatePort(edge.targetHandle)].includes(item.targetHandle)) : graph.edges;
    const input = nodePorts(graph.nodes.find(node => node.id === edge.target), catalog, project).inputs.find(port => port.id === edge.targetHandle);
    if (port.readyOn && input?.sample !== 'latest' && !hasPath(orderedEdges, source.id, edge.target, true)) add('error', 'logic-order', 'Значение должно передаваться после события «Готово» его источника. Соедините также события.', { edgeId: edge.id, nodeId: edge.target });
  }
  const roots = graph.nodes.filter(node => node.moduleId==='clex.logic.timer'||moduleIsEventSource(graphModule(node,catalog),node)).map(node => node.id);
  for (const node of graph.nodes.filter(node => !logicVersionProblem(node,catalog) && !roots.includes(node.id) && !graphModule(node, catalog)?.editor)) if (!roots.some(root => hasPath(graph.edges, root, node.id, true))) add('warning', 'logic-unreachable', `${node.name}: нет событийного пути от источника событий.`, { nodeId: node.id });
  return issues;
}
