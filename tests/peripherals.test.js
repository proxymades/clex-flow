import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog, led, eth} from './catalog-fixture.js';
import {peripheralProject} from './peripheral-fixture.js';
import {resourceClaims, resourceIssues} from '../src/hardware/resources.js';
import {addHardware, connectTerminal, connectionProblem, validateAssembly} from '../src/assembly/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {addNode, connectNodes, nodePorts, withLogic} from '../src/logic/model.js';
import {connectDisplayData} from '../src/logic/displayBindings.js';
const modules = id => catalog.modules.find(m=>m.id===id);
test('DSI, camera and audio share matching I2C/LDO, while duplicate interfaces and GPIO collisions are rejected',()=>{
 const p=peripheralProject();assert.deepEqual(resourceIssues(p,catalog),[]);
 assert.equal(resourceClaims(p,catalog).filter(c=>c.key==='i2c:0').length,3);
 assert.equal(resourceClaims(p,catalog).filter(c=>c.key==='ldo:3').length,2);
 const reordered=structuredClone(catalog);reordered.boards.find(b=>b.id===p.boardId).peripherals.find(p=>p.family==='camera').resources[0].configuration={scl:8,sda:7,port:0};assert.deepEqual(resourceIssues(p,reordered),[]);
 const duplicate=addHardware(p,modules('clex.hardware.camera'),catalog);
 assert.ok(resourceIssues(duplicate,catalog).some(issue=>issue.message.includes('MIPI-CSI')));
 const ledProject=addHardware(p,led,catalog), component=ledProject.components.at(-1);
 assert.match(connectionProblem(ledProject,catalog,component.id,'anode','P1-3'),/GPIO7.*используется/);
 assert.match(connectionProblem(ledProject,catalog,component.id,'anode','P2-14'),/усилител|GPIO53.*используется/);
 const changed=structuredClone(catalog),board=changed.boards.find(b=>b.id===p.boardId);
 const audio=board.peripherals.find(p=>p.family==='audio');audio.resources[0].key='i2c:1';
 assert.ok(resourceIssues(p,changed).length,'different I2C controllers cannot drive the same physical pins');
 const bad=structuredClone(catalog);bad.boards.find(b=>b.id===p.boardId).peripherals.find(p=>p.family==='camera').resources.find(r=>r.key==='ldo:3').configuration.voltageMv=1800;
 assert.ok(resourceIssues(p,bad).length,'LDO sharing requires equal voltage');
});
test('new interface reservation catches existing wires and physical peripherals declared in board settings',()=>{
 let p=peripheralProject({audio:false,camera:false});p=addHardware(p,led,catalog);const component=p.components.at(-1);
 p=connectTerminal(p,catalog,component.id,'anode','P1-13');p=connectTerminal(p,catalog,component.id,'cathode','P1-9');
 const fake=structuredClone(catalog),board=fake.boards.find(b=>b.id===p.boardId),provider=board.peripherals.find(p=>p.family==='audio');provider.resources[1].gpios.push(20);
 p=addHardware(p,modules('clex.hardware.audio'),fake);
 assert.ok(validateAssembly(p,fake).some(issue=>issue.severity==='error' && /GPIO20.*используется/.test(issue.message)));
 const physical=peripheralProject({audio:false,camera:false});physical.boardSettings.mipiCamera='connected';
 assert.ok(resourceClaims(physical,catalog).some(c=>c.componentId===null && c.key==='csi:0'));
});
test('combined firmware uses model-specific JD9365 commands, native RGB565, shared buses, async media and ordinary saved graph edges',async()=>{
 const p=peripheralProject(),bundle=generateFirmware(p,catalog);
 assert.deepEqual(bundle.featureRuntimes,['audio-es8311','camera-ov5647','jd9365-dsi']);
 assert.match(bundle.mainC,/esp_lcd_new_panel_jd9365/);assert.match(bundle.mainC,/h_size=800,.v_size=1280/);
 assert.doesNotMatch(bundle.mainC,/lv_draw_sw_rgb565_swap/);
 assert.equal((bundle.mainC.match(/i2c_new_master_bus\(/g)||[]).length,1);
 assert.equal((bundle.mainC.match(/esp_ldo_acquire_channel\(/g)||[]).length,1);
 assert.match(bundle.mainC,/dont_init_ldo=true/);assert.match(bundle.mainC,/esp_lcd_touch_new_i2c_gt911/);
 assert.match(bundle.mainC,/esp_codec_dev_write/);assert.match(bundle.mainC,/VIDIOC_DQBUF/);assert.match(bundle.mainC,/VIDIOC_S_DQBUF_TIMEOUT/);
 assert.match(bundle.mainC,/CLEX_EVENT_MEDIA/);assert.match(bundle.mainC,/event.payload.media/);
 const worker=bundle.mainC.slice(bundle.mainC.indexOf('static void clex_audio_'),bundle.mainC.indexOf('static void node_'));
 assert.doesNotMatch(worker,/lv_label_set|lv_obj_set|lv_timer_handler/);
 const screen=modules('clex.display.waveshare-10-1-dsi-touch-a').display;
 assert.equal(screen.initialization.commands[0].command,0xe0);assert.ok(screen.initialization.commands.length>180);
 assert.equal(screen.touch.controller,'GT9271');
 assert.deepEqual(parseProject(serializeProject(p)).logic.edges,p.logic.edges);
 const camera=p.logic.nodes.find(n=>n.moduleId==='clex.logic.camera-capture');assert.ok(nodePorts(camera,catalog,p).outputs.some(p=>p.id==='frames' && p.readyOn==='changed'));
 const before=await firmwareFingerprint(bundle);assert.notEqual(before,await firmwareFingerprint({...bundle,featureRuntimes:bundle.featureRuntimes.slice(1)}));
 const spi=generateFirmware(peripheralProject({network:false,display:false}),catalog);assert.match(spi.mainC,/lv_draw_sw_rgb565_swap/);
 const incompatible={...p,boardId:eth.id};assert.throws(()=>generateFirmware(incompatible,catalog),/несовместим|совместим|ревизи|отсутствует/);
});

test('camera and tone errors bind to display text directly and through Serial without losing buffer or font checks', () => {
 for (const moduleId of ['clex.logic.camera-capture', 'clex.logic.tone']) {
  for (const throughSerial of [false, true]) {
   let project = peripheralProject();
   const source = project.logic.nodes.find(node => node.moduleId === moduleId);
   const view = project.logic.nodes.find(node => node.moduleId === 'clex.logic.display');
   const element = {id:crypto.randomUUID(),name:'Ошибка',type:'text',text:'',mode:'dynamic',valueType:'text',initialValue:'',prefix:'Ошибка: ',suffix:'',x:20,y:310,fontId:'montserrat_28',color:'#ffffff'};
   project.screens[view.parameters.componentId].elements.push(element);
   let producer = source, sourceHandle = 'error';
   if (throughSerial) {
    let graph = addNode(project.logic, modules('clex.logic.serial'), project.components, project, catalog);
    producer = graph.nodes.at(-1);
    for (const [sourcePort, targetPort] of [['error','text'], ['changed','trigger']]) {
     graph = connectNodes(graph, catalog, {source:source.id,sourceHandle:sourcePort,target:producer.id,targetHandle:targetPort}, {...project,logic:graph});
    }
    project = withLogic(project, graph);
    sourceHandle = 'text';
   }
   project = withLogic(project, connectDisplayData(project, catalog, {source:producer.id,sourceHandle,target:view.id,targetHandle:element.id}));
   const bundle = generateFirmware(project, catalog);
   const ordered = [...project.logic.nodes].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
   const expression = throughSerial ? 'text_' + ordered.findIndex(node => node.id === producer.id) : 'media_value_' + ordered.findIndex(node => node.id === source.id) + '.error';
   assert.ok(bundle.mainC.includes('clex_graphics_set_text("' + view.parameters.componentId + '", "' + element.id + '", ' + expression + ');'));
   if (throughSerial) assert.ok(bundle.mainC.includes('static char ' + expression + '[129];'));
   // Runtime text still goes through the chosen font's glyph validation.
   const limited = structuredClone(catalog);
   for (const font of limited.modules.find(module => module.id === project.components.find(component => component.id === view.parameters.componentId).moduleId).display.graphics.fonts) {
    font.ranges = font.ranges.flatMap(([min,max]) => min <= 109 && max >= 109 ? [[min,108],[110,max]].filter(([a,b]) => a <= b) : [[min,max]]);
   }
   assert.throws(() => generateFirmware(project, limited), /шрифт|символ/i);
  }
 }
});
