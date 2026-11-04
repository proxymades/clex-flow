import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
export const MOSFET_BOARDS=['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'];
const definition=id=>catalog.modules.find(module=>module.id===id);
export function mosfetProject({boardId='waveshare-esp32-p4-nano',channels='2',activeLevel='high',connected=[1,2]}={}){
 const board=catalog.boards.find(board=>board.id===boardId);
 let project=createProject('MOSFET','',boardId,Object.fromEntries(Object.entries(board.options||{}).map(([key,option])=>[key,option.default])));
 if(boardId==='waveshare-esp32-s3-eth')project.boardSettings.camera='disconnected';
 project=addHardware(project,definition('clex.hardware.mosfet'),catalog);
 const component=project.components.at(-1);Object.assign(component.parameters,{channels,activeLevel});
 project=connectTerminal(project,catalog,component.id,'ground',board.pins.find(pin=>pin.kind==='ground').id);
 for(const channel of connected){
  const terminal='in'+channel,pin=board.pins.find(pin=>!connectionProblem(project,catalog,component.id,terminal,pin.id));
  if(!pin)throw Error('No output pin for '+terminal+' on '+boardId);
  project=connectTerminal(project,catalog,component.id,terminal,pin.id);
 }
 let graph=addNode(project.logic,definition('clex.logic.timer'),project.components,project,catalog);
 const timer=graph.nodes.at(-1),blocks=[];
 for(const channel of connected){
  graph=addNode(graph,definition('clex.logic.gpio-set'),project.components,{...project,logic:graph},catalog);
  const node=graph.nodes.at(-1);Object.assign(node.parameters,{componentId:component.id,channel:String(channel)});blocks.push({node,channel});
  graph=connectNodes(graph,catalog,{source:timer.id,sourceHandle:'tick',target:node.id,targetHandle:'toggle'},{...project,logic:graph});
 }
 return {project:withLogic(project,graph),component,blocks,timer};
}
