import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,removeHardware} from '../src/assembly/model.js';
import {addNode,withLogic,hardwareMatches,logicAdditionProblem} from '../src/logic/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
const modules=catalog.modules.filter(module=>module.kind==='logic');
const mountable=(module,board)=>moduleSupportsBoard(module,board)&&(!module.network||board.networkInterfaces?.some(provider=>provider.family===module.network.family))&&(!module.hardwareInterface||board.peripherals?.some(provider=>provider.family===module.hardwareInterface.family&&provider.interface===module.hardwareInterface.interface));
test('every hardware-dependent block requires compatible mounted hardware, without requiring wiring',()=>{
 for(const module of modules.filter(module=>module.constraints.hardware)){
  const requirement=module.constraints.hardware;
  const board=catalog.boards.find(board=>moduleSupportsBoard(module,board)&&catalog.modules.some(hardware=>hardware.kind==='hardware'&&mountable(hardware,board)&&hardwareMatches({moduleId:hardware.id},requirement,catalog)));
  assert.ok(board,module.id);
  const hardware=catalog.modules.find(hardware=>hardware.kind==='hardware'&&mountable(hardware,board)&&hardwareMatches({moduleId:hardware.id},requirement,catalog));
  let project=createProject('Проверка доступности','',board.id);
  const before=structuredClone(project);assert.match(logicAdditionProblem(module,project,catalog),/Сначала добавьте.*Монтаж/,module.id);assert.deepEqual(project,before);
  project=addHardware(project,hardware,catalog);assert.equal(project.assembly.connections.length,0);assert.equal(logicAdditionProblem(module,project,catalog),null,module.id);
  const graph=addNode(project.logic,module,project.components,project,catalog);assert.equal(graph.nodes.at(-1).parameters.componentId,project.components[0].id);
 }
});
test('timers, counters, stopwatch and Serial remain available in an empty project',()=>{
 const project=createProject('Самостоятельная логика');
 for(const id of ['timer','counter','stopwatch','serial'])assert.equal(logicAdditionProblem(modules.find(m=>m.id==='clex.logic.'+id),project,catalog),null);
});
test('Internet check requires an actual network component, not a radio or the board alone',()=>{
 const module=modules.find(m=>m.id==='clex.logic.internet-check');let project=createProject('Сеть');
 assert.match(logicAdditionProblem(module,project,catalog),/сетевой интерфейс/);
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.espnow'),catalog);assert.match(logicAdditionProblem(module,project,catalog),/сетевой интерфейс/);
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.ethernet'),catalog);assert.equal(logicAdditionProblem(module,project,catalog),null);
});
test('removing hardware disables additions while preserving existing nodes and connections',()=>{
 const module=modules.find(m=>m.id==='clex.logic.espnow-send');let project=addHardware(createProject('Удаление'),catalog.modules.find(m=>m.id==='clex.hardware.espnow'),catalog);
 project=withLogic(project,addNode(project.logic,module,project.components,project,catalog));const logic=structuredClone(project.logic);
 project=removeHardware(project,catalog,project.components[0].id);assert.deepEqual(project.logic,logic);assert.match(logicAdditionProblem(module,project,catalog),/ESP-NOW/);
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.espnow'),catalog);assert.equal(logicAdditionProblem(module,project,catalog),null);
});
test('wrong component versions and unsupported boards never unlock a block',()=>{
 const module=modules.find(m=>m.id==='clex.logic.espnow-send');const project=addHardware(createProject('Версии'),catalog.modules.find(m=>m.id==='clex.hardware.espnow'),catalog);
 project.components[0].moduleVersion='1.0.0';assert.match(logicAdditionProblem(module,project,catalog),/Сначала добавьте/);
 project.boardId='waveshare-esp32-p4-nano';assert.match(logicAdditionProblem(module,project,catalog),/платформы/);
});
