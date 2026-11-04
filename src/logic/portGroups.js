// Direction describes who uses the contact; sections describe its purpose.
export function portSections(ports) {
 return [
  {id:'signals',inputTitle:'Команды',outputTitle:'События',inputs:ports.inputs.filter(p=>p.type==='event'),outputs:ports.outputs.filter(p=>p.type==='event')},
  {id:'data',inputTitle:'Данные',outputTitle:'Данные',inputs:ports.inputs.filter(p=>p.type!=='event'),outputs:ports.outputs.filter(p=>p.type!=='event')},
 ].filter(section=>section.inputs.length||section.outputs.length);
}
export const portRowCount=ports=>portSections(ports).reduce((sum,section)=>sum+Math.max(section.inputs.length,section.outputs.length),0);
