import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
export const XGZP_BOARDS=['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'];
export function mountXgzp(project,{sda,scl,k='16',supply,port}={}) {
  let p=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.xgzp6847d'),catalog);
  const component=p.components.at(-1),board=catalog.boards.find(b=>b.id===p.boardId),nano=board.platform==='arduino-avr';
  component.parameters.kFactor=k;
  if(port!==undefined)component.parameters.i2cPort=port;
  component.parameters.supplyVoltage=supply||String(board.logicVoltage||3.3);
  const pins=nano?[18,19]:board.target==='esp32'?[21,22]:board.id==='waveshare-esp32-s3-eth'?[1,2]:[4,5];
  for(const [terminal,pin] of [['power',board.pins.find(pin=>pin.kind==='power'&&pin.voltage===Number(component.parameters.supplyVoltage))],['ground',board.pins.find(pin=>pin.kind==='ground')],['sda',board.pins.find(pin=>pin.gpio===(sda??pins[0]))],['scl',board.pins.find(pin=>pin.gpio===(scl??pins[1]))]]){
    if(!pin)throw Error('Missing fixture pin '+terminal+' on '+board.id);
    p=connectTerminal(p,catalog,component.id,terminal,pin.id);
  }
  return {project:p,component:p.components.find(c=>c.id===component.id)};
}
export function xgzpProject(boardId=XGZP_BOARDS[0],options={}) {
  let p=createProject('I2C sensor fixture','',boardId,boardId.includes('p4')?{chipRevision:'pre-v3',audio:'disconnected',mipiDisplay:'disconnected',mipiCamera:'disconnected'}:{camera:'disconnected'});
  const mounted=mountXgzp(p,options);p=mounted.project;
  for(const id of ['clex.logic.xgzp6847d','clex.logic.serial'])p=withLogic(p,addNode(p.logic,catalog.modules.find(m=>m.id===id),p.components,p,catalog));
  const [sensor,output]=p.logic.nodes;
  sensor.parameters.unit=options.unit||'kPa';
  for(const [sourceHandle,targetHandle] of [['changed','trigger'],['text','text']])p=withLogic(p,connectNodes(p.logic,catalog,{source:sensor.id,sourceHandle,target:output.id,targetHandle},p));
  return {project:p,component:mounted.component,sensor,output};
}
