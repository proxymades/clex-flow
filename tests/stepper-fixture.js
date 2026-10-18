import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {componentContact} from '../src/assembly/endpoints.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
export function stepperProject(driverId='drv8825',boardId='waveshare-esp32-s3-eth'){
 let p=createProject('NEMA 17 + '+driverId,'',boardId,boardId.includes('p4')?{chipRevision:'pre-v3'}:{camera:'disconnected'});
 const motorModule=catalog.modules.find(m=>m.id==='clex.hardware.nema17'),driverModule=catalog.modules.find(m=>m.id==='clex.hardware.'+driverId);
 p=addHardware(p,motorModule,catalog);const motor=p.components.at(-1);p=addHardware(p,driverModule,catalog);const driver=p.components.at(-1);
 const board=catalog.boards.find(b=>b.id===boardId);
 p.assembly.positions[driver.id]={x:p.assembly.positions.board.x+board.width+150,y:120};p.assembly.positions[motor.id]={x:p.assembly.positions[driver.id].x+400,y:120};
 for(const terminal of driverModule.terminals.filter(t=>t.kind!=='winding-output')){
  const pin=board.pins.find(pin=>!connectionProblem(p,catalog,driver.id,terminal.id,pin.id));if(!pin)throw Error('No compatible pin for '+terminal.id);
  p=connectTerminal(p,catalog,driver.id,terminal.id,pin.id);
 }
 for(const id of ['a1','a2','b1','b2'])p=connectTerminal(p,catalog,motor.id,id,componentContact(driver.id,id));
 let graph=addNode(p.logic,catalog.modules.find(m=>m.id==='clex.logic.timer'),p.components,p,catalog),timer=graph.nodes.at(-1);
 timer.parameters.intervalMs=5000;
 graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.stepper'),p.components,p,catalog);const motion=graph.nodes.at(-1);
 graph=connectNodes(graph,catalog,{source:timer.id,sourceHandle:'tick',target:motion.id,targetHandle:'trigger'},{...p,logic:graph});
 return {project:withLogic(p,graph),driver,motor,motion,timer};
}
