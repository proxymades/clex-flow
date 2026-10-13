import { resizeImage } from './image.js';

export default function ImageProperties({ element, update, resolution, busy, onSplash }) {
  return <>
    <div className="screen-coordinates">{['width', 'height'].map(axis => <label className="field" key={axis}>{axis === 'width' ? 'Ширина' : 'Высота'}<input aria-label={axis === 'width' ? 'Ширина изображения' : 'Высота изображения'} type="number" min={1} max={resolution[axis]} value={element[axis]} disabled={busy} onChange={event => update(resizeImage(element, axis, Number(event.target.value), resolution))} /></label>)}</div>
    <p className="panel-note">Пропорции и прозрачный фон сохраняются. Размер можно менять за угол изображения на холсте.</p>
    <label className="screen-splash-toggle"><input type="checkbox" aria-label="Заставка при запуске" checked={Boolean(element.splash)} disabled={busy} onChange={event => onSplash(event.target.checked)} />Заставка при запуске</label>
    {element.splash && <><label className="field">Время заставки, сек<input aria-label="Время заставки, сек" type="number" min={0.1} max={60} step={0.1} value={element.durationMs / 1000} disabled={busy} onChange={event => update({ durationMs: Math.round(Number(event.target.value) * 1000) })} /></label><p className="panel-note">Сначала появится логотип. После указанного времени откроется основной экран. Заставка повторяется при каждом запуске платы.</p></>}
  </>;
}
