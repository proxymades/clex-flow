import { useState } from 'react';
import { ArrowRight, FolderOpen, Plus, Pencil, Trash2, Search, CircuitBoard } from 'lucide-react';
import Blueprint from '../components/Blueprint.jsx';
import { getBoard } from '../catalog/index.js';

const date = value => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export default function Home({ projects, loading, busy, onCreate, onImport, onOpen, onRename, onDelete }) {
  const [query, setQuery] = useState('');
  const visible = projects.filter(p => p.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  return <div className="home-scroll">
    <div className="page-heading"><div><span className="eyebrow">ВАША ВИЗУАЛЬНАЯ ЛАБОРАТОРИЯ</span><h1>От идеи к устройству<span>.</span></h1><p>Проекты, подключения, логика и интерфейсы устройств.</p></div></div>
    <section className="hero">
      <div className="hero-content"><span className="badge purple"><span className="dot" />CLEX Flow / Visual Microcontroller Studio</span><h2>Создайте свой<br />следующий проект.</h2><p>Соберите аппаратную схему, настройте логику<br />и создайте интерфейс вашего устройства.</p><div className="button-row"><button className="button primary" onClick={onCreate} disabled={busy || loading}><Plus size={19} />Новый проект<ArrowRight size={17} /></button><button className="button secondary" onClick={onImport} disabled={busy || loading}><FolderOpen size={18} />Открыть JSON</button></div><div className="hero-note"><span className="dot green-dot" />Локальные проекты</div></div>
      <div className="hero-art"><Blueprint /></div>
    </section>
    <section className="projects-section"><div className="section-heading"><div><h2>Последние проекты <span className="count">{projects.length}</span></h2><p>Ваша работа всегда под рукой</p></div><label className="search"><Search size={17} /><input aria-label="Поиск проектов" placeholder="Найти проект…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
      {loading ? <div className="empty-state"><span className="loading-ring" /><p>Открываем библиотеку проектов…</p></div> : !visible.length ? <div className="empty-state"><div className="empty-icon"><FolderOpen size={27} /></div><h3>{query ? 'Проекты не найдены' : 'Здесь начнётся ваша коллекция'}</h3><p>{query ? 'Попробуйте другое название.' : 'Создайте первый проект или откройте сохранённый JSON.'}</p>{!query && <button className="text-button" onClick={onCreate} disabled={busy}>Создать первый проект<ArrowRight size={16} /></button>}</div> : <div className="project-grid">{visible.map(project => <article className="project-card" key={project.id}><button className="project-open" onClick={() => onOpen(project)} disabled={busy}><div className="project-card-top"><span className="project-icon"><CircuitBoard size={24} /></span><span className="badge">{getBoard(project.boardId)?.name || project.boardId}</span></div><h3>{project.name}</h3><p>{project.description || 'Проект устройства'}</p><div className="project-meta"><span className="dot green-dot" />Сохранён локально<ArrowRight size={17} /></div></button><footer><time dateTime={project.updatedAt}>{date(project.updatedAt)}</time><div><button className="icon-button" aria-label={`Переименовать ${project.name}`} title="Переименовать" onClick={() => onRename(project)} disabled={busy}><Pencil size={15} /></button><button className="icon-button danger-hover" aria-label={`Удалить ${project.name}`} title="Удалить" onClick={() => onDelete(project)} disabled={busy}><Trash2 size={15} /></button></div></footer></article>)}</div>}
    </section>

  </div>;
}
