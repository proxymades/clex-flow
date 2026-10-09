import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { Activity, ArrowLeft, Check, ChevronRight, Cpu, FlaskConical, FolderOpen, Hammer, Layers, Monitor, Plus, Radio, Save, Settings2, TriangleAlert, X, Zap, FileCode2, RefreshCw, Square } from 'lucide-react';
import { desktop } from './projects/storage.js';
import { useProjects } from './projects/useProjects.js';
import Home from './screens/Home.jsx';
import Workspace from './screens/Workspace.jsx';
import Settings from './screens/Settings.jsx';
import Modal from './components/Modal.jsx';
import { getBoard } from './catalog/index.js';
import ProjectDialog from './components/ProjectDialog.jsx';
import useIdf from './idf/useIdf.js';
import FirmwareDialog from './idf/FirmwareDialog.jsx';

export default function App() {
  const api = useProjects();
  const idf = useIdf(api.active);
  const locked = api.busy || idf.busy;
  const [confirmed, setConfirmed] = useState(false);
  const { active, busy, dirty, save, setError, isWriting, pauseAutosave, resumeAutosave } = api;
  const [screen, setScreen] = useState('home');
  const [modal, setModal] = useState(null);
  const pending = useRef(null), allowClose = useRef(false);
  const closeModal = useCallback(() => { setModal(null); resumeAutosave(); }, [resumeAutosave]);
  const navigate = useCallback(action => {
    if (isWriting() || idf.busy) return;
    if (api.dirty) { pauseAutosave(); pending.current = action; setModal({ type: 'unsaved' }); }
    else action();
  }, [api.dirty, isWriting, pauseAutosave, idf.busy]);
  const home = () => navigate(() => { api.setActive(null); setScreen('home'); });
  const create = () => navigate(() => setModal({ type: 'create' }));
  const importFile = () => navigate(async () => { if (await api.openFile()) setScreen('workspace'); });

  useEffect(() => {
    const handle = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (active && !busy && !modal) save(); }
    };
    window.addEventListener('keydown', handle);
    const beforeUnload = event => { if (dirty || isWriting()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', handle); window.removeEventListener('beforeunload', beforeUnload); };
  }, [active, busy, dirty, save, modal, isWriting]);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false, unlisten, stopQuit;
    listen('studio-quit-requested', () => {
      getCurrentWindow().close().catch(e => setError(String(e)));
    }).then(stop => { if (disposed) stop(); else stopQuit = stop; });
    getCurrentWindow().onCloseRequested(event => {
      if (allowClose.current) return;
      if (idf.busy) { event.preventDefault(); setError('Завершите или остановите операцию ESP-IDF перед закрытием.'); return; }
      if (isWriting()) { event.preventDefault(); setError('Дождитесь завершения сохранения перед закрытием.'); return; }
      if (dirty) {
        pauseAutosave(); event.preventDefault();
        pending.current = async () => { allowClose.current = true; try { await getCurrentWindow().destroy(); } catch (e) { allowClose.current = false; setError(String(e)); } };
        setModal({ type: 'unsaved' });
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); stopQuit?.(); };
  }, [dirty, setError, isWriting, pauseAutosave, idf.busy]);

  async function continueNavigation(save) {
    if (save && !await api.save()) return;
    if (!save && api.active) api.setActive(api.projects.find(project => project.id === api.active.id) || null);
    const action = pending.current;
    pending.current = null; closeModal(); action?.();
  }

  return <div className="app-shell">
    <aside className="app-sidebar"><button className="brand" onClick={home} disabled={locked || api.autoSaving} aria-label="Главный экран CLEX Flow"><span className="brand-mark"><Zap size={23} fill="currentColor" /></span><span>CLEX <b>Flow</b><small>MICROCONTROLLER STUDIO</small></span></button><div className="sidebar-section-label">РАБОЧЕЕ ПРОСТРАНСТВО</div><nav><button className={`nav-item ${screen === 'home' ? 'selected' : ''}`} onClick={home} disabled={locked || api.autoSaving}><FolderOpen size={19} />Мои проекты<span>{api.projects.length}</span></button><button className={`nav-item ${screen === 'workspace' ? 'selected' : ''}`} disabled={!api.active || locked} onClick={() => setScreen('workspace')}><FlaskConical size={19} />Эксперимент</button><button className="nav-item" onClick={() => setModal({ type: 'library' })}><Layers size={19} />Библиотека<span className="nav-soon">7</span></button></nav><div className="sidebar-guide"><span className="guide-icon"><CircuitIcon /></span><strong>Маленькие эксперименты.<br />Большие возможности.</strong><p>Визуальная лаборатория<br />для ваших устройств.</p><span className="badge">ESP32-S3</span></div><div className="sidebar-bottom"><button className={`nav-item ${screen === 'settings' ? 'selected' : ''}`} onClick={() => navigate(() => setScreen('settings'))} disabled={locked || api.autoSaving}><Settings2 size={19} />Настройки</button><div className="sidebar-version"><span className="dot green-dot" />CLEX Flow<span>v0.1.0</span></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>CLEX Flow</span><ChevronRight size={15} /><strong>{screen === 'workspace' ? api.active?.name : screen === 'settings' ? 'Настройки' : 'Мои проекты'}</strong>{api.dirty && <span className="dirty-dot" title="Есть несохранённые изменения" />}</div><div className="topbar-actions">{screen === 'workspace' ? <><span className="toolbar-board"><Cpu size={14} />{getBoard(api.active?.boardId)?.name || 'Плата не установлена'}</span><button className="icon-button" aria-label="Вернуться к проектам" onClick={home} disabled={locked || api.autoSaving}><ArrowLeft size={18} /></button><button className="button compact secondary" onClick={api.save} disabled={api.busy || !api.dirty}><Save size={16} />Сохранить</button><div className="toolbar-divider" /><button className="icon-button" aria-label="Посмотреть исходники прошивки" disabled={!idf.preview} title={idf.generationError || 'Исходники прошивки'} onClick={() => setModal({type:'firmware'})}><FileCode2 size={18}/></button><button className="button compact secondary" disabled={locked || !idf.desktop || !idf.compatible || !idf.fingerprint || !idf.ready} title={idf.generationError || (!idf.desktop ? 'Сборка доступна в десктопном приложении' : !idf.compatible ? 'Откройте инструменты разработки и выберите совместимый ESP-IDF' : 'Собрать прошивку ESP-IDF')} onClick={idf.startBuild}><Hammer size={16}/>Собрать</button><button className="button compact primary" disabled={locked || !idf.fresh || !idf.port} title={!idf.fresh ? 'Нужна успешная сборка текущей схемы' : !idf.port ? 'Подключите плату и выберите порт' : 'Прошить выбранную плату'} onClick={() => {setConfirmed(false);setModal({type:'flash'});}}><Zap size={16}/>Прошить</button><select className="port-select" aria-label="Порт платы" value={idf.port} disabled={idf.busy || !idf.environment} onChange={e=>idf.setPort(e.target.value)}><option value="">{idf.ports.length ? 'Выберите порт' : 'Нет подключённого порта'}</option>{idf.ports.map(port=><option key={port.path} value={port.path}>{port.path.split('/').at(-1)}</option>)}</select><button className="icon-button" aria-label="Обновить порты" disabled={idf.busy || !idf.environment} onClick={idf.refreshPorts}><RefreshCw size={15}/></button><button className="icon-button" disabled={!idf.monitoring && (locked || !idf.port || !idf.ready)} aria-label={idf.monitoring?'Остановить монитор':'Открыть монитор'} title="Serial · 115200 бод" onClick={idf.monitoring?idf.cancel:idf.startMonitor}>{idf.monitoring?<Square size={17}/>:<Monitor size={18}/>}</button></> : <><span className="topbar-local"><span className="dot green-dot" />Локальная студия</span><button className="button compact secondary" onClick={create} disabled={locked || api.loading}><Plus size={16} />Новый проект</button></>}</div></header>
      <div className="content-region">{(api.error || idf.error) && <div className="alert error" role="alert"><TriangleAlert size={18} /><span>{api.error || idf.error}</span><button className="icon-button" aria-label="Скрыть ошибку" onClick={() => {api.setError('');idf.setError('');}}><X size={16} /></button></div>}{api.damaged.length > 0 && <details className="alert damaged"><summary>Не удалось открыть файлов: {api.damaged.length}. Исходные данные сохранены.</summary>{api.damaged.map(message => <p key={message}>{message}</p>)}</details>}
        {screen === 'home' && <Home projects={api.projects} busy={locked} loading={api.loading} onCreate={create} onImport={importFile} onOpen={project => { api.setActive(project); setScreen('workspace'); }} onRename={project => setModal({ type: 'rename', project })} onDelete={project => setModal({ type: 'delete', project })} />}
        {screen === 'workspace' && api.active && desktop && !idf.checking && !idf.compatible && <div className="toolchain-needed"><Cpu size={17}/><span>Для {getBoard(api.active.boardId)?.name || 'платы'} нужны {idf.requirement?.name} {idf.requirement?.version} и компилятор {idf.requirement?.compiler}.</span><button className="text-button" disabled={locked} onClick={()=>navigate(()=>setScreen('settings'))}>Настроить инструменты</button></div>}
        {screen === 'workspace' && api.active && <Workspace key={api.active.id} project={api.active} setProject={api.setActive} dirty={api.dirty} busy={locked} idf={idf} onPreview={() => setModal({type:'firmware'})} onSave={api.save} onExport={api.exportFile} onLogicChange={api.updateLogic} autoState={api.autoState} />}
        {screen === 'settings' && <Settings path={api.path} idf={idf} />}
      </div><footer className="statusbar"><span><Activity size={13} />{idf.busy ? (idf.job ? 'Операция ESP-IDF · ' + idf.job.operation : 'Проверяем ESP-IDF…') : api.busy ? 'Выполняем операцию…' : (api.autoSaving ? 'Автосохранение графа…' : api.notice) || 'Готов к экспериментам'}</span><span>{!desktop && <b>Веб-предпросмотр · </b>}Локальная прошивка<span className="status-separator">|</span><Cpu size={13} />ESP32-S3<span className="status-separator">|</span><Radio size={13} />{idf.checking ? 'Проверяем ESP-IDF…' : idf.environment ? `ESP-IDF ${idf.environment.sdkVersion} · ${idf.compatible ? 'готова' : 'несовместима с генератором'}` : 'ESP-IDF не проверена'}</span></footer>
    </div>
    {idf.busy && idf.job && screen !== 'workspace' && <button className="global-stop button secondary" onClick={idf.cancel} disabled={idf.job.operation==='sdk_remove'}><Square size={14}/>Остановить ESP-IDF</button>}
    {modal?.type === 'firmware' && idf.preview && <FirmwareDialog bundle={idf.preview} build={idf.fresh?idf.build:null} onClose={closeModal}/>}
    {modal?.type === 'flash' && <Modal title="Прошить выбранную плату?" onClose={closeModal}><p className="modal-intro">Прошивка заменит существующую программу на плате. Проверьте модель, соединения и выбранный порт.</p><div className="flash-summary"><strong>{getBoard(api.active?.boardId)?.name}</strong><code>{idf.port}</code><small>{idf.build?.binary}</small></div><label className="flash-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Плата и монтаж проверены, разрешаю запись прошивки.</label><footer><button className="button secondary" onClick={closeModal}>Отмена</button><button className="button primary" disabled={!confirmed || locked || !idf.fresh || !idf.port} onClick={async()=>{closeModal();await idf.startFlash();}}><Zap size={16}/>Записать прошивку</button></footer></Modal>}
    {modal?.type === 'create'  && <ProjectDialog onClose={closeModal} busy={api.busy} onSubmit={async (name, description, boardId) => { const success = await api.create(name, description, boardId); if (success) setScreen('workspace'); return success; }} />}
    {modal?.type === 'rename' && <ProjectDialog project={modal.project} onClose={closeModal} busy={api.busy} onSubmit={name => api.rename(modal.project, name)} />}
    {modal?.type === 'delete' && <Modal title="Удалить проект?" onClose={closeModal} busy={api.busy}><p className="modal-intro">«{modal.project.name}» будет удалён из локального хранилища. Экспортированные копии останутся. Отменить удаление нельзя.</p><footer><button className="button secondary" onClick={closeModal} disabled={locked || api.autoSaving}>Оставить проект</button><button className="button danger" disabled={locked || api.autoSaving} onClick={async () => { if (await api.remove(modal.project)) closeModal(); }}>Удалить проект</button></footer></Modal>}
    {modal?.type === 'unsaved' && <Modal title="Сохранить изменения?" onClose={closeModal} busy={api.busy}><p className="modal-intro">В проекте есть несохранённые изменения. Сохраните их перед выходом или продолжите без сохранения.</p><footer><button className="text-button" disabled={locked || api.autoSaving} onClick={() => continueNavigation(false)}>Не сохранять</button><button className="button secondary" disabled={locked || api.autoSaving} onClick={closeModal}>Отмена</button><button className="button primary" disabled={locked || api.autoSaving} onClick={() => continueNavigation(true)}><Save size={16} />Сохранить</button></footer></Modal>}
    {modal?.type === 'library' && <Modal title="Библиотека компонентов" onClose={closeModal}><div className="modal-feature-icon"><Layers size={35} /></div><p className="modal-intro">Доступны внешний светодиод с резистором и кнопка. Добавляйте их из библиотеки во вкладке «Монтаж». Во вкладке «Логика» доступны таймер, чтение GPIO, установка GPIO, переключение GPIO и сообщение в Serial.</p><p className="fine-print">Модули хранятся отдельно от проектов и имеют точные версии. Эти модули имеют фиксированные реализации для генерации прошивки ESP-IDF.</p><footer><button className="button primary" onClick={closeModal}><Check size={17} />Понятно</button></footer></Modal>}
  </div>;
}

function CircuitIcon() { return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="7" y="7" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2v5m8-5v5M10 21v5m8-5v5M2 10h5m-5 8h5m14-8h5m-5 8h5" stroke="currentColor" strokeWidth="1.4" /><rect x="11" y="11" width="6" height="6" rx="1" fill="currentColor" /></svg>; }
