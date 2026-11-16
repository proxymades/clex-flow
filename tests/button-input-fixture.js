import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {componentContact} from '../src/assembly/endpoints.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';

export const BUTTON_BOARDS=['doit-esp32-devkit-v1-30pin','esp32-c3-super-mini','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'];
export function buttonInputProject({boardId='esp32-c3-super-mini',module=false,pull='up',activeLevel='low',resistor=pull.startsWith('external-'),branch='component',inputGpio=null,swapped=false}={}){
 const board=catalog.boards.find(b=>b.id===boardId),definition=id=>catalog.modules.find(m=>m.id===id);
 const settings=Object.fromEntries(Object.entries(board.options||{}).map(([key,value])=>[key,value.default]));
 if(board.options?.camera)settings.camera='disconnected';
 let project=createProject('Кнопка и светодиод','',boardId,settings);
 project=addHardware(project,definition(module?'clex.hardware.button-module':'clex.hardware.button'),catalog);
 const button=project.components.at(-1);Object.assign(button.parameters,{pull,...(module?{activeLevel}:{})});
 const input=board.pins.find(pin=>(inputGpio===null||pin.gpio===inputGpio)&&!connectionProblem(project,catalog,button.id,'signal',pin.id));
 if(!input)throw Error('No button GPIO');
 project=connectTerminal(project,catalog,button.id,'signal',input.id);
 const ground=board.pins.find(pin=>pin.kind==='ground'),power=board.pins.find(pin=>pin.kind==='power'&&pin.voltage===(board.logicVoltage||3.3));
 project=connectTerminal(project,catalog,button.id,'ground',!module&&pull.endsWith('down')?power.id:ground.id);
 if(module)project=connectTerminal(project,catalog,button.id,'power',power.id);
 project=addHardware(project,definition('clex.hardware.led'),catalog);const led=project.components.at(-1);
 const output=board.pins.find(pin=>!connectionProblem(project,catalog,led.id,'anode',pin.id));
 project=connectTerminal(project,catalog,led.id,'anode',output.id);project=connectTerminal(project,catalog,led.id,'cathode',ground.id);
 let physicalResistor=null;
 if(resistor){
  project=addHardware(project,definition('clex.hardware.resistor'),catalog);physicalResistor=project.components.at(-1);
  project=connectTerminal(project,catalog,physicalResistor.id,swapped?'b':'a',branch==='component'?componentContact(button.id,'signal'):input.id);
  project=connectTerminal(project,catalog,physicalResistor.id,swapped?'a':'b',pull.endsWith('down')?ground.id:power.id);
 }
 for(const id of ['clex.logic.gpio-edge','clex.logic.gpio-set'])project=withLogic(project,addNode(project.logic,definition(id),project.components,project,catalog));
 const [edge,action]=project.logic.nodes;
 project=withLogic(project,connectNodes(project.logic,catalog,{source:edge.id,sourceHandle:'active',target:action.id,targetHandle:'toggle'},project));
 return {project,button,led,resistor:physicalResistor,input,output,power,ground,edge,action};
}

export function buttonInputCases(){
 const cases=[];
 for(const boardId of BUTTON_BOARDS){
  for(const pull of ['up','down','external-up','external-down']){
   if(boardId.startsWith('arduino')&&pull==='down')continue;
   cases.push([boardId+'-button-'+pull,buttonInputProject({boardId,pull}).project]);
  }
  for(const [pull,activeLevel]of [['module','low'],['module','high'],['none','high'],['external-up','low'],['external-down','high']])cases.push([boardId+'-button-module-'+pull+'-'+activeLevel,buttonInputProject({boardId,module:true,pull,activeLevel}).project]);
 }
 return cases;
}

export function combinedButtonProject(boardId='esp32-c3-super-mini'){
 let {project,action}=buttonInputProject({boardId,module:true,pull:'external-down',activeLevel:'high'});
 const board=catalog.boards.find(b=>b.id===boardId),module=catalog.modules.find(m=>m.id==='clex.hardware.button');
 for(const pull of ['up',board.platform==='arduino-avr'?'external-up':'down']){
  project=addHardware(project,module,catalog);const button=project.components.at(-1);button.parameters.pull=pull;
  const input=board.pins.find(pin=>!connectionProblem(project,catalog,button.id,'signal',pin.id));
  project=connectTerminal(project,catalog,button.id,'signal',input.id);
  project=connectTerminal(project,catalog,button.id,'ground',board.pins.find(pin=>pull.endsWith('down')?pin.kind==='power'&&pin.voltage===(board.logicVoltage||3.3):pin.kind==='ground').id);
  if(pull.startsWith('external-')){
   project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.resistor'),catalog);const resistor=project.components.at(-1);
   project=connectTerminal(project,catalog,resistor.id,'a',componentContact(button.id,'signal'));
   project=connectTerminal(project,catalog,resistor.id,'b',board.pins.find(pin=>pin.kind==='power'&&pin.voltage===(board.logicVoltage||3.3)).id);
  }
  project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.gpio-edge'),project.components,project,catalog));const edge=project.logic.nodes.at(-1);edge.parameters.componentId=button.id;
  project=withLogic(project,connectNodes(project.logic,catalog,{source:edge.id,sourceHandle:'active',target:action.id,targetHandle:'toggle'},project));
 }
 return project;
}
