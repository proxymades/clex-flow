import { useEffect, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, MarkerType, SelectionMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Undo2, Redo2, Copy, ClipboardPaste, Files, Trash2, Plus, Minus, Maximize, Layers, Unplug } from 'lucide-react';
import LogicNode from './LogicNode.jsx';
import { graphModule, hardwareBinding, connectionProblem, TYPE_COLORS } from './model.js';

const nodeTypes = { logic: LogicNode };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const statusNames = { idle: 'Автосохранение включено', waiting: 'Ожидает сохранения…', saving: 'Сохраняем граф…', saved: 'Граф сохранён', error: 'Ошибка сохранения' };
export default function LogicCanvas({ project, catalog, history, selection, setSelection, pending, onPort, onConnect, error, setError, busy, clipboard, onCopy, onPaste, onDuplicate, onRemove, issues, autoState }) {
  const [instance, setInstance] = useState(null), [measurements, setMeasurements] = useState({});
  const previousIds = useRef(new Set(project.logic.nodes.map(node => node.id)));
  useEffect(() => {
    const added = project.logic.nodes.some(node => !previousIds.current.has(node.id));
    previousIds.current = new Set(project.logic.nodes.map(node => node.id));
    if (instance && added) instance.fitView({ padding: 0.22, maxZoom: 1.1 });
  }, [project.logic.nodes, instance]);
  // Keep a measured object while dimensions are pending: React Flow clears measured handle bounds when this property is absent on a controlled-node rerender.
  const nodes = project.logic.nodes.map(node => ({ id: node.id, type: 'logic', position: node.position, measured: measurements[node.id] || {}, selected: selection.nodes.includes(node.id), dragHandle: '.logic-drag-handle', ariaLabel: `Блок: ${node.name}`, data: { node, definition: graphModule(node, catalog), binding: hardwareBinding(node, project, catalog), issueCount: issues.filter(issue => issue.severity === 'error' && issue.nodeId === node.id).length, onPort, pending } }));
  const edges = project.logic.edges.map(edge => ({ ...edge, type: 'default', selected: selection.edges.includes(edge.id), ariaLabel: `Связь: ${project.logic.nodes.find(node => node.id === edge.source)?.name} → ${project.logic.nodes.find(node => node.id === edge.target)?.name}`, style: { stroke: issues.some(issue => issue.severity === 'error' && issue.edgeId === edge.id) ? '#fb7185' : TYPE_COLORS[edge.dataType], strokeWidth: selection.edges.includes(edge.id) ? 3 : 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: TYPE_COLORS[edge.dataType], width: 16, height: 16 } }));
  function changeNodes(changes) {
    const dimensions = changes.filter(change => change.type === 'dimensions' && change.dimensions);
    if (dimensions.length) setMeasurements(previous => {
      const next = { ...previous, ...Object.fromEntries(dimensions.map(change => [change.id, change.dimensions])) };
      return same(next, previous) ? previous : next;
    });
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const ids = new Set(previous.nodes); for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id);
      const next = { ...previous, nodes: [...ids] }; return same(next, previous) ? previous : next;
    });
    const positions = changes.filter(change => change.type === 'position' && change.position);
    if (!busy && positions.length) history.change(graph => ({ ...graph, nodes: graph.nodes.map(node => { const change = positions.find(change => change.id === node.id); return change ? { ...node, position: { x: clamp(change.position.x, -5000, 5000), y: clamp(change.position.y, -5000, 5000) } } : node; }) }));
  }
  function changeEdges(changes) {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => { const ids = new Set(previous.edges); for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id); const next = { ...previous, edges: [...ids] }; return same(next, previous) ? previous : next; });
  }
  function endConnection(_event, state) {
    if (state.isValid || !state.fromNode || !state.toNode || !state.fromHandle || !state.toHandle) return;
    const sourceFirst = state.fromHandle.type === 'source';
    const connection = { source: sourceFirst ? state.fromNode.id : state.toNode.id, sourceHandle: sourceFirst ? state.fromHandle.id : state.toHandle.id, target: sourceFirst ? state.toNode.id : state.fromNode.id, targetHandle: sourceFirst ? state.toHandle.id : state.fromHandle.id };
    const problem = connectionProblem(project.logic, catalog, connection);
    if (problem) setError(problem);
  }
  return <main className="logic-canvas">
    <div className="logic-toolbar"><div><button className="icon-button" title="Отменить · ⌘/Ctrl Z" aria-label="Отменить изменение графа" disabled={busy || !history.canUndo} onClick={history.undo}><Undo2 size={16} /></button><button className="icon-button" title="Повторить · ⌘/Ctrl Shift Z" aria-label="Повторить изменение графа" disabled={busy || !history.canRedo} onClick={history.redo}><Redo2 size={16} /></button><span className="toolbar-divider" /><button className="icon-button" title="Копировать · ⌘/Ctrl C" aria-label="Копировать выделенные блоки" disabled={busy || !selection.nodes.length} onClick={onCopy}><Copy size={16} /></button><button className="icon-button" title="Вставить · ⌘/Ctrl V" aria-label="Вставить блоки" disabled={busy || !clipboard?.nodes.length} onClick={onPaste}><ClipboardPaste size={16} /></button><button className="icon-button" title="Дублировать · ⌘/Ctrl D" aria-label="Дублировать выделенные блоки" disabled={busy || !selection.nodes.length} onClick={onDuplicate}><Files size={16} /></button><button className="icon-button danger-hover" title="Удалить · Delete" aria-label="Удалить выделение графа" disabled={busy || (!selection.nodes.length && !selection.edges.length)} onClick={onRemove}><Trash2 size={16} /></button></div><span className={`logic-auto-state ${autoState === 'error' ? 'save-error' : ''}`}><span className="dot" />{statusNames[autoState]}</span></div>
    <div className="reactflow-region"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} viewport={project.logic.viewport} onNodesChange={changeNodes} onEdgesChange={changeEdges} onNodeDragStart={() => history.begin()} onNodeDragStop={() => history.end()} onSelectionDragStart={() => history.begin()} onSelectionDragStop={() => history.end()} onInit={setInstance} onMoveEnd={(_event, viewport) => { if (!busy) history.change(graph => ({ ...graph, viewport: { x: clamp(viewport.x, -50000, 50000), y: clamp(viewport.y, -50000, 50000), zoom: clamp(viewport.zoom, 0.2, 3) } }), { track: false }); }} onConnect={onConnect} onConnectEnd={endConnection} isValidConnection={connection => !connectionProblem(project.logic, catalog, connection)} onPaneClick={() => setSelection({ nodes: [], edges: [] })} nodeExtent={[[-5000, -5000], [5000, 5000]]} minZoom={0.2} maxZoom={3} nodesDraggable={!busy} nodesConnectable={!busy} edgesReconnectable={false} selectionMode={SelectionMode.Partial} selectionKeyCode="Shift" multiSelectionKeyCode={['Meta', 'Control']} deleteKeyCode={null} colorMode="dark" ariaLabelConfig={{ 'node.a11yDescription.default': 'Выделите блок. Стрелки перемещают, Delete удаляет.', 'edge.a11yDescription.default': 'Выделите связь. Delete удаляет.' }} onError={(_code, message) => setError(message)}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#34405b" />
    </ReactFlow>{!nodes.length && <div className="logic-empty"><Layers size={43} strokeWidth={1.2} /><h2>Соберите логику эксперимента</h2><p>Добавьте таймер и переключение GPIO.<br />Соедините «Такт» с входом «Выполнить».</p><span>Начните с библиотеки слева</span></div>}
    {pending && <div className="logic-connection-prompt"><span className="dot green-dot" />{pending.direction === 'output' ? 'Выберите совместимый вход блока' : 'Выберите совместимый выход блока'}<button className="icon-button" aria-label="Отменить связь логики" onClick={() => onPort(null)}><Unplug size={15} /></button></div>}
    {error && <div className="wiring-error logic-connect-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError('')}>Закрыть</button></div>}
    </div>
    <footer className="logic-canvas-footer"><span>{nodes.length} блоков · {edges.length} связей</span>    <div className="logic-zoom-controls"><button className="icon-button" aria-label="Уменьшить граф" disabled={busy} onClick={() => instance?.zoomOut()}><Minus size={16} /></button><span>{Math.round(project.logic.viewport.zoom * 100)}%</span><button className="icon-button" aria-label="Увеличить граф" disabled={busy} onClick={() => instance?.zoomIn()}><Plus size={16} /></button><button className="icon-button" aria-label="Показать весь граф" disabled={busy || !nodes.length} onClick={() => instance?.fitView({ padding: 0.22, maxZoom: 1.1 })}><Maximize size={16} /></button></div><span className="logic-footer-hint">Редактирование · без исполнения</span></footer>
  </main>;
}
