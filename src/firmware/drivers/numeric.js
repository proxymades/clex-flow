import {conditionCode} from './condition-code.js';
import {readConditions} from '../../logic/conditions.js';
import {TEXT_TO_NUMBER,NUMERIC_MODULES} from '../../logic/numeric.js';
import {NUMERIC_RUNTIME} from './numeric-runtime.js';

const literal=value=>/[.e]/i.test(String(value))?String(value):String(value)+'.0';
export function numericFirmware(nodes,index,cString,{avr=false,project=null}={}) {
 const blocks=nodes.filter(node=>NUMERIC_MODULES.has(node.moduleId));
 const expressions=new Map(),textSizes=new Map(),textGlyphs=new Map(),operations=new Map();
 let ram=0;
 const declarations=blocks.map(node=>{
  const name='numeric_'+index.get(node.id),parse=node.moduleId===TEXT_TO_NUMBER;
  expressions.set(node.id,parse?{value:name+'.value',valid:name+'.valid',error:name+'.error'}:{value:name+'.value',valid:name+'.valid',result:name+'.result',isBelow:name+'.below',isInside:name+'.inside',isAbove:name+'.above',error:name+'.error'});
  textSizes.set(node.id,{error:96});
  textGlyphs.set(node.id,'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя');
  if(!parse&&node.parameters.mode==='conditions'){
   const rows=readConditions(node);
   const flashBuffers=avr?Math.max(...rows.map(row=>row.type==='text'?['value','reference'].reduce((size,port)=>{
    const edge=project?.logic.edges.find(e=>e.target===node.id&&e.targetHandle===row.id+'.'+port);
    return size+(edge?.sourceHandle==='error'&&nodes.find(n=>n.id===edge.source)?.moduleId==='clex.logic.stepper'?128:0);
   },0):0)):0;
   ram+=rows.reduce((sum,row)=>sum+(row.type==='text'?new TextEncoder().encode(row.reference).length+1:0),0)+flashBuffers+(avr&&rows.some(row=>row.type==='number')?112:0);
  }
  ram+=parse?112+new TextEncoder().encode((node.parameters.prefix||'')+(node.parameters.suffix||'')).length+2:112;
  operations.set(node.id,({inputEdge,dataExpression,emit})=>{
   const p=node.parameters;
   if(!parse&&p.mode==='conditions')return conditionCode(node,name,{inputEdge,dataExpression,emit},cString,nodes,avr);
   if(parse){
    const prefix=p.format==='affixes'?p.prefix:'',suffix=p.format==='affixes'?p.suffix:'';
    return '  clex_text_number_parse(&'+name+','+dataExpression(inputEdge(node,'text'))+','+cString(prefix)+','+cString(suffix)+','+({either:0,dot:1,comma:2}[p.decimalSeparator])+');\n'+emit('changed')+'\n  if('+name+'.valid){\n'+emit('done')+'\n  }else{\n'+emit('failed')+'\n  }';
   }
   const get=port=>{const edge=inputEdge(node,port);return edge?dataExpression(edge):literal(p[port]);};
   const range=p.mode==='range',operator=['lt','lte','eq','neq','gte','gt'].indexOf(p.operator);
   const action='  clex_number_evaluate(&'+name+','+dataExpression(inputEdge(node,'value'))+','+range+','+(range?0:operator)+','+(range?'0.0':get('reference'))+','+(range?get('lower'):'0.0')+','+(range?get('upper'):'0.0')+','+(range?p.includeLower:true)+','+(range?p.includeUpper:true)+','+(range?'0.0':literal(p.tolerance))+');\n'+emit('changed')+'\n  if(!'+name+'.valid){\n'+emit('failed')+'\n  }';
   return action+(range?'else if('+name+'.below){\n'+emit('below')+'\n  }else if('+name+'.above){\n'+emit('above')+'\n  }else{\n'+emit('inside')+'\n  }':'else if('+name+'.result){\n'+emit('matched')+'\n  }else{\n'+emit('unmatched')+'\n  }');
  });
  if(avr)return parse?'static clex_text_number_t '+name+' = {NAN,false,{0}};':'static clex_number_condition_t '+name+' = {NAN,false,false,false,false,false,{0}};';
  return parse?'static clex_text_number_t '+name+' = {.value=NAN,.valid=false,.error=""};':'static clex_number_condition_t '+name+' = {.value=NAN,.valid=false,.result=false,.below=false,.inside=false,.above=false,.error=""};';
 });
 return {enabled:blocks.length>0,source:blocks.length?NUMERIC_RUNTIME+'\n'+declarations.join('\n'):'',expressions,textSizes,textGlyphs,operations,ram:ram+(blocks.some(n=>n.moduleId===TEXT_TO_NUMBER)?80:0)};
}
