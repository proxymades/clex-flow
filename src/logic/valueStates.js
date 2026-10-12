import {graphModule,nodePorts} from './model.js';
import {nodeDisplayName} from './presentation.js';
export function valueStates(port){
 const descriptor=port?.valueStates,options=descriptor?.options;
 const valid=value=>port.type==='number'?Number.isFinite(value):port.type==='boolean'?typeof value==='boolean':port.type==='text'&&typeof value==='string'&&value.length<=200;
 if(!Array.isArray(options)||!options.length||options.length>32||options.some(option=>!option||!valid(option.value)||typeof option.label!=='string'||!option.label.trim()||option.label.length>80||!/^#[0-9a-f]{6}$/i.test(option.dotColor)))return null;
 if(new Set(options.map(option=>JSON.stringify(option.value))).size!==options.length)return null;
 return {...descriptor,options,initialValue:options.some(option=>option.value===descriptor.initialValue)?descriptor.initialValue:options[0].value,fallbackValue:options.some(option=>option.value===descriptor.fallbackValue)?descriptor.fallbackValue:options[0].value};
}
export function stateSources(project,catalog){
 return project.logic.nodes.filter(node=>graphModule(node,catalog)?.editor!=='screen').flatMap(node=>nodePorts(node,catalog,project).outputs.filter(port=>valueStates(port)).map(port=>({node,port,name:nodeDisplayName(node,project,catalog),key:JSON.stringify([node.id,port.id])})));
}
export function applyValueStates(element,port){
 const descriptor=valueStates(port);if(element.type!=='indicator'||!descriptor)throw new Error('Выберите источник с описанными состояниями.');
 const states=descriptor.options.map(option=>{
  const previous=element.valueType===port.type&&element.states.find(state=>state.value===option.value);
  const index=previous?element.states.indexOf(previous):-1;
  const generic=previous&&previous.name===`Состояние ${index+1}`&&previous.value===index;
  const defaultDot=['#a78bfa','#38bdf8'][index];
  return {id:previous?.id||crypto.randomUUID(),name:generic?option.label:previous?.name||option.label,value:option.value,text:generic&&previous.text===previous.name?option.label:previous?.text??option.label,background:previous?.background||'#1b2d42',color:previous?.color||'#ffffff',dotColor:generic&&previous.dotColor===defaultDot?option.dotColor:previous?.dotColor||option.dotColor};
 });
 const extra=element.valueType===port.type?element.states.filter(state=>!descriptor.options.some(option=>option.value===state.value)):[];states.push(...extra);
 if(states.length>32)throw new Error('Набор источника вместе с вашими состояниями превышает лимит 32.');
 const initialValue=states.some(state=>state.value===element.initialValue)?element.initialValue:descriptor.initialValue;
 return {...element,mode:'dynamic',valueType:port.type,states,initialValue,staticStateId:states.find(state=>state.value===initialValue).id,fallbackStateId:states.find(state=>state.value===descriptor.fallbackValue).id,editStateId:states[0].id};
}
