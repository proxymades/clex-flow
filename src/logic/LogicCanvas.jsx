import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, MarkerType, SelectionMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Undo2, Redo2, Copy, ClipboardPaste, Files, Trash2, Layers, Unplug } from 'lucide-react';
import CanvasControls from '../components/CanvasControls.jsx';
import useCanvasKeys from '../components/useCanvasKeys.js';
import LogicNode from './LogicNode.jsx';
import { graphModule, hardwareBinding, connectionProblem, TYPE_COLORS } from './model.js';

const nodeTypes = { logic: LogicNode };
const emptyMeasurements = {};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export default function LogicCanvas({ project, catalog, history, selection, setSelection, pending, onPort, onConnect, error, setError, busy, clipboard, onCopy, onPaste, onDuplicate, onRemove, issues, onInteraction }) {
  const [instance, setInstance] = useState(null), [measurements, setMeasurements] = useState({});
  const fitView = () => instance?.fitView({ padding: 0.22, maxZoom: 1.1, duration: 0 });
  const { spaceHeld } = useCanvasKeys({ onFit: fitView, onEscape: () => onPort(null), busy });
  const [positions, setPositions] = useState({});
  const draftPositions = useRef({}), draftViewport = useRef(null), dragging = useRef(false), interactions = useRef(new Set());
  const interaction = useCallback((kind, active) => {
    const wasActive = interactions.current.size > 0;
    if (active) interactions.current.add(kind); else interactions.current.delete(kind);
    const isActive = interactions.current.size > 0;
    if (wasActive !== isActive) onInteraction(isActive);
  }, [onInteraction]);
  useEffect(() => () => onInteraction(false), [onInteraction]);
  const previousIds = useRef(new Set(project.logic.nodes.map(node => node.id)));
  useEffect(() => {
    const added = project.logic.nodes.some(node => !previousIds.current.has(node.id));
    previousIds.current = new Set(project.logic.nodes.map(node => node.id));
    if (instance && added) instance.fitView({ padding: 0.22, maxZoom: 1.1 });
  }, [project.logic.nodes, instance]);
  useEffect(() => {
    // An external reset (for example discarding edits) still restores the
    // saved camera, without controlling its position on every pointer move.
    if (instance && !interactions.current.size && !same(instance.getViewport(), project.logic.viewport)) instance.setViewport(project.logic.viewport);
  }, [project.logic.viewport, instance]);
  // Keep a measured object while dimensions are pending: React Flow clears measured handle bounds when this property is absent on a controlled-node rerender.
  const modelNodes = useMemo(() => {
    const selected = new Set(selection.nodes), errors = new Map();
    for (const issue of issues) if (issue.severity === 'error' && issue.nodeId) errors.set(issue.nodeId, (errors.get(issue.nodeId) || 0) + 1);
    return project.logic.nodes.map(node => ({ id: node.id, type: 'logic', position: node.position, measured: measurements[node.id] || emptyMeasurements, selected: selected.has(node.id), ariaLabel: `Блок: ${node.name}`, data: { node, definition: graphModule(node, catalog), binding: hardwareBinding(node, project, catalog), issueCount: errors.get(node.id) || 0, onPort, pending } }));
  }, [project, catalog, measurements, selection.nodes, issues, onPort, pending]);
  // Moving a node updates only its canvas position. Card data, validation,
  // firmware generation and project serialization stay outside the frame loop.
  const nodes = useMemo(() => modelNodes.map(node => positions[node.id] ? { ...node, ...positions[node.id] } : node), [modelNodes, positions]);
  const edges = useMemo(() => {
    const selected = new Set(selection.edges), errors = new Set(issues.filter(issue => issue.severity === 'error').map(issue => issue.edgeId));
    const names = new Map(project.logic.nodes.map(node => [node.id, node.name]));
    return project.logic.edges.map(edge => ({ ...edge, type: 'default', selected: selected.has(edge.id), ariaLabel: `Связь: ${names.get(edge.source)} → ${names.get(edge.target)}`, style: { stroke: errors.has(edge.id) ? '#fb7185' : TYPE_COLORS[edge.dataType], strokeWidth: selected.has(edge.id) ? 3 : 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: TYPE_COLORS[edge.dataType], width: 16, height: 16 } }));
  }, [project.logic.edges, project.logic.nodes, selection.edges, issues]);
  const commitPositions = useCallback(updates => {
    history.change(graph => ({ ...graph, nodes: graph.nodes.map(node => {
      const position = updates[node.id]?.position;
      return position && (position.x !== node.position.x || position.y !== node.position.y) ? { ...node, position } : node;
    }), ...(draftViewport.current ? { viewport: draftViewport.current } : {}) }));
    draftViewport.current = null;
  }, [history]);
  const beginDrag = useCallback(() => {
    dragging.current = true;
    interaction('drag', true);
  }, [interaction]);
  const finishDrag = useCallback(() => {
    if (!dragging.current) return;
    commitPositions(draftPositions.current);
    dragging.current = false;
    draftPositions.current = {};
    setPositions({});
    interaction('drag', false);
  }, [commitPositions, interaction]);
  const changeNodes = useCallback(changes => {
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
    if (!busy && positions.length) {
      const updates = Object.fromEntries(positions.map(change => [change.id, { position: { x: clamp(change.position.x, -5000, 5000), y: clamp(change.position.y, -5000, 5000) }, dragging: Boolean(change.dragging) }]));
      if (dragging.current) {
        draftPositions.current = { ...draftPositions.current, ...updates };
        setPositions(draftPositions.current);
      } else commitPositions(updates); // Keyboard movement commits immediately.
    }
  }, [busy, setSelection, commitPositions]);
  const changeEdges = useCallback(changes => {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => { const ids = new Set(previous.edges); for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id); const next = { ...previous, edges: [...ids] }; return same(next, previous) ? previous : next; });
  }, [setSelection]);
  const moveStart = useCallback(() => interaction('viewport', true), [interaction]);
  const moveEnd = useCallback((_event, viewport) => {
    const next = { x: clamp(viewport.x, -50000, 50000), y: clamp(viewport.y, -50000, 50000), zoom: clamp(viewport.zoom, 0.2, 3) };
    if (!busy) {
      if (dragging.current) draftViewport.current = next;
      else history.change(graph => ({ ...graph, viewport: next }), { track: false });
    }
    interaction('viewport', false);
  }, [busy, history, interaction]);
  function endConnection(_event, state) {
    if (state.isValid || !state.fromNode || !state.toNode || !state.fromHandle || !state.toHandle) return;
    const sourceFirst = state.fromHandle.type === 'source';
    const connection = { source: sourceFirst ? state.fromNode.id : state.toNode.id, sourceHandle: sourceFirst ? state.fromHandle.id : state.toHandle.id, target: sourceFirst ? state.toNode.id : state.fromNode.id, targetHandle: sourceFirst ? state.toHandle.id : state.fromHandle.id };
    const problem = connectionProblem(project.logic, catalog, connection);
    if (problem) setError(problem);
  }
  return <main className={`logic-canvas ${spaceHeld ? 'canvas-space-pan' : ''}`}>
    <div className="logic-toolbar"><div><button className="icon-button" title="Отменить · ⌘/Ctrl Z" aria-label="Отменить изменение графа" disabled={busy || !history.canUndo} onClick={history.undo}><Undo2 size={16} /></button><button className="icon-button" title="Повторить · ⌘/Ctrl Shift Z" aria-label="Повторить изменение графа" disabled={busy || !history.canRedo} onClick={history.redo}><Redo2 size={16} /></button><span className="toolbar-divider" /><button className="icon-button" title="Копировать · ⌘/Ctrl C" aria-label="Копировать выделенные блоки" disabled={busy || !selection.nodes.length} onClick={onCopy}><Copy size={16} /></button><button className="icon-button" title="Вставить · ⌘/Ctrl V" aria-label="Вставить блоки" disabled={busy || !clipboard?.nodes.length} onClick={onPaste}><ClipboardPaste size={16} /></button><button className="icon-button" title="Дублировать · ⌘/Ctrl D" aria-label="Дублировать выделенные блоки" disabled={busy || !selection.nodes.length} onClick={onDuplicate}><Files size={16} /></button><button className="icon-button danger-hover" title="Удалить · Delete" aria-label="Удалить выделение графа" disabled={busy || (!selection.nodes.length && !selection.edges.length)} onClick={onRemove}><Trash2 size={16} /></button></div></div>
    <div className="reactflow-region"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultViewport={project.logic.viewport} onNodesChange={changeNodes} onEdgesChange={changeEdges} onNodeDragStart={beginDrag} onNodeDragStop={finishDrag} onSelectionDragStart={beginDrag} onSelectionDragStop={finishDrag} onInit={setInstance} onMoveStart={moveStart} onMoveEnd={moveEnd} onConnect={onConnect} onConnectEnd={endConnection} isValidConnection={connection => !connectionProblem(project.logic, catalog, connection)} onPaneClick={() => setSelection({ nodes: [], edges: [] })} nodeExtent={[[-5000, -5000], [5000, 5000]]} minZoom={0.2} maxZoom={3} nodesDraggable={!busy && !spaceHeld} nodesConnectable={!busy && !spaceHeld} edgesReconnectable={false} selectionMode={SelectionMode.Partial} selectionKeyCode="Shift" multiSelectionKeyCode={['Meta', 'Control']} deleteKeyCode={null} colorMode="dark" ariaLabelConfig={{ 'node.a11yDescription.default': 'Выделите блок. Стрелки перемещают, Delete удаляет.', 'edge.a11yDescription.default': 'Выделите связь. Delete удаляет.' }} onError={(_code, message) => setError(message)}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#34405b" />
    </ReactFlow>{!nodes.length && <div className="logic-empty"><Layers size={43} strokeWidth={1.2} /><h2>Соберите логику эксперимента</h2><p>Добавьте таймер и переключение GPIO.<br />Соедините «Такт» с входом «Выполнить».</p><span>Начните с библиотеки слева</span></div>}
    {pending && <div className="logic-connection-prompt"><span className="dot green-dot" />{pending.direction === 'output' ? 'Выберите совместимый вход блока' : 'Выберите совместимый выход блока'}<button className="icon-button" aria-label="Отменить связь логики" onClick={() => onPort(null)}><Unplug size={15} /></button></div>}
    {error && <div className="wiring-error logic-connect-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError('')}>Закрыть</button></div>}
    </div>
    <footer className="logic-canvas-footer"><span>{nodes.length} блоков · {edges.length} связей</span><CanvasControls subject="граф" zoom={project.logic.viewport.zoom} busy={busy} fitDisabled={!nodes.length} onZoomOut={() => instance?.zoomOut({ duration: 0 })} onZoomIn={() => instance?.zoomIn({ duration: 0 })} onFit={fitView} /><span className="canvas-navigation-hint">Пробел + перетаскивание · панорама</span></footer>
  </main>;
}
