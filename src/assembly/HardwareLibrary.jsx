import { useState } from 'react';
import { Cpu, Search, Plus, Lightbulb, MousePointer2, Box, Check, Monitor } from 'lucide-react';
const icons = { Lightbulb, MousePointer2, Monitor };

export default function HardwareLibrary({ boards, modules, board, busy, onBoard, onAdd }) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all');
  const categories = [...new Map(modules.map(module => [module.category, module.categoryName])).entries()];
  const visible = modules.filter(module => (category === 'all' || module.category === category) && `${module.name} ${module.description}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
  return <><div className="panel-label">КАТАЛОГ ПЛАТ</div><div className="board-list">{boards.map(item => <button key={item.id} disabled={busy} className={`board-option ${item.id === board?.id ? 'chosen' : ''}`} onClick={() => onBoard(item)}><Cpu size={18} /><div><strong>{item.name}</strong><small>{item.revision || (item.svg ? 'Ревизия не подтверждена' : 'Без распиновки')}</small></div>{item.id === board?.id && <Check size={14} />}</button>)}</div>
    <div className="panel-label library-title">АППАРАТНЫЕ КОМПОНЕНТЫ</div><label className="search component-search"><Search size={14} /><input aria-label="Поиск компонентов" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти компонент…" /></label><div className="category-filter"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Все</button>{categories.map(([id, name]) => <button key={id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}>{name}</button>)}</div>
    <div className="hardware-library">{visible.map(module => { const Icon = icons[module.icon] || Box; return <button key={module.id} className="hardware-library-item" onClick={() => onAdd(module)} disabled={busy || !board?.pins.length} aria-label={`Добавить: ${module.name}`}><span style={{ color: module.color }}><Icon size={20} /></span><div><strong>{module.name}</strong><small>{module.categoryName} · v{module.version}</small></div><Plus size={14} /></button>; })}{!visible.length && <p className="panel-note">Компоненты не найдены.</p>}</div>
    {!board?.pins.length && <p className="panel-note">Выберите конкретную плату, чтобы добавить компоненты.</p>}
    <div className="library-bottom"><span className="dot green-dot" />{modules.length} аппаратных модулей · локальная библиотека</div>
  </>;
}
