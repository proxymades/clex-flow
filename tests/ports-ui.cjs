/* global window, document */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const boardId=process.env.CLEX_TEST_BOARD||null;
 const {catalog}=await import('./catalog-fixture.js');
 const target=boardId?catalog.boards.find(board=>board.id===boardId)?.target:'esp32s3';
 assert.ok(target,'requested board must have a target');
 const stem='ports-harness-'+Date.now();
 await fs.writeFile('.artifacts/'+stem+'.html',`<html><body><div id="fixture"></div><script type="module" src="/.artifacts/${stem}.jsx"></script></body></html>`);
 await fs.writeFile('.artifacts/'+stem+'.jsx',`import React from 'react';import{createRoot}from'react-dom/client';import useIdf from '../src/idf/useIdf.js';import{createProject}from'../src/projects/model.js';const project=${JSON.stringify(boardId)}?createProject('Ports fixture','',${JSON.stringify(boardId)}):null;function Fixture(){const idf=useIdf(project);window.portsHook=idf;return <><select aria-label="Порт платы" value={idf.port} onChange={event=>idf.setPort(event.target.value)}><option value="">Выберите порт</option>{idf.ports.map(port=><option key={port.path} value={port.path}>{port.path}</option>)}</select><span data-busy>{String(idf.busy)}</span><button onClick={idf.startMonitor}>Монитор</button><button onClick={idf.cancel}>Остановить</button></>;}createRoot(document.getElementById('fixture')).render(<Fixture/>);`);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]}),page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(target=>{
  window.isTauri=true;window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  const callbacks=new Map(),listeners=new Map(),environment={target,sdkVersion:'5.4.4',identity:'fixture-sdk'};let next=1,sequence=0,job;
  window.portFixture={items:[],calls:0,delay:0,targets:[]};
  const emit=status=>{for(const [id,args]of listeners)callbacks.get(args.handler)?.({event:'idf-event',id,payload:{jobId:job.id,sequence:sequence++,operation:'monitor',status,stream:'system',text:'fixture'}});};
  window.__TAURI_INTERNALS__={transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
   if(command==='plugin:event|listen'){const id=next++;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return null;}
   if(command==='idf_environment'){window.portFixture.targets.push(args.target);return environment;}if(command==='sdk_list')return {installations:[],environment};
   if(command==='idf_ports'){window.portFixture.calls++;await new Promise(resolve=>setTimeout(resolve,window.portFixture.delay));return window.portFixture.items;}
   if(command==='idf_monitor'){job={id:args.id};setTimeout(()=>emit('connected'),0);return null;}if(command==='idf_events')return [];if(command==='idf_cancel'){emit('cancelled');return null;}
   throw Error('Unexpected RPC '+command);
  }};
 },target);
 const usb=path=>({path,description:'USB serial fixture',usb:true}),a='/dev/cu.usbmodem-A',b='/dev/cu.usbmodem-B',c='/dev/cu.usbmodem-C';
 const value=expected=>page.waitForFunction(expected=>document.querySelector('select').value===expected,expected,{timeout:5000});
 const items=async ports=>{await page.evaluate(ports=>{window.portFixture.items=ports;},ports);};
 try{
  await page.goto((process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430')+'/.artifacts/'+stem+'.html');await page.waitForFunction(()=>window.portsHook?.ready);await value('');
  await page.waitForFunction(()=>window.portsHook?.compatible);assert.deepEqual(await page.evaluate(()=>window.portFixture.targets),[target]);
  if(target==='esp32')assert.deepEqual(await page.evaluate(()=>window.portsHook.consoleModes),['uart']);
  await items([usb(a)]);await value(a); // Detect hot-plug without a refresh click.
  await items([]);await value('');
  await items([usb(a),usb(b)]);await page.waitForFunction(()=>document.querySelector('select').options.length===3);assert.equal(await page.locator('select').inputValue(),'','multiple boards require a choice');
  await page.locator('select').selectOption(b);await items([usb(a),usb(b),usb(c)]);await page.waitForFunction(()=>document.querySelector('select').options.length===4);await value(b);
  await page.getByRole('button',{name:'Монитор',exact:true}).click();await page.waitForFunction(()=>window.portsHook.monitoring);const calls=await page.evaluate(()=>window.portFixture.calls);await items([]);await page.waitForTimeout(2300);assert.equal(await page.evaluate(()=>window.portFixture.calls),calls,'monitor owns the port without concurrent enumeration');await value(b);
  await page.getByRole('button',{name:'Остановить',exact:true}).click();await value('');
  await items([usb(c),{path:'COM1',usb:false,description:'built-in serial'}]);await value(c);
  await page.evaluate(()=>{window.portFixture.delay=100;});const before=await page.evaluate(()=>window.portFixture.calls);await page.evaluate(()=>Promise.all([window.portsHook.refreshPorts(),window.portsHook.refreshPorts(),window.portsHook.refreshPorts()]));assert.equal(await page.evaluate(()=>window.portFixture.calls),before+1,'refresh requests do not overlap');
  assert.deepEqual(errors,[]);console.log('PASS: actual useIdf hook hot-plug detection, unique USB auto-selection, disconnect, ambiguous ports, preserved manual choice, no enumeration during monitor and deduplicated requests. Native RPC responses are controlled; no device opened.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
