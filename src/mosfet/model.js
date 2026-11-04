export const MOSFET_MODULE='clex.hardware.mosfet';
export const isMosfet=component=>component?.moduleId===MOSFET_MODULE;
export function mosfetChannelCount(component){
 const value=component?.parameters?.channels;
 return typeof value==='string'&&/^(?:[1-9]|1[0-6])$/.test(value)?Number(value):0;
}
export function resolveMosfetModule(component,module){
 if(!isMosfet(component)||module?.id!==MOSFET_MODULE)return module;
 const count=mosfetChannelCount(component);
 return {...module,visual:{...module.visual,height:Math.max(195,160+(count-1)*35)},terminals:module.terminals.filter(terminal=>!terminal.channel||terminal.channel<=count)};
}
