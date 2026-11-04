import MicAudioLines from '../components/MicAudioLines.jsx';
import {useState} from 'react';
import {Mic,Gauge,Wifi,ToggleRight,RotateCw,Search,Plus,Timer,ScanLine,ArrowUpRight,Repeat2,Terminal,Box,Layers,Monitor,Hash,Network,Globe,Camera,Volume2,Radio,GitBranch,Thermometer} from 'lucide-react';
import {TYPE_COLORS,TYPE_NAMES} from './model.js';
import {logicLibraryEntries} from './library.js';
const icons={MicAudioLines,Mic,Gauge,Wifi,ToggleRight,RotateCw,Timer,ScanLine,ArrowUpRight,Repeat2,Terminal,Monitor,Hash,Network,Globe,Camera,Volume2,Radio,GitBranch,Thermometer};
export default function LogicLibrary({modules,project,catalog,busy,onAdd}){
 const [search,setSearch]=useState(''),[category,setCategory]=useState('all');
 const entries=logicLibraryEntries(modules,project,catalog);
 const categories=[...new Map(entries.map(({module})=>[module.category,module.categoryName])).entries()];
 const query=search.trim().toLocaleLowerCase('ru');
 const visible=entries.filter(entry=>(category==='all'||entry.module.category===category)&&[entry.name,entry.group,entry.module.name,entry.module.description].join(' ').toLocaleLowerCase('ru').includes(query));
 const groups=[...project.components.map(component=>component.name),'Общие блоки'].filter((name,index,items)=>items.indexOf(name)===index);
 return <><div className="panel-label">ДЕЙСТВИЯ И СОБЫТИЯ</div>
  <label className="search component-search"><Search size={14}/><input aria-label="Поиск блоков" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Кнопка, светодиод, таймер…"/></label>
  <div className="category-filter"><button className={category==='all'?'active':''} onClick={()=>setCategory('all')}>Все</button>{categories.map(([id,name])=><button key={id} className={category===id?'active':''} onClick={()=>setCategory(id)}>{name}</button>)}</div>
  <div className="logic-library">{groups.map(group=>{
   const items=visible.filter(entry=>entry.group===group);if(!items.length)return null;
   return <section className="logic-library-group" key={group}><div className="panel-label library-title">{group}</div><div className="hardware-library">{items.map(entry=>{const Icon=icons[entry.module.icon]||Box;return <button key={entry.key} className="hardware-library-item" onClick={()=>onAdd(entry.module,entry.component?.id)} disabled={busy||Boolean(entry.problem)} title={entry.problem||entry.module.description} aria-label={'Добавить блок: '+entry.name+(entry.component?' · '+entry.component.name:'')}><span style={{color:entry.module.color}}><Icon size={20}/></span><div><strong>{entry.name}</strong></div><Plus size={14}/></button>;})}</div></section>;
  })}{!visible.length&&<p className="panel-note">Блоки не найдены.</p>}</div>
  {!project.components.length&&<p className="panel-note">Добавьте устройства в «Монтаже». Здесь появятся их события и действия.</p>}
  <div className="panel-label library-title">СВЯЗИ</div><div className="logic-type-legend">{Object.entries(TYPE_NAMES).map(([type,name])=><span key={type}><i style={{background:TYPE_COLORS[type]}}/>{name}</span>)}</div>
  <p className="panel-note">Соедините событие с нужным действием. Например, «Кнопка нажата» → «Переключить».</p><div className="library-bottom"><Layers size={14}/>Действия устройств из монтажа</div>
 </>;
}
