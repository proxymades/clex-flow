import Panel from '../components/Panel.jsx';
import Page from '../components/Page.jsx';
import Details from '../components/Details.jsx';
import { Database, Save, FolderOpen } from 'lucide-react';
import ToolingSetup from '../idf/ToolingSetup.jsx';
import SdkManager from '../idf/SdkManager.jsx';
import { desktop } from '../projects/storage.js';

export default function Settings({ path, idf, autoSaveEnabled, onAutoSaveChange, saving, onChangeDirectory, storageBusy }) {
  return <Page className="settings-page" title="Настройки" description="Проекты, сохранение и инструменты для работы с платами.">
    <Panel className="settings-card">
      <div className="settings-icon"><Database size={23} /></div>
      <div>
        <h2>Папка проектов</h2>
        <p>{desktop ? 'Здесь сохраняются ваши проекты.' : 'Проекты сохраняются в хранилище браузера. Выбрать папку на диске можно в приложении CLEX Flow.'}</p>
        <code className="storage-path">{path || 'Папка ещё не выбрана'}</code>
        {desktop && <>
          <div className="storage-actions"><button className="button secondary" disabled={storageBusy} onClick={onChangeDirectory}><FolderOpen size={16} />Выбрать папку</button></div>
          <p className="fine-print">При смене папки проекты будут скопированы. Исходные файлы останутся на месте.</p>
        </>}
        <Details title="Перенос и удаление проектов">
          {desktop && <p>Перед переносом CLEX Flow сохранит текущие изменения. Разные файлы с одинаковым именем не перезаписываются.</p>}
          <p>Удаление проекта из библиотеки удаляет его файл. Экспортированные копии остаются.</p>
        </Details>
      </div>
    </Panel>
    <Panel className="settings-card">
      <div className="settings-icon"><Save size={23} /></div>
      <div>
        <h2>Сохранение проектов</h2>
        <label className="autosave-toggle"><input type="checkbox" checked={autoSaveEnabled} disabled={saving} onChange={event => onAutoSaveChange(event.target.checked)} />Сохранять автоматически</label>
        <p>{autoSaveEnabled ? 'Изменения сохраняются через 10 секунд после последней правки.' : 'Нажимайте «Сохранить» или ⌘/Ctrl + S, чтобы сохранить изменения.'}</p>
        <p className="fine-print">Перед выходом из проекта приложение спросит, что делать с несохранёнными изменениями.</p>
      </div>
    </Panel>
    <ToolingSetup idf={idf} />
    <SdkManager idf={idf} />
  </Page>;
}
