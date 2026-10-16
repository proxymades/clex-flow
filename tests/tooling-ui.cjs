/* global window */
const assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{
 const {nanoProject}=await import('./nano-fixture.js');const p=nanoProject();
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE}),page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>{
  window.isTauri=true;window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  const callbacks=new Map(),listeners=new Map(),events=[];let next=1,sequence=0,env=null,installed=false,root='C:\\CLEX Tools';window.__toolCalls=[];
  const avr={target:'atmega328p',root:'X:\\Arduino15',sdkVersion:'1.8.6',identity:'avr-test',version:'Arduino AVR 1.8.6 · CLI fixture',compilerVersion:'AVR GCC fixture',arduino:{cli:'X:\\Tools\\arduino-cli.exe'}};
  function emit(id,operation,status,text,build=null){const event={jobId:id,operation,status,text,build,sequence:sequence++,stream:'system'};events.push(event);for(const[key,v]of listeners)if(v.event==='idf-event')callbacks.get(v.handler)?.({event:'idf-event',id:key,payload:event});}
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:fn=>{const id=next++;callbacks.set(id,fn);return id;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
   window.__toolCalls.push({command,args});
   if(command==='plugin:event|listen'){const id=next++;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten')return listeners.delete(args.eventId);
   if(command==='list_projects')return [{id:p.id,contents:JSON.stringify(p)}];if(command==='storage_path')return 'X:\\Projects';if(command==='save_project')return true;
   if(command==='tooling_directory'){if(args.choose)root='X:\\CLEX Tools';return root;}
   if(command==='idf_environment'){if(args.target==='atmega328p'&&installed){env=avr;return env;}throw 'Инструменты еще не подготовлены';}
   if(command==='sdk_list')return {installations:env?[{id:'avr',state:'ready',managed:false,root:env.root,version:'1.8.6',environment:env}]:[],active:{},available:[],environment:env,managedPath:root};
   if(command==='idf_ports')return [{path:'COM7',description:'CH340G',usb:true}];
   if(command==='tooling_plan')return {root,estimatedMin:65*1024*1024,estimatedMax:85*1024*1024,bundles:[{target:'esp32s3',name:'ESP32-S3 · ESP-IDF 5.4.4',ready:true,diagnostic:'Готово'},{target:'esp32p4',name:'ESP32-P4 · ESP-IDF 5.4.4',ready:true,diagnostic:'Готово'},{target:'atmega328p',name:'Arduino Nano · AVR Boards 1.8.6',ready:false,estimatedMin:65*1024*1024,estimatedMax:85*1024*1024}]};
   if(command==='sdk_prepare_all'){setTimeout(()=>emit(args.id,'sdk_install','running','Проверка Arduino AVR'),20);setTimeout(()=>{installed=true;env=avr;emit(args.id,'sdk_install','success','Готово');},80);return null;}
   if(command==='idf_events')return events.filter(e=>e.jobId===args.id);
   if(command==='idf_build'){const build={id:args.id,fingerprint:args.spec.fingerprint,environmentIdentity:avr.identity,projectDir:'X:\\build',binary:'X:\\build\\clex_flow.ino.hex'};setTimeout(()=>emit(args.id,'build','success','Fixture build',build),30);return null;}
   throw new Error('Unexpected RPC '+command);
  }};
 },p);
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430');await page.locator('.project-open').click();await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('heading',{name:/Инструменты Arduino Nano/}).waitFor();
  await page.getByRole('button',{name:'Выбрать папку инструментов',exact:true}).click();await page.locator('#tooling-setup .storage-path').filter({hasText:'X:\\CLEX Tools'}).waitFor();
  await page.getByRole('button',{name:'Проверить и подготовить все',exact:true}).click();const modal=page.getByRole('dialog');await modal.waitFor();assert.equal(await modal.locator('.tooling-bundle').count(),3);assert.equal(await modal.getByRole('button',{name:'Подготовить все',exact:true}).isDisabled(),true);
  assert.match(await modal.innerText(),/65 МиБ-85 МиБ/);assert.equal((await page.evaluate(()=>window.__toolCalls)).some(c=>c.command==='sdk_prepare_all'),false);
  await modal.evaluate(element=>Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished)));await page.screenshot({path:'.artifacts/nano-support/tooling-plan.png'});
  await modal.getByRole('checkbox',{name:'Разрешаю указанную загрузку и установку инструментов.',exact:true}).check();await modal.getByRole('button',{name:'Подготовить все',exact:true}).click();await page.getByRole('heading',{name:/Инструменты Arduino Nano/}).getByText('Окружение готово',{exact:true}).waitFor();
  const calls=await page.evaluate(()=>window.__toolCalls);const prepare=calls.find(c=>c.command==='sdk_prepare_all');assert.deepEqual(prepare.args.targets,['atmega328p']);assert.equal(prepare.args.target,'atmega328p');assert.equal(prepare.args.confirmed,true);assert.equal(calls.some(c=>c.command==='sdk_install'),false);
  await page.getByRole('button',{name:'Текущий проект',exact:true}).click();await page.getByRole('button',{name:'Собрать',exact:true}).click();await page.waitForFunction(()=>!window.document.querySelector('.topbar-actions button.primary').disabled);
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.getByRole('combobox',{name:'Загрузчик Nano',exact:true}).selectOption('old');await page.waitForFunction(()=>window.document.querySelector('.topbar-actions button.primary').disabled);
  assert.equal((await page.evaluate(()=>window.__toolCalls)).some(c=>c.command==='idf_flash'),false);
  assert.deepEqual(errors,[]);console.log('PASS: common tool setup, folder selection, estimate/consent, three platforms, reuse of ESP bundles, AVR readiness/port, build UI and stale bootloader gate. Simulated RPCs; no device access.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
