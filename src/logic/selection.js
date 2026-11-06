export const SELECTION_MODULE='clex.logic.select-number';
export const MAX_SELECTION_CASES=16;
export const SELECTION_TYPES=['number','text','boolean'];
export const selectionType=node=>node.parameters.valueType;

export function selectionRows(node){
 const p=node.parameters,type=selectionType(node);
 if(type==='boolean')return [{id:'yes',value:true},{id:'no',value:false}];
 let rows;
 if(typeof p.cases!=='string'||p.cases.length>32768)throw new Error('Некорректный список вариантов.');
 try{rows=JSON.parse(p.cases);}catch{throw new Error('Не удалось прочитать варианты выбора.');}
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_SELECTION_CASES)throw new Error('Добавьте от 1 до 16 вариантов.');
 const ids=new Set();
 for(const row of rows){
  if(!row||!/^case[1-9][0-9]{0,5}$/.test(row.id)||ids.has(row.id))throw new Error('Некорректный идентификатор варианта.');
  ids.add(row.id);
 }
 return rows;
}
export function selectionIssues(node){
 if(node.moduleId!==SELECTION_MODULE)return [];
 const type=selectionType(node);
 if(!SELECTION_TYPES.includes(type))return ['Выберите тип значения: Число, Текст или Да/Нет.'];
 let rows;
 try{rows=selectionRows(node);}catch(error){return [error.message];}
 const values=new Set();
 for(const row of rows){
  if(type==='number'&&(!Number.isInteger(row.value)||row.value<-2147483648||row.value>2147483647))return ['Варианты должны быть целыми числами от -2147483648 до 2147483647.'];
  if(type==='text'&&(typeof row.value!=='string'||row.value.includes('\0')||new TextEncoder().encode(row.value).length>256))return ['Текст варианта должен содержать до 256 байт UTF-8 без нулевого символа.'];
  if(values.has(row.value))return ['Укажите разные значения вариантов.'];
  values.add(row.value);
 }
 return [];
}
export function selectionOutputs(node){
 let rows;
 try{rows=selectionRows(node);}catch{return [];}
 const type=selectionType(node);
 const outputs=rows.map(row=>({id:row.id,type:'event',name:type==='boolean'?(row.value?'Да':'Нет'):type==='text'?(row.value===''?'Пустой текст':'Текст «'+String(row.value)+'»'):'Значение '+String(row.value),description:'Срабатывает при точном совпадении с этим значением.'}));
 return type==='boolean'?outputs:[...outputs,{id:'other',type:'event',name:'Другое значение',description:'Срабатывает, если ни один вариант не совпал.'}];
}
export function selectionSummary(node){
 if(node.moduleId!==SELECTION_MODULE)return null;
 try{return selectionType(node)==='boolean'?'Да/Нет · две ветви':(selectionType(node)==='text'?'Текст':'Число')+' · вариантов: '+selectionRows(node).length;}catch{return 'Проверьте варианты выбора';}
}
