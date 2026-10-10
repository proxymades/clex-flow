import { useState } from 'react';
import { Cpu, Search, Lightbulb, MousePointer2, Monitor, Timer, ScanLine, ArrowUpRight, Repeat2, Terminal, Box } from 'lucide-react';
import Modal from '../components/Modal.jsx';
const icons = { Lightbulb, MousePointer2, Monitor, Timer, ScanLine, ArrowUpRight, Repeat2, Terminal };
const kinds = { hardware: 'Аппаратные компоненты', logic: 'Блоки логики', board: 'Платы' };
export default function LibraryDialog({ catalog, onClose }) {
  const [kind, setKind] = useState('hardware'), [query, setQuery] = useState('');
  const items = kind === 'board' ? catalog.boards.filter(board => board.pins.length) : catalog.modules.filter(module => module.kind === kind);
  const visible = items.filter(item => [item.name, item.description, item.manufacturer, item.categoryName].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  return <Modal title="Библиотека компонентов" className="library-modal" onClose={onClose}>
    <div className="library-catalog-tabs" role="tablist" aria-label="Раздел библиотеки">{Object.entries(kinds).map(([id, name]) => <button key={id} role="tab" aria-selected={kind === id} onClick={() => { setKind(id); setQuery(''); }}>{name}</button>)}</div>
    <label className="search library-catalog-search"><Search size={16} /><input aria-label="Поиск в библиотеке" placeholder="Название, производитель или категория" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="library-catalog-results" role="tabpanel" aria-label={kinds[kind]}>
      {visible.map(item => {
        const Icon = kind === 'board' ? Cpu : icons[item.icon] || Box;
        const controller = item.display && catalog.controllers.find(controller => controller.id === item.display.controllerId);
        return <article className="library-catalog-card" key={item.id}>
          <header><span style={{ color: item.color || '#a78bfa' }}><Icon size={23} /></span><div><h3>{item.name}</h3><small>{item.manufacturer || item.categoryName || item.mcu}</small></div></header>
          <p>{kind === 'board' ? `${item.mcu} · ${item.pins.length} физических контактов` : item.description}</p>
          {item.display && <div className="library-catalog-details"><span>{controller?.name || item.display.controllerId}</span><span>{item.display.interface.toUpperCase()}</span><span>{item.display.resolution.width} × {item.display.resolution.height}</span></div>}
          {kind === 'hardware' && <div className="library-catalog-details">{item.terminals.map(terminal => <span key={terminal.id}>{terminal.label}</span>)}</div>}
          {kind === 'logic' && <div className="library-catalog-details">{[...item.inputs, ...item.outputs].map(port => <span key={port.id}>{port.name}</span>)}{item.editor === 'screen' && <span>Редактор интерфейса</span>}</div>}
          <footer>{kind === 'board' ? item.revision : `Версия модуля ${item.version}`}</footer>
        </article>;
      })}
      {!visible.length && <p className="library-catalog-empty">По вашему запросу ничего не найдено.</p>}
    </div>
    <footer><button className="button secondary" onClick={onClose}>Закрыть</button></footer>
  </Modal>;
}
