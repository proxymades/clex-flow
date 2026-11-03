import {useEffect,useRef} from 'react';
import {readAudioAsset,activationWave} from '../voice/audio.js';
export default function AudioPreview({source,label='Прослушать запись'}){
  const player=useRef(null);
  useEffect(()=>{
    const element=player.current,asset=readAudioAsset(source);
    if(!asset)return;
    const url=URL.createObjectURL(new Blob([activationWave(asset)],{type:'audio/wav'}));
    element.src=url;
    return()=>{element.pause();element.removeAttribute('src');URL.revokeObjectURL(url);};
  },[source]);
  return <audio ref={player} controls aria-label={label}/>;
}
