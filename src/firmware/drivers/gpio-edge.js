import {hardwareBinding}from '../../logic/model.js';
export function gpioEdgeFirmware(project,catalog,nodes,index,hardware){
 const edges=nodes.filter(n=>n.moduleId==='clex.logic.gpio-edge'),expressions=new Map();
 for(const n of edges)expressions.set(n.id,{level:'gpio_edge_'+index.get(n.id)});
 return {enabled:Boolean(edges.length),expressions,eventModules:new Set(edges.length?['clex.logic.gpio-edge']:[]),source:edges.map(n=>'static bool gpio_edge_'+index.get(n.id)+';').join('\n'),
 initialize:edges.map(n=>'  gpio_edge_'+index.get(n.id)+' = input_stable_'+hardware.get(hardwareBinding(n,project,catalog).component.id)+';').join('\n'),
 poll:edges.map(n=>{const i=index.get(n.id),h=hardware.get(hardwareBinding(n,project,catalog).component.id);return `    if(gpio_edge_${i} != input_stable_${h}){gpio_edge_${i}=input_stable_${h};node_${i}_emit_changed();if(gpio_edge_${i})node_${i}_emit_rising();else node_${i}_emit_falling();}`;}).join('\n')};
}
