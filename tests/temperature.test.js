import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,timer} from './catalog-fixture.js';
import {temperatureProject} from './temperature-fixture.js';
import {createProject,parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {addNode,connectNodes,withLogic,validateGraph} from '../src/logic/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
import {displayProject} from './display-fixture.js';
import {connectDisplayData} from '../src/logic/displayBindings.js';
const sensorModule=catalog.modules.find(m=>m.id==='clex.logic.temperature');

test('temperature is available on S3 and P4, initializes one physical driver before worker and persists without wiring',()=>{
  for(const boardId of ['waveshare-esp32-s3-eth','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-p4-nano']){
    let p=temperatureProject(boardId);
    p=withLogic(p,addNode(p.logic,sensorModule,p.components,p,catalog));
    assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'||i.code==='logic-unreachable'),[]);
    const fw=generateFirmware(p,catalog);
    assert.ok(fw.featureRuntimes.includes('temperature-'+fw.target));
    assert.match(fw.files['main/CMakeLists.txt'],/esp_driver_tsens/);
    assert.equal(fw.mainC.match(/temperature_sensor_install\(&config/g).length,1);
    assert.ok(fw.mainC.indexOf('  clex_temperature_initialize();')<fw.mainC.indexOf('xTaskCreate(flow_worker'));
    assert.equal(fw.mainC.match(/temperature_\d+\.due = esp_timer_get_time\(\) \+ 1000LL/g).length,2);
    assert.deepEqual(parseProject(serializeProject(p)).logic,p.logic);
    assert.equal(p.components.length,0);
  }
  assert.equal(moduleSupportsBoard(sensorModule,catalog.boards.find(b=>b.target==='atmega328p')),false);
});

test('manual measurements need an event source and do not create background reads',()=>{
  let p=temperatureProject();const sensor=p.logic.nodes[0];sensor.parameters.autoRead=false;
  assert.ok(validateGraph(p,catalog).some(i=>i.code==='logic-unreachable'));
  p=withLogic(p,addNode(p.logic,timer,p.components,p,catalog));
  p=withLogic(p,connectNodes(p.logic,catalog,{source:p.logic.nodes.at(-1).id,sourceHandle:'tick',target:sensor.id,targetHandle:'trigger'},p));
  assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'||i.code==='logic-unreachable'),[]);
  assert.doesNotMatch(generateFirmware(p,catalog).mainC,/\.due = esp_timer_get_time/);
  sensor.parameters.autoRead=true;sensor.parameters.intervalMs=0;
  assert.ok(validateGraph(p,catalog).some(i=>i.code==='logic-parameter'));
  assert.throws(()=>generateFirmware(withLogic(createProject('Unsupported','','arduino-nano-atmega328p-ch340'),p.logic),catalog));
});

test('temperature text binds success and error updates to an ordinary display field',()=>{
  let p=displayProject();p=withLogic(p,addNode(p.logic,sensorModule,p.components,p,catalog));
  const sensor=p.logic.nodes.at(-1),view=p.logic.nodes.find(n=>n.moduleId==='clex.logic.display');
  p.screens[view.parameters.componentId].elements=[{id:'temperature',name:'Температура',type:'text',text:'',mode:'dynamic',valueType:'text',initialValue:'Нет данных',prefix:'Чип: ',suffix:'',x:8,y:30,fontId:'montserrat_20',color:'#ffffff'}];
  p=withLogic(p,connectDisplayData(p,catalog,{source:sensor.id,sourceHandle:'text',target:view.id,targetHandle:'temperature'}));
  assert.ok(p.logic.edges.some(e=>e.sourceHandle==='changed'&&e.targetHandle==='update.temperature'));
  assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);
  assert.match(generateFirmware(p,catalog).mainC,/clex_graphics_set_text\([^\n]+temperature_\d+\.text\)/);
});
