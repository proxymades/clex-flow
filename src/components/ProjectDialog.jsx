import { useState } from 'react';
import { ArrowRight, Cpu, FolderPlus } from 'lucide-react';
import Modal from './Modal.jsx';
import { validateName } from '../projects/model.js';
import { boards, getBoard } from '../catalog/index.js';

export default function ProjectDialog({ project, onSubmit, onClose, busy }) {
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState('');
  const [boardId, setBoardId] = useState('waveshare-esp32-s3-eth');
  const [error, setError] = useState('');
  const rename = Boolean(project);
  async function submit(event) {
    event.preventDefault();
    try { validateName(name); } catch (e) { setError(e.message); return; }
    if (await onSubmit(name, description, boardId)) onClose();
  }
  return <Modal title={rename ? 'Переименовать проект' : 'Новый эксперимент'} onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      {!rename && <p className="modal-intro">Каждая идея начинается с проекта. Дайте ему имя и выберите направление.</p>}
      <label className="field">Название проекта<input disabled={busy} autoFocus value={name} onChange={e => { setName(e.target.value); setError(''); }} maxLength={80} placeholder="Например, Blink Test" required /></label>
      {!rename && <>
        <label className="field">Описание <span className="muted">необязательно</span><textarea disabled={busy} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} rows={3} placeholder="Что вы хотите попробовать?" /></label>
        <label className="field">Плата<select disabled={busy} value={boardId} onChange={e => setBoardId(e.target.value)}>{boards.map(board => <option key={board.id} value={board.id}>{board.name}{board.revision ? ` / ${board.revision}` : ''}</option>)}</select></label>
        <div className="target-choice"><Cpu size={26} /><div><strong>{getBoard(boardId)?.name}</strong><small>{getBoard(boardId)?.manufacturer}</small></div><span className="badge green">ESP-IDF {getBoard(boardId)?.espIdfVersion}</span></div>
        <p className="fine-print">{getBoard(boardId)?.verificationNote} Файл проекта сохраняется локально.</p>
      </>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy || !name.trim()}>{rename ? 'Сохранить название' : <><FolderPlus size={17} />Создать проект<ArrowRight size={17} /></>}</button></footer>
    </form>
  </Modal>;
}
