export const RELAY_MODULE='clex.hardware.relay';
export function relayChannelCount(component){
 const value=component?.parameters?.channels;
 return typeof value==='string'&&/^(?:[1-9]|1[0-6])$/.test(value)?Number(value):0;
}
export function resolveRelayModule(component,module){
 if(module?.id!==RELAY_MODULE)return module;
 const count=relayChannelCount(component);
 return {...module,visual:{...module.visual,height:Math.max(230,160+(count-1)*35)},terminals:module.terminals.filter(terminal=>!terminal.channel||terminal.channel<=count).map(terminal=>terminal.id==='power'&&component.parameters.powerSource==='external'?{...terminal,label:'VCC · внешние 5 В',optional:true,externalPower:true}:terminal)};
}
