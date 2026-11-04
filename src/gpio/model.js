export const OUTPUT_MODULE='clex.logic.gpio-set';
export const outputChannelCount=component=>/^(?:[1-9]|1[0-6])$/.test(component?.parameters?.channels)?Number(component.parameters.channels):0;
export function outputTerminals(component,catalog){
 const module=catalog.modules.find(m=>m.id===component?.moduleId);
 if(!module||module.display||module.i2c||module.stepper||module.microphone||module.hardwareInterface||module.softwareInterface)return [];
 return (module.terminals||[]).filter(t=>t.kind==='gpio-output'&&(!t.channel||t.channel<=outputChannelCount(component)));
}
export function outputTerminalId(node,component,catalog){
 const terminals=outputTerminals(component,catalog);
 return outputChannelCount(component)?terminals.find(t=>String(t.channel)===node.parameters.channel)?.id:terminals[0]?.id;
}
