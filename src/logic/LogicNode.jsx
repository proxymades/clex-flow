import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { Timer, ScanLine, ArrowUpRight, Repeat2, Terminal, Box, TriangleAlert, Monitor } from 'lucide-react';
import ScreenPreview from '../displays/ScreenPreview.jsx';
import { TYPE_COLORS, TYPE_NAMES } from './model.js';
const icons = { Timer, ScanLine, ArrowUpRight, Repeat2, Terminal, Monitor };

function LogicNode({ id, data, selected }) {
  const { definition, node, binding, issueCount, onPort, pending, display, screen } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    // WebKit требует повторного измерения портов после загрузки карточки.
    updateNodeInternals(id);
  }, [id, definition, updateNodeInternals]);
  const Icon = icons[definition?.icon] || Box;
  const inputs = definition?.inputs || [], outputs = definition?.outputs || [];
  const rows = Math.max(inputs.length, outputs.length);
  const summary = definition?.editor === 'screen' ? (binding?.component?.name || 'Выберите дисплей монтажа') : definition?.id === 'clex.logic.timer' ? `${node.parameters.intervalMs} мс` : definition?.constraints.hardware ? binding?.component ? `${binding.component.name} · ${binding.gpio === null ? 'GPIO не назначен' : `GPIO${binding.gpio}`}` : 'Выберите компонент монтажа' : node.parameters.message || 'Пустое сообщение';
  function portView(port, direction) {
    const active = pending?.nodeId === id && pending.portId === port.id && pending.direction === direction;
    return <div className={`logic-port ${direction} ${active ? 'pending-port' : ''}`} key={`${direction}-${port.id}`} style={{ '--port-color': TYPE_COLORS[port.type] }}>
      <Handle type={direction === 'output' ? 'source' : 'target'} position={direction === 'output' ? Position.Right : Position.Left} id={port.id} aria-label={`${direction === 'output' ? 'Выход' : 'Вход'} ${port.name}: ${node.name}`} title={`${port.name} · ${TYPE_NAMES[port.type]}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onPort({ nodeId: id, portId: port.id, direction }); } }} tabIndex={0} />
      <button className="logic-port-name nodrag" aria-label={`${direction === 'output' ? 'Выход' : 'Вход'}: ${node.name} / ${port.name}`} title={TYPE_NAMES[port.type]} onClick={event => { event.stopPropagation(); onPort({ nodeId: id, portId: port.id, direction }); }}><span className="port-type-dot" />{port.name}</button>
    </div>;
  }
  return <article className={`logic-node ${selected ? 'node-selected' : ''} ${issueCount ? 'node-invalid' : ''}`} style={{ '--node-color': definition?.color || '#fb7185' }}>
    <header className="logic-drag-handle"><span className="logic-node-icon"><Icon size={19} /></span><div><strong>{node.name}</strong><small>{definition?.categoryName || 'Модуль не установлен'} · v{node.moduleVersion}</small></div>{issueCount > 0 && <span className="node-issue-count" title={`${issueCount} ошибок`}><TriangleAlert size={12} />{issueCount}</span>}</header>
    <div className="logic-node-summary" title={summary}>{summary}</div>
    {definition?.editor === 'screen' && display && <div className="logic-display-preview nodrag" title="Двойное нажатие открывает редактор экрана"><ScreenPreview display={display} screen={screen || { background: '#000000', elements: [] }} /></div>}
    {!definition && <p className="logic-missing">Точная версия модуля отсутствует в библиотеке.</p>}
    <div className="logic-ports">{Array.from({ length: rows }, (_, index) => <div className="logic-port-row" key={index}>{inputs[index] ? portView(inputs[index], 'input') : <span />}{outputs[index] ? portView(outputs[index], 'output') : <span />}</div>)}</div>
  </article>;
}
export default memo(LogicNode);
