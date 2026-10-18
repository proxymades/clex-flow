const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const {stepperProject}=await import('./stepper-fixture.js');const fixture=stepperProject(),p=fixture.project;
 await fs.mkdir('.artifacts/stepper-work',{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});const page=await browser.newPage({viewport:{width:1800,height:1200}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(p=>localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)})),p);
 const card=id=>page.locator('.react-flow__node[data-id="'+id+'"]');
 const select=async id=>card(id).locator('.assembly-hardware-node').click({position:{x:35,y:20}});
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();};
 const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  await page.getByRole('button',{name:'Двигатели',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Добавить: NEMA 17',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Добавить: DRV8825',exact:true}).count(),0);
  await page.getByRole('button',{name:'Драйверы двигателей',exact:true}).click();for(const name of ['DRV8825','TB6600','MKS TMC2208 V2'])assert.equal(await page.getByRole('button',{name:'Добавить: '+name,exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:/Добавить: Внешний источник/}).count(),0);
  await page.getByRole('button',{name:/Показать весь/}).click();await select(fixture.motor.id);
  const a1=page.getByRole('combobox',{name:'Подключение: A1',exact:true});assert.equal(await a1.inputValue(),'component:'+fixture.driver.id+':a1');
  assert.equal(await a1.locator('option[value="component:'+fixture.driver.id+':b1"]').count(),0);
  await a1.selectOption('');await save();assert.equal((await saved()).assembly.connections.filter(w=>w.sourceComponentId).length,3);
  // Connect by clicking the physical contacts, with the driver as the starting endpoint.
  await card(fixture.driver.id).locator('.assembly-handle[data-handleid="a1"]').click({force:true});await card(fixture.motor.id).locator('.assembly-handle[data-handleid="a1"]').click({force:true});await save();
  assert.equal((await saved()).assembly.connections.filter(w=>w.sourceComponentId).length,4);
  await page.getByRole('button',{name:/Показать весь/}).click();await page.screenshot({path:'.artifacts/stepper-work/assembly.png'});
  await select(fixture.driver.id);await page.getByText(/Ток выставляется вручную/).waitFor();
  await page.getByRole('button',{name:'Логика',exact:true}).click();await card(fixture.motion.id).locator('.logic-drag-handle').click();
  assert.equal(await page.getByLabel('Шаговый драйвер',{exact:true}).inputValue(),fixture.driver.id);await page.getByLabel('Движение',{exact:true}).selectOption('revolutions');await page.getByLabel('Количество оборотов',{exact:true}).fill('2');
  assert.equal(await card(fixture.motion.id).locator('[data-port-id="stop"]').count(),1);assert.equal(await card(fixture.motion.id).locator('[data-port-id="release"]').count(),1);
  await save();assert.equal((await saved()).logic.nodes.find(n=>n.id===fixture.motion.id).parameters.revolutions,2);
  await page.screenshot({path:'.artifacts/stepper-work/logic.png'});assert.deepEqual(errors,[]);console.log('PASS: separate motor/driver categories, phase connection UI, actual physical contact clicks, saved wiring, manual setup notes and motion controls.');
 }catch(e){await page.screenshot({path:'.artifacts/stepper-work/ui-failure.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
