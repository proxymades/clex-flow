import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
export function touchButtonProject(boardId='waveshare-esp32-s3-eth',activeLevel='high'){
 const board=catalog.boards.find(b=>b.id===boardId);
 let project=createProject('Сенсорная кнопка','',boardId,{...Object.fromEntries(Object.entries(board.options||{}).map(([key,option])=>[key,option.default])),...(boardId==='waveshare-esp32-s3-eth'?{camera:'disconnected'}:{})});
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.touch-button'),catalog);const component=project.components[0];component.parameters.activeLevel=activeLevel;
 for(const terminal of ['power','ground','signal']){
  const pin=board.pins.find(pin=>!connectionProblem(project,catalog,component.id,terminal,pin.id));if(!pin)throw Error('Нет контакта для '+terminal);
  project=connectTerminal(project,catalog,component.id,terminal,pin.id);
 }
 let graph=project.logic;const nodes={};
 for(const [name,id]of [['edge','gpio-edge'],['counter','counter'],['serial','serial'],['read','gpio-read'],['off','serial']]){
  graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.'+id),project.components,project,catalog);nodes[name]=graph.nodes.at(-1);
 }
 nodes.serial.parameters.message='Касаний:';nodes.off.parameters.message='Сенсор выключен';
 for(const [source,sourceHandle,target,targetHandle]of [['edge','rising','counter','increment'],['counter','done','serial','trigger'],['counter','value','serial','number'],['edge','changed','read','trigger'],['edge','falling','off','trigger']]){
  graph=connectNodes(graph,catalog,{source:nodes[source].id,sourceHandle,target:nodes[target].id,targetHandle},{...project,logic:graph});
 }
 return {project:withLogic(project,graph),component,nodes};
}
