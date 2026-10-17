import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';

export function selectNumberProject(boardId='waveshare-esp32-s3-eth',parameters={}) {
  const board=catalog.boards.find(board=>board.id===boardId);
  let project=createProject('Выбор по значению','',boardId,Object.fromEntries(Object.entries(board.options||{}).map(([key,option])=>[key,option.default])));
  let graph=project.logic;
  const nodes={};
  for(const [key,id] of [['timer','timer'],['counter','counter'],['select','select-number'],['first','serial'],['second','serial'],['other','serial']]) {
    graph=addNode(graph,catalog.modules.find(module=>module.id==='clex.logic.'+id),[],project,catalog);
    nodes[key]=graph.nodes.at(-1);
    if(id==='serial')nodes[key].parameters.message=key;
  }
  Object.assign(nodes.select.parameters,parameters);
  for(const [source,sourceHandle,target,targetHandle] of [
    ['timer','tick','counter','increment'],['counter','done','select','trigger'],['counter','value','select','value'],
    ['select','first','first','trigger'],['select','second','second','trigger'],['select','other','other','trigger'],
  ]) graph=connectNodes(graph,catalog,{source:nodes[source].id,sourceHandle,target:nodes[target].id,targetHandle},{...project,logic:graph});
  project=withLogic(project,graph);
  return {project,nodes};
}
