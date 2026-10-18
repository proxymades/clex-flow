import {componentContact} from '../assembly/endpoints.js';
import { formatCount, pluralForm } from '../utils/plural.js';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { CircuitBoard, Layers, Settings2, Terminal, Download, TriangleAlert, CheckCircle2, Cpu, Info } from 'lucide-react';
import ResizeHandle from '../components/ResizeHandle.jsx';
import Modal from '../components/Modal.jsx';
import HardwareLibrary from '../assembly/HardwareLibrary.jsx';
const AssemblyCanvas = lazy(() => import('../assembly/AssemblyCanvas.jsx'));
import AssemblyInspector from '../assembly/AssemblyInspector.jsx';
import LogicLibrary from '../logic/LogicLibrary.jsx';
const LogicCanvas = lazy(() => import('../logic/LogicCanvas.jsx'));
import LogicInspector from '../logic/LogicInspector.jsx';
import {friendlyConnectionProblem,friendlyIssue} from '../logic/presentation.js';
import {connectDisplayData} from '../logic/displayBindings.js';
const DisplayBindingDialog=lazy(()=>import('../logic/DisplayBindingDialog.jsx'));
import ProcessPanel from '../idf/ProcessPanel.jsx';
import useLogicHistory from '../logic/useLogicHistory.js';
const ScreenEditor = lazy(() => import('../displays/ScreenEditor.jsx'));
import { saveScreen, displayDescription } from '../displays/model.js';
import { AUTOSAVE_STATUS } from '../projects/autosave.js';
import { logicAdditionProblem, addNode, updateNode, withLogic, removeElements, selectionSnapshot, pasteNodes, validateGraph } from '../logic/model.js';
import { catalog, boards, hardwareModules, logicModules, getBoard } from '../catalog/index.js';
import { addHardware, connectTerminal, disconnectTerminal, removeWire, removeHardware, selectBoard, validateAssembly, transformAssembly } from '../assembly/model.js';

export default function Workspace({ project, setProject, dirty, busy, onExport, onLogicChange, onInteraction, autoSaveEnabled, autoState, idf, onPreview }) {
  const [tab, setTab] = useState('overview');
  const [editingScreen, setEditingScreen] = useState(null);
  const [bindingNodeId,setBindingNodeId]=useState(null);
  const openBinding=useCallback(node=>{if(!busy){setEditingScreen(null);setBindingNodeId(node.id);}},[busy]);
  const closeScreen = useCallback(() => setEditingScreen(null), []);
  const [left, setLeft] = useState(220), [right, setRight] = useState(280), [bottom, setBottom] = useState(155);
  const [selection, setSelection] = useState({ type: 'board', id: 'board' });
  const [assemblyFocus, setAssemblyFocus] = useState(null);
  const clearAssemblyFocus = useCallback(id => setAssemblyFocus(current => current === id ? null : current), []);
  const [pending, setPending] = useState(null), [error, setError] = useState(''), [newBoard, setNewBoard] = useState(null);
  const publishLogic=useCallback((logic,screens)=>{if(screens===undefined)onLogicChange(logic);else setProject(current=>({...withLogic(current,logic),screens}));},[onLogicChange,setProject]);
  const history = useLogicHistory(project.logic, publishLogic, project.screens);
  const [logicSelection, setLogicSelection] = useState({ nodes: [], edges: [] });
  const [logicPending, setLogicPending] = useState(null), [logicError, setLogicError] = useState(''), [clipboard, setClipboard] = useState(null);
  const board = getBoard(project.boardId);
  const graphIssues = validateGraph(project, catalog).map(issue=>friendlyIssue(issue,project,catalog));
  const assemblyIssues = validateAssembly(project, catalog);
  const assemblyErrors = assemblyIssues.filter(issue => issue.severity === 'error'), assemblyWarnings = assemblyIssues.filter(issue => issue.severity === 'warning');
  const issues = [...assemblyIssues, ...graphIssues];
  function undoLogic() { history.undo(); setLogicPending(null); setLogicSelection({ nodes: [], edges: [] }); setLogicError(''); }
  function redoLogic() { history.redo(); setLogicPending(null); setLogicSelection({ nodes: [], edges: [] }); setLogicError(''); }
  function openScreen(node) {
    const component = project.components.find(component => component.id === node.parameters.componentId);
    if (component && displayDescription(component, catalog)) {setBindingNodeId(null);setEditingScreen(component.id);}
    else { setLogicSelection({ nodes: [node.id], edges: [] }); setLogicError('Сначала выберите дисплей монтажа в свойствах блока.'); }
  }
  function addLogic(module) {
    try {
      const problem = logicAdditionProblem(module, project, catalog);
      if (problem) throw new Error(problem);
      const next = addNode(project.logic, module, project.components, project, catalog); if (module.editor === 'screen') next.nodes.at(-1).parameters.componentId = project.components.find(component => displayDescription(component, catalog))?.id || '';
      history.change(next);
      setLogicSelection({ nodes: [next.nodes.at(-1).id], edges: [] }); setLogicPending(null); setLogicError(''); setTab('logic');
    } catch (error) { setLogicError(error.message); }
  }
  function connectLogic(connection) {
    if (busy) return;
    try { const problem=friendlyConnectionProblem(project,catalog,connection);if(problem)throw new Error(problem); const next = connectDisplayData(project, catalog, connection); history.change(next); const data=next.edges.find(edge=>edge.source===connection.source&&edge.sourceHandle===connection.sourceHandle&&edge.target===connection.target&&edge.targetHandle===connection.targetHandle); setLogicSelection({ nodes: [], edges: [data.id] }); setLogicPending(null); setLogicError(''); }
    catch (error) { setLogicError(error.message); }
  }
  function logicPort(port) {
    if (!port) { setLogicPending(null); return; }
    if (busy) return;
    if (logicPending && logicPending.direction !== port.direction) {
      const output = port.direction === 'output' ? port : logicPending, input = port.direction === 'input' ? port : logicPending;
      connectLogic({ source: output.nodeId, sourceHandle: output.portId, target: input.nodeId, targetHandle: input.portId });
    } else { setLogicPending(port); setLogicError(''); }
  }
  const copyLogic = useCallback(() => setClipboard(selectionSnapshot(project.logic, logicSelection.nodes)), [project.logic, logicSelection.nodes]);
  const pasteLogic = useCallback(snapshot => {
    try { const next = pasteNodes(project.logic, snapshot); if (!next.ids.length) return; history.change(next.graph); setLogicSelection({ nodes: next.ids, edges: [] }); setLogicError(''); }
    catch (error) { setLogicError(error.message); }
  }, [project.logic, history]);
  const duplicateLogic = () => pasteLogic(selectionSnapshot(project.logic, logicSelection.nodes));
  const changeLogicNode=(id,patch,group)=>{
    let removed=0;
    history.change(graph=>{const next=updateNode(graph,id,patch,catalog,project);removed=graph.edges.length-next.edges.length;return next;},{group});
    if(patch.parameters){setLogicPending(null);setLogicError(removed?`При смене действия удалено несовместимых соединений: ${removed}. Остальные соединения сохранены.`:'');}
  };
  const removeLogic = () => { history.change(graph => removeElements(graph, logicSelection.nodes, logicSelection.edges)); setLogicSelection({ nodes: [], edges: [] }); setLogicPending(null); setLogicError(''); };
  const removeAssemblyWire = id => { setProject(current => removeWire(current, catalog, id)); setSelection({ type: 'board', id: 'board' }); setPending(null); setError(''); };
  const removeAssemblyComponent = id => { setProject(current => removeHardware(current, catalog, id)); setSelection({ type: 'board', id: 'board' }); setPending(null); setError(''); };
  useEffect(() => {
    if (tab !== 'logic' && tab !== 'assembly') return;
    const keyboard = event => {
      if (busy || document.querySelector('[role="dialog"]') || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const command = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
      if (tab === 'assembly') {
        if (event.defaultPrevented || event.repeat || command || event.altKey) return;
        if (key === 'delete' || key === 'backspace') {
          if (selection.type === 'component') { event.preventDefault(); removeAssemblyComponent(selection.id); }
          else if (selection.type === 'wire') { event.preventDefault(); removeAssemblyWire(selection.id); }
        }
        return;
      }
      if (command && key === 'z') { event.preventDefault(); event.shiftKey ? redoLogic() : undoLogic(); }
      else if (command && key === 'y') { event.preventDefault(); redoLogic(); }
      else if (command && key === 'c' && logicSelection.nodes.length) { event.preventDefault(); copyLogic(); }
      else if (command && key === 'v' && clipboard) { event.preventDefault(); pasteLogic(clipboard); }
      else if (command && key === 'd' && logicSelection.nodes.length) { event.preventDefault(); duplicateLogic(); }
      else if ((key === 'delete' || key === 'backspace') && (logicSelection.nodes.length || logicSelection.edges.length)) { event.preventDefault(); removeLogic(); }
      else if (key === 'escape') setLogicPending(null);
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  });
  const errors = issues.filter(issue => issue.severity === 'error');
  const change = (key, value) => setProject(current => ({ ...current, [key]: value }));
  const updateAssemblyTransform = transform => setProject(current => transformAssembly(current, catalog, transform));
  function switchBoard(value) {
    if (value.id === project.boardId) return;
    if (project.assembly.connections.length) setNewBoard(value);
    else applyBoard(value);
  }
  function applyBoard(value) {
    setProject(current => selectBoard(current, value)); setSelection({ type: 'board', id: 'board' }); setPending(null); setError(''); setNewBoard(null);
  }
  function add(module) {
    try { const next = addHardware(project, module, catalog); setProject(next); setSelection({ type: 'component', id: next.components.at(-1).id }); setAssemblyFocus(next.components.at(-1).id); setPending(null); setTab('assembly'); setError(''); }
    catch (e) { setError(e.message); }
  }
  function connect(componentId, terminalId, pinId) {
    try { setProject(connectTerminal(project, catalog, componentId, terminalId, pinId)); setPending(null); setError(''); return true; }
    catch (e) { setError(e.message); return false; }
  }
  function pinClick(pin) {
    if (pending?.componentId) { if (connect(pending.componentId, pending.terminalId, pin.id)) setSelection({ type: 'component', id: pending.componentId }); }
    else { setSelection({ type: 'pin', id: pin.id }); setPending({ boardPinId: pin.id }); setError(''); }
  }
  function terminalClick(component, terminal) {
    setSelection({ type: 'component', id: component.id });
    if (pending?.boardPinId) connect(component.id, terminal.id, pending.boardPinId);
    else if(pending?.componentId&&pending.componentId!==component.id)connect(component.id,terminal.id,componentContact(pending.componentId,pending.terminalId));
    else { setPending({ componentId: component.id, terminalId: terminal.id }); setError(''); }
  }
  const inspectIssue = issue => { if (issue.nodeId || issue.edgeId || issue.code.startsWith('logic-') || issue.code.startsWith('timer-')) { setTab('logic'); setLogicSelection({ nodes: issue.nodeId ? [issue.nodeId] : [], edges: issue.edgeId ? [issue.edgeId] : [] }); return; } setTab('assembly'); setPending(null); if (issue.componentId) setSelection({ type: 'component', id: issue.componentId }); else setSelection({ type: 'board', id: 'board' }); };

  return <div className="workspace">
    <div className="workspace-tabs"><button className={`workspace-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => { setTab('overview'); setPending(null); }}><Settings2 size={16} />Обзор проекта</button><button className={`workspace-tab ${tab === 'assembly' ? 'active' : ''}`} onClick={() => setTab('assembly')}><CircuitBoard size={16} />Монтаж</button><button className={`workspace-tab ${tab === 'logic' ? 'active' : ''}`} onClick={() => { setTab('logic'); setPending(null); }}><Layers size={16} />Логика</button><span className={`workspace-stage ${autoState === 'error' ? 'save-error' : ''}`} title={autoSaveEnabled ? 'Весь проект сохраняется через 10 секунд без правок' : 'Автосохранение выключено: кнопка «Сохранить» или ⌘/Ctrl + S'}>{AUTOSAVE_STATUS[autoState]}</span></div>
    <div className="workspace-body" style={{ gridTemplateColumns: tab === 'overview' ? `minmax(250px, 1fr) 5px ${right}px` : `${left}px 5px minmax(250px, 1fr) 5px ${right}px`, gridTemplateRows: `minmax(280px, 1fr) 5px ${bottom}px` }}>
      {tab !== 'overview' && <aside className="workspace-library">{tab === 'logic' ? <LogicLibrary project={project} catalog={catalog} modules={logicModules} busy={busy} onAdd={addLogic} /> : <HardwareLibrary boards={boards} modules={hardwareModules} board={board} busy={busy} onBoard={switchBoard} onAdd={add} />}</aside>}
      {tab !== 'overview' && <ResizeHandle label="Ширина библиотеки" onResize={delta => setLeft(v => Math.max(180, Math.min(300, v + delta)))} />}
      {tab === 'logic' ? <Suspense fallback={<main className="logic-loading"><Layers size={30} /><span>Открываем редактор логики…</span></main>}><LogicCanvas onBindData={openBinding} onOpenScreen={openScreen} project={project} onInteraction={onInteraction} catalog={catalog} history={{ ...history, undo: undoLogic, redo: redoLogic }} selection={logicSelection} setSelection={setLogicSelection} pending={logicPending} onPort={logicPort} onConnect={connectLogic} error={logicError} setError={setLogicError} busy={busy} clipboard={clipboard} onCopy={copyLogic} onPaste={() => pasteLogic(clipboard)} onDuplicate={duplicateLogic} onRemove={removeLogic} issues={graphIssues} /></Suspense> : tab === 'assembly' ? <main className="assembly-region">{board?.pins.length ? <Suspense fallback={<div className="logic-loading"><CircuitBoard size={30} /><span>Открываем монтаж…</span></div>}><AssemblyCanvas focusComponentId={assemblyFocus} onFocusDone={clearAssemblyFocus} onInteraction={onInteraction} key={project.boardId} project={project} board={board} catalog={catalog} selection={selection} setSelection={setSelection} pending={pending} setPending={setPending} onTerminal={terminalClick} onPin={pinClick} onConnect={connect} onError={setError} onTransform={updateAssemblyTransform} busy={busy} onRouteChange={(id,route)=>setProject(current=>({...current,assembly:{...current.assembly,connections:current.assembly.connections.map(wire=>{if(wire.id!==id)return wire;const copy={...wire};if(route?.length)copy.route=route;else delete copy.route;return copy;})}}))} /></Suspense> : <div className="assembly-choose-board"><Cpu size={44} /><h2>Выберите конкретную плату</h2><p>Выберите модель платы с описанными контактами в каталоге слева.</p></div>}{error && <div className="wiring-error" role="alert"><TriangleAlert size={15} /><span>{error}</span><button className="text-button" onClick={() => setError('')}>Закрыть</button></div>}<div className={`assembly-validation ${assemblyErrors.length ? 'has-errors' : ''}`}><span>{assemblyErrors.length ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}{assemblyErrors.length ? `Ошибок: ${assemblyErrors.length}` : 'Ошибок монтажа нет'}</span><span>Предупреждений: {assemblyWarnings.length}</span><span>{board?.pinoutVerified ? 'Профиль по документации' : 'Ревизия не подтверждена'}</span></div></main> : <main className="project-overview"><div className="overview-topline"><span className="badge purple">ОБЗОР ПРОЕКТА</span><span className={`save-indicator ${dirty ? 'unsaved' : ''}`}><span className="dot" />{dirty ? 'Есть изменения' : 'Сохранен'}</span></div><div className="overview-center"><h1>{project.name}</h1><p>{project.description || 'Плата, подключения, логика и интерфейсы вашего устройства.'}</p><div className="overview-stats"><div><strong>{project.components.length}</strong><span>{pluralForm(project.components.length, ['компонент', 'компонента', 'компонентов'])}</span></div><div><strong>{project.logic.nodes.length}</strong><span>{pluralForm(project.logic.nodes.length, ['блок логики', 'блока логики', 'блоков логики'])}</span></div><div><strong>{board?.name || 'Неизвестная плата'}</strong><span>выбранная плата</span></div></div><button className="next-stage open-assembly" onClick={() => setTab('assembly')}><div><strong>Открыть монтаж</strong><p>Плата, физические контакты, подключения и проверка GPIO.</p></div><CircuitBoard size={21} /></button><div className="button-row"><button className="text-button" onClick={onExport} disabled={busy}><Download size={17} />Экспорт JSON</button></div></div><div className="canvas-caption">Соберите схему, проверьте исходники и запустите сборку прошивки.</div></main>}
      <ResizeHandle label="Ширина свойств" onResize={delta => setRight(v => Math.max(240, Math.min(360, v - delta)))} />
      <aside className="workspace-properties">{tab === 'logic' ? <LogicInspector onBindData={openBinding} onOpenScreen={openScreen} project={project} catalog={catalog} selection={logicSelection} busy={busy} onChange={changeLogicNode} onRemove={removeLogic} onDuplicate={duplicateLogic} issues={graphIssues} /> : tab === 'overview' ? <><div className="panel-label">СВОЙСТВА ПРОЕКТА</div><label className="field">Название<input value={project.name} maxLength={80} onChange={e => change('name', e.target.value)} disabled={busy} /></label><label className="field">Описание<textarea rows={5} value={project.description} maxLength={4000} placeholder="Описание проекта" onChange={e => change('description', e.target.value)} disabled={busy} /></label><div className="property-divider" /><div className="property-pair"><span>Плата</span><strong>{board?.name || project.boardId}</strong></div><div className="property-pair"><span>Среда прошивки</span><code>{board?.platform==='arduino-avr'?'Arduino AVR '+board.coreVersion:'ESP-IDF '+board?.espIdfVersion}</code></div><p className="panel-note"><Info size={15} />{autoSaveEnabled ? 'Весь проект сохраняется через 10 секунд без правок. Можно сохранить сразу: «Сохранить» или ⌘/Ctrl + S.' : 'Автосохранение выключено. Сохраните проект кнопкой «Сохранить» или ⌘/Ctrl + S.'}</p></> : board ? <AssemblyInspector events={idf?.events} idf={idf} onResetRoute={id=>setProject(current=>({...current,assembly:{...current.assembly,connections:current.assembly.connections.map(wire=>{if(wire.id!==id)return wire;const copy={...wire};delete copy.route;return copy;})}}))} project={project} board={board} catalog={catalog} selection={selection} busy={busy} onConnect={connect} onDisconnect={(id, terminal) => { setProject(current => disconnectTerminal(current, catalog, id, terminal)); setPending(null); setError(''); }} onRemoveWire={removeAssemblyWire} onRemoveComponent={removeAssemblyComponent} onComponentChange={(id, patch) => setProject(current => ({ ...current, components: current.components.map(component => component.id === id ? { ...component, ...patch } : component) }))} onTerminalSide={(id, terminal, side) => setProject(current => ({ ...current, assembly: { ...current.assembly, portSides: { ...current.assembly.portSides, [id]: { ...current.assembly.portSides?.[id], [terminal]: side } } } }))} onBoardSetting={(key, value) => { change('boardSettings', { ...project.boardSettings, [key]: value }); setPending(null); }} /> : <p className="inspector-warning">Плата не установлена. Выберите доступную модель в каталоге.</p>}</aside>
      <div className="bottom-resize"><ResizeHandle axis="y" label="Высота журнала" onResize={delta => setBottom(v => Math.max(110, Math.min(280, v - delta)))} /></div>
      {idf?.job ? <ProcessPanel key={idf.job.id} idf={idf} onPreview={onPreview} issues={issues} onIssue={inspectIssue} /> : <section className="workspace-log"><header><Terminal size={15} /><strong>Проверка проекта</strong><span className={`badge ${errors.length ? 'red' : 'green'}`}>{errors.length ? formatCount(errors.length, ['ошибка', 'ошибки', 'ошибок']) : 'Ошибок проекта нет'}</span></header><div className="log-row"><span className={`log-level ${dirty ? 'warning' : 'success'}`}>{dirty ? 'Изменения' : 'Готово'}</span><span>{dirty ? (autoSaveEnabled ? 'Есть правки. Автосохранение через 10 секунд без изменений; «Сохранить» или ⌘/Ctrl + S сохраняет сразу.' : 'Правки еще не сохранены. Нажмите «Сохранить» или ⌘/Ctrl + S.') : 'Текущая версия проекта сохранена.'}</span></div>{issues.map((issue, index) => <button key={`${issue.code}-${index}`} className="validation-row" onClick={() => inspectIssue(issue)}><span className={`log-level ${issue.severity === 'error' ? 'error-level' : 'warning'}`}>{issue.severity === 'error' ? 'Ошибка' : 'Предупреждение'}</span><span>{issue.message}</span></button>)}{idf?.generationError && <div className="log-row"><span className="log-level warning">Сборка</span><span>{idf.generationError}</span></div>}{!errors.length && <div className="log-row"><span className="log-level success">Готово</span><span>Проверка монтажа и графа пройдена.</span></div>}</section>}
    </div>
    {bindingNodeId&&project.logic.nodes.some(node=>node.id===bindingNodeId)&&<Suspense fallback={null}><DisplayBindingDialog node={project.logic.nodes.find(node=>node.id===bindingNodeId)} project={project} catalog={catalog} busy={busy} onClose={()=>setBindingNodeId(null)} onApply={(graph,screens)=>{history.change(graph,screens?{screens}:{});setBindingNodeId(null);setLogicPending(null);setLogicSelection({nodes:[bindingNodeId],edges:[]});setLogicError('');}}/></Suspense>}
    {editingScreen && project.components.some(component => component.id === editingScreen) && <Suspense fallback={null}><ScreenEditor project={project} component={project.components.find(component => component.id === editingScreen)} catalog={catalog} busy={busy} onClose={closeScreen} onSave={(id, screen) => setProject(current => saveScreen(current, id, screen))} /></Suspense>}
    {newBoard && <Modal title="Сменить плату?" onClose={() => setNewBoard(null)} busy={busy}><p className="modal-intro">Соединения и назначения GPIO будут очищены: у новой платы другая распиновка. Компоненты и их параметры останутся в проекте.</p><footer><button className="button secondary" onClick={() => setNewBoard(null)}>Отмена</button><button className="button primary" onClick={() => applyBoard(newBoard)}>Сменить плату</button></footer></Modal>}
  </div>;
}
