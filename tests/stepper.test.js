import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostC} from './host-c.js';
import {catalog} from './catalog-fixture.js';
import {stepperProject} from './stepper-fixture.js';
import {addStepper} from './assembly-performance-fixture.js';
import {stepperIssues,stepperTimerBudget} from '../src/stepper/model.js';
import {createProject} from '../src/projects/model.js';
import {STEPPER_CORE} from '../src/firmware/drivers/stepper-core.js';
import {addHardware,connectTerminal,connectionProblem,disconnectTerminal,removeHardware,validateAssembly,transformAssembly} from '../src/assembly/model.js';
import {componentContact} from '../src/assembly/endpoints.js';
import {physicalEdges} from '../src/assembly/flow.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
import {addNode,hardwareMatches,validateGraph} from '../src/logic/model.js';

test('generic NEMA 17 and three manual STEP/DIR drivers have distinct library categories and no power supply component',()=>{
 const motor=catalog.modules.find(m=>m.id==='clex.hardware.nema17');assert.equal(motor.categoryName,'Двигатели');assert.equal(motor.parameters.ratedCurrent,undefined);
 assert.deepEqual(motor.terminals.map(t=>t.id),['a1','a2','b1','b2']);assert.equal(catalog.modules.some(m=>m.id==='clex.hardware.dc-supply'),false);
 for(const id of ['tb6600','tmc2208','drv8825']){const m=catalog.modules.find(m=>m.id==='clex.hardware.'+id);assert.equal(m.categoryName,'Драйверы двигателей');assert.ok(m.manualWiring.some(s=>s.includes('вручную')));assert.equal(hardwareMatches({moduleId:m.id},{kind:'gpio',mode:'output'},catalog),false);}
});
test('motor phase wiring is canonical, reversible from the UI, persisted and excluded from GPIO assignments',()=>{
 let {project:p,motor,driver}=stepperProject();assert.deepEqual(validateAssembly(p,catalog).filter(i=>i.severity==='error'),[]);
 assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);assert.deepEqual(parseProject(serializeProject(p)),p);
 assert.equal(p.gpioAssignments.length,3);assert.equal(physicalEdges(p).filter(e=>e.source===driver.id).length,4);
 p=disconnectTerminal(p,catalog,motor.id,'a1');p=connectTerminal(p,catalog,driver.id,'a1',componentContact(motor.id,'a1'));
 assert.equal(p.assembly.connections.find(w=>w.componentId===motor.id&&w.terminalId==='a1').sourceComponentId,driver.id);
 assert.throws(()=>connectTerminal(p,catalog,motor.id,'a1',componentContact(driver.id,'b1')),/обмотку/);
 const pin=p.gpioAssignments[0];assert.throws(()=>connectTerminal(p,catalog,motor.id,'a1',pin.pinId),/GPIO/);
 p=removeHardware(p,catalog,driver.id);assert.equal(p.assembly.connections.length,0);assert.equal(p.gpioAssignments.length,0);
});
test('all driver profiles generate native timer control on S3 and P4 with no unresolved templates',()=>{
 for(const board of ['waveshare-esp32-s3-eth','waveshare-esp32-p4-nano'])for(const id of ['tb6600','tmc2208','drv8825']){
  const {project:p}=stepperProject(id,board),bundle=generateFirmware(p,catalog);
  assert.match(bundle.mainC,/gptimer_register_event_callbacks/);assert.match(bundle.mainC,/portENTER_CRITICAL_ISR/);assert.match(bundle.files['main/CMakeLists.txt'],/esp_driver_gptimer/);assert.doesNotMatch(bundle.mainC,/@[A-Z_]+@/);
  assert.deepEqual(bundle.featureRuntimes,['stepper-'+bundle.target]);
 }
});
test('manual routes and component movement preserve generated pulse control',async()=>{
 const {project:p}=stepperProject();const before=await firmwareFingerprint(generateFirmware(p,catalog));
 const wire=p.assembly.connections.find(w=>w.sourceComponentId);wire.route=[{x:900,y:400},{x:1200,y:400}];
 const moved=transformAssembly(p,catalog,{positions:{[wire.sourceComponentId]:{x:1400,y:800},[wire.componentId]:{x:1900,y:900}}});
 assert.ok(moved.assembly.connections.find(w=>w.id===wire.id).route.length);assert.deepEqual(parseProject(serializeProject(moved)),moved);assert.equal(await firmwareFingerprint(generateFirmware(moved,catalog)),before);
});
test('revolutions use the manual microstep setting and the motor resolution, and invalid moves are rejected',()=>{
 const {project:p,motion,driver}=stepperProject('tmc2208');motion.parameters.motion='revolutions';motion.parameters.revolutions=2;driver.parameters.microsteps='16';
 assert.match(generateFirmware(p,catalog).mainC,/clex_sp_start\(0,\d+,6400,/);
 motion.parameters.revolutions=NaN;assert.ok(validateGraph(p,catalog).some(i=>i.message.includes('Количество оборотов')));
 motion.parameters.revolutions=10000;assert.ok(validateGraph(p,catalog).some(i=>i.message.includes('10000000')));
});
test('two independent drivers use distinct GPIOs and timers; further drivers use the board budget',()=>{
 let {project:p}=stepperProject();
 p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.nema17'),catalog);const motor=p.components.at(-1);
 const module=catalog.modules.find(m=>m.id==='clex.hardware.drv8825');p=addHardware(p,module,catalog);const driver=p.components.at(-1),board=catalog.boards.find(b=>b.id===p.boardId);
 for(const t of module.terminals.filter(t=>t.kind!=='winding-output')){const pin=board.pins.find(pin=>!connectionProblem(p,catalog,driver.id,t.id,pin.id));assert.ok(pin,t.id);p=connectTerminal(p,catalog,driver.id,t.id,pin.id);}
 for(const id of ['a1','a2','b1','b2'])p=connectTerminal(p,catalog,motor.id,id,componentContact(driver.id,id));
 p.logic=addNode(p.logic,catalog.modules.find(m=>m.id==='clex.logic.stepper'),p.components,p,catalog);p.logic.nodes.at(-1).parameters.componentId=driver.id;
 assert.deepEqual(validateAssembly(p,catalog).filter(i=>i.severity==='error'),[]);assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);
 assert.equal(new Set(p.gpioAssignments.map(a=>a.gpio)).size,6);const bundle=generateFirmware(p,catalog);assert.match(bundle.mainC,/clex_sp_drivers\[2\]/);assert.match(bundle.mainC,/clex_sp_start\(0,/);assert.match(bundle.mainC,/clex_sp_start\(1,/);
 p=addHardware(p,module,catalog);assert.equal(validateAssembly(p,catalog).some(i=>i.code==='stepper-count'),false);
 p=addHardware(p,module,catalog);assert.equal(validateAssembly(p,catalog).some(i=>i.code==='stepper-count'),false);
 p=addHardware(p,module,catalog);assert.ok(validateAssembly(p,catalog).some(i=>i.code==='stepper-count'));
});
test('import rejects orphaned or mixed motor connections and generation supports a disabled driver without logic',()=>{
 const {project:p}=stepperProject();const wire=p.assembly.connections.find(w=>w.sourceComponentId),id=wire.sourceComponentId;
 wire.boardPinId='invalid';assert.throws(()=>serializeProject(p),/соединение/);delete wire.boardPinId;
 wire.sourceComponentId='missing';assert.throws(()=>serializeProject(p),/соединение/);wire.sourceComponentId=id;
 p.logic.nodes=[];p.logic.edges=[];const bundle=generateFirmware(p,catalog);assert.match(bundle.mainC,/clex_sp_initialize\(\);/);assert.doesNotMatch(bundle.mainC,/clex_sp_start\(0,/);
});
const support=String.raw`
#include <stdbool.h>
#include <stdint.h>
#include <assert.h>
`;
test('real C pulse planner handles finite counts, acceleration, reverse, continuous motion, stop and release without blocking',()=>{
 runHostC(support+STEPPER_CORE+String.raw`
int main(void){
 clex_sp_core_t s={.ready=true,.pulse_us=10};assert(clex_sp_begin(&s,7,200,false,400,400)==SP_OK);
 assert(s.enabled&&s.moving&&s.owner==7);uint32_t first=s.interval_us,min=first,edges=0;
 while(s.moving){uint32_t wait=clex_sp_tick(&s);if(s.high){assert(wait==10);edges++;}else if(s.moving){assert(wait>=5);if(s.interval_us<min)min=s.interval_us;}}
 assert(edges==200&&s.emitted==200&&s.position==200&&!s.high&&s.enabled&&(s.events&SP_DONE));assert(min<first);
 assert(clex_sp_begin(&s,8,200,true,1000,0)==SP_OK);while(s.moving)clex_sp_tick(&s);assert(s.position==0);
 assert(clex_sp_begin(&s,9,0,false,100,0)==SP_OK);for(int i=0;i<20;i++)clex_sp_tick(&s);assert(s.position==10&&s.moving);
 assert(clex_sp_begin(&s,10,1,false,100,0)==SP_BUSY);
 clex_sp_halt(&s,9,false);assert(!s.moving&&s.enabled&&(s.events&SP_STOPPED));
 assert(clex_sp_begin(&s,9,0,false,100,0)==SP_OK);clex_sp_tick(&s);assert(s.high);clex_sp_halt(&s,9,true);assert(s.high&&s.enabled&&s.moving);clex_sp_tick(&s);assert(!s.high&&!s.enabled&&!s.moving);
 s.position=INT32_MAX;assert(clex_sp_begin(&s,9,2,false,100,0)==SP_POSITION_LIMIT);assert(clex_sp_begin(&s,9,0,false,100,0)==SP_OK);clex_sp_tick(&s);assert(!s.moving&&s.position==INT32_MAX&&s.error==SP_POSITION_LIMIT);
 s.ready=false;assert(clex_sp_begin(&s,0,1,false,100,0)==SP_NOT_READY);s.ready=true;assert(clex_sp_begin(&s,0,1,false,2001,0)==SP_ARGUMENT);
 return 0;
}
`,'clex-stepper-core-');
});

test('three and four drivers generate independent motion on each supported ESP32 target', () => {
 for (const boardId of ['doit-esp32-devkit-v1-30pin', 'waveshare-esp32-s3-eth', 'waveshare-esp32-p4-nano']) {
  let project = createProject('Четыре двигателя', '', boardId, boardId.includes('p4') ? { chipRevision: 'pre-v3' } : { camera: 'disconnected' });
  for (let index = 0; index < 4; index++) {
   project = addStepper(project, index).project;
   if (index < 2) continue;
   assert.deepEqual(validateAssembly(project, catalog).filter(issue => issue.severity === 'error'), [], boardId);
   assert.deepEqual(validateGraph(project, catalog).filter(issue => issue.severity === 'error'), [], boardId);
   const count = index + 1, bundle = generateFirmware(project, catalog);
   assert.ok(bundle.mainC.includes('clex_sp_drivers[' + count + ']'));
   assert.ok(bundle.mainC.includes('_Static_assert(' + count + ' <= SOC_TIMER_GROUP_TOTAL_TIMERS'));
   for (let driver = 0; driver < count; driver++) assert.ok(bundle.mainC.includes('clex_sp_start(' + driver + ','));
   assert.equal(new Set(project.gpioAssignments.map(assignment => assignment.gpio)).size, count * 3);
   assert.deepEqual(parseProject(serializeProject(project)), project);
  }
 }
});

test('motion capacity follows the selected board and deducts occupied GPTimer resources', () => {
 let project = createProject('Ресурсы');
 const driver = catalog.modules.find(module => module.id === 'clex.hardware.drv8825');
 for (let i = 0; i < 3; i++) project = addHardware(project, driver, catalog);
 const board = catalog.boards.find(board => board.id === project.boardId);
 const use = changed => ({ ...catalog, boards: catalog.boards.map(item => item.id === board.id ? changed : item) });
 assert.equal(stepperTimerBudget(project, catalog).available, 4);
 assert.equal(stepperIssues(project, catalog).some(issue => issue.code === 'stepper-count'), false);
 const small = use({ ...board, resources: { gptimer: 2 } });
 assert.equal(stepperTimerBudget(project, small).available, 2);
 assert.match(stepperIssues(project, small).find(issue => issue.code === 'stepper-count').message, /требуется 3, доступно 2 из 2/);
 const occupied = use({ ...board, peripherals: [...board.peripherals || [], { id: 'other-timers', occupancySetting: 'timers', resources: [{ key: 'gptimer', count: 2 }] }] });
 project = { ...project, boardSettings: { ...project.boardSettings, timers: 'connected' } };
 assert.equal(stepperTimerBudget(project, occupied).available, 2);
 assert.ok(stepperIssues(project, occupied).some(issue => issue.code === 'stepper-count'));
 const unknown = use({ ...board, resources: {} });
 assert.match(stepperIssues(project, unknown).find(issue => issue.code === 'stepper-count').message, /не описаны/);
});
