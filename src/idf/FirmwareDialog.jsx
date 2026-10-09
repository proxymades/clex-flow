import { useState } from 'react';
import { FileCode2 } from 'lucide-react';
import Modal from '../components/Modal.jsx';
export default function FirmwareDialog({bundle,build,onClose}){
 const [file,setFile]=useState('main/main.c');
 return <Modal title="Исходники прошивки" className="firmware-modal" onClose={onClose}><div className="firmware-files">{Object.keys(bundle.files).map(name=><button key={name} onClick={()=>setFile(name)} className={file===name?'selected':''}><FileCode2 size={13}/>{name}</button>)}</div><pre className="firmware-source" tabIndex={0}>{bundle.files[file]}</pre><p className="fine-print">Код сформирован фиксированными реализациями модулей, без ИИ. {build?`ESP-IDF-проект: ${build.projectDir}`:'Файлы временного ESP-IDF-проекта будут созданы при сборке.'}</p><footer><button className="button secondary" onClick={onClose}>Закрыть</button></footer></Modal>;
}
