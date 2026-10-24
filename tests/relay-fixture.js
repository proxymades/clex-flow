import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
const definition=id=>catalog.modules.find(module=>module.id===id);
export function relayProject({boardId='waveshare-esp32-s3-eth',channels='8',activeLevel='low',connected=[1,2]}={}){
 const board=catalog.boards.find(board=>board.id===boardId);
 let project=createProject('Relay','',boardId,Object.fromEntries(Object.entries(board.options||{}).map(([key,option])=>[key,option.default])));
 if(boardId==='waveshare-esp32-s3-eth')project.boardSettings.camera='disconnected';
 project=addHardware(project,definition('clex.hardware.relay'),catalog);
 const component=project.components.at(-1);Object.assign(component.parameters,{channels,activeLevel,powerSource:'board'});
 for(const [terminal,pin]of [['power',board.pins.find(pin=>pin.kind==='power'&&pin.voltage===5)],['ground',board.pins.find(pin=>pin.kind==='ground')]])project=connectTerminal(project,catalog,component.id,terminal,pin.id);
 for(const channel of connected){
  const terminal='in'+channel,pin=board.pins.find(pin=>!connectionProblem(project,catalog,component.id,terminal,pin.id));
  if(!pin)throw Error('No output pin for '+terminal+' on '+boardId);
  project=connectTerminal(project,catalog,component.id,terminal,pin.id);
 }
 let graph=addNode(project.logic,definition('clex.logic.timer'),project.components,project,catalog);const timer=graph.nodes.at(-1),blocks=[];
 for(const channel of connected)for(const action of ['on','off','toggle','set']){
  graph=addNode(graph,definition('clex.logic.relay'),project.components,{...project,logic:graph},catalog);
  const node=graph.nodes.at(-1);Object.assign(node.parameters,{componentId:component.id,channel:String(channel),action,defaultValue:false});blocks.push(node);
  graph=connectNodes(graph,catalog,{source:timer.id,sourceHandle:'tick',target:node.id,targetHandle:'trigger'},{...project,logic:graph});
 }
 project=withLogic(project,graph);
 return {project,component,blocks,timer};
}
