import { useState } from 'react';
import { Check, Cpu, Search } from 'lucide-react';
import Modal from './Modal.jsx';
import { boardFamily, selectableBoards } from '../catalog/boardSelection.js';
import { formatCount } from '../utils/plural.js';
export default function BoardPicker({ boards, selectedId, onSelect, onClose, busy = false }) {
  const [query, setQuery] = useState(''), [family, setFamily] = useState(''), [manufacturer, setManufacturer] = useState('');
  const available = selectableBoards(boards);
  const families = [...new Set(available.map(boardFamily).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
  const manufacturers = [...new Set(available.map(board => board.manufacturer).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
  const visible = selectableBoards(available, { query, family, manufacturer });
  return <Modal title="Выбор платы" onClose={onClose} busy={busy} className="board-picker-modal">
    <label className="search board-picker-search"><Search size={16}/><input aria-label="Поиск платы" placeholder="Название платы или микроконтроллера" value={query} disabled={busy} onChange={event => setQuery(event.target.value)}/></label>
    <div className="board-picker-filters">
      <label className="field">Семейство<select aria-label="Семейство плат" value={family} disabled={busy} onChange={event => setFamily(event.target.value)}><option value="">Все семейства</option>{families.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="field">Производитель<select aria-label="Производитель платы" value={manufacturer} disabled={busy} onChange={event => setManufacturer(event.target.value)}><option value="">Все производители</option>{manufacturers.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <div className="board-picker-summary"><span role="status">{formatCount(visible.length, ['плата', 'платы', 'плат'])}</span>{(query || family || manufacturer) && <button type="button" className="text-button" disabled={busy} onClick={() => { setQuery(''); setFamily(''); setManufacturer(''); }}>Сбросить фильтры</button>}</div>
    <div className="board-picker-results board-list" aria-label="Доступные платы">{visible.map(board => <button type="button" key={board.id} className={`board-option ${board.id === selectedId ? 'chosen' : ''}`} aria-label={`Выбрать плату: ${board.name}`} aria-pressed={board.id === selectedId} disabled={busy} onClick={() => onSelect(board)}><Cpu size={21}/><div><strong>{board.name}</strong><small>{board.mcu} · {boardFamily(board)}</small><small>{[board.manufacturer, board.revision].filter(Boolean).join(' · ')}</small></div>{board.id === selectedId && <Check size={17} aria-label="Текущая плата"/>}</button>)}{!visible.length && <p className="board-picker-empty">Платы не найдены. Измените запрос или сбросьте фильтры.</p>}</div>
    <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button></footer>
  </Modal>;
}
