const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 if(process.env.CLEX_MQTT_UI_TEST!=='1')throw new Error('MQTT UI smoke requires CLEX_MQTT_UI_TEST=1 and an isolated project-local test browser.');
 const executable=process.env.CLEX_BROWSER_EXECUTABLE;
 if(!executable)throw new Error('Set CLEX_BROWSER_EXECUTABLE to an isolated project-local test browser.');
 const root=await fs.realpath(process.cwd()),browserPath=await fs.realpath(executable);
 if(!browserPath.startsWith(root+path.sep))throw new Error('MQTT UI smoke cannot launch an installed or external application. Use an isolated project-local test browser.');
 const {catalog}=await import('./catalog-fixture.js'),{createProject}=await import('../src/projects/model.js'),{addHardware}=await import('../src/assembly/model.js'),{addNode,connectNodes,withLogic}=await import('../src/logic/model.js');
 const mod=id=>catalog.modules.find(module=>module.id===id);
 let project=createProject('MQTT UI','', 'waveshare-esp32-s3-eth',{camera:'disconnected'});
 project=addHardware(project,mod('clex.hardware.ethernet'),catalog);
 project=addHardware(project,mod('clex.hardware.mqtt'),catalog);const mqtt=project.components.at(-1);Object.assign(mqtt.parameters,{host:'broker.example.org',protocol:'5.0'});
 for(const id of ['control','send','receive'])project=withLogic(project,addNode(project.logic,mod('clex.logic.mqtt-'+id),project.components,project,catalog));
 const [control,send,receive]=project.logic.nodes;send.parameters.topic='clex/test';receive.parameters.filters='[{"topic":"clex/+","qos":1}]';
 project=withLogic(project,connectNodes(project.logic,catalog,{source:control.id,sourceHandle:'connected',target:send.id,targetHandle:'trigger'},project));
 const browser=await chromium.launch({headless:true,executablePath:browserPath});const page=await browser.newPage({viewport:{width:1800,height:1200}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(p=>{
  if(!localStorage.getItem('clex-flow:projects:v1')){
   localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));
   localStorage.setItem('clex-flow:autosave-enabled','false');
  }
 },project);
 const card=id=>page.locator('.react-flow__node[data-id="'+id+'"]'),saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();await page.locator('.dirty-dot').waitFor({state:'detached'});};
 await fs.mkdir('.artifacts/mqtt-ui',{recursive:true});
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1442');await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  await card(mqtt.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});
  assert.equal(await page.getByLabel('Пароль',{exact:true}).getAttribute('type'),'password');
  await page.getByLabel('Логин',{exact:true}).fill('mqtt-ui');await page.getByLabel('Пароль',{exact:true}).fill('temporary-key');
  await page.getByLabel('TLS',{exact:true}).selectOption('true');assert.equal(await page.getByLabel('Порт',{exact:true}).inputValue(),'8883');
  await page.getByLabel('Проверка сертификата',{exact:true}).selectOption('pem');await page.getByLabel('Корневые сертификаты CA (PEM)',{exact:true}).fill('-----BEGIN CERTIFICATE-----\n'+Buffer.alloc(96).toString('base64')+'\n-----END CERTIFICATE-----');
  await page.getByLabel('Проверка сертификата',{exact:true}).selectOption('bundle');
  await page.getByLabel('Начинать новую сессию',{exact:true}).selectOption('false');await page.getByLabel('Client ID (пусто – автоматически)',{exact:true}).fill('ui-client');await page.getByLabel('Срок хранения сессии MQTT 5, с',{exact:true}).fill('600');
  await page.getByLabel('Последняя воля (LWT)',{exact:true}).selectOption('true');await page.getByLabel('LWT topic',{exact:true}).fill('clex/status');await page.getByLabel('LWT payload',{exact:true}).fill('offline');
  await page.getByRole('button',{name:'Добавить: MQTT',exact:true}).click();
  await page.getByLabel('Адрес брокера',{exact:true}).fill('localhost');
  await save();let current=await saved();assert.equal(current.components.filter(c=>c.moduleId==='clex.hardware.mqtt').length,2);assert.equal(current.assembly.connections.length,0);
  await card(mqtt.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});await page.screenshot({path:'.artifacts/mqtt-ui/montage.png'});
  await page.getByRole('button',{name:'Логика',exact:true}).click();await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();
  await card(receive.id).locator('.logic-drag-handle').click();await page.getByRole('button',{name:'Добавить подписку MQTT',exact:true}).click();await page.getByLabel('MQTT topic-фильтр 2',{exact:true}).fill('clex/events/#');await page.getByLabel('MQTT QoS подписки 2',{exact:true}).selectOption('2');await page.getByLabel('Кодировка payload',{exact:true}).selectOption('base64');await page.getByLabel('No Local MQTT 5',{exact:true}).selectOption('true');
  for(const id of ['subscribe','unsubscribe','received','subscribed','unsubscribed','topic','payload','properties','failed'])assert.ok(await card(receive.id).locator('[data-port-id="'+id+'"]').count(),id);
  await page.screenshot({path:'.artifacts/mqtt-ui/subscriptions.png'});
  await card(send.id).locator('.logic-drag-handle').click();await page.getByLabel('Payload',{exact:true}).fill('AP8=');await page.getByLabel('Кодировка payload',{exact:true}).selectOption('base64');await page.getByLabel('Content Type MQTT 5',{exact:true}).fill('application/octet-stream');await page.getByRole('button',{name:'Добавить свойство MQTT',exact:true}).click();await page.getByLabel('MQTT User Property key 1',{exact:true}).fill('source');await page.getByLabel('MQTT User Property value 1',{exact:true}).fill('CLEX');
  await card(control.id).locator('.logic-drag-handle').click();for(const id of ['connect','disconnect','state','isConnected','connected','disconnected','failed','error','reasonCode'])assert.ok(await card(control.id).locator('[data-port-id="'+id+'"]').count(),id);
  await save();current=await saved();assert.equal(JSON.parse(current.logic.nodes.find(n=>n.id===receive.id).parameters.filters).length,2);assert.equal(current.logic.nodes.find(n=>n.id===receive.id).parameters.payloadEncoding,'base64');assert.equal(JSON.parse(current.logic.nodes.find(n=>n.id===send.id).parameters.userProperties)[0].key,'source');
  assert.equal(current.components.find(c=>c.id===mqtt.id).parameters.port,8883);assert.equal(current.components.find(c=>c.id===mqtt.id).parameters.sessionExpiry,600);
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();await card(mqtt.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});assert.equal(await page.getByLabel('Логин',{exact:true}).inputValue(),'mqtt-ui');assert.equal(await page.getByLabel('Порт',{exact:true}).inputValue(),'8883');assert.equal(await page.getByLabel('Срок хранения сессии MQTT 5, с',{exact:true}).inputValue(),'600');current=await saved();assert.equal(current.components.filter(c=>c.moduleId==='clex.hardware.mqtt').length,2);assert.equal(JSON.parse(current.logic.nodes.find(n=>n.id===receive.id).parameters.filters).length,2);assert.equal(current.logic.nodes.find(n=>n.id===send.id).parameters.payload,'AP8=');assert.deepEqual(errors,[]);
  console.log('PASS MQTT UI: TLS/session/LWT, several components without wires, three logic types, editable subscriptions, MQTT 5 properties, binary encoding and persistence.');
 }catch(error){await page.screenshot({path:'.artifacts/mqtt-ui/failure.png'});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
