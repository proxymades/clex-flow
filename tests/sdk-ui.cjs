/* global window */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.isTauri=true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  let sequence=0,next=1,environment=null,job=null;const callbacks=new Map(),listeners=new Map(),events=[];
  const sdk={id:'managed-fixture',family:'esp-idf',version:'5.4.4',root:'/fixture/CLEX/sdks/v5.4.4/esp-idf',slot:'/fixture/CLEX/sdks/v5.4.4',managed:true,state:'installing',diagnostic:''};
  let installations=[];
  const emit=(status,text,extra={})=>{const event={jobId:job.id,sequence:sequence++,operation:job.operation,status,stream:'system',text,build:null,downloaded:null,total:null,...extra};events.push(event);for(const [id,value] of listeners){if(value.event==='idf-event')callbacks.get(value.handler)?.({event:'idf-event',id,payload:event});}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:callback=>{const id=next++;callbacks.set(id,callback);return id;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
   if(command==='plugin:event|listen'){const id=next++;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return null;}
   if(command==='list_projects')return [];if(command==='storage_path')return '/fixture/projects';
   if(command==='idf_environment')throw 'Fixture: SDK отсутствует';if(command==='idf_ports')return [];
   if(command==='sdk_list')return {installations,active:environment?{esp32s3:'external-fixture'}:{},available:[{version:'5.4.4',supported:true},{version:'5.5.2',supported:false}],catalogError:'',managedPath:'/fixture/CLEX/sdks',host:'macos-aarch64',environment};
   if(command==='sdk_refresh_versions')return null;
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
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByText('SDK не обнаружены.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Установить нужный SDK',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  const install=dialog.getByRole('button',{name:'Установить',exact:true});assert.equal(await install.isDisabled(),true);
  assert.match(await dialog.innerText(),/Оценка загрузки/);
  assert.equal(await page.evaluate(()=>window.__sdkInstallCalls||0),0);
  await dialog.getByRole('checkbox',{name:'Разрешаю полную загрузку и установку SDK.',exact:true}).check();await install.click();
  await page.locator('.sdk-operation pre').filter({hasText:'Fixture EIM: compiler download'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__sdkInstallCalls),1);
  await page.locator('.sdk-operation').getByRole('button',{name:'Остановить',exact:true}).click();
  await page.getByText('Установка прервана',{exact:true}).waitFor();
  await page.locator('.sdk-row').getByRole('button',{name:'Повторить установку',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();
  await page.locator('.sdk-row').getByRole('button',{name:'Удалить',exact:true}).click();
  assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Удалить SDK',exact:true}).isDisabled(),true);
  await page.getByRole('dialog').getByRole('checkbox',{name:'Разрешаю удалить эту управляемую установку.',exact:true}).check();
  await page.getByRole('dialog').getByRole('button',{name:'Удалить SDK',exact:true}).click();
  await page.getByText('SDK не обнаружены.',{exact:false}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS SDK UI: missing SDK offer, size estimate, explicit install consent, small fixture progress, cancel, retry, owned removal confirmation. RPCs are simulated; no SDK was downloaded.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
