import {MAX_SELECTION_CASES,selectionRows,selectionType,selectionIssues} from './selection.js';
export default function SelectionSettings({node,busy,onChange}){
 const type=selectionType(node);
 let rows;try{rows=selectionRows(node);}catch{rows=[];}
 const save=next=>onChange(node.id,{parameters:{...node.parameters,cases:JSON.stringify(next)}});
 const errors=selectionIssues(node);
 return <div className="condition-settings">
  <label className="field">Тип значения<select aria-label="Тип значения" disabled={busy} value={type} onChange={event=>{
   const valueType=event.target.value;
   const next=valueType==='text'?[{id:'case1',value:''}]:[{id:'case1',value:0},{id:'case2',value:1}];
   onChange(node.id,{parameters:{...node.parameters,valueType,cases:valueType==='boolean'?'':JSON.stringify(next)}});
  }}><option value="number">Число</option><option value="text">Текст</option><option value="boolean">Да/Нет</option></select></label>
  <p className="panel-note">При смене типа подключённые данные и выходные ветви нужно соединить заново. Изменение можно отменить.</p>
  {errors.map(error=><p className="binding-error" role="alert" key={error}>{error}</p>)}
  {type==='boolean'?<p className="panel-note">Значение true запускает «Да», false – «Нет».</p>:<>
   {rows.map((row,index)=><section className="condition-row" key={row.id}>
    <label className="field">Вариант {index+1}<input aria-label={'Значение варианта '+(index+1)} disabled={busy} type={type==='number'?'number':'text'} min={type==='number'?-2147483648:undefined} max={type==='number'?2147483647:undefined} step={type==='number'?1:undefined} maxLength={256} value={row.value} onChange={event=>save(rows.map(item=>item.id===row.id?{...item,value:type==='number'?Number(event.target.value):event.target.value}:item))}/></label>
    <button className="text-button danger-hover" disabled={busy||rows.length===1} onClick={()=>save(rows.filter(item=>item.id!==row.id))}>Удалить вариант {index+1}</button>
   </section>)}
   <button className="button secondary" disabled={busy||rows.length>=MAX_SELECTION_CASES} onClick={()=>{
    let index=1;while(rows.some(row=>row.id==='case'+index))index++;
    let value='';if(type==='number'){value=0;while(rows.some(row=>row.value===value))value++;}
    save([...rows,{id:'case'+index,value}]);
   }}>Добавить вариант</button>
   <p className="panel-note">{type==='text'?'Сравнение точное, с учётом регистра и пробелов. Пустая строка тоже может быть вариантом.':'Варианты задаются целыми числами. Сравнение точное.'} Если совпадений нет, срабатывает «Другое значение».</p>
  </>}
  <p className="panel-note">Выбор выполняется по сигналу «Выбрать действие».</p>
 </div>;
}
