const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const {routerProject}=await import('./router-fixture.js');const {validateAssembly}=await import('../src/assembly/model.js');const {catalog}=await import('./catalog-fixture.js');const {project,router,node}=routerProject({wan:'ethernet'});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});const page=await browser.newPage({viewport:{width:1800,height:1200}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)})),project);
 const card=id=>page.locator('.react-flow__node[data-id="'+id+'"]');const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 await fs.mkdir('.artifacts/router-ui',{recursive:true});
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430');await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();await card(router.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});
  assert.equal(await page.getByLabel('Пароль администратора',{exact:true}).getAttribute('type'),'password');await page.getByLabel('SSID локальной сети',{exact:true}).fill('Тест LAN');await page.getByLabel('Резервный WAN',{exact:true}).selectOption('wifi');await page.getByLabel('SSID WAN',{exact:true}).fill('WAN Test');
  await page.getByRole('button',{name:'Добавить проброс',exact:true}).click();await page.getByLabel('Внешний порт 1',{exact:true}).fill('8088');await page.getByLabel('IP клиента 1',{exact:true}).fill('192.168.50.25');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();let p=await saved();assert.equal(p.components.find(c=>c.id===router.id).parameters.apSsid,'Тест LAN');assert.equal(JSON.parse(p.components.find(c=>c.id===router.id).parameters.portMappings)[0].externalPort,8088);
  assert.deepEqual(validateAssembly(p,catalog).filter(i=>i.severity==='error'),[]);await page.screenshot({path:'.artifacts/router-ui/settings.png'});await page.getByRole('button',{name:'Логика',exact:true}).click();await card(node.id).locator('.logic-drag-handle').click();assert.equal(await page.getByLabel('Маршрутизатор из монтажа',{exact:true}).inputValue(),router.id);
  for(const id of ['wanIp','lanIp','clientCount','internet','clients','start','stop','applyAp','applyWan'])assert.ok(await card(node.id).locator('[data-port-id="'+id+'"]').count(),id);
  await page.screenshot({path:'.artifacts/router-ui/logic.png'});assert.deepEqual(errors,[]);console.log('PASS router UI: WAN/LAN settings, hidden secrets, Wi-Fi fallback, port-forward editor, persisted project and real logic ports.');
 }catch(error){await page.screenshot({path:'.artifacts/router-ui/failure.png'});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
