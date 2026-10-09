import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
import { firmwareProject } from './firmware-fixture.js';
import { generateFirmware, cString, firmwareFingerprint } from '../src/firmware/generator.js';
import { catalog, timer, toggle, serial } from './catalog-fixture.js';
test('firmware contains actual connected GPIO, SDK target and fixed dependencies',()=>{
 const bundle=generateFirmware(firmwareProject(),catalog);
 assert.equal(Object.keys(bundle.files).length,4);
 assert.match(bundle.mainC,/gpio_set_level\(17,/);
 assert.match(bundle.mainC,/gpio_get_level\(16\)/);
 assert.match(bundle.mainC,/500ULL \* 1000ULL/);
 assert.match(bundle.files['sdkconfig.defaults'],/FLASHSIZE_16MB=y/);
 assert.match(bundle.files['sdkconfig.defaults'],/USB_SERIAL_JTAG=y/);
 assert.match(bundle.files['CMakeLists.txt'],/set\(COMPONENTS main\)/);
 assert.doesNotMatch(bundle.mainC,/gpio_set_level\((0|21),/);
});
test('visual changes and reordered serialized arrays preserve generated source and fingerprint',async()=>{
 const project=firmwareProject(true), bundle=generateFirmware(project,catalog), edited=structuredClone(project);
 edited.name='Another name';edited.logic.nodes.reverse();edited.components.reverse();edited.logic.edges.reverse();
 for(const node of edited.logic.nodes){node.position={x:2000,y:3000};node.name='Moved';}
 const next=generateFirmware(edited,catalog);
 assert.equal(next.mainC,bundle.mainC);assert.equal(await firmwareFingerprint(next),await firmwareFingerprint(bundle));
});
test('semantic parameters and USB/UART console invalidate fingerprint',async()=>{
 const project=firmwareProject(), before=generateFirmware(project,catalog);
 project.logic.nodes.find(node=>node.moduleId===timer.id).parameters.intervalMs=750;
 assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog)),await firmwareFingerprint(before));
 assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog,'uart')),await firmwareFingerprint(generateFirmware(project,catalog)));
 assert.match(generateFirmware(project,catalog,'uart').files['sdkconfig.defaults'],/UART_DEFAULT=y/);
});
test('all five block implementations support boolean, numeric and text values safely',()=>{
 const bundle=generateFirmware(firmwareProject(true),catalog);
 assert.match(bundle.mainC,/value_\d+ = input_stable_/);
 assert.match(bundle.mainC,/gpio_state_\d+ = value_/);
 assert.match(bundle.mainC,/snprintf\(text_\d+, sizeof\(text_\d+\), "%s %.15g"/);
 assert.match(bundle.mainC,/snprintf\(text_\d+, sizeof\(text_\d+\), "%s", text_/);
 assert.match(bundle.mainC,/atomic_fetch_add/);
});
test('C strings escape quotes, backslash, newline, UTF-8 and preserve percent as data',()=>{
 assert.equal(cString('"\\\n%s'),'"\\"\\\\\\012%s"');
 assert.equal(cString('я'),'"\\321\\217"');
 assert.throws(()=>cString('bad\0text'),/нулевой/);
});
test('invalid assembly, unsupported implementation and empty logic block generation',()=>{
 const project=firmwareProject();project.assembly.connections=[];project.gpioAssignments=[];
 assert.throws(()=>generateFirmware(project,catalog),/Исправьте схему/);
 const bad=structuredClone(catalog);bad.modules.find(module=>module.id===toggle.id).firmware.generatorKey='gpio-set';
 assert.throws(()=>generateFirmware(firmwareProject(),bad),/Нет проверенной реализации/);
 const empty=firmwareProject();empty.logic={nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}};
 assert.throws(()=>generateFirmware(empty,catalog),/таймер/);
 assert.throws(()=>generateFirmware(firmwareProject(),catalog,'bad'),/Неизвестный режим/);
});
test('unused timers and hardware have deterministic safe initialization',()=>{
 let project=firmwareProject();project=withLogic(project,addNode(project.logic,timer,project.components));
 const source=generateFirmware(project,catalog).mainC;
 assert.match(source,/__attribute__\(\(unused\)\)/);
 assert.match(source,/gpio_set_level\(17, gpio_state_/);
});

test('UTF-8 text buffer budget rejects oversized valid graphs before compilation',()=>{
 let project=firmwareProject();
 let graph=project.logic;
 for(let i=0;i<17;i++){graph=addNode(graph,serial,project.components);const target=graph.nodes.at(-1);target.parameters.message='я'.repeat(2000);graph=connectNodes(graph,catalog,{source:graph.nodes[0].id,sourceHandle:'tick',target:target.id,targetHandle:'trigger'});}
 project=withLogic(project,graph);
 assert.throws(()=>generateFirmware(project,catalog),/64 КиБ/);
});
