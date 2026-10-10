import { useRef, useState } from 'react';
import { Plus, Save, Trash2, Monitor } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import ScreenPreview from './ScreenPreview.jsx';
import { displayDescription, screenFor, screenIssues } from './model.js';

export default function ScreenEditor({ project, component, catalog, onSave, onClose, busy }) {
  const display = displayDescription(component, catalog);
  const [screen, setScreen] = useState(() => structuredClone(screenFor(project, component.id)));
  const [selected, setSelected] = useState(null), [error, setError] = useState('');
  const drag = useRef(null);
  const element = screen.elements.find(element => element.id === selected);
  const update = patch => setScreen(current => ({ ...current, elements: current.elements.map(element => element.id === selected ? { ...element, ...patch } : element) }));
  const issues = screenIssues(screen, display);
  function addText() {
    if (screen.elements.length >= display.graphics.maxElements) return;
    const id = crypto.randomUUID();
    setScreen(current => ({ ...current, elements: [...current.elements, { id, type: 'text', text: 'Привет, мир! CLEX Flow', x: 20, y: 20, fontId: display.graphics.fonts[0].id, color: '#ffffff' }] }));
    setSelected(id); setError('');
  }
  function pointerDown(event, id, scale) {
    if (busy || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const element = screen.elements.find(element => element.id === id);
    setSelected(id);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, scale, x: event.clientX, y: event.clientY, left: element.x, top: element.y };
  }
  function pointerMove(event) {
    const start = drag.current;
    if (!start) return;
    const x = Math.max(0, Math.min(display.resolution.width - 1, Math.round(start.left + (event.clientX - start.x) / start.scale)));
    const y = Math.max(0, Math.min(display.resolution.height - 1, Math.round(start.top + (event.clientY - start.y) / start.scale)));
    setScreen(current => ({ ...current, elements: current.elements.map(element => element.id === start.id ? { ...element, x, y } : element) }));
  }
  return <Modal title={'Редактор экрана · ' + component.name} className="display-editor" busy={busy} onClose={onClose}>
    <div className="screen-editor-info"><Monitor size={17} /><strong>{display.resolution.width} × {display.resolution.height}</strong><span>{display.colorFormats.join(', ')}</span><span>{display.model.name}</span></div>
    <div className="screen-editor-body">
      <section className="screen-editor-canvas" onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <ScreenPreview display={display} screen={screen} maxWidth={480} maxHeight={560} selected={selected} onElementPointerDown={pointerDown} />
      </section>
      <aside className="screen-editor-properties">
        {display.graphics.features.includes('background') && <label className="field">Фон экрана<input aria-label="Фон экрана" type="color" value={screen.background} disabled={busy} onChange={event => setScreen(current => ({ ...current, background: event.target.value }))} /></label>}
        {display.graphics.features.includes('text') && <button className="button secondary" disabled={busy || screen.elements.length >= display.graphics.maxElements} onClick={addText}><Plus size={16} />Добавить текст</button>}
        <div className="screen-element-list">{screen.elements.map(element => <button key={element.id} className={selected === element.id ? 'selected' : ''} onClick={() => setSelected(element.id)}>{element.text || 'Пустой текст'}</button>)}</div>
        {element && <>
          <label className="field">Текст<textarea aria-label="Текст на экране" rows={3} maxLength={500} value={element.text} disabled={busy} onChange={event => update({ text: event.target.value })} /></label>
          <div className="screen-coordinates">{['x', 'y'].map(axis => <label className="field" key={axis}>{axis.toUpperCase()}<input aria-label={'Координата ' + axis.toUpperCase()} type="number" min={0} max={display.resolution[axis === 'x' ? 'width' : 'height'] - 1} value={element[axis]} disabled={busy} onChange={event => update({ [axis]: Number(event.target.value) })} /></label>)}</div>
          <label className="field">Шрифт и размер<select aria-label="Шрифт и размер" value={element.fontId} disabled={busy} onChange={event => update({ fontId: event.target.value })}>{display.graphics.fonts.map(font => <option key={font.id} value={font.id}>{font.name} · {font.size} px</option>)}</select></label>
          <label className="field">Цвет текста<input aria-label="Цвет текста" type="color" value={element.color} disabled={busy} onChange={event => update({ color: event.target.value })} /></label>
          <button className="text-button danger-hover" disabled={busy} onClick={() => { setScreen(current => ({ ...current, elements: current.elements.filter(element => element.id !== selected) })); setSelected(null); }}><Trash2 size={15} />Удалить текст</button>
        </>}
        <p className="panel-note">Доступны только возможности выбранного дисплея и его шрифтов. Перетаскивайте текст на холсте или задайте координаты.</p>
      </aside>
    </div>
    {(error || issues.length > 0) && <p className="screen-editor-error" role="alert">{error || issues.join(' ')}</p>}
    <footer><button className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy || issues.length > 0} onClick={() => { if (issues.length) { setError(issues.join(' ')); return; } onSave(component.id, screen); onClose(); }}><Save size={16} />Сохранить интерфейс</button></footer>
  </Modal>;
}
