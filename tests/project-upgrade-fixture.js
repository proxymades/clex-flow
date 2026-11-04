import {firmwareProject} from './firmware-fixture.js';
export const edge = (source,sourceHandle,target,targetHandle,dataType='event') => ({id:crypto.randomUUID(),source,sourceHandle,target,targetHandle,dataType});
export const versions = p => {p.moduleVersions=Object.fromEntries([...p.components,...p.logic.nodes].map(n=>[n.moduleId,n.moduleVersion]));return p;};
export function oldBlink() {
  const p=firmwareProject();p.formatVersion=3;
  const output=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-set');
  output.moduleId='clex.logic.gpio-toggle';
  p.logic.edges.find(e=>e.target===output.id).targetHandle='trigger';
  return versions(p);
}
export function ambiguousProject() {
  const p=firmwareProject(true);p.formatVersion=3;
  const timer=p.logic.nodes.find(n=>n.moduleId==='clex.logic.timer'),read=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-read'),output=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-set');
  output.parameters.defaultValue=true;
  p.logic.edges=p.logic.edges.filter(e=>e.target!==output.id);
  p.logic.edges.push(edge(read.id,'level',output.id,'value','boolean'),edge(timer.id,'tick',output.id,'trigger'));
  return versions(p);
}
