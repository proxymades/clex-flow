import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal, Hammer, Radio, Square, FileCode2, CheckCircle2, TriangleAlert, ArrowDownToLine } from 'lucide-react';
// eslint-disable-next-line no-control-regex
const strip = value => value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
export default function ProcessPanel({ idf, onPreview, issues, onIssue }) {
  const [selectedTab, setTab] = useState(null), [following, setFollowing] = useState(true);
  const tab = selectedTab || (idf.job?.operation === 'monitor' ? 'monitor' : 'build');
  const log = useRef(null), follow = useRef(true), lastScrollTop = useRef(0);
  const scrollToEnd = useCallback(() => {
    const element = log.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    lastScrollTop.current = element.scrollTop;
  }, []);
  // Move after DOM layout, before paint. Appending output must never be mistaken
  // for a user's decision to stop following the stream.
  useLayoutEffect(() => { if (follow.current) scrollToEnd(); }, [idf.events, tab, scrollToEnd]);
  useEffect(() => {
    const element = log.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (follow.current) scrollToEnd(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollToEnd]);
  function followEnd() {
    follow.current = true;
    setFollowing(true);
    scrollToEnd();
  }
  function changeTab(next) {
    follow.current = true;
    setFollowing(true);
    setTab(next);
  }
  function onScroll(event) {
    const element = event.currentTarget;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    if (atEnd) { follow.current = true; setFollowing(true); }
    else if (Math.abs(element.scrollTop - lastScrollTop.current) > 1) { follow.current = false; setFollowing(false); }
    lastScrollTop.current = element.scrollTop;
  }
  function onWheel(event) {
    if (event.deltaY < 0 && event.currentTarget.scrollHeight > event.currentTarget.clientHeight) {
      follow.current = false;
      setFollowing(false);
    }
  }
  const errors = issues.filter(issue => issue.severity === 'error');
  const events = idf.events.filter(event => tab === 'monitor' ? event.operation === 'monitor' : event.operation !== 'monitor');
  const labels = { running: 'Выполняется', connected: 'Подключён', stopping: 'Останавливаем…', success: 'Готово', failed: 'Ошибка', cancelled: 'Остановлено' };
  return <section className="process-panel">
    <header><div>
      <button className={tab === 'build' ? 'selected' : ''} onClick={() => changeTab('build')}><Hammer size={14} />Сборка и прошивка</button>
      <button className={tab === 'monitor' ? 'selected' : ''} onClick={() => changeTab('monitor')}><Radio size={14} />Монитор</button>
      <button className={tab === 'check' ? 'selected' : ''} onClick={() => changeTab('check')}>Проверка{errors.length ? ` · ${errors.length}` : ''}</button>
    </div>
      {!following && tab !== 'check' && <button className="icon-button" onClick={followEnd} aria-label="К последним сообщениям" title="К последним сообщениям"><ArrowDownToLine size={16} /></button>}
      <span className={`process-state ${idf.job?.status === 'failed' ? 'failed' : ''}`}>{idf.job ? labels[idf.job.status] : idf.environment ? 'ESP-IDF готова' : 'Среда не проверена'}</span>
      {idf.busy && idf.job && <button className="text-button" onClick={idf.cancel}><Square size={12} />Остановить</button>}
      <button className="icon-button" onClick={onPreview} disabled={!idf.preview} aria-label="Посмотреть исходники прошивки"><FileCode2 size={15} /></button>
    </header>
    <div className="process-log" ref={log} onScroll={onScroll} onWheel={onWheel} role="log" aria-label={tab === 'monitor' ? 'Последовательный монитор' : 'Журнал компилятора'}>
      {tab === 'check' ? <div><p className="generation-state">{idf.generationError || 'Исходники готовы к сборке.'}</p>{issues.map((issue, index) => <button className="validation-row" key={`${issue.code}-${index}`} onClick={() => onIssue(issue)}><span className={`log-level ${issue.severity === 'error' ? 'error-level' : 'warning'}`}>{issue.severity === 'error' ? 'ОШ' : 'ВНИМ'}</span><span>{issue.message}</span></button>)}</div>
        : !events.length ? <div className="process-empty"><Terminal size={18} /><p>{tab === 'monitor' ? 'Выберите порт и откройте монитор.' : 'Нажмите «Собрать», чтобы открыть журнал компиляции.'}</p></div>
          : tab === 'monitor' ? <pre className="serial-output">{strip(events.map(event => event.stream === 'stdout' ? event.text : `\n[${event.status}] ${event.text}\n`).join(''))}</pre>
            : events.map(event => <div key={event.sequence} className={`process-line ${event.status === 'failed' ? 'failed' : ''}`}><span className="process-stream">{event.status === 'success' ? <CheckCircle2 size={11} /> : event.status === 'failed' ? <TriangleAlert size={11} /> : event.stream === 'stderr' ? 'ОШ' : event.stream === 'system' ? 'СИСТ' : 'ВЫВ'}</span><pre>{strip(event.text)}</pre></div>)}
    </div>
    {idf.build && <footer><span>{idf.fresh ? 'Прошивка соответствует текущей схеме' : 'Схема/среда изменена – нужна новая сборка'}</span><code title={idf.build.binary}>{idf.build.binary}</code></footer>}
  </section>;
}
