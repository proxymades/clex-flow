import {selectionRows,selectionType} from '../../logic/selection.js';
// Both platforms select exactly one branch from the value sampled now.
export function selectNumberCode(node,expression,emit,{avr=false,cString,flashText=false,floatingNumber=false}={}){
 const type=selectionType(node),rows=selectionRows(node),integer=avr&&!floatingNumber;
 if(type==='boolean')return '  bool selected = (bool)('+expression+');\n  if (selected) {\n'+emit('yes')+'\n  } else {\n'+emit('no')+'\n  }';
 const code=[];
 if(type==='text'){
  if(flashText){
   code.push('  const char *selected_source = ('+expression+');','  char selected_copy[128];','  if (selected_source) {','    strncpy_P(selected_copy,selected_source,sizeof(selected_copy)-1);','    selected_copy[127]=0;','  }','  const char *selected = selected_source ? selected_copy : NULL;');
  }else code.push('  const char *selected = ('+expression+');');
 }else code.push('  '+(integer?'int64_t':'double')+' selected = ('+(integer?'int64_t':'double')+')('+expression+');');
 rows.forEach((row,index)=>{
  const match=type==='text'?'selected && '+(avr?'strcmp_P(selected,PSTR('+cString(row.value)+'))':'strcmp(selected,'+cString(row.value)+')')+' == 0':'selected == '+row.value+(integer?'LL':'.0');
  code.push('  '+(index?'else if':'if')+' ('+match+') {',emit(row.id),'  }');
 });
 code.push('  else {',emit('other'),'  }');
 return code.join('\n');
}
