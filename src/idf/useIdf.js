import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktop } from '../projects/storage.js';
import { generateFirmware, firmwareFingerprint } from '../firmware/generator.js';
import { sdkRequirement } from './sdkRequirements.js';
import { catalog, getBoard } from '../catalog/index.js';

const terminal = ['success','failed','cancelled'];
export default function useIdf(project) {
  const [environment,setEnvironment]=useState(null), [checking,setChecking]=useState(false), [ports,setPorts]=useState([]), [port,setPort]=useState('');
  const [consoleMode,setConsoleMode]=useState(()=>localStorage.getItem('clex-flow:console')||'usb');
  const [job,setJob]=useState(null), [events,setEvents]=useState([]), [build,setBuild]=useState(null), [error,setError]=useState('');
  const [sdks,setSdks]=useState(null), [sdkLoading,setSdkLoading]=useState(false);
  const requirement=sdkRequirement(getBoard(project?.boardId || 'waveshare-esp32-s3-eth'));
  const compatible=Boolean(environment && environment.sdkVersion===requirement?.version);
  const [computed,setComputed]=useState({key:'',value:null,error:''});
  const generated=useMemo(()=>{if(!project)return {bundle:null,error:''};try{return {bundle:generateFirmware(project,catalog,consoleMode),error:''};}catch(error){return {bundle:null,error:error.message};}},[project,consoleMode]);
  const preview=generated.bundle;
  const signature=preview?JSON.stringify([preview.boardId,preview.consoleMode,preview.mainC,preview.graphicsRuntime]):'';
  const fingerprint=computed.key===signature?computed.value:null;
  const generationError=generated.error||(computed.key===signature?computed.error:'');
  const current=useRef(null), received=useRef({sequences:new Set(),max:-1}), flight=useRef(false), probing=useRef(false), mounted=useRef(true);
  const [ready,setReady]=useState(false);
  const refreshSdk=useCallback(async()=>{
    if(!desktop)return null;
    const snapshot=await invoke('sdk_list');
    if(mounted.current){setSdks(snapshot);setEnvironment(snapshot.environment);}
    if(snapshot.environment){try{const items=await invoke('idf_ports');if(mounted.current){setPorts(items);setPort(selected=>items.some(p=>p.path===selected)?selected:'');}}catch(error){setError(String(error));}}
    else {setPorts([]);setPort('');}
    return snapshot;
  },[]);
  const ingest=useCallback(event=>{
    if(event.jobId!==current.current?.id||received.current.sequences.has(event.sequence) || event.sequence < received.current.max - 3000||!mounted.current)return;
    received.current.sequences.add(event.sequence);
    received.current.max=Math.max(received.current.max,event.sequence);
    if(received.current.sequences.size>3000)received.current.sequences=new Set([...received.current.sequences].filter(sequence=>sequence>=received.current.max-3000));
    setEvents(items=>[...items,event].slice(-1200));
    if(terminal.includes(event.status)){setJob(value=>value?.id===event.jobId?{...value,status:event.status}:value);flight.current=false;if(event.build)setBuild(event.build);if(event.status==='failed')setError(event.text);if(event.operation.startsWith('sdk_'))refreshSdk().catch(error=>setError(String(error)));}
    if(event.status==='connected')setJob(value=>value?.id===event.jobId && !terminal.includes(value.status)?{...value,status:'connected'}:value);
  },[refreshSdk]);
  useEffect(()=>{
    mounted.current=true;
    if(!desktop)return ()=>{mounted.current=false;};
    let stop,closed=false;
    listen('idf-event',event=>ingest(event.payload)).then(unlisten=>{if(closed)unlisten();else{stop=unlisten;setReady(true);}}).catch(error=>setError(String(error)));
    return()=>{closed=true;mounted.current=false;stop?.();};
  },[ingest]);
  useEffect(()=>{
    let live=true;
    if(preview) firmwareFingerprint(preview).then(value=>{if(live)setComputed({key:signature,value,error:''});}).catch(error=>{if(live)setComputed({key:signature,value:null,error:error.message});});
    return()=>{live=false;};
  },[preview,signature]);
  const refreshPorts=useCallback(async()=>{
    if(!desktop)return;
    try{const items=await invoke('idf_ports');setPorts(items);setPort(selected=>items.some(item=>item.path===selected)?selected:'');}catch(error){setError(String(error));}
  },[]);
  const check=useCallback(async(root=null,python=null)=>{
    if(!desktop){setError('ESP-IDF доступна в десктопном приложении Tauri.');return false;}
    if(flight.current || probing.current)return false;
    probing.current=true;
    setChecking(true);setError('');
    try{const environment=await invoke('idf_environment',{root,python});setEnvironment(environment);await refreshPorts();await refreshSdk();return environment;}
    catch(error){setEnvironment(null);setError(String(error));try{await refreshSdk();}catch{ /* Keep the actionable probe error. */ }return false;}
    finally{probing.current=false;if(mounted.current)setChecking(false);}
  },[refreshPorts,refreshSdk]);
  useEffect(()=>{if(!desktop)return;const timer=setTimeout(()=>check(),0);return()=>clearTimeout(timer);},[check]);
  const start=async(operation,args)=>{
    if(!desktop||!ready){setError('Операции доступны после запуска десктопного приложения.');return false;}
    if(flight.current||checking)return false;
    flight.current=true;const id=crypto.randomUUID();current.current={id,operation};received.current={sequences:new Set(),max:-1};setJob({id,operation,status:'running'});setEvents([]);setError('');
    try{await invoke(operation.startsWith('sdk_')?operation:`idf_${operation}`,{id,...args});const backlog=await invoke('idf_events',{id});for(const event of backlog)ingest(event);return true;}
    catch(error){flight.current=false;setJob({id,operation,status:'failed'});setError(String(error));return false;}
  };
  const startBuild=()=>preview&&fingerprint&&compatible?start('build',{spec:{boardId:preview.boardId,consoleMode,mainC:preview.mainC,graphicsRuntime:preview.graphicsRuntime,fingerprint}}):Promise.resolve(false);
  const startFlash=()=>build&&fingerprint&&port?start('flash',{buildId:build.id,fingerprint,port}):Promise.resolve(false);
  const startMonitor=()=>port?start('monitor',{port}):Promise.resolve(false);
  const cancel=async()=>{if(!current.current)return;try{await invoke('idf_cancel',{id:current.current.id});setJob(value=>value && !terminal.includes(value.status)?{...value,status:'stopping'}:value);}catch(error){setError(String(error));}};
  const setConsole=value=>{if(!['usb','uart'].includes(value))return;localStorage.setItem('clex-flow:console',value);setConsoleMode(value);};
  const running=job&&['running','connected','stopping'].includes(job.status);
  const sdkAction=async(command,args={})=>{
    if(flight.current||checking||sdkLoading)return false;
    setSdkLoading(true);setError('');
    try{await invoke(command,args);await refreshSdk();return true;}catch(error){setError(String(error));return false;}finally{setSdkLoading(false);}
  };
  return {sdks,sdkLoading,refreshSdk,requirement,compatible,
    installPlan:version=>invoke('sdk_install_plan',{version}),
    refreshCatalog:()=>sdkAction('sdk_refresh_versions'),registerSdk:(root,python)=>sdkAction('sdk_register',{root,python:python||null}),
    selectSdk:sdkId=>start('sdk_select',{sdkId}),installSdk:(version,allowPrerequisites)=>start('sdk_install',{version,allowPrerequisites}),removeSdk:sdkId=>start('sdk_remove',{sdkId}),
    desktop,environment,checking,check,ports,port,setPort,refreshPorts,consoleMode,setConsole,job,events,build,error,setError,preview,fingerprint,generationError,ready,
    busy:Boolean(checking||running||sdkLoading),monitoring:Boolean(running&&job.operation==='monitor'),fresh:Boolean(compatible&&build&&fingerprint&&build.fingerprint===fingerprint&&environment?.identity===build.environmentIdentity),startBuild,startFlash,startMonitor,cancel};
}
