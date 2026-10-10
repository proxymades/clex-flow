import { createProject } from '../src/projects/model.js';
import { addHardware, connectTerminal } from '../src/assembly/model.js';
import { addNode, withLogic } from '../src/logic/model.js';
import { catalog, eth } from './catalog-fixture.js';
export const displayModule = catalog.modules.find(module => module.display);
export const screenModule = catalog.modules.find(module => module.editor === 'screen');
export function displayProject() {
 let project = {...createProject('Display test'), boardSettings:{camera:'disconnected'}};
 project = addHardware(project, displayModule);
 const id = project.components[0].id;
 for (const [terminal,gpio] of [['sclk',16],['mosi',17],['cs',18],['dc',15],['reset',38]]) project = connectTerminal(project,catalog,id,terminal,eth.pins.find(pin=>pin.gpio===gpio).id);
 project = connectTerminal(project,catalog,id,'gnd','P28');
 project = connectTerminal(project,catalog,id,'vcc',eth.pins.find(pin=>pin.kind==='power'&&pin.voltage===3.3).id);
 const graph = addNode(project.logic,screenModule,project.components);
 graph.nodes[0].parameters.componentId = id;
 project = withLogic(project,graph);
 project.screens = {[id]:{formatVersion:1,background:'#123456',elements:[{id:crypto.randomUUID(),type:'text',text:'Привет, мир! CLEX Flow',x:8,y:30,fontId:'montserrat_14',color:'#ffdd00'}]}};
 return project;
}
