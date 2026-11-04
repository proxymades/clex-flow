import {catalog} from './catalog-fixture.js';
import {numericProject} from './numeric-fixture.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {newCondition} from '../src/logic/conditions.js';

export function conditionProject(boardId='waveshare-esp32-s3-eth',{combine='all',negate=false}={}) {
 let {project,nodes}=numericProject(boardId);
 const definition=id=>catalog.modules.find(m=>m.id==='clex.'+id);
 project=addHardware(project,definition('hardware.button'),catalog);
 const button=project.components.at(-1),board=catalog.boards.find(b=>b.id===boardId);
 for(const terminal of ['signal','ground']){
  const pin=board.pins.find(pin=>!connectionProblem(project,catalog,button.id,terminal,pin.id));
  project=connectTerminal(project,catalog,button.id,terminal,pin.id);
 }
 project=withLogic(project,addNode(project.logic,definition('logic.gpio-edge'),project.components,project,catalog));
 nodes.input=project.logic.nodes.at(-1);nodes.input.parameters.componentId=button.id;
 const rows=[{...newCondition('c1','number'),reference:100},{...newCondition('c2'),negate},{...newCondition('c3','text'),operator:'contains',reference:'Па'}];
 Object.assign(nodes.condition.parameters,{mode:'conditions',conditions:JSON.stringify(rows),combine});
 project.logic.edges=project.logic.edges.filter(e=>e.target!==nodes.condition.id&&e.source!==nodes.condition.id);
 const link=(from,sh,to,th)=>{project=withLogic(project,connectNodes(project.logic,catalog,{source:nodes[from].id,sourceHandle:sh,target:nodes[to].id,targetHandle:th},project));};
 for(const[from,sh,to,th]of [['parse','changed','condition','trigger'],['parse','value','condition','c1.value'],['input','activeState','condition','c2.value'],['source','text','condition','c3.value'],['input','active','condition','trigger'],['input','inactive','condition','trigger'],['condition','matched','low','on'],['condition','unmatched','low','off'],['condition','failed','low','off'],['condition','matched','high','off'],['condition','unmatched','high','off'],['condition','failed','high','off']])link(from,sh,to,th);
 for(const key of ['matched','unmatched','failed']){
  project=withLogic(project,addNode(project.logic,definition('logic.serial'),project.components,project,catalog));
  nodes[key]=project.logic.nodes.at(-1);nodes[key].parameters.message=key;link('condition',key,key,'trigger');
 }
 return {project,nodes,button};
}
