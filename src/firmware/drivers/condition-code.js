import {readConditions} from '../../logic/conditions.js';

export function conditionCode(node, name, context, cString, nodes, avr) {
 const {inputEdge,dataExpression,emit}=context, rows=readConditions(node), all=node.parameters.combine==='all';
 const code=[`  ${name}.valid=true; ${name}.result=false; ${name}.value=NAN; ${name}.below=false; ${name}.inside=false; ${name}.above=false; ${name}.error[0]=0;`, `  bool combined=${all};`];
 for(const row of rows){
  const edge=inputEdge(node,row.id+'.value'),reference=inputEdge(node,row.id+'.reference');
  const value=dataExpression(edge),expected=reference?dataExpression(reference):row.type==='text'?cString(row.reference):String(row.reference);
  code.push('  { bool matched=false;');
  if(row.type==='number'){
   code.push(`    clex_number_condition_t comparison; clex_number_evaluate(&comparison,${value},false,${['lt','lte','eq','neq','gte','gt'].indexOf(row.operator)},${expected},0,0,true,true,${row.tolerance});`,
    `    if(!comparison.valid){${name}.valid=false; if(!${name}.error[0])snprintf(${name}.error,sizeof(${name}.error),"%s",comparison.error);} matched=comparison.result;`);
  }else if(row.type==='boolean')code.push(`    matched=(${value}) ${row.operator==='neq'?'!=':'=='} (${expected});`);
  else{
   const text=(link,expression,key)=>{
    if(avr&&link?.sourceHandle==='error'&&nodes.find(n=>n.id===link.source)?.moduleId==='clex.logic.stepper'){
     code.push(`    char ${key}_copy[128]; strncpy_P(${key}_copy,${expression},sizeof(${key}_copy)-1); ${key}_copy[127]=0; const char *${key}=${key}_copy;`);
    }else code.push(`    const char *${key}=${expression};`);
   };
   text(edge,value,'actual');text(reference,expected,'expected');
   const compare={eq:'strcmp(actual,expected)==0',neq:'strcmp(actual,expected)!=0',contains:'strstr(actual,expected)!=NULL',starts:'strncmp(actual,expected,strlen(expected))==0',ends:'strlen(actual)>=strlen(expected)&&strcmp(actual+strlen(actual)-strlen(expected),expected)==0'}[row.operator];
   code.push(`    if(!actual||!expected){${name}.valid=false; snprintf(${name}.error,sizeof(${name}.error),"%s","Нет входного текста");}else{matched=(${compare});}`);
  }
  code.push(`    combined=combined ${all?'&&':'||'} ${row.negate?'!':''}matched;`, '  }');
 }
 code.push(`  ${name}.result=${name}.valid&&combined;`,emit('changed'),`  if(!${name}.valid){`,emit('failed'),`  }else if(${name}.result){`,emit('matched'),'  }else{',emit('unmatched'),'  }');
 return code.join('\n');
}
