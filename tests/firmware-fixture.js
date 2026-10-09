import { createProject } from '../src/projects/model.js';
import { addHardware, connectTerminal } from '../src/assembly/model.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
import { catalog, led, button, timer, read, set, toggle, serial } from './catalog-fixture.js';
export function firmwareProject(all = false) {
 let project={...createProject('Firmware test'),boardSettings:{camera:'disconnected'}};
 project=addHardware(project,led);project=addHardware(project,button);
 for(const [index,terminal,pin] of [[0,'anode','P34'],[0,'cathode','P28'],[1,'signal','P32'],[1,'ground','P28']])project=connectTerminal(project,catalog,project.components[index].id,terminal,pin);
 let graph=project.logic;
 for(const module of all?[timer,read,set,toggle,serial,serial]:[timer,toggle,serial])graph=addNode(graph,module,project.components);
 const connect=(source,sourceHandle,target,targetHandle)=>{graph=connectNodes(graph,catalog,{source:graph.nodes[source].id,sourceHandle,target:graph.nodes[target].id,targetHandle});};
 if(all){connect(0,'tick',1,'trigger');connect(1,'done',2,'trigger');connect(1,'level',2,'value');connect(2,'done',3,'trigger');connect(3,'done',4,'trigger');connect(0,'interval',4,'number');connect(4,'done',5,'trigger');connect(4,'text',5,'text');graph.nodes[4].parameters.message='Привет "CLEX" %s \\ 🌡';}
 else{connect(0,'tick',1,'trigger');connect(1,'done',2,'trigger');connect(0,'interval',2,'number');}
 return withLogic(project,graph);
}
