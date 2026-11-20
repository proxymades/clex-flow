/* global window */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.isTauri=true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  let sequence=0,next=1,environment=null,job=null,catalogError='EOF while parsing a string at line 1 column 2097152';const callbacks=new Map(),listeners=new Map(),events=[];
  const sdk={id:'managed-fixture',family:'esp-idf',version:'5.4.4',root:'/fixture/CLEX/sdks/v5.4.4/esp-idf',slot:'/fixture/CLEX/sdks/v5.4.4',managed:true,state:'installing',diagnostic:''};
  let installations=[];
  const emit=(status,text,extra={})=>{const event={jobId:job.id,sequence:sequence++,operation:job.operation,status,stream:'system',text,build:null,downloaded:null,total:null,...extra};events.push(event);for(const [id,value] of listeners){if(value.event==='idf-event')callbacks.get(value.handler)?.({event:'idf-event',id,payload:event});}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
   if(command==='plugin:event|listen'){const id=next++;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return null;}
   if(command==='list_projects')return [];if(command==='tooling_directory')return '/fixture/CLEX/sdks';
   if(command==='storage_path')return '/fixture/projects';
   if(command==='idf_environment')throw 'Fixture: SDK отсутствует';if(command==='idf_ports')return [];
   if(command==='sdk_list')return {installations,active:environment?{esp32s3:'external-fixture'}:{},available:[{version:'5.4.4',supported:true},{version:'5.5.2',supported:false}],catalogError,managedPath:'/fixture/CLEX/sdks',host:'macos-aarch64',environment};
   if(command==='sdk_refresh_versions'){window.__catalogCalls=(window.__catalogCalls||0)+1;if(window.__catalogCalls===1){catalogError='EOF while parsing a string at line 1 column 1048576';throw catalogError;}catalogError='';return null;}
   if(command==='sdk_install_plan')return {toolBytes:1024,estimatedMin:2048,estimatedMax:4096};
   if(command==='sdk_install'){job={id:args.id,operation:command};installations=[sdk];window.__sdkInstallCalls=(window.__sdkInstallCalls||0)+1;setTimeout(()=>{emit('running','Fixture EIM: compiler download\n');emit('progress','small test bytes',{downloaded:2,total:8});},30);return null;}
   if(command==='idf_events')return events.filter(e=>e.jobId===args.id);
   if(command==='idf_cancel'){sdk.state='interrupted';sdk.diagnostic='Fixture: installation interrupted';emit('cancelled','Fixture installation cancelled');return null;}
   if(command==='sdk_remove'){job={id:args.id,operation:command};installations=installations.filter(s=>s.id!==args.sdkId);setTimeout(()=>emit('success','Fixture managed SDK removed'),30);return null;}
   if(command==='sdk_select'){job={id:args.id,operation:command};setTimeout(()=>emit('failed','Fixture: incomplete SDK'),30);return null;}
   throw new Error('Unexpected fixture RPC '+command);
  }};
 });
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');
  const settings=page.getByRole('navigation',{name:'Основные разделы'}).getByRole('button',{name:'Настройки',exact:true});
  await settings.waitFor();
  const homeFill=await page.locator('.nav-item.selected').evaluate(el=>window.getComputedStyle(el).backgroundImage);
  await settings.click();await page.mouse.move(900,100);
  assert.equal(await settings.getAttribute('aria-current'),'page');
  assert.equal(await settings.evaluate(el=>window.getComputedStyle(el).backgroundImage),homeFill);
  assert.equal(await page.getByRole('button',{name:'Настройки',exact:true}).count(),1);
  assert.equal(await settings.evaluate(el=>el.previousElementSibling.textContent.startsWith('Библиотека')),true);
  const notice=page.locator('.catalog-notice');
  await notice.getByText('Не удалось обновить список версий ESP-IDF. Показан ранее сохранённый список.',{exact:true}).waitFor();
  assert.equal((await page.locator('body').innerText()).includes('EOF while parsing'),false,'Raw parsing error stays in collapsed details');
  await notice.getByText('Технические подробности',{exact:true}).click();
  await notice.getByText('EOF while parsing a string at line 1 column 2097152',{exact:true}).waitFor();
  await notice.getByText('Технические подробности',{exact:true}).click();
  await notice.getByRole('button',{name:'Повторить обновление',exact:true}).click();
  await page.waitForFunction(()=>window.__catalogCalls===1 && !window.document.querySelector('.catalog-notice button').disabled);
  assert.equal(await notice.locator('pre').textContent(),'EOF while parsing a string at line 1 column 1048576');
  assert.equal((await page.locator('body').innerText()).includes('EOF while parsing'),false,'Retry failure remains understandable');
  assert.equal(await page.getByRole('alert').count(),0,'Catalogue errors do not create a raw global error');
  await notice.getByRole('button',{name:'Повторить обновление',exact:true}).click();await notice.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.__catalogCalls),2);
  assert.equal(await page.evaluate(()=>window.__sdkInstallCalls||0),0,'Refreshing the catalogue does not install SDKs');
  await page.locator('.sdk-options > summary').click();
  await page.getByText('ESP-IDF не найдена.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Версия ESP-IDF для установки'}).inputValue(),'5.4.4');
  await page.getByRole('button',{name:'Установить ESP-IDF 5.4.4',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  const install=dialog.getByRole('button',{name:'Установить',exact:true});assert.equal(await install.isDisabled(),true);
  assert.match(await dialog.innerText(),/Примерный размер загрузки/);
  assert.equal(await page.evaluate(()=>window.__sdkInstallCalls||0),0);
  await dialog.getByRole('checkbox',{name:'Разрешаю загрузить и установить ESP-IDF.',exact:true}).check();await install.click();
  await page.locator('.sdk-operation pre').filter({hasText:'Fixture EIM: compiler download'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__sdkInstallCalls),1);
  await page.locator('.sdk-operation').getByRole('button',{name:'Остановить',exact:true}).click();
  await page.getByText('Установка прервана',{exact:true}).waitFor();
  await page.locator('.sdk-row').getByRole('button',{name:'Повторить установку',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();
  await page.locator('.sdk-row').getByRole('button',{name:'Удалить',exact:true}).click();
  assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Удалить SDK',exact:true}).isDisabled(),true);
  await page.getByRole('dialog').getByRole('checkbox',{name:'Разрешаю удалить эту установку.',exact:true}).check();
  await page.getByRole('dialog').getByRole('button',{name:'Удалить SDK',exact:true}).click();
  await page.getByText('ESP-IDF не найдена.',{exact:false}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS SDK UI: selected Settings navigation, saved catalogue error, collapsed diagnostics, failed retry and recovery, missing SDK offer, size estimate, explicit install consent, small fixture progress, cancel, retry, owned removal confirmation. RPCs are simulated; no SDK was downloaded.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
