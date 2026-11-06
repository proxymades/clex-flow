import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';

export function synchronizationProject(boardId='waveshare-esp32-s3-eth',eventCount=2) {
 const board=catalog.boards.find(b=>b.id===boardId);
 let p=createProject('Синхронизация','',boardId,Object.fromEntries(Object.entries(board.options).map(([key,value])=>[key,value.default])));
 let graph=p.logic;
 const add=(id,params={})=>{
  graph=addNode(graph,catalog.modules.find(m=>m.id===id),p.components,{...p,logic:graph},catalog);
  const node=graph.nodes.at(-1); Object.assign(node.parameters,params);return node;
 };
 const start=add('clex.logic.timer',{intervalMs:5000});
 const sync=add('clex.logic.synchronize',{eventCount});
 const sink=add('clex.logic.serial',{message:'Все события получены'});
 const link=(source,sourceHandle,target,targetHandle)=>{
  graph=connectNodes(graph,catalog,{source:source.id,sourceHandle,target:target.id,targetHandle},{...p,logic:graph});
 };
 link(start,'tick',sync,'start');
 for(let slot=1;slot<=eventCount;slot++) {
  const event=add('clex.logic.timer',{intervalMs:500+slot*100});
  link(event,'tick',sync,'event'+slot);
 }
 link(sync,'done',sink,'trigger');
 return {project:withLogic(p,graph),sync};
}
