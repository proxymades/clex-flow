import { moduleSupportsBoard } from '../catalog/compatibility.js';
import { formatCount } from '../utils/plural.js';
import { useState } from 'react';
import BoardChoice from '../components/BoardChoice.jsx';
import BoardPicker from '../components/BoardPicker.jsx';
import { ToggleRight, RotateCw, Search, Plus, Lightbulb, MousePointer2, Box, Monitor, Network , Camera, Volume2, Radio } from 'lucide-react';
const icons = { ToggleRight, RotateCw, Lightbulb, MousePointer2, Monitor, Network, Camera, Volume2, Radio };

export default function HardwareLibrary({ boards, modules, board, busy, onBoard, onAdd }) {
  const [choosingBoard, setChoosingBoard] = useState(false);
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all');
  const categories = [...new Map(modules.map(module => [module.category, module.categoryName])).entries()];
  const visible = modules.filter(module => (category === 'all' || module.category === category) && `${module.name} ${module.description}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
  const ordered = category === 'all' ? categories.flatMap(([id]) => visible.filter(module => module.category === id)) : visible;
  return <><div className="panel-label">ПЛАТА ПРОЕКТА</div><BoardChoice board={board} busy={busy} onChange={() => setChoosingBoard(true)}/>{choosingBoard && <BoardPicker boards={boards} selectedId={board?.id} busy={busy} onClose={() => setChoosingBoard(false)} onSelect={item => { setChoosingBoard(false); onBoard(item); }}/>}
    <div className="panel-label library-title">АППАРАТНЫЕ КОМПОНЕНТЫ</div><label className="search component-search"><Search size={14} /><input aria-label="Поиск компонентов" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти компонент…" /></label><div className="category-filter"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Все</button>{categories.map(([id, name]) => <button key={id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}>{name}</button>)}</div>
    <div className="hardware-library">{ordered.map(module => { const Icon = icons[module.icon] || Box; const unsupported = !moduleSupportsBoard(module,board) || (module.network && !board?.networkInterfaces?.some(provider => provider.family === module.network.family)) || (module.hardwareInterface && !board?.peripherals?.some(provider=>provider.family===module.hardwareInterface.family && provider.interface===module.hardwareInterface.interface)); return <button key={module.id} className="hardware-library-item" onClick={() => onAdd(module)} disabled={busy || !board?.pins.length || unsupported} title={unsupported ? 'Для выбранной платы нет реализованного драйвера этого компонента' : undefined} aria-label={`Добавить: ${module.name}`}><span style={{ color: module.color }}><Icon size={20} /></span><div><strong>{module.name}</strong><small>{module.categoryName} · v{module.version}</small></div><Plus size={14} /></button>; })}{!visible.length && <p className="panel-note">Компоненты не найдены.</p>}</div>
    {!board?.pins.length && <p className="panel-note">Выберите конкретную плату, чтобы добавить компоненты.</p>}
    <div className="library-bottom"><span className="dot green-dot" />{formatCount(modules.length, ['аппаратный модуль', 'аппаратных модуля', 'аппаратных модулей'])} · локальная библиотека</div>
  </>;
}
