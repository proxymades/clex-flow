import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';

export function temperatureProject(boardId='waveshare-esp32-s3-eth') {
  let project=createProject('Температура кристалла','',boardId,boardId.includes('-p4-')?{chipRevision:'pre-v3'}:{camera:'disconnected'});
  for(const id of ['clex.logic.temperature','clex.logic.serial'])project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id===id),project.components,project,catalog));
  const [sensor,output]=project.logic.nodes;
  for(const [sourceHandle,targetHandle] of [['changed','trigger'],['text','text']])project=withLogic(project,connectNodes(project.logic,catalog,{source:sensor.id,sourceHandle,target:output.id,targetHandle},project));
  return project;
}
