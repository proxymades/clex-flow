import {MAX_CONDITIONS,NUMBER_OPERATORS,TEXT_OPERATORS,newCondition,readConditionRows,readConditions} from './conditions.js';

export default function ConditionSettings({node,busy,onChange}) {
 if(node.parameters.mode!=='conditions')return null;
 let rows,error;
 try{rows=readConditions(node);}catch(cause){error=cause.message;try{rows=readConditionRows(node);}catch{rows=[];}}
 const save=next=>onChange(node.id,{parameters:{...node.parameters,conditions:JSON.stringify(next)}});
 const update=(id,patch)=>save(rows.map(row=>row.id===id?{...row,...patch}:row));
 return <div className="condition-settings">
  <label className="field">Объединение условий<select aria-label="Объединение условий" disabled={busy} value={node.parameters.combine||'all'} onChange={event=>onChange(node.id,{parameters:{...node.parameters,combine:event.target.value}})}><option value="all">И – выполнены все условия</option><option value="any">ИЛИ – выполнено хотя бы одно</option></select></label>
  {error&&<p className="binding-error" role="alert">{error}</p>}
  {rows.map((row,index)=><section className="condition-row" key={row.id}>
   <strong>Условие {index+1}</strong>
   <label className="field">Тип данных<select aria-label={'Тип данных условия '+(index+1)} disabled={busy} value={row.type} onChange={event=>update(row.id,newCondition(row.id,event.target.value))}><option value="boolean">Да/Нет</option><option value="number">Число</option><option value="text">Текст</option></select></label>
   {row.type!=='boolean'&&<label className="field">Сравнение<select aria-label={'Сравнение условия '+(index+1)} disabled={busy} value={row.operator} onChange={event=>update(row.id,{operator:event.target.value})}>{(row.type==='number'?NUMBER_OPERATORS:TEXT_OPERATORS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
   <label className="field">Сравнить со значением{row.type==='boolean'?<select aria-label={'Значение условия '+(index+1)} disabled={busy} value={String(row.reference)} onChange={event=>update(row.id,{reference:event.target.value==='true'})}><option value="true">Да</option><option value="false">Нет</option></select>:<input aria-label={'Значение условия '+(index+1)} type={row.type==='number'?'number':'text'} min={row.type==='number'?-1e12:undefined} max={row.type==='number'?1e12:undefined} step="any" maxLength={256} disabled={busy} value={row.reference} onChange={event=>update(row.id,{reference:row.type==='number'?Number(event.target.value):event.target.value})}/>}</label>
   {row.type==='number'&&['eq','neq'].includes(row.operator)&&<label className="field">Допуск равенства<input aria-label={'Допуск условия '+(index+1)} type="number" min={0} max={1e12} step="any" value={row.tolerance} disabled={busy} onChange={event=>update(row.id,{tolerance:Number(event.target.value)})}/></label>}
   <label className="checkbox-field"><input aria-label={'НЕ для условия '+(index+1)} type="checkbox" checked={row.negate} disabled={busy} onChange={event=>update(row.id,{negate:event.target.checked})}/>НЕ – противоположный результат</label>
   <p className="panel-note">Подключите данные к входу «Условие {index+1}». Вход «сравнить с» позволяет взять второе значение у другого блока.</p>
   <button className="text-button danger-hover" disabled={busy||rows.length===1} onClick={()=>save(rows.filter(item=>item.id!==row.id))}>Удалить условие {index+1}</button>
  </section>)}
  <button className="button secondary" disabled={busy||rows.length>=MAX_CONDITIONS} onClick={()=>{let index=1;while(rows.some(row=>row.id==='c'+index))index++;save([...rows,newCondition('c'+index)]);}}>Добавить условие</button>
  <p className="panel-note">Данные проверяются по команде «Проверить». Изменение данных само по себе проверку не запускает. Некорректное число вызывает «Ошибка проверки».</p>
 </div>;
}
