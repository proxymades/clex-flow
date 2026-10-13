import ImageProperties from './ImageProperties.jsx';
import { importPng } from './importPng.js';
import { resizeImage } from './image.js';
import { serializeProject } from '../projects/model.js';
import IndicatorProperties from './IndicatorProperties.jsx';
import { newIndicator } from './indicator.js';
import { useRef, useState } from 'react';
import { Plus, Save, Trash2, Monitor, Type, CircleDot, ImagePlus } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import ScreenPreview from './ScreenPreview.jsx';
import { displayDescription, screenFor, screenIssues, isDynamicText, elementName, elementPreviewText, saveScreen } from './model.js';

export default function ScreenEditor({ project, component, catalog, onSave, onClose, busy }) {
  const display = displayDescription(component, catalog);
  const [screen, setScreen] = useState(() => structuredClone(screenFor(project, component.id)));
  const [selected, setSelected] = useState(null), [error, setError] = useState('');
  const drag = useRef(null), fileInput = useRef(null);
  const [importing, setImporting] = useState(false);
  const locked = busy || importing;
  const splash = screen.elements.find(element => element.type === 'image' && element.splash);
  const selectElement = element => setSelected(element.id);
  function setSplash(enabled) {
    setScreen(current => ({ ...current, elements: current.elements.map(item => item.type === 'image' ? (item.id === selected ? { ...item, splash: enabled, durationMs: item.durationMs || 3000 } : enabled ? { ...item, splash: false } : item) : item) }));
  }
  async function addImage(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || locked) return;
    setImporting(true); setError('');
    try {
      const image = await importPng(file, display.resolution);
      const next = { ...screen, elements: [...screen.elements, image] };
      serializeProject(saveScreen(project, component.id, next));
      setScreen(next); selectElement(image);
    } catch (error) { setError(error.message || 'Не удалось прочитать PNG.'); }
    finally { setImporting(false); }
  }
  const element = screen.elements.find(element => element.id === selected);
  const update = patch => setScreen(current => ({ ...current, elements: current.elements.map(element => element.id === selected ? { ...element, ...patch } : element) }));
  const issues = screenIssues(screen, display);
  function addText() {
    if (screen.elements.length >= display.graphics.maxElements) return;
    const id = crypto.randomUUID();
    setScreen(current => ({ ...current, elements: [...current.elements, { id, type: 'text', text: 'Привет, мир! CLEX Flow', x: 20, y: 20, fontId: display.graphics.fonts[0].id, color: '#ffffff' }] }));
    setSelected(id); setError('');
  }
  function pointerDown(event, id, scale, resize = false) {
    if (locked || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const element = screen.elements.find(element => element.id === id);
    selectElement(element);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, scale, x: event.clientX, y: event.clientY, left: element.x, top: element.y, width: element.width, height: element.height, image: element.type === 'image' ? element : null, resize };
  }
  function pointerMove(event) {
    const start = drag.current;
    if (!start) return;
    if (start.resize && start.image) {
      const dx = (event.clientX - start.x) / start.scale, dy = (event.clientY - start.y) / start.scale;
      const axis = Math.abs(dx / start.width) >= Math.abs(dy / start.height) ? 'width' : 'height';
      const size = resizeImage(start.image, axis, start[axis] + (axis === 'width' ? dx : dy), display.resolution);
      setScreen(current => ({ ...current, elements: current.elements.map(element => element.id === start.id ? { ...element, ...size } : element) }));
      return;
    }
    if (start.resize) {
      const width=Math.max(16,Math.min(display.resolution.width-start.left,Math.round(start.width+(event.clientX-start.x)/start.scale))),height=Math.max(16,Math.min(display.resolution.height-start.top,Math.round(start.height+(event.clientY-start.y)/start.scale)));
      setScreen(current=>({...current,elements:current.elements.map(element=>element.id===start.id?{...element,width,height,radius:Math.min(element.radius,Math.floor(Math.min(width,height)/2))}:element)}));
      return;
    }
    const x = Math.max(0, Math.min(display.resolution.width - (start.width || 1), Math.round(start.left + (event.clientX - start.x) / start.scale)));
    const y = Math.max(0, Math.min(display.resolution.height - (start.height || 1), Math.round(start.top + (event.clientY - start.y) / start.scale)));
    setScreen(current => ({ ...current, elements: current.elements.map(element => element.id === start.id ? { ...element, x, y } : element) }));
  }
  return <Modal title={'Редактор экрана · ' + component.name} className="display-editor" busy={locked} onClose={onClose}>
    <div className="screen-editor-info"><Monitor size={17} /><strong>{display.resolution.width} × {display.resolution.height}</strong><span>{display.colorFormats.join(', ')}</span><span>{display.model.name}</span></div>

    <div className="screen-editor-body">
      <section className="screen-editor-canvas" onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <div className="screen-editor-surfaces">
          {display.graphics.features.includes('image') && <div className="screen-editor-surface" data-screen-view="splash"><h3>Заставка{splash && <span>{splash.durationMs / 1000} сек</span>}</h3><div className="screen-splash-surface"><ScreenPreview display={display} screen={screen} maxWidth={280} maxHeight={400} selected={selected} showSplash onElementPointerDown={pointerDown} onElementResizePointerDown={(event,id,scale)=>pointerDown(event,id,scale,true)} />{!splash && <p className="screen-splash-hint">Добавьте PNG и включите<br />«Заставка при запуске»</p>}</div></div>}
          <div className="screen-editor-surface" data-screen-view="main"><h3>Основной экран</h3><ScreenPreview display={display} screen={screen} maxWidth={280} maxHeight={400} selected={selected} onElementPointerDown={pointerDown} onElementResizePointerDown={(event,id,scale)=>pointerDown(event,id,scale,true)} /></div>
        </div>
      </section>
      <aside className="screen-editor-properties">
        {display.graphics.features.includes('background') && <label className="field">Фон экрана<input aria-label="Фон экрана" type="color" value={screen.background} disabled={locked} onChange={event => setScreen(current => ({ ...current, background: event.target.value }))} /></label>}
        <div className="screen-create-actions">
        {display.graphics.features.includes('text') && <button className="button secondary" disabled={locked || screen.elements.length >= display.graphics.maxElements} onClick={addText}><Plus size={16} />Добавить текст</button>}
        {display.graphics.features.includes('indicator')&&<button className="button secondary" disabled={locked||screen.elements.length>=display.graphics.maxElements} onClick={()=>{const element=newIndicator(display);element.y=Math.min(display.resolution.height-element.height,20+screen.elements.length*54);setScreen(current=>({...current,elements:[...current.elements,element]}));selectElement(element);setError('');}}><Plus size={16}/>Добавить индикатор</button>}
        {display.graphics.features.includes('image') && <button className="button secondary" disabled={locked || screen.elements.length >= display.graphics.maxElements} onClick={() => fileInput.current.click()}><ImagePlus size={16} />{importing ? 'Загрузка PNG…' : 'Добавить PNG'}</button>}
        <input ref={fileInput} type="file" accept=".png,image/png" hidden aria-label="Файл PNG" onChange={addImage} />
        </div>
        <div className="screen-element-list">{screen.elements.map((element, index) => <button key={element.id} data-element-type={element.type} className={selected === element.id ? 'selected' : ''} title={element.type === 'image' ? (element.splash ? 'Заставка при запуске' : 'Изображение PNG') : element.type === 'indicator' ? 'Индикатор состояния' : isDynamicText(element) ? 'Текст с динамическим значением' : 'Статический текст'} onClick={() => selectElement(element)}>{element.type === 'image' ? <ImagePlus size={16} aria-hidden="true" /> : element.type === 'indicator' ? <CircleDot size={16} aria-hidden="true" /> : <Type size={16} aria-hidden="true" />}<span className="screen-element-label">{element.type === 'image' ? elementName(element,index) + (element.splash ? ' · заставка' : '') : element.type === 'indicator' ? elementName(element,index) : isDynamicText(element) ? elementName(element, index) + ' · ' + elementPreviewText(element) : element.text || 'Пустой текст'}</span></button>)}</div>
        {element && <>
          <label className="field">Название элемента<input aria-label="Название элемента" maxLength={80} value={element.name || ''} placeholder={elementName(element, screen.elements.indexOf(element))} disabled={locked} onChange={event => update({ name: event.target.value })} /></label>
          {element.type === 'image' ? <ImageProperties element={element} update={update} resolution={display.resolution} busy={locked} onSplash={setSplash} /> : element.type === 'indicator' ? <IndicatorProperties key={element.id} element={element} update={update} display={display} busy={locked} project={project} catalog={catalog} componentId={component.id}/> : <>
          <label className="field">Режим текста<select aria-label="Режим текста" disabled={locked} value={element.mode || 'static'} onChange={event => update(event.target.value === 'dynamic' ? { mode: 'dynamic', valueType: element.valueType || 'number', initialValue: element.initialValue ?? 0, prefix: element.prefix || '', suffix: element.suffix || '' } : { mode: 'static' })}><option value="static">Статический текст</option><option value="dynamic">Динамическое значение</option></select></label>
          {isDynamicText(element) ? <>
            <label className="field">Тип значения<select aria-label="Тип значения" value={element.valueType} disabled={locked} onChange={event => update({ valueType: event.target.value, initialValue: event.target.value === 'number' ? 0 : event.target.value === 'boolean' ? false : '' })}><option value="number">Число</option><option value="boolean">Логическое значение</option><option value="text">Текст</option></select></label>
            <label className="field">Префикс<input aria-label="Префикс" value={element.prefix} maxLength={200} disabled={locked} onChange={event => update({ prefix: event.target.value })} /></label>
            <label className="field">Начальное значение{element.valueType === 'boolean' ? <select aria-label="Начальное значение текста" value={String(element.initialValue)} disabled={locked} onChange={event => update({ initialValue: event.target.value === 'true' })}><option value="false">Нет</option><option value="true">Да</option></select> : <input aria-label="Начальное значение текста" type={element.valueType === 'number' ? 'number' : 'text'} step="any" maxLength={500} value={element.initialValue} disabled={locked} onChange={event => update({ initialValue: element.valueType === 'number' ? Number(event.target.value) : event.target.value })} />}</label>
            <label className="field">Суффикс<input aria-label="Суффикс" value={element.suffix} maxLength={200} disabled={locked} onChange={event => update({ suffix: event.target.value })} /></label>
            <p className="panel-note">В «Логике» соедините выход данных с этим элементом. Обновление подключится автоматически. Для настройки момента обновления используйте «Подключить данные» или контакт «Обновить: {elementName(element, screen.elements.indexOf(element))}». Смена типа или удаление элемента удалит его связи.</p>
          </> : <label className="field">Текст<textarea aria-label="Текст на экране" rows={3} maxLength={500} value={element.text} disabled={locked} onChange={event => update({ text: event.target.value })} /></label>}
          </>}
          <div className="screen-coordinates">{['x', 'y'].map(axis => <label className="field" key={axis}>{axis.toUpperCase()}<input aria-label={'Координата ' + axis.toUpperCase()} type="number" min={0} max={display.resolution[axis === 'x' ? 'width' : 'height'] - (element.type === 'image' ? element[axis === 'x' ? 'width' : 'height'] : 1)} value={element[axis]} disabled={locked} onChange={event => update({ [axis]: Number(event.target.value) })} /></label>)}</div>
          {element.type !== 'image' && <label className="field">Шрифт и размер<select aria-label="Шрифт и размер" value={element.fontId} disabled={locked} onChange={event => update({ fontId: event.target.value })}>{display.graphics.fonts.map(font => <option key={font.id} value={font.id}>{font.name} · {font.size} px</option>)}</select></label>}
          {element.type === 'text' && <label className="field">Цвет текста<input aria-label="Цвет текста" type="color" value={element.color} disabled={locked} onChange={event => update({ color: event.target.value })} /></label>}
          <button className="text-button danger-hover" disabled={locked} onClick={() => { setScreen(current => ({ ...current, elements: current.elements.filter(element => element.id !== selected) })); setSelected(null); }}><Trash2 size={15} />Удалить элемент</button>
        </>}
        <p className="panel-note">Доступны только возможности выбранного дисплея и его шрифтов. Перетаскивайте элементы на холсте или задайте координаты.</p>
      </aside>
    </div>
    {(error || issues.length > 0) && <p className="screen-editor-error" role="alert">{error || issues.join(' ')}</p>}
    <footer><button className="button secondary" disabled={locked} onClick={onClose}>Отмена</button><button className="button primary" disabled={locked || issues.length > 0} onClick={() => { if (issues.length) { setError(issues.join(' ')); return; } try { serializeProject(saveScreen(project, component.id, screen)); onSave(component.id, screen); onClose(); } catch (error) { setError(error.message); } }}><Save size={16} />Сохранить интерфейс</button></footer>
  </Modal>;
}
