export const RELAY_MODULE='clex.hardware.relay';
export const RELAY_SUPPLY_VOLTAGES=['3.3','5','6','9','12','24','48'];
// Relay 1.0 projects created before selectable supply voltage used 5 V.
export const relayParameters=component=>({supplyVoltage:'5',...component?.parameters});
export function relaySupplyVoltage(component){
 const value=relayParameters(component).supplyVoltage;
 return RELAY_SUPPLY_VOLTAGES.includes(value)?Number(value):0;
}
export const relayVoltageLabel=component=>relaySupplyVoltage(component)?String(relaySupplyVoltage(component)).replace('.',',')+' В':'не задано';
export function relayChannelCount(component){
 const value=component?.parameters?.channels;
 return typeof value==='string'&&/^(?:[1-9]|1[0-6])$/.test(value)?Number(value):0;
}
export function relayPowerProblem(component,pin){
 const p=relayParameters(component),label=relayVoltageLabel(component),voltage=relaySupplyVoltage(component);
 if(!voltage)return 'Выберите напряжение питания реле.';
 if(p.powerSource==='external')return 'VCC питается от внешнего источника '+label+'. Для соединения с платой измените источник питания модуля.';
 if(voltage>5)return 'Для питания реле '+label+' выберите внешний источник. Питание от платы недоступно.';
 if(pin?.kind!=='power'||pin.voltage!==voltage)return 'Для VCC реле нужен контакт питания '+label+'. Напряжение контакта платы должно совпадать с выбранным питанием модуля.';
 return null;
}
export function relayPowerWarning(component,pin){
 return (pin?.powerNote?pin.powerNote+' ':'')+'Питание реле от платы может вызвать просадки напряжения и перезапуск микроконтроллера. Рекомендуется внешний источник '+relayVoltageLabel(component)+' с общим GND.';
}
export function resolveRelayModule(component,module){
 if(module?.id!==RELAY_MODULE)return module;
 const count=relayChannelCount(component),voltage=relaySupplyVoltage(component),label=relayVoltageLabel(component),external=component.parameters.powerSource==='external';
 const parameters={...module.parameters,powerSource:{...module.parameters.powerSource,options:module.parameters.powerSource.options.map(option=>({...option,disabled:option.value==='board'&&voltage>5}))}};
 const terminals=module.terminals.filter(terminal=>!terminal.channel||terminal.channel<=count).map(terminal=>terminal.id==='power'?{...terminal,voltage,label:'VCC · '+(external?'внешние ':'')+label,...(external?{optional:true,externalPower:true,externalPowerLabel:'Внешние '+label}:{})}:terminal);
 return {...module,parameters,visual:{...module.visual,height:Math.max(230,160+(count-1)*35)},terminals};
}
