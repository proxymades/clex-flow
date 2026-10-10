import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, ConnectionMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Unplug, Move, MousePointer2 } from 'lucide-react';
import CanvasControls from '../components/CanvasControls.jsx';
import useCanvasKeys from '../components/useCanvasKeys.js';
import { moduleFor, pinProblem, connectionProblem } from './model.js';
import { physicalConnection, physicalEdges } from './flow.js';
import { allocateWireLanes } from './wireRouting.js';
import { wireColors, GROUND_COLOR } from './wireColors.js';
import { terminalLayout } from './terminalLayout.js';
import { AssemblyBoardNode, AssemblyHardwareNode } from './AssemblyNodes.jsx';
import AssemblyWire from './AssemblyWire.jsx';

const nodeTypes = { physicalBoard: AssemblyBoardNode, physicalHardware: AssemblyHardwareNode };
const edgeTypes = { physical: AssemblyWire };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const viewportData = viewport => ({
  x: clamp(viewport.x, -50000, 50000), y: clamp(viewport.y, -50000, 50000), zoom: clamp(viewport.zoom, 0.2, 3),
});

export default function AssemblyCanvas({ project, board, catalog, selection, setSelection, pending, setPending, onTerminal, onPin, onConnect, onError, onTransform, onInteraction, busy }) {
  const root = useRef(null);
  const [instance, setInstance] = useState(null), [measurements, setMeasurements] = useState({}), [ready, setReady] = useState(false);
  const [positions, setPositions] = useState({}), [zoom, setZoom] = useState(project.assembly.viewport.zoom);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const draftPositions = useRef({}), dragging = useRef(false), interactions = useRef(new Set());
  const initial = useRef(true), silentFits = useRef(0), connectionStart = useRef(null);
  const autoFit = useRef(same(project.assembly.viewport, { x: 0, y: 0, zoom: 1 }));
  const fitView = () => {
    if (!instance || dragging.current) return;
    autoFit.current = false;
    return cameraAction(() => instance.fitView({ padding: 0.12, maxZoom: 1, duration: 0 }));
  };
  const { spaceHeld } = useCanvasKeys({ onFit: fitView, onEscape: () => setPending(null), busy });
  const interaction = useCallback((kind, active) => {
    const previous = interactions.current.size > 0;
    if (active) interactions.current.add(kind); else interactions.current.delete(kind);
    if (previous !== (interactions.current.size > 0)) onInteraction(interactions.current.size > 0);
  }, [onInteraction]);
  useEffect(() => () => { onInteraction(false); }, [onInteraction]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!instance || !size.width || !size.height) return;
    let live = true;
    const finish = () => { if (live) { initial.current = false; setReady(true); } };
    if (autoFit.current) {
      silentFits.current++;
      instance.fitView({ padding: 0.12, maxZoom: 1, duration: 0 }).finally(() => { silentFits.current--; finish(); });
    } else Promise.resolve().then(finish);
    return () => { live = false; };
  }, [instance, board.id, project.components.length, size.width, size.height]);
  useEffect(() => {
    if (instance && !autoFit.current && !interactions.current.size && !same(instance.getViewport(), project.assembly.viewport)) {
      instance.setViewport(project.assembly.viewport, { duration: 0 });
    }
  }, [instance, project.assembly.viewport]);

  const selectNode = useCallback(id => {
    if (busy || spaceHeld) return;
    setSelection({ type: id === 'board' ? 'board' : 'component', id });
  }, [busy, spaceHeld, setSelection]);
  const selectWire = useCallback(id => {
    if (busy || spaceHeld) return;
    setSelection({ type: 'wire', id }); setPending(null);
  }, [busy, spaceHeld, setSelection, setPending]);
  const pinClick = useCallback(pin => { if (!busy && !spaceHeld) onPin(pin); }, [busy, spaceHeld, onPin]);
  const terminalClick = useCallback((component, terminal) => { if (!busy && !spaceHeld) onTerminal(component, terminal); }, [busy, spaceHeld, onTerminal]);
  const problemFor = useCallback(connection => {
    try {
      const { componentId, terminalId, pinId } = physicalConnection(connection);
      return connectionProblem(project, catalog, componentId, terminalId, pinId);
    } catch (error) { return error.message; }
  }, [project, catalog]);
  const connect = useCallback(connection => {
    if (busy || spaceHeld) return;
    try {
      const { componentId, terminalId, pinId } = physicalConnection(connection);
      onConnect(componentId, terminalId, pinId);
    } catch (error) { onError(error.message); }
  }, [busy, spaceHeld, onConnect, onError]);
  const connectStart = useCallback(event => {
    connectionStart.current = { x: event.clientX, y: event.clientY };
    interaction('connection', true);
  }, [interaction]);
  const connectEnd = useCallback((event, state) => {
    const start = connectionStart.current;
    const moved = start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3;
    if (moved && !state.isValid && state.fromNode && state.toNode && state.fromHandle && state.toHandle) {
      const problem = problemFor({ source: state.fromNode.id, sourceHandle: state.fromHandle.id, target: state.toNode.id, targetHandle: state.toHandle.id });
      if (problem) onError(problem);
    }
    connectionStart.current = null;
    interaction('connection', false);
  }, [problemFor, onError, interaction]);

  const colors = useMemo(() => wireColors(project, catalog), [project, catalog]);
  const modelNodes = useMemo(() => {
    const pins = board.pins.map(pin => {
      const blocked = pinProblem(project, pin, board);
      const connectedWire = project.assembly.connections.find(wire => wire.boardPinId === pin.id);
      return { pin, blocked, selected: selection?.type === 'pin' && selection.id === pin.id,
        connected: project.assembly.connections.some(wire => wire.boardPinId === pin.id),
        candidate: pending?.componentId && !connectionProblem(project, catalog, pending.componentId, pending.terminalId, pin.id),
        color: colors[connectedWire?.id] || (pin.kind === 'ground' ? GROUND_COLOR : pin.kind === 'power' ? '#fb7185' : pin.kind === 'control' ? '#e9b968' : blocked ? '#576179' : '#34d399') };
    });
    const nodes = [{
      id: 'board', type: 'physicalBoard', position: project.assembly.positions.board, width: board.width, height: board.height,
      style: { width: board.width, height: board.height }, measured: measurements.board || { width: board.width, height: board.height },
      selected: selection?.type === 'board' || selection?.type === 'pin', ariaLabel: 'Плата ' + board.name,
      data: { board, pins, onPin: pinClick, busy: busy || spaceHeld },
    }];
    for (const component of project.components) {
      const module = moduleFor(component, catalog), layout = terminalLayout(module, project.assembly.portSides?.[component.id]), { width, height } = layout;
      const selected = selection?.type === 'component' && selection.id === component.id;
      const terminals = layout.terminals.map(terminal => {
        const wire = project.assembly.connections.find(wire => wire.componentId === component.id && wire.terminalId === terminal.id);
        return { terminal, connected: Boolean(wire), pin: wire && board.pins.find(pin => pin.id === wire.boardPinId),
          active: pending?.componentId === component.id && pending.terminalId === terminal.id,
          color: colors[wire?.id] || (terminal.kind === 'ground' ? GROUND_COLOR : module.color) };
      });
      nodes.push({
        id: component.id, type: 'physicalHardware', position: project.assembly.positions[component.id], width, height,
        style: { width, height }, measured: measurements[component.id] || { width, height }, selected,
        ariaLabel: 'Компонент ' + component.name,
        data: { component, module, layout, terminals, selected, onTerminal: terminalClick, onSelect: selectNode, busy: busy || spaceHeld },
      });
    }
    return nodes;
  }, [project, board, catalog, colors, selection, pending, measurements, pinClick, terminalClick, selectNode, busy, spaceHeld]);
  const nodes = useMemo(() => modelNodes.map(node => positions[node.id] ? { ...node, ...positions[node.id] } : node), [modelNodes, positions]);
  const edges = useMemo(() => allocateWireLanes(physicalEdges(project).map(edge => {
    const wire = project.assembly.connections.find(wire => wire.id === edge.id);
    const component = project.components.find(component => component.id === wire.componentId), module = component && moduleFor(component, catalog);
    const terminal = module?.terminals.find(terminal => terminal.id === wire.terminalId), targetLayout = terminalLayout(module, project.assembly.portSides?.[wire.componentId]), targetTerminal = targetLayout.terminals.find(item => item.id === wire.terminalId), pin = board.pins.find(pin => pin.id === wire.boardPinId);
    const diagnostic = connectionProblem(project, catalog, wire.componentId, wire.terminalId, wire.boardPinId);
    const selected = selection?.type === 'wire' && selection.id === wire.id;
    const label = 'Соединение ' + (component?.name || wire.componentId) + ': ' + (terminal?.label || wire.terminalId) + ' → ' + (pin?.label || wire.boardPinId);
    return { ...edge, selected, ariaLabel: label, data: { label, diagnostic, selected, sourcePin: pin, targetTerminal, targetWidth: targetLayout.width, targetHeight: targetLayout.height, boardWidth: board.width, boardHeight: board.height, ground: terminal?.kind === 'ground',
      color: diagnostic ? '#fb7185' : colors[wire.id],
      highlighted: selected || (selection?.type === 'component' && selection.id === wire.componentId), onSelect: selectWire } };
  })), [project, board, catalog, colors, selection, selectWire]);

  const commitPositions = useCallback(updates => {
    const moved = Object.fromEntries(Object.entries(updates).map(([id, change]) => [id, change.position]));
    if (!Object.keys(moved).length) return;
    onTransform({ positions: moved, viewport: viewportData(instance?.getViewport() || project.assembly.viewport) });
  }, [instance, project.assembly.viewport, onTransform]);
  const beginDrag = useCallback(() => {
    autoFit.current = false; dragging.current = true; interaction('drag', true);
  }, [interaction]);
  const finishDrag = useCallback(() => {
    if (!dragging.current) return;
    commitPositions(draftPositions.current);
    draftPositions.current = {}; dragging.current = false; setPositions({});
    interaction('drag', false);
  }, [commitPositions, interaction]);
  const changeNodes = useCallback(changes => {
    const dimensions = changes.filter(change => change.type === 'dimensions' && change.dimensions);
    if (dimensions.length) setMeasurements(previous => {
      const next = { ...previous, ...Object.fromEntries(dimensions.map(change => [change.id, change.dimensions])) };
      return same(previous, next) ? previous : next;
    });
    for (const change of changes) if (change.type === 'select' && change.selected) selectNode(change.id);
    const moves = changes.filter(change => change.type === 'position' && change.position);
    if (!busy && moves.length) {
      const updates = Object.fromEntries(moves.map(change => [change.id, { position: { x: clamp(change.position.x, -5000, 5000), y: clamp(change.position.y, -5000, 5000) }, dragging: Boolean(change.dragging) }]));
      if (dragging.current) { draftPositions.current = { ...draftPositions.current, ...updates }; setPositions(draftPositions.current); }
      else { autoFit.current = false; commitPositions(updates); }
    }
  }, [busy, selectNode, commitPositions]);
  const moveStart = useCallback(event => {
    if (!event || initial.current || silentFits.current) return;
    autoFit.current = false;
    interaction('viewport', true);
  }, [interaction]);
  const moveEnd = useCallback((event, viewport) => {
    const next = viewportData(viewport);
    setZoom(next.zoom);
    if (event && !initial.current && !silentFits.current && !dragging.current && !busy && !same(next, project.assembly.viewport)) onTransform({ viewport: next });
    interaction('viewport', false);
  }, [busy, project.assembly.viewport, onTransform, interaction]);
  function cameraAction(action) {
    interaction('viewport', true);
    return Promise.resolve(action()).then(() => {
      const next = viewportData(instance.getViewport());
      setZoom(next.zoom);
      if (!same(next, project.assembly.viewport)) onTransform({ viewport: next });
    }).finally(() => interaction('viewport', false));
  }
  const zoomBy = factor => {
    if (!instance || dragging.current) return;
    autoFit.current = false;
    return cameraAction(() => factor > 1 ? instance.zoomIn({ duration: 0 }) : instance.zoomOut({ duration: 0 }));
  };

  return <div className={['assembly-canvas', busy ? 'canvas-busy' : '', spaceHeld ? 'canvas-space-pan' : ''].join(' ')}>
    <div className="canvas-top"><span className="badge purple"><MousePointer2 size={12} />МОНТАЖ / {project.components.length} компонентов</span><span className="canvas-scale">{Math.round(zoom * 100)}%</span></div>
    {pending && <div className="connection-prompt"><span className="dot green-dot" />{pending.componentId ? 'Выберите контакт платы для соединения' : 'Выберите контакт компонента'}<button aria-label="Отменить соединение" className="icon-button" onClick={() => setPending(null)}><Unplug size={15} /></button></div>}
    <div ref={root} className="assembly-flow-region" data-ready={ready} aria-label="Холст монтажа">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultViewport={project.assembly.viewport}
        onInit={setInstance} onNodesChange={changeNodes} onNodeClick={(_event, node) => selectNode(node.id)}
        onNodeDragStart={beginDrag} onNodeDragStop={finishDrag}
        onMoveStart={moveStart} onMoveEnd={moveEnd} onConnect={connect} onConnectStart={connectStart} onConnectEnd={connectEnd}
        isValidConnection={connection => !problemFor(connection)} connectionMode={ConnectionMode.Loose} connectOnClick={false}
        onPaneClick={() => { setSelection({ type: 'board', id: 'board' }); setPending(null); }}
        nodesDraggable={ready && !busy && !spaceHeld} nodesConnectable={ready && !busy && !spaceHeld} panOnDrag={ready} zoomOnScroll={ready} zoomOnPinch={ready} edgesReconnectable={false}
        selectionKeyCode={null} multiSelectionKeyCode={null} deleteKeyCode={null} minZoom={0.2} maxZoom={3} colorMode="dark"
        ariaLabelConfig={{ 'node.a11yDescription.default': 'Плата или компонент. Стрелки перемещают. Пробел и перетаскивание перемещают камеру.', 'edge.a11yDescription.default': 'Физическое соединение. Enter выбирает провод.' }}
        onError={(_code, message) => onError(message)}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={0.8} color="#3b465d" />
      </ReactFlow>
    </div>
    <div className="canvas-toolbar"><span className="canvas-navigation-hint"><Move size={13} />Пробел + перетаскивание · панорама</span><CanvasControls subject="монтаж" zoom={zoom} busy={busy || !ready} onZoomOut={() => zoomBy(1 / 1.2)} onZoomIn={() => zoomBy(1.2)} onFit={fitView} /></div>
  </div>;
}
