import { Cpu, RefreshCw } from 'lucide-react';
export default function BoardChoice({ board, busy, onChange }) {
  const environment = board?.platform === 'arduino-avr' ? `Arduino AVR ${board.coreVersion}` : board?.platform === 'esp-idf' ? `ESP-IDF ${board.espIdfVersion}` : null;
  return <div className="selected-board-card"><Cpu size={22}/><div className="selected-board-info"><strong>{board?.name || 'Плата не выбрана'}</strong>{board && <><small>{board.mcu}</small><small>{[board.manufacturer, board.revision].filter(Boolean).join(' · ')}</small>{environment && <small>{environment}</small>}</>}</div><button type="button" className="button secondary selected-board-change" disabled={busy} onClick={onChange}><RefreshCw size={13}/>{board ? 'Сменить плату' : 'Выбрать плату'}</button></div>;
}
