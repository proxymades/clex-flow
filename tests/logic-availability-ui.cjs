const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {createProject}=await import('../src/projects/model.js');const {catalog}=await import('./catalog-fixture.js');
 const project=createProject('Доступность блоков','','waveshare-esp32-s3-eth',{camera:'disconnected'});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(p=>localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)})),project);
 const logic=()=>page.getByRole('button',{name:'Логика',exact:true}).click();const assembly=()=>page.getByRole('button',{name:'Монтаж',exact:true}).click();
 const item=id=>page.getByRole('button',{name:'Добавить блок: '+catalog.modules.find(m=>m.id==='clex.logic.'+id).name,exact:true});
 const radio=['espnow-send','espnow-receive','espnow-ack','espnow-control'];
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1431');await page.locator('.project-open').click();await logic();
  for(const id of [...radio,'gpio-read','gpio-edge','gpio-set','gpio-toggle','display','ethernet','internet-check']){assert.equal(await item(id).isDisabled(),true,id);assert.match(await item(id).getAttribute('title'),/Сначала добавьте.*Монтаж/,id);}
  for(const id of ['timer','counter','serial','stopwatch'])assert.equal(await item(id).isEnabled(),true,id);
  await page.screenshot({path:'.artifacts/espnow-four/logic-without-hardware.png'});
  const groups=[['clex.hardware.espnow',radio],['clex.hardware.led',['gpio-set','gpio-toggle']],['clex.hardware.button',['gpio-read','gpio-edge']],['clex.hardware.ethernet',['ethernet','internet-check']]];
  const display=catalog.modules.find(m=>m.kind==='hardware'&&m.display?.interface==='spi'&&m.display.resolution.width===240);assert.ok(display);groups.push([display.id,['display']]);
  for(const [hardwareId,ids] of groups){
   await assembly();await page.getByRole('button',{name:'Добавить: '+catalog.modules.find(m=>m.id===hardwareId).name,exact:true}).click();await logic();
   for(const id of ids){assert.equal(await item(id).isEnabled(),true,id);assert.equal(await item(id).getAttribute('title'),null,id);}
  }
  await item('espnow-send').click();assert.equal(await page.locator('.react-flow__node').count(),1);
  await assembly();await page.getByRole('button',{name:'Компонент ESP-NOW 1',exact:true}).click();await page.getByRole('button',{name:'Удалить компонент',exact:true}).click();await logic();
  for(const id of radio)assert.equal(await item(id).isDisabled(),true,id);assert.equal(await page.locator('.react-flow__node').count(),1,'existing node is preserved');
  for(const id of ['timer','counter','ethernet','internet-check','display'])assert.equal(await item(id).isEnabled(),true,id);
  assert.deepEqual(errors,[]);console.log('PASS: missing hardware disables blocks with Russian hints; timer/counter/Serial/stopwatch stay available; mounting ESP-NOW/GPIO/Ethernet/display unlocks dependent logic; removing ESP-NOW disables additions without deleting existing blocks. Browser only, no device access.');
 }catch(error){await page.screenshot({path:'.artifacts/espnow-four/availability-failure.png'});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
