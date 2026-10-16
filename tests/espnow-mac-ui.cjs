/* global window, document */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
(async () => {
 const stem='espnow-mac-'+Date.now();
 await fs.mkdir('.artifacts/espnow-work',{recursive:true});
 await fs.writeFile('.artifacts/'+stem+'.html',`<html><body><div id="fixture"></div><script type="module" src="/.artifacts/${stem}.jsx"></script></body></html>`);
 await fs.writeFile('.artifacts/'+stem+'.jsx',`import React,{useState}from'react';import{createRoot}from'react-dom/client';import useIdf from'../src/idf/useIdf.js';import EspNowSettings from'../src/espnow/EspNowSettings.jsx';import initialProject from'../examples/espnow-button.clex.json';import'../src/styles.css';function Fixture(){const[project,setProject]=useState(initialProject);const idf=useIdf(project);window.macHook=idf;window.macSetProject=setProject;const[component,setComponent]=useState(project.components[0]),[show,setShow]=useState(true);window.macShowSettings=setShow;return <main style={{padding:24}}><label>Порт платы<select aria-label="Порт платы" value={idf.port} disabled={idf.busy} onChange={event=>idf.setPort(event.target.value)}><option value="">Выберите порт</option>{idf.ports.map(port=><option key={port.path} value={port.path}>{port.path}</option>)}</select></label><div role="alert">{idf.error}</div>{show&&<aside className="workspace-properties" style={{width:320,marginTop:20,border:'1px solid #334158',borderRadius:10}}><EspNowSettings component={component} busy={false} onChange={(id,patch)=>setComponent(value=>({...value,...patch}))} events={idf.events} idf={idf}/></aside>}</main>;}createRoot(document.getElementById('fixture')).render(<Fixture/>);`);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});
 const page=await browser.newPage({viewport:{width:900,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.isTauri=true;window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  const callbacks=new Map(),listeners=new Map(),environment={target:'esp32s3',sdkVersion:'5.4.4',identity:'mac-test-sdk'};let next=1,sequence=0,job;
  window.macFixture={items:[],reads:[],failure:'',pending:null,monitorCalls:0,copied:'',copyFailure:false};
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.macFixture.copyFailure)throw Error('clipboard unavailable');window.macFixture.copied=value;}}});
  const emit=status=>{for(const [id,listener]of listeners)callbacks.get(listener.handler)?.({event:'idf-event',id,payload:{jobId:job.id,sequence:sequence++,operation:'monitor',status,stream:'stdout',text:'fixture'}});};
  window.__TAURI_INTERNALS__={transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
   if(command==='plugin:event|listen'){const id=next++;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return null;}
   if(command==='idf_environment')return environment;if(command==='sdk_list')return {installations:[],environment};
   if(command==='idf_ports')return window.macFixture.items;
   if(command==='idf_read_mac'){window.macFixture.reads.push(args.port);return new Promise((resolve,reject)=>{window.macFixture.pending=mac=>window.macFixture.failure?reject(window.macFixture.failure):resolve({mac,port:args.port});});}
   if(command==='idf_monitor'){job={id:args.id};window.macFixture.monitorCalls++;setTimeout(()=>emit('connected'),0);return null;}
   if(command==='idf_events')return [];if(command==='idf_cancel'){emit('cancelled');return null;}
   throw Error('Unexpected RPC '+command);
  }};
 });
 try{
  await page.goto((process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1431')+'/.artifacts/'+stem+'.html');
  await page.waitForFunction(()=>window.macHook?.ready&&window.macHook.compatible&&!window.macHook.checking);
  const button=()=>page.getByRole('button',{name:'Скопировать MAC',exact:true});
  const reads=()=>page.evaluate(()=>window.macFixture.reads.length);
  const waitReads=count=>page.waitForFunction(count=>window.macFixture.reads.length===count,count);
  const items=async paths=>{await page.evaluate(async paths=>{window.macFixture.items=paths.map(path=>({path,usb:true}));await window.macHook.refreshPorts();},paths);};
  const finish=async mac=>{await page.evaluate(mac=>window.macFixture.pending(mac),mac);await page.waitForFunction(()=>!window.macHook.readingMac);};
  const select=async path=>{await page.getByLabel('Порт платы',{exact:true}).selectOption(path);};
  const a='/dev/cu.usbmodem-A',b='/dev/cu.usbmodem-B',c='/dev/cu.usbmodem-C',d='/dev/cu.usbmodem-D';
  assert.equal(await button().isDisabled(),true);assert.equal(await reads(),0);assert.ok(await page.evaluate(()=>window.macHook.generationError));
  await items([a]);await waitReads(1);await page.getByText('Определяем MAC…',{exact:true}).waitFor();assert.equal(await button().isDisabled(),true);
  await page.evaluate(()=>window.macHook.startMonitor());assert.equal(await page.evaluate(()=>window.macFixture.monitorCalls),0);
  await finish('A0:B7:65:12:34:56');await page.getByText('A0:B7:65:12:34:56',{exact:true}).waitFor();await button().click();assert.equal(await page.evaluate(()=>window.macFixture.copied),'A0:B7:65:12:34:56');await page.getByRole('status').filter({hasText:'MAC скопирован'}).waitFor();
  await page.evaluate(()=>window.macShowSettings(false));await page.waitForFunction(()=>!document.querySelector('.espnow-settings'));await page.evaluate(()=>window.macShowSettings(true));await button().waitFor();await items([a]);await page.waitForTimeout(100);assert.equal(await reads(),1,'opening settings and polling must not reset the board again');
  await items([a,b]);await page.evaluate(()=>{window.macFixture.failure='Порт занят другой программой.';});await select(b);await waitReads(2);await finish('');await page.getByRole('alert').filter({hasText:'Порт занят другой программой'}).waitFor();assert.equal(await button().isDisabled(),true);await items([a,b]);await page.waitForTimeout(100);assert.equal(await reads(),2,'failed reads must not retry on every scan');
  await items([a]);await page.waitForFunction(a=>window.macHook.port===a,a);await page.getByText('A0:B7:65:12:34:56',{exact:true}).waitFor();assert.equal(await reads(),2,'cached addresses survive switching between connected boards');
  await page.evaluate(()=>{window.macFixture.copyFailure=true;});await button().click();await page.getByRole('alert').filter({hasText:'Не удалось скопировать MAC'}).waitFor();await page.evaluate(()=>{window.macFixture.copyFailure=false;window.macFixture.failure='';});
  await items([a,b]);await select(b);await waitReads(3);await finish('A0:B7:65:98:76:54');await page.getByText('A0:B7:65:98:76:54',{exact:true}).waitFor();await page.screenshot({path:'.artifacts/espnow-work/mac-auto-settings.png'});
  await items([a,b,c]);await select(c);await waitReads(4);await page.evaluate(a=>window.macHook.setPort(a),a);await finish('A0:B7:65:00:00:03');assert.equal(await page.getByText('A0:B7:65:00:00:03',{exact:true}).count(),0);await page.getByText('A0:B7:65:12:34:56',{exact:true}).waitFor();
  await items([a,b,c,d]);await page.evaluate(d=>{window.macHook.setPort(d);void window.macHook.startMonitor();},d);await page.waitForFunction(()=>window.macHook.monitoring);await page.waitForTimeout(100);assert.equal(await reads(),4,'active monitor blocks automatic reads');await page.evaluate(()=>window.macHook.cancel());await waitReads(5);await finish('A0:B7:65:00:00:04');
  await items([a,b,c]);await items([a,b,c,d]);await select(d);await waitReads(6);assert.equal(await button().isDisabled(),true,'disconnected ports must lose cached MAC');await finish('A0:B7:65:00:00:05');await page.getByText('A0:B7:65:00:00:05',{exact:true}).waitFor();
  await page.evaluate(()=>window.macSetProject(project=>({...project,components:[]})));await items([a,b,c,d,'/dev/cu.usbmodem-E']);await select('/dev/cu.usbmodem-E');await page.waitForTimeout(100);assert.equal(await reads(),6,'unrelated projects must not trigger radio probing');
  assert.deepEqual(errors,[]);console.log('PASS: automatic MAC without firmware/peer setup, copy and clipboard errors, caching across inspector/port changes, disconnect invalidation, bounded failures, stale results, monitor exclusion and deferred read, no probing in unrelated projects. RPC mocked; no physical port opened.');
 }catch(error){await page.screenshot({path:'.artifacts/espnow-work/mac-auto-failure.png'});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
