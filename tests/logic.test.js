import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, serializeProject, parseProject } from '../src/projects/model.js';
import { addHardware, connectTerminal, removeHardware } from '../src/assembly/model.js';
import { addNode, connectNodes, connectionProblem, removeElements, selectionSnapshot, pasteNodes, withLogic, validateGraph } from '../src/logic/model.js';
import { createHistory } from '../src/logic/history.js';
import { createWriteQueue, acknowledgeWrite } from '../src/projects/writeQueue.js';
import { catalog, timer, read, set, toggle, serial, led, button } from './catalog-fixture.js';
function mounted() {
  let project = { ...createProject('Blink'), boardSettings: { camera: 'disconnected' } };
  project = addHardware(project, led); project = addHardware(project, button);
  for (const [index, terminal, pin] of [[0,'anode','P34'],[0,'cathode','P28'],[1,'signal','P32'],[1,'ground','P28']]) project = connectTerminal(project,catalog,project.components[index].id,terminal,pin);
  return project;
}
function nodes(project, ...modules) {
  let graph = project.logic;
  for (const module of modules) graph = addNode(graph,module,project.components);
  return withLogic(project,graph);
}
const edge = (graph, source, sourceHandle, target, targetHandle) => ({ source: graph.nodes[source].id, sourceHandle, target: graph.nodes[target].id, targetHandle });
function blink() { const project = nodes(mounted(), timer, toggle); return withLogic(project,connectNodes(project.logic,catalog,edge(project.logic,0,'tick',1,'trigger'))); }

test('таймер 500 мс → переключение LED использует компонент монтажа и точные версии', () => {
  const project = blink(); assert.equal(project.logic.nodes[0].parameters.intervalMs,500);
  assert.equal(project.logic.nodes[1].parameters.componentId,project.components[0].id);
  assert.equal(project.logic.edges[0].dataType,'event');
  assert.equal(validateGraph(project,catalog).filter(issue=>issue.severity==='error').length,0);
  assert.deepEqual(parseProject(serializeProject(project)),project);
  assert.equal(project.moduleVersions[toggle.id],'1.0.0');
});
test('несовместимые типы, обратные направления, повторные связи и второй вход запрещены', () => {
  const project = nodes(mounted(),timer,toggle,serial,timer), graph = project.logic;
  assert.match(connectionProblem(graph,catalog,edge(graph,0,'interval',1,'trigger')),/Несовместимые/);
  assert.match(connectionProblem(graph,catalog,edge(graph,1,'trigger',0,'tick')),/выход/);
  const connected = connectNodes(graph,catalog,edge(graph,0,'tick',1,'trigger'));
  assert.match(connectionProblem(connected,catalog,edge(graph,0,'tick',1,'trigger')),/уже существует/);
  assert.match(connectionProblem(connected,catalog,edge(graph,3,'tick',1,'trigger')),/одно соединение/);
});
test('все четыре типа портов участвуют в допустимых схемах', () => {
  let project = nodes(mounted(),timer,read,set,serial,serial);
  let graph = connectNodes(project.logic,catalog,edge(project.logic,0,'tick',1,'trigger'));
  graph = connectNodes(graph,catalog,edge(graph,1,'done',2,'trigger'));
  graph = connectNodes(graph,catalog,edge(graph,1,'level',2,'value'));
  graph = connectNodes(graph,catalog,edge(graph,2,'done',3,'trigger'));
  graph = connectNodes(graph,catalog,edge(graph,0,'interval',3,'number'));
  graph = connectNodes(graph,catalog,edge(graph,3,'done',4,'trigger'));
  graph = connectNodes(graph,catalog,edge(graph,3,'text',4,'text'));
  project=withLogic(project,graph);
  assert.deepEqual(new Set(graph.edges.map(edge=>edge.dataType)),new Set(['event','boolean','number','text']));
  assert.equal(validateGraph(project,catalog).filter(issue=>issue.severity==='error').length,0);
});
test('самосоединения и косвенные циклы отклоняются', () => {
  const project = nodes(mounted(),serial,serial,serial); let graph=project.logic;
  assert.match(connectionProblem(graph,catalog,edge(graph,0,'done',0,'trigger')),/самим собой/);
  graph=connectNodes(graph,catalog,edge(graph,0,'done',1,'trigger')); graph=connectNodes(graph,catalog,edge(graph,1,'done',2,'trigger'));
  assert.match(connectionProblem(graph,catalog,edge(graph,2,'done',0,'trigger')),/Циклические/);
});
test('данные после действия требуют событийного пути от источника', () => {
  let project=nodes(mounted(),timer,read,set); let graph=connectNodes(project.logic,catalog,edge(project.logic,0,'tick',1,'trigger'));
  graph=connectNodes(graph,catalog,edge(graph,1,'level',2,'value'));
  project=withLogic(project,graph); assert.ok(validateGraph(project,catalog).some(issue=>issue.code==='logic-order'));
  project=withLogic(project,connectNodes(graph,catalog,edge(graph,1,'done',2,'trigger')));
  assert.ok(!validateGraph(project,catalog).some(issue=>issue.code==='logic-order'));
});
test('удалённый компонент, неправильный тип компонента и GPIO без монтажа видны', () => {
  const project=blink(), node=project.logic.nodes[1];
  assert.ok(validateGraph(removeHardware(project,catalog,project.components[0].id),catalog).some(issue=>issue.code==='logic-hardware'));
  assert.equal(removeHardware(project,catalog,project.components[0].id).moduleVersions[timer.id],'1.0.0');
  const wrong={...project,logic:{...project.logic,nodes:project.logic.nodes.map(item=>item.id===node.id?{...item,parameters:{componentId:project.components[1].id}}:item)}};
  assert.ok(validateGraph(wrong,catalog).some(issue=>issue.code==='logic-hardware'));
  assert.ok(validateGraph({...project,gpioAssignments:[]},catalog).some(issue=>issue.code==='logic-hardware'));
});
test('невалидный интервал и отсутствующий событийный вход обнаруживаются', () => {
  const project=nodes(mounted(),timer,toggle), graph={...project.logic,nodes:project.logic.nodes.map(node=>node.moduleId===timer.id?{...node,parameters:{intervalMs:0}}:node)};
  const issues=validateGraph(withLogic(project,graph),catalog);
  assert.ok(issues.some(issue=>issue.code==='logic-parameter')); assert.ok(issues.some(issue=>issue.code==='logic-input'));
});
test('несовместимая версия и неверный сохранённый тип связи не подменяются', () => {
  const project=blink();
  assert.ok(validateGraph({...project,logic:{...project.logic,nodes:project.logic.nodes.map(node=>({...node,moduleVersion:'9.0.0'}))}},catalog).some(issue=>issue.code==='logic-module'));
  assert.ok(validateGraph({...project,logic:{...project.logic,edges:project.logic.edges.map(edge=>({...edge,dataType:'number'}))}},catalog).some(issue=>issue.code==='logic-type'));
});
test('копирование создаёт новые ID и переносит только связи внутри выделения', () => {
  const project=nodes(mounted(),timer,toggle,serial); let graph=connectNodes(project.logic,catalog,edge(project.logic,0,'tick',1,'trigger'));
  graph=connectNodes(graph,catalog,edge(graph,1,'done',2,'trigger'));
  const snapshot=selectionSnapshot(graph,[graph.nodes[0].id,graph.nodes[1].id]), pasted=pasteNodes(graph,snapshot);
  assert.equal(snapshot.edges.length,1); assert.equal(pasted.graph.nodes.length,5); assert.equal(pasted.graph.edges.length,3);
  assert.ok(pasted.ids.every(id=>!graph.nodes.some(node=>node.id===id)));
  assert.equal(pasted.graph.edges.at(-1).source,pasted.ids[0]); assert.equal(pasted.graph.edges.at(-1).target,pasted.ids[1]);
  assert.equal(pasted.graph.nodes.at(-1).parameters.componentId,project.components[0].id);
});
test('удаление блока убирает зависимые связи и версии, сохраняя монтаж', () => {
  const project=blink(), graph=removeElements(project.logic,[project.logic.nodes[1].id]); const next=withLogic(project,graph);
  assert.equal(graph.edges.length,0); assert.equal(next.moduleVersions[toggle.id],undefined); assert.equal(next.moduleVersions[led.id],'1.0.0');
  assert.deepEqual(next.assembly,project.assembly); serializeProject(next);
});
test('история группирует drag в один шаг и сохраняет панораму при Undo/Redo', () => {
  const project=blink(), history=createHistory(project.logic); history.begin();
  for(let x=61;x<70;x++) history.change(graph=>({...graph,nodes:graph.nodes.map((node,index)=>index===0?{...node,position:{...node.position,x}}:node)}));
  history.end(); history.change(graph=>({...graph,viewport:{x:123,y:42,zoom:0.8}}),{track:false});
  assert.equal(history.canUndo,true); assert.equal(history.undo().nodes[0].position.x,60); assert.equal(history.canUndo,false); assert.equal(history.current.viewport.x,123);
  assert.equal(history.redo().nodes[0].position.x,69); assert.equal(history.current.viewport.zoom,0.8);
});
test('последовательное редактирование параметра объединяется; новая правка очищает Redo', () => {
  const history=createHistory(blink().logic);
  for(const intervalMs of [50,500,1000]) history.change(graph=>({...graph,nodes:graph.nodes.map((node,index)=>index===0?{...node,parameters:{intervalMs}}:node)}),{group:'timer'});
  assert.equal(history.undo().nodes[0].parameters.intervalMs,500); assert.equal(history.canUndo,false); assert.equal(history.canRedo,true);
  history.change(graph=>({...graph,nodes:graph.nodes.map((node,index)=>index===0?{...node,parameters:{intervalMs:2000}}:node)})); assert.equal(history.canRedo,false);
});
test('история не меняет переданный граф и ограничивает число шагов', () => {
  const original=blink().logic, history=createHistory(original,2);
  for(const intervalMs of [1000,2000,3000]) history.change(graph=>({...graph,nodes:graph.nodes.map((node,index)=>index===0?{...node,parameters:{intervalMs}}:node)}));
  assert.equal(original.nodes[0].parameters.intervalMs,500); history.undo(); history.undo(); assert.equal(history.current.nodes[0].parameters.intervalMs,1000); assert.equal(history.canUndo,false);
});
test('формат 2 с монтажом обновляется в памяти, будущие версии и осиротевшие связи отклоняются', () => {
  const project=mounted(), legacy={...project,formatVersion:2}; const migrated=parseProject(JSON.stringify(legacy));
  assert.equal(migrated.formatVersion,3); assert.deepEqual(migrated.assembly,legacy.assembly); assert.equal(legacy.formatVersion,2);
  const valid=blink(); assert.throws(()=>serializeProject({...valid,logic:{...valid.logic,edges:[{...valid.logic.edges[0],target:'missing'}]}}));
  assert.throws(()=>parseProject(JSON.stringify({...valid,formatVersion:2})),/неподдерживаемый граф/);
});
test('сохранённые узлы не содержат runtime-данные React Flow', () => {
  const project=parseProject(serializeProject(blink()));
  for(const node of project.logic.nodes) for(const field of ['selected','measured','data','dragging']) assert.equal(node[field],undefined);
});
test('очередь записывает строго по порядку и восстанавливается после ошибки', async () => {
  const calls=[], finishes=[]; const queue=createWriteQueue(value=>new Promise((resolve,reject)=>{calls.push(value);finishes.push(value===2?()=>reject(new Error('disk')):resolve);}));
  const first=queue(1), second=queue(2).catch(error=>error.message), third=queue(3);
  await Promise.resolve(); assert.deepEqual(calls,[1]); finishes[0](); await first;
  await new Promise(resolve=>setTimeout(resolve,0)); assert.deepEqual(calls,[1,2]); finishes[1](); assert.equal(await second,'disk');
  await new Promise(resolve=>setTimeout(resolve,0)); assert.deepEqual(calls,[1,2,3]); finishes[2](); await third;
});
test('завершение старой записи сохраняет новые правки до следующего подтверждения', async () => {
  const before = blink(), during = structuredClone(before);
  during.logic.nodes[0].parameters.intervalMs = 750;
  during.description = 'Изменено во время записи';
  const finishes = [];
  const queue = createWriteQueue(value => new Promise(resolve => finishes.push(() => resolve({ ...value, updatedAt: '2026-10-09T10:00:00Z' }))));
  const first = queue(before), second = queue(during);
  await Promise.resolve(); finishes[0]();
  let current = acknowledgeWrite(during, before, await first);
  assert.equal(current.logic.nodes[0].parameters.intervalMs, 750);
  assert.equal(current.description, 'Изменено во время записи');
  await new Promise(resolve => setTimeout(resolve, 0)); finishes[1]();
  current = acknowledgeWrite(current, during, await second);
  assert.equal(current.updatedAt, '2026-10-09T10:00:00Z');
  assert.equal(current.logic.nodes[0].parameters.intervalMs, 750);
});
