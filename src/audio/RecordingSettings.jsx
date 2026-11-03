import {useEffect,useRef,useState} from 'react';
import {loadActivationAudio} from '../voice/audio.js';
import {readRecording} from './model.js';
import AudioPreview from './AudioPreview.jsx';
export default function RecordingSettings({node,busy,onChange}){
  const file=useRef(null),latest=useRef(node),alive=useRef(true);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{latest.current=node;},[node]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  let asset;try{asset=readRecording(node);}catch{/* Graph validation shows the error. */}
  const upload=async value=>{
    if(!value)return;
    setLoading(true);setError('');
    try{const audio=await loadActivationAudio(value);if(alive.current){const current=latest.current;onChange(current.id,{parameters:{...current.parameters,audio:JSON.stringify(audio)}});}}
    catch(e){if(alive.current)setError(e.message);}finally{if(alive.current){setLoading(false);if(file.current)file.current.value='';}}
  };
  return <div className="audio-recording-settings">
    <input type="file" ref={file} accept=".wav,.mp3,audio/wav,audio/mpeg" aria-label="Файл аудиозаписи" disabled={busy||loading} onChange={e=>upload(e.target.files?.[0])}/>
    <button className="button secondary" disabled={busy||loading} onClick={()=>file.current?.click()}>{loading?'Подготовка записи…':asset?'Заменить запись':'Загрузить запись'}</button>
    <p className="panel-note">WAV или MP3, до 5 секунд. Запись сохраняется в проекте и включается в прошивку.</p>
    {asset&&<><span className="voice-audio-name">{asset.name} · {(asset.samples/asset.sampleRate).toFixed(1)} сек.</span><AudioPreview source={node.parameters.audio}/><button className="button secondary" disabled={busy||loading} onClick={()=>onChange(node.id,{parameters:{...node.parameters,audio:''}})}>Удалить запись</button></>}
    <p className="panel-note">Соедините нужное событие со входом «Воспроизвести»: например, завершение действия или «Повторить команду» голосового блока. При управлении другой платой используйте её ответ о выполнении.</p>
    {error&&<p className="inspector-warning" role="alert">{error}</p>}
  </div>;
}
