import {catalog} from './catalog-fixture.js';
import {displayProject} from './display-fixture.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {newIndicator} from '../src/displays/indicator.js';
import {screenCommands} from '../src/displays/model.js';
export function eventIndicatorProject(){
 let project=displayProject();const display=project.components[0],board=catalog.boards.find(b=>b.id===project.boardId);
 project.screens[display.id].elements=[newIndicator(catalog.modules.find(m=>m.id===display.moduleId).display)];
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.button'),catalog);const button=project.components.at(-1);
 for(const terminal of ['signal','ground'])project=connectTerminal(project,catalog,button.id,terminal,board.pins.find(pin=>!connectionProblem(project,catalog,button.id,terminal,pin.id)).id);
 let graph=addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.gpio-edge'),project.components,project,catalog);
 const source=graph.nodes.at(-1),view=graph.nodes.find(n=>n.moduleId==='clex.logic.display'),commands=screenCommands(project.screens[display.id]);
 for(const [sourceHandle,command] of [['active',commands[1]],['inactive',commands[0]]])graph=connectNodes(graph,catalog,{source:source.id,sourceHandle,target:view.id,targetHandle:command.id},project);
 return withLogic(project,graph);
}
