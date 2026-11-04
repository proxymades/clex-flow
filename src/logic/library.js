import {hardwareMatches,logicAdditionProblem} from './model.js';
import {moduleSupportsBoard} from '../catalog/compatibility.js';
import {moduleProblem} from '../assembly/model.js';

export function logicLibraryEntries(modules,project,catalog){
 const board=catalog.boards.find(item=>item.id===project.boardId);
 return modules.filter(module=>!module.hidden&&moduleSupportsBoard(module,board)).flatMap(module=>{
  const requirement=module.constraints.hardware;
  if(!requirement)return [{key:module.id,module,component:null,name:module.name,group:'Общие блоки',problem:logicAdditionProblem(module,project,catalog)}];
  return project.components.filter(component=>hardwareMatches(component,requirement,catalog)&&!moduleProblem(component,catalog,board)).map(component=>{
   const hardware=catalog.modules.find(item=>item.id===component.moduleId);
   const operation=module.id==='clex.logic.gpio-set'?'output':module.firmware.generatorKey.replace('gpio-','');
   return {key:component.id+'/'+module.id,module,component,name:hardware.logicPresentation?.[operation]?.title||module.name,group:component.name,problem:null};
  });
 });
}
