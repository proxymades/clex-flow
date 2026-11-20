import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import ModuleIcon from '../components/ModuleIcon.jsx';
import Panel from '../components/Panel.jsx';
import { formatCount } from '../utils/plural.js';

const kinds = { hardware: 'Аппаратные компоненты', logic: 'Блоки логики', board: 'Платы' };

export default function ComponentCatalog({ catalog }) {
  const tabsId = useId();
  const [kind, setKind] = useState('hardware'), [query, setQuery] = useState('');
  const items = kind === 'board' ? catalog.boards.filter(board => board.pins.length) : catalog.modules.filter(module => module.kind === kind && !module.hidden);
  const visible = items.filter(item => [item.name, item.description, item.manufacturer, item.categoryName].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));

  function selectKind(id) {
    setKind(id);
    setQuery('');
  }

  function navigateTabs(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const ids = Object.keys(kinds), index = ids.indexOf(kind);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    selectKind(ids[next]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
  }

  return <div className="component-catalog">
    <Panel as="div" className="library-catalog-toolbar">
      <div className="segmented-tabs library-catalog-tabs" role="tablist" aria-label="Раздел библиотеки">
        {Object.entries(kinds).map(([id, name]) => <button type="button" key={id} role="tab" id={`${tabsId}-${id}`} aria-controls={`${tabsId}-results`} aria-selected={kind === id} tabIndex={kind === id ? 0 : -1} onClick={() => selectKind(id)} onKeyDown={navigateTabs}>{name}</button>)}
      </div>
      <label className="search library-catalog-search"><Search size={16} /><input aria-label="Поиск в библиотеке" placeholder="Название, производитель или категория" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </Panel>
    <div className="library-catalog-results" role="tabpanel" id={`${tabsId}-results`} aria-labelledby={`${tabsId}-${kind}`}>
      {visible.map(item => {
        const controller = item.display && catalog.controllers.find(controller => controller.id === item.display.controllerId);
        return <Panel as="article" className="library-catalog-card" highlight key={item.id}>
          <header>
            <span className="icon-tile"><ModuleIcon name={kind === 'board' ? 'Cpu' : item.icon} size={23} /></span>
            <div><h3>{item.name}</h3><small>{item.manufacturer || item.categoryName || item.mcu}</small></div>
          </header>
          <p>{kind === 'board' ? `${item.mcu} · ${formatCount(item.pins.length, ['физический контакт', 'физических контакта', 'физических контактов'])}` : item.description}</p>
          {item.display && <div className="library-catalog-details"><span className="tag">{controller?.name || item.display.controllerId}</span><span className="tag">{item.display.interface.toUpperCase()}</span><span className="tag">{item.display.resolution.width} × {item.display.resolution.height}</span></div>}
          {kind === 'hardware' && <div className="library-catalog-details">{item.terminals.map(terminal => <span className="tag" key={terminal.id}>{terminal.label}</span>)}</div>}
          {kind === 'logic' && <div className="library-catalog-details">{[...item.inputs, ...item.outputs].map(port => <span className="tag" key={port.id}>{port.name}</span>)}{item.editor === 'screen' && <span className="tag">Редактор интерфейса</span>}</div>}
          <footer>{kind === 'board' ? item.revision : `Версия модуля ${item.version}`}</footer>
        </Panel>;
      })}
      {!visible.length && <Panel as="div" className="library-catalog-empty" role="status"><Search size={27} strokeWidth={1.5} /><h2>Ничего не найдено</h2><p>Попробуйте другое название, производителя или категорию.</p></Panel>}
    </div>
  </div>;
}
