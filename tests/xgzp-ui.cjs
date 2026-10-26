const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const executable=process.env.CLEX_BROWSER_EXECUTABLE;
 if(!executable)throw Error('Set CLEX_BROWSER_EXECUTABLE to an isolated project-local browser.');
 const root=await fs.realpath(process.cwd()),browserPath=await fs.realpath(executable);
 if(!browserPath.startsWith(root+path.sep))throw Error('Use a project-local browser.');
 const {xgzpProject}=await import('./xgzp-fixture.js'),{project,component,sensor}=xgzpProject(process.env.CLEX_XGZP_UI_BOARD||'doit-esp32-devkit-v1-30pin');
 const {catalog}=await import('./catalog-fixture.js'),board=catalog.boards.find(b=>b.id===project.boardId),voltage=board.logicVoltage||3.3;
 if(process.env.CLEX_XGZP_LEGACY==='1'){
  for(const item of [...project.components,...project.logic.nodes])if(item.moduleId.includes('xgzp6847d')){item.moduleId=item.moduleId.replace('6847','6897');item.name=item.name.replace('6847','6897');}
  project.moduleVersions=Object.fromEntries(Object.entries(project.moduleVersions).map(([id,version])=>[id.replace('xgzp6847d','xgzp6897d'),version]));
 }
 const browser=await chromium.launch({headless:true,executablePath:browserPath}),page=await browser.newPage({viewport:{width:1800,height:1200}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1')){localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));localStorage.setItem('clex-flow:autosave-enabled','false');}},project);
 const card=id=>page.locator('.react-flow__node[data-id="'+id+'"]');
 await fs.mkdir('.artifacts/xgzp/ui',{recursive:true});
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1454');await page.locator('.project-open').click();
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  await card(component.id).locator('.assembly-hardware-node').click({position:{x:30,y:20}});
  assert.ok((await card(component.id).innerText()).includes('XGZP6847D'));
  assert.equal(await card(component.id).locator('[data-terminal]').count(),6);
  assert.equal(await card(component.id).locator('.assembly-handle').count(),4);
  assert.equal(await page.locator('.workspace-properties').getByText('Не подключать',{exact:true}).count(),2);
  assert.equal(await page.getByLabel('Питание VDD',{exact:true}).inputValue(),String(voltage));
  assert.equal(await page.getByLabel('Питание VDD',{exact:true}).locator('option[value="'+(voltage===5?'3.3':'5')+'"]').evaluate(option=>option.disabled),true,await page.getByLabel('Питание VDD',{exact:true}).evaluate(el=>el.outerHTML));
  for(const pin of board.pins.filter(p=>p.kind==='power'&&p.voltage!==voltage))assert.equal(await page.getByLabel('Подключение: 4 · VDD',{exact:true}).locator('option').filter({hasText:pin.label+' · '+pin.id}).evaluate(option=>option.disabled),true);
  assert.equal(await page.getByLabel('Согласование уровней I²C',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('Коэффициент K по диапазону датчика',{exact:true}).inputValue(),'16');
  await page.screenshot({path:'.artifacts/xgzp/ui/assembly.png'});
  await page.getByRole('button',{name:'Логика',exact:true}).click();await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();await card(sensor.id).locator('.logic-drag-handle').click();
  for(const port of ['trigger','changed','done','failed','pressure','pressurePa','temperature','temperatureText','valid','error'])assert.equal(await card(sensor.id).locator('[data-port-id="'+port+'"]').count(),1,port);
  await page.getByLabel('Единица давления',{exact:true}).selectOption('psi');
  await page.getByLabel('Измерять автоматически',{exact:true}).selectOption('false');assert.equal(await page.getByLabel('Период измерения, мс',{exact:true}).count(),0);
  await page.getByLabel('Измерять автоматически',{exact:true}).selectOption('true');await page.getByLabel('Период измерения, мс',{exact:true}).fill('500');
  assert.ok(await page.getByText('Подключение настроено в «Монтаже»',{exact:true}).count());
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('.dirty-dot').waitFor({state:'detached'});
  await page.screenshot({path:'.artifacts/xgzp/ui/logic.png'});
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Логика',exact:true}).click();await card(sensor.id).locator('.logic-drag-handle').click();
  assert.equal(await page.getByLabel('Единица давления',{exact:true}).inputValue(),'psi');assert.equal(await page.getByLabel('Период измерения, мс',{exact:true}).inputValue(),'500');
  const saved=await page.evaluate(id=>JSON.parse(JSON.parse(localStorage.getItem('clex-flow:projects:v1'))[id]),project.id);
  assert.equal(saved.components[0].moduleId,'clex.hardware.xgzp6847d');assert.equal(saved.logic.nodes[0].moduleId,'clex.logic.xgzp6847d');
  assert.deepEqual(errors,[]);console.log('PASS XGZP UI: '+voltage+' V power restriction on '+board.id+', K=16, logic ports, units and persistence.');
 }catch(error){await page.screenshot({path:'.artifacts/xgzp/ui/failure.png'});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
