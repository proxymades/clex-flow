const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 if(process.env.CLEX_WIFI_UI_TEST!=='1')throw Error('Set CLEX_WIFI_UI_TEST=1 and use an isolated project-local test browser.');
 const executable=process.env.CLEX_BROWSER_EXECUTABLE;if(!executable)throw Error('Set CLEX_BROWSER_EXECUTABLE.');
 const root=await fs.realpath(process.cwd()),browserPath=await fs.realpath(executable);
 if(!browserPath.startsWith(root+path.sep))throw Error('Wi-Fi UI checks require a project-local test browser.');
 const {wifiProject}=await import('./wifi-fixture.js');const {project,wifi,node}=wifiProject({boardId:'doit-esp32-devkit-v1-30pin',mqtt:true});
 const mqtt=project.components.find(component=>component.moduleId==='clex.hardware.mqtt');
 const browser=await chromium.launch({headless:true,executablePath:browserPath}),page=await browser.newPage({viewport:{width:1800,height:1200}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1')){localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));localStorage.setItem('clex-flow:autosave-enabled','false');}},project);
 const card=id=>page.locator('.react-flow__node[data-id="'+id+'"]');
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('.dirty-dot').waitFor({state:'detached'});};
 await fs.mkdir('.artifacts/wifi/ui',{recursive:true});
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1454');await page.locator('.project-open').click();
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  await card(wifi.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});
  assert.equal(await page.getByLabel('Пароль Wi-Fi',{exact:true}).getAttribute('type'),'password');
  await page.getByLabel('Название сети (SSID)',{exact:true}).fill('Fixture Hotspot');await page.getByLabel('Пароль Wi-Fi',{exact:true}).fill('temporary-ui-wifi-key');
  await page.getByLabel('Показать пароль',{exact:true}).check();assert.equal(await page.getByLabel('Пароль Wi-Fi',{exact:true}).getAttribute('type'),'text');await page.getByLabel('Показать пароль',{exact:true}).uncheck();
  await page.getByLabel('Настройка IPv4',{exact:true}).selectOption('static');
  for(const [label,value]of [['IP-адрес','192.0.2.20'],['Маска подсети','255.255.255.0'],['Шлюз','192.0.2.1'],['DNS (необязательно)','192.0.2.53']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('Подключаться при запуске',{exact:true}).selectOption('false');
  await page.getByLabel('Переподключаться при потере сети',{exact:true}).selectOption('false');assert.equal(await page.getByLabel('Интервал повторных попыток, мс',{exact:true}).count(),0);
  await page.getByLabel('Переподключаться при потере сети',{exact:true}).selectOption('true');await page.getByLabel('Интервал повторных попыток, мс',{exact:true}).fill('7000');
  await save();await page.screenshot({path:'.artifacts/wifi/ui/settings.png'});
  await card(mqtt.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});assert.equal(await page.getByLabel('Сетевое подключение',{exact:true}).inputValue(),wifi.id);
  await page.getByRole('button',{name:'Логика',exact:true}).click();await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();await card(node.id).locator('.logic-drag-handle').click();
  for(const port of ['trigger','connect','disconnect','reconnect','changed','connected','disconnected','ipChanged','failed','state','isConnected','ip','reasonCode','error'])assert.equal(await card(node.id).locator('[data-port-id="'+port+'"]').count(),1,port);
  assert.ok(await page.getByText('Подключение настроено в «Монтаже»',{exact:true}).count());await page.screenshot({path:'.artifacts/wifi/ui/logic.png'});
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();await card(wifi.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});
  assert.equal(await page.getByLabel('Название сети (SSID)',{exact:true}).inputValue(),'Fixture Hotspot');assert.equal(await page.getByLabel('IP-адрес',{exact:true}).inputValue(),'192.0.2.20');assert.equal(await page.getByLabel('Интервал повторных попыток, мс',{exact:true}).inputValue(),'7000');assert.equal(await page.getByLabel('Пароль Wi-Fi',{exact:true}).getAttribute('type'),'password');
  assert.deepEqual(errors,[]);console.log('PASS Wi-Fi UI: masked password, IPv4, reconnect settings, MQTT selection, logic controls and persistence.');
 }catch(error){await page.screenshot({path:'.artifacts/wifi/ui/failure.png'});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
