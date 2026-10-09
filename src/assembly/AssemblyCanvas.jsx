import { useEffect, useMemo, useRef, useState } from 'react';
import { Unplug, Move, MousePointer2 } from 'lucide-react';
import CanvasControls from '../components/CanvasControls.jsx';
import useCanvasKeys from '../components/useCanvasKeys.js';
import { getAsset } from '../catalog/index.js';
import { moduleFor, pinProblem, connectionProblem } from './model.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function boundsFor(project, board, catalog) {
  const elements = [{ ...project.assembly.positions.board, width: board.width, height: board.height }, ...project.components.map(component => ({ ...project.assembly.positions[component.id], width: moduleFor(component, catalog)?.visual.width || 230, height: moduleFor(component, catalog)?.visual.height || 185 }))];
  return { left: Math.min(...elements.map(e => e.x)), top: Math.min(...elements.map(e => e.y)), right: Math.max(...elements.map(e => e.x + e.width)), bottom: Math.max(...elements.map(e => e.y + e.height)) };
}
function fitViewport(bounds, size) {
  const zoom = clamp(Math.min((size.width - 70) / (bounds.right - bounds.left), (size.height - 60) / (bounds.bottom - bounds.top)), 0.2, 1);
  return { zoom, x: (size.width - (bounds.right - bounds.left) * zoom) / 2 - bounds.left * zoom, y: (size.height - (bounds.bottom - bounds.top) * zoom) / 2 - bounds.top * zoom };
}

export default function AssemblyCanvas({ project, board, catalog, selection, setSelection, pending, setPending, onTerminal, onPin, onTransform, onInteraction, busy }) {
  const svgRef = useRef(null), drag = useRef(null), draft = useRef(null), blockClick = useRef(false);
  const [preview, setPreview] = useState(null);
  const [size, setSize] = useState({ width: 700, height: 570 });
  const [autoFit, setAutoFit] = useState(project.assembly.viewport.zoom === 1 && project.assembly.viewport.x === 0 && project.assembly.viewport.y === 0);
  const bounds = useMemo(() => boundsFor(project, board, catalog), [project, board, catalog]);
  const viewport = preview?.viewport || (autoFit ? fitViewport(bounds, size) : project.assembly.viewport);
  const positions = useMemo(() => ({ ...project.assembly.positions, ...preview?.positions }), [project.assembly.positions, preview]);
  const boardPosition = positions.board;
  const { space, spaceHeld } = useCanvasKeys({ onFit: () => { if (!drag.current) updateViewport(fitViewport(bounds, size)); }, onEscape: () => setPending(null), busy });
  const selectedComponent = selection?.type === 'component' ? selection.id : null;
  useEffect(() => () => onInteraction(false), [onInteraction]);
  const updateViewport = next => {
    setAutoFit(false);
    onTransform({ viewport: { x: clamp(next.x, -50000, 50000), y: clamp(next.y, -50000, 50000), zoom: clamp(next.zoom, 0.2, 3) } });
  };
  const zoomAt = (factor, x = size.width / 2, y = size.height / 2) => {
    const zoom = clamp(viewport.zoom * factor, 0.2, 3);
    updateViewport({ zoom, x: x - (x - viewport.x) * zoom / viewport.zoom, y: y - (y - viewport.y) * zoom / viewport.zoom });
  };
  useEffect(() => {
    const svg = svgRef.current;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width: Math.max(100, width), height: Math.max(100, height) });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    const wheel = event => {
      event.preventDefault();
      if (busy || drag.current) return;
      const rect = svg.getBoundingClientRect();
      const zoom = clamp(viewport.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 0.2, 3);
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      setAutoFit(false);
      onTransform({ viewport: { zoom, x: clamp(x - (x - viewport.x) * zoom / viewport.zoom, -50000, 50000), y: clamp(y - (y - viewport.y) * zoom / viewport.zoom, -50000, 50000) } });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [viewport.x, viewport.y, viewport.zoom, onTransform, busy]);

  function pointerDown(event) {
    if (busy || event.button !== 0 || (!space.current && event.target.closest('[data-terminal], [data-pin], [data-wire]'))) return;
    const id = space.current ? null : event.target.closest('[data-drag]')?.getAttribute('data-drag');
    if (id) setSelection({ type: id === 'board' ? 'board' : 'component', id });
    svgRef.current.setPointerCapture(event.pointerId);
    draft.current = null;
    drag.current = { id, x: event.clientX, y: event.clientY, position: id ? positions[id] : null, viewport, moved: false, panMode: space.current };
    onInteraction(true);
  }
  function pointerMove(event) {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !start.moved) return;
    if (!start.moved) setAutoFit(false);
    start.moved = true;
    draft.current = start.id ? { viewport: start.viewport, positions: { [start.id]: { x: clamp(start.position.x + dx / start.viewport.zoom, -5000, 5000), y: clamp(start.position.y + dy / start.viewport.zoom, -5000, 5000) } } } : { viewport: { ...start.viewport, x: clamp(start.viewport.x + dx, -50000, 50000), y: clamp(start.viewport.y + dy, -50000, 50000) } };
    setPreview(draft.current);
  }
  function pointerUp(event) {
    const start = drag.current;
    if (start && !start.id && !start.moved && !start.panMode) { setSelection({ type: 'board', id: 'board' }); setPending(null); }
    if (start?.moved && draft.current) onTransform(draft.current);
    blockClick.current = Boolean(start?.moved || start?.panMode);
    requestAnimationFrame(() => { blockClick.current = false; });
    drag.current = null;
    draft.current = null; setPreview(null);
    if (start) onInteraction(false);
    if (svgRef.current.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  }
  function cancelDrag() {
    if (!drag.current) return;
    if (drag.current.moved && draft.current) onTransform(draft.current);
    drag.current = null;
    draft.current = null; setPreview(null);
    onInteraction(false);
  }
  const activate = callback => event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(); } };

  return <div className={`assembly-canvas ${busy ? 'canvas-busy' : ''} ${spaceHeld ? 'canvas-space-pan' : ''}`}>
    <div className="canvas-top"><span className="badge purple"><MousePointer2 size={12} />МОНТАЖ / {project.components.length} компонентов</span><span className="canvas-scale">{Math.round(viewport.zoom * 100)}%</span></div>
    {pending && <div className="connection-prompt"><span className="dot green-dot" />{pending.componentId ? 'Выберите контакт платы для соединения' : 'Выберите контакт компонента'}<button aria-label="Отменить соединение" className="icon-button" onClick={() => setPending(null)}><Unplug size={15} /></button></div>}
    <svg ref={svgRef} className="assembly-svg" aria-label="Холст монтажа" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onClickCapture={event => { if (blockClick.current) { event.preventDefault(); event.stopPropagation(); blockClick.current = false; } }}>
      <defs><pattern id="assembly-dots" width={24 * viewport.zoom} height={24 * viewport.zoom} x={viewport.x} y={viewport.y} patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#3b465d" opacity=".65" /></pattern></defs><rect width="100%" height="100%" fill="url(#assembly-dots)" />
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {project.assembly.connections.map(wire => {
          const component = project.components.find(component => component.id === wire.componentId);
          const module = component && moduleFor(component, catalog);
          const terminal = module?.terminals.find(terminal => terminal.id === wire.terminalId);
          const pin = board.pins.find(pin => pin.id === wire.boardPinId);
          if (!terminal || !pin) return null;
          const position = positions[component.id];
          const start = { x: boardPosition.x + pin.x, y: boardPosition.y + pin.y }, end = { x: position.x + terminal.x, y: position.y + terminal.y };
          const bend = Math.max(70, Math.abs(end.x - start.x) * 0.5);
          const path = `M${start.x},${start.y} C${start.x + (pin.side === 'left' ? -bend : bend)},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}`;
          const invalid = connectionProblem(project, catalog, wire.componentId, wire.terminalId, wire.boardPinId);
          const selected = selection?.type === 'wire' && selection.id === wire.id;
          const color = invalid ? '#fb7185' : terminal.kind === 'ground' ? '#7c8ba8' : terminal.kind === 'gpio-output' ? '#34d399' : '#a78bfa';
          return <g key={wire.id} className="physical-wire" data-wire={wire.id} role="button" tabIndex={0} aria-label={`Соединение ${component.name}: ${terminal.label} → ${pin.label}`} onClick={event => { event.stopPropagation(); setSelection({ type: 'wire', id: wire.id }); setPending(null); }} onKeyDown={activate(() => setSelection({ type: 'wire', id: wire.id }))}>
            <path d={path} fill="none" stroke="transparent" strokeWidth="18" /><path className="visible-wire" d={path} fill="none" stroke={color} strokeWidth={selected ? 4 : 2.2} strokeDasharray={terminal.kind === 'ground' ? '5 4' : undefined} opacity={selected || selectedComponent === component.id ? 1 : 0.75} /><title>{invalid || `${terminal.label} → ${pin.label}`}</title>
          </g>;
        })}
        <g transform={`translate(${boardPosition.x} ${boardPosition.y})`}>
          <image href={getAsset(board.svg)} width={board.width} height={board.height} data-drag="board" className="board-drawing" />
          {board.pins.map(pin => {
            const blocked = pinProblem(project, pin, board);
            const selected = selection?.type === 'pin' && selection.id === pin.id;
            const connected = project.assembly.connections.some(wire => wire.boardPinId === pin.id);
            const candidate = pending?.componentId && !connectionProblem(project, catalog, pending.componentId, pending.terminalId, pin.id);
            const color = pin.kind === 'ground' ? '#7c8ba8' : pin.kind === 'power' ? '#fb7185' : pin.kind === 'control' ? '#e9b968' : blocked ? '#576179' : '#34d399';
            const label = `${pin.physicalNumber} · ${pin.label}`;
            return <g key={pin.id} data-pin={pin.id} className={`board-pin ${selected || connected ? 'pin-selected' : ''} ${candidate ? 'pin-candidate' : ''}`} role="button" tabIndex={0} aria-label={`Контакт ${pin.id}: ${pin.label}${blocked ? ', ограничен' : ''}`} onClick={event => { event.stopPropagation(); if (!busy) onPin(pin); }} onKeyDown={activate(() => { if (!busy) onPin(pin); })}>
              <rect x={pin.side === 'left' ? 2 : pin.x - 12} y={pin.y - 11} width="108" height="22" rx="4" fill={selected || connected ? '#24364a' : '#101722'} opacity={selected || connected ? 0.9 : 0.7} />
              <circle cx={pin.x} cy={pin.y} r={candidate ? 6 : 5} fill={connected ? color : '#121c26'} stroke={color} strokeWidth={selected || candidate ? 2.5 : 1.5} />
              <text x={pin.side === 'left' ? pin.x - 12 : pin.x + 12} y={pin.y + 3.5} textAnchor={pin.side === 'left' ? 'end' : 'start'} fill={blocked && pin.kind === 'gpio' ? '#69758e' : '#bbc9db'} fontSize="10" fontFamily="ui-monospace, monospace">{label}</text>
              <title>{label} · {blocked || (pin.kind === 'gpio' ? 'Цифровой GPIO' : pin.kind === 'ground' ? 'Общая земля' : 'Питание / управление')}{pin.functions.length ? ` · ${pin.functions.join(', ')}` : ''}</title>
            </g>;
          })}
        </g>
        {project.components.map(component => {
          const module = moduleFor(component, catalog), position = positions[component.id];
          const selected = selectedComponent === component.id;
          return <g key={component.id} transform={`translate(${position.x} ${position.y})`} className={`hardware-node ${selected ? 'hardware-selected' : ''}`} data-drag={component.id} role="button" tabIndex={0} aria-label={`Компонент ${component.name}`} onClick={() => setSelection({ type: 'component', id: component.id })} onKeyDown={activate(() => setSelection({ type: 'component', id: component.id }))}>
            <rect width={module?.visual.width || 230} height={module?.visual.height || 185} rx="12" fill="#151c2a" stroke={selected ? module?.color || '#8b5cf6' : '#344158'} strokeWidth={selected ? 2 : 1} />
            <rect x="0" y="14" width="3" height="29" rx="1" fill={module?.color || '#fb7185'} />
            <text x="16" y="30" fill="#e2e8f0" fontSize="12" fontWeight="550">{component.name.length > 28 ? component.name.slice(0, 27) + '…' : component.name}</text><text x="16" y="49" fill="#72869f" fontSize="8" fontFamily="monospace">{module ? `${module.categoryName.toUpperCase()} / v${component.moduleVersion}` : 'МОДУЛЬ НЕ УСТАНОВЛЕН'}</text>
            {module && <image href={getAsset(module.visual.svg)} x="25" y="57" width="180" height="56" />}
            {module?.terminals.map(terminal => {
              const wire = project.assembly.connections.find(wire => wire.componentId === component.id && wire.terminalId === terminal.id);
              const pin = wire && board.pins.find(pin => pin.id === wire.boardPinId);
              const active = pending?.componentId === component.id && pending.terminalId === terminal.id;
              const color = terminal.kind === 'ground' ? '#7c8ba8' : module.color;
              return <g key={terminal.id} data-terminal={terminal.id} role="button" tabIndex={0} className="component-terminal" aria-label={`${component.name}: ${terminal.label}`} onClick={event => { event.stopPropagation(); if (!busy) onTerminal(component, terminal); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); if (!busy) onTerminal(component, terminal); } }}>
                <rect x="-12" y={terminal.y - 13} width="234" height="26" rx="4" fill={active ? '#8b5cf619' : 'transparent'} /><circle cx={terminal.x} cy={terminal.y} r="6" fill={wire ? color : '#151c2a'} stroke={color} strokeWidth={active ? 3 : 1.7} /><text x="16" y={terminal.y + 3} fill="#a8b8cb" fontSize="10">{terminal.label}</text><text x="214" y={terminal.y + 3} textAnchor="end" fill={pin ? color : '#5b6c86'} fontSize="10" fontFamily="monospace">{pin?.label || '—'}</text>
              </g>;
            })}
          </g>;
        })}
      </g>
    </svg>
    <div className="canvas-toolbar"><span className="canvas-navigation-hint"><Move size={13} />Пробел + перетаскивание · панорама</span><CanvasControls subject="монтаж" zoom={viewport.zoom} busy={busy} onZoomOut={() => zoomAt(1 / 1.2)} onZoomIn={() => zoomAt(1.2)} onFit={() => updateViewport(fitViewport(bounds, size))} /></div>
  </div>;
}
