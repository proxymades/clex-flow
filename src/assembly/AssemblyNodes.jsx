import {relayChannelCount} from '../relay/model.js';
import {formatCount} from '../utils/plural.js';
import { memo, useEffect, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { getAsset } from '../catalog/index.js';
import { boardPinLabel } from './pinLayout.js';

const activate = callback => event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault(); event.stopPropagation(); callback();
  }
};
const handleStyle = (x, y) => ({
  left: x, top: y, right: 'auto', bottom: 'auto',
  transform: 'translate(-50%, -50%)', width: 12, height: 12,
});

function BoardNode({ id, data }) {
  const { board, pins, onPin, busy } = data;
  const [hoveredPin, setHoveredPin] = useState(null);
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { updateInternals(id); }, [id, board, updateInternals]);
  return <div className="assembly-board-node" style={{ width: board.width, height: board.height }}>
    <svg width={board.width} height={board.height} viewBox={'0 0 ' + board.width + ' ' + board.height}>
      <image href={getAsset(board.svg)} width={board.width} height={board.height} className="board-drawing" preserveAspectRatio="xMinYMin meet" />
      {pins.map(({ pin, blocked, selected, connected, candidate, color }) => {
        const label = pin.physicalNumber + ' · ' + pin.label, layout = boardPinLabel(pin);
        return <g key={pin.id} data-pin={pin.id} className={['board-pin nodrag nopan', selected || connected ? 'pin-selected' : '', candidate ? 'pin-candidate' : '', hoveredPin === pin.id ? 'pin-hovered' : ''].join(' ')} onPointerEnter={() => setHoveredPin(pin.id)} onPointerLeave={() => setHoveredPin(null)} onFocus={() => setHoveredPin(pin.id)} onBlur={() => setHoveredPin(null)} role="button" tabIndex={0} aria-label={'Контакт ' + pin.id + ': ' + pin.label + (blocked ? ', ограничен' : '')} onClick={event => { event.stopPropagation(); if (!busy) onPin(pin); }} onKeyDown={activate(() => { if (!busy) onPin(pin); })}>
          <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} rx="4" fill={selected || connected ? '#24364a' : '#101722'} opacity={selected || connected ? 0.9 : 0.7} />
          <circle cx={pin.x} cy={pin.y} r={candidate ? 6 : 5} fill={connected || candidate || selected || hoveredPin === pin.id ? color : '#121c26'} stroke={color} strokeWidth={selected || candidate ? 2.5 : 1.5} />
          <text x={layout.textX} y={layout.textY} textAnchor={layout.textAnchor} fill={blocked && pin.kind === 'gpio' ? '#69758e' : '#bbc9db'} fontSize={layout.fontSize} fontFamily="ui-monospace, monospace">{layout.text}</text>
          <title>{label + ' · ' + (blocked || (pin.kind === 'gpio' ? 'Цифровой GPIO' : pin.kind === 'ground' ? 'Общая земля' : pin.kind === 'analog' ? 'Аналоговый вход' : 'Питание / управление')) + (pin.functions.length ? ' · ' + pin.functions.join(', ') : '') + (pin.powerNote ? ' · ' + pin.powerNote : '')}</title>
        </g>;
      })}
    </svg>
    {pins.map(({ pin }) => <Handle key={pin.id} type="source" id={pin.id} position={pin.side === 'left' ? Position.Left : Position.Right} className="assembly-handle" style={handleStyle(pin.x, pin.y)} isConnectable={!busy} aria-label={'Порт платы ' + pin.id} title={pin.label} onPointerEnter={() => setHoveredPin(pin.id)} onPointerLeave={() => setHoveredPin(null)} onClick={event => { event.stopPropagation(); if (!busy) onPin(pin); }} />)}
  </div>;
}

function HardwareNode({ id, data }) {
  const { component, module, layout, terminals, selected, onTerminal, onSelect, busy } = data;
  const [hoveredTerminal, setHoveredTerminal] = useState(null);
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { updateInternals(id); }, [id, module, layout, updateInternals]);
  const { width, height, headerOffset } = layout;
  const splitSides=terminals.some(({terminal})=>terminal.side==='left')&&terminals.some(({terminal})=>terminal.side==='right');
  return <div className={'hardware-node assembly-hardware-node ' + (selected ? 'hardware-selected' : '')} style={{ width, height }} role="button" tabIndex={0} aria-label={'Компонент ' + component.name} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(component.id); } }}>
    <svg width={width} height={height} viewBox={'0 0 ' + width + ' ' + height}>
      <rect width={width} height={height} rx="12" fill="#151c2a" stroke={selected ? module?.color || '#8b5cf6' : '#344158'} strokeWidth={selected ? 2 : 1} />
      <rect x="0" y={14 + headerOffset} width="3" height="29" rx="1" fill={module?.color || '#fb7185'} />
      <text x="16" y={30 + headerOffset} fill="#e2e8f0" fontSize="12" fontWeight="550">{component.name.length > 28 ? component.name.slice(0, 27) + '…' : component.name}</text>
      <text x="16" y={49 + headerOffset} fill="#72869f" fontSize="8" fontFamily="monospace">{module?.id==='clex.hardware.relay'?formatCount(relayChannelCount(component),['канал','канала','каналов'])+' · '+String(component.parameters.activeLevel||'').toUpperCase()+' / v'+component.moduleVersion:module ? module.categoryName.toUpperCase() + ' / v' + component.moduleVersion : 'МОДУЛЬ НЕ УСТАНОВЛЕН'}</text>
      {module && <image href={getAsset(module.visual.svg)} x={(width - 180) / 2} y={57 + headerOffset} width="180" height="56" />}
      {terminals.map(({ terminal, pin, active, candidate, color, connected }) => {
        const vertical = terminal.side === 'top' || terminal.side === 'bottom';
        const labelY = terminal.side === 'top' ? 14 : terminal.side === 'bottom' ? height - 24 : terminal.y + (splitSides?-3:3);
        const pinY = terminal.side === 'top' ? 29 : height - 10;
        const label = vertical && terminal.label.length > 13 ? terminal.label.slice(0, 12) + '…' : terminal.label;
        const right=terminal.side==='right',columnX=right?width-16:16,columnAnchor=right?'end':'start';
        const maxLabel=Math.max(10,Math.floor((splitSides?width/2-32:width-100)/5.5)),connection=terminal.kind==='nc'?'Не подключать':pin?.label||'–',connectionText=connection.length>maxLabel?connection.slice(0,maxLabel-1)+'…':connection;
        return <g key={terminal.id} data-terminal={terminal.id} className={['component-terminal nodrag nopan', candidate ? 'terminal-candidate' : '', active ? 'terminal-active' : '', hoveredTerminal === terminal.id ? 'terminal-hovered' : ''].join(' ')} onPointerEnter={() => setHoveredTerminal(terminal.id)} onPointerLeave={() => setHoveredTerminal(null)} onFocus={() => setHoveredTerminal(terminal.id)} onBlur={() => setHoveredTerminal(null)} role="button" tabIndex={0} aria-disabled={terminal.kind==='nc'||undefined} aria-label={component.name + ': ' + terminal.label} onClick={event => { event.stopPropagation(); if (!busy && terminal.kind!=='nc') onTerminal(component, terminal); }} onKeyDown={activate(() => { if (!busy && terminal.kind!=='nc') onTerminal(component, terminal); })}>
          <rect x={vertical ? terminal.x - 39 : splitSides&&right?width/2:-12} y={vertical ? (terminal.side === 'top' ? 0 : height - 38) : terminal.y - 13} width={vertical ? 78 : splitSides?width/2+12:width+4} height={vertical ? 38 : 26} rx="4" fill={active ? '#8b5cf619' : 'transparent'} />
          <circle cx={terminal.x} cy={terminal.y} r="6" fill={connected || active || candidate || hoveredTerminal === terminal.id ? color : '#151c2a'} stroke={color} strokeWidth={active || candidate ? 3 : 1.7} />
          <text x={vertical ? terminal.x : splitSides?columnX:16} y={labelY} textAnchor={vertical ? 'middle' : splitSides?columnAnchor:'start'} fill="#a8b8cb" fontSize={vertical ? 9 : 10}>{label}</text>
          <text x={vertical ? terminal.x : splitSides?columnX:width-16} y={vertical ? pinY : terminal.y+(splitSides?11:3)} textAnchor={vertical ? 'middle' : splitSides?columnAnchor:'end'} fill={pin ? color : '#5b6c86'} fontSize="9" fontFamily="monospace">{connectionText}</text>
          <title>{terminal.label + ' · ' + (terminal.kind==='nc'?'Не подключать':pin?.label || 'Не подключен')}</title>
        </g>;
      })}
    </svg>
    {terminals.filter(({terminal})=>terminal.kind!=='nc').map(({ terminal }) => <Handle key={terminal.id} type="source" id={terminal.id} position={Position[terminal.side[0].toUpperCase() + terminal.side.slice(1)]} className="assembly-handle" style={handleStyle(terminal.x, terminal.y)} isConnectable={!busy && terminal.kind!=='nc'} aria-label={'Порт компонента ' + component.name + ': ' + terminal.label} title={terminal.label} onPointerEnter={() => setHoveredTerminal(terminal.id)} onPointerLeave={() => setHoveredTerminal(null)} onClick={event => { event.stopPropagation(); if (!busy && terminal.kind!=='nc') onTerminal(component, terminal); }} />)}
  </div>;
}

export const AssemblyBoardNode = memo(BoardNode);
export const AssemblyHardwareNode = memo(HardwareNode);
