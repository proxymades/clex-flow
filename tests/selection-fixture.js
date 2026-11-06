import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {selectionOutputs} from '../src/logic/selection.js';
export function selectionProject(type='text',boardId='waveshare-esp32-s3-eth',values=null){
 const board=catalog.boards.find(item=>item.id===boardId);
 let project=createProject('Выбор '+type,'',boardId,Object.fromEntries(Object.entries(board.options||{}).map(([key,option])=>[key,option.default])));
 const add=id=>{project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.'+id),[],project,catalog));return project.logic.nodes.at(-1);};
 const timer=add('timer'),source=add(type==='number'?'counter':'serial');
 if(type!=='number')source.parameters.message='ON';
 let producer=source;
 if(type==='boolean')producer=add('text-to-number');
 const select=add('select-number');
 select.parameters.valueType=type;
 select.parameters.cases=type==='boolean'?'':JSON.stringify((values||(type==='number'?[0,1,2]:['ON','OFF','GROUP ON','GROUP OFF'])).map((value,i)=>({id:'case'+(i+1),value})));
 const sinks=Object.fromEntries(selectionOutputs(select).map(port=>{const node=add('serial');node.parameters.message=port.id;return [port.id,node];}));
 const connect=(from,output,to,input)=>{project=withLogic(project,connectNodes(project.logic,catalog,{source:from.id,sourceHandle:output,target:to.id,targetHandle:input},project));};
 connect(timer,'tick',source,type==='number'?'increment':'trigger');
 if(type==='boolean'){connect(source,'done',producer,'trigger');connect(source,'text',producer,'text');}
 connect(producer,type==='boolean'?'changed':'done',select,'trigger');
 connect(producer,type==='boolean'?'valid':type==='number'?'value':'text',select,'value');
 for(const [id,node]of Object.entries(sinks))connect(select,id,node,'trigger');
 return {project,select,source:producer,sinks};
}
