import { Maximize, Minus, Plus } from 'lucide-react';

export default function CanvasControls({ subject, zoom, busy, fitDisabled, onZoomOut, onZoomIn, onFit }) {
  return <div className="canvas-controls" role="group" aria-label={`Управление холстом: ${subject}`}>
    <button className="icon-button" aria-label={`Уменьшить ${subject}`} title="Уменьшить масштаб" disabled={busy} onClick={onZoomOut}><Minus size={16} /></button>
    <span aria-label="Масштаб холста">{Math.round(zoom * 100)}%</span>
    <button className="icon-button" aria-label={`Увеличить ${subject}`} title="Увеличить масштаб" disabled={busy} onClick={onZoomIn}><Plus size={16} /></button>
    <button className="icon-button" aria-label={`Показать весь ${subject}`} title="Показать всё · F" disabled={busy || fitDisabled} onClick={onFit}><Maximize size={16} /></button>
  </div>;
}
