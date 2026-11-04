/* global document, window */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const {temperatureProject}=await import('./temperature-fixture.js');
 const {conditionProject}=await import('./condition-fixture.js');
 const {catalog}=await import('./catalog-fixture.js');
 const {generateFirmware}=await import('../src/firmware/generator.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE}),errors=[];
 await fs.mkdir('.artifacts/conditions/ui',{recursive:true});
 async function open(project){
  const page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1')){localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));localStorage.setItem('clex-flow:autosave-enabled','false');}},project);
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430');await page.locator('.project-open').click();await page.getByRole('button',{name:'Логика',exact:true}).click();return page;
 }
 const card=(page,node)=>page.locator('.react-flow__node[data-id="'+node.id+'"]');
 async function save(page){await page.getByRole('button',{name:'Сохранить',exact:true}).first().click();await page.getByText('Проект сохранен',{exact:true}).waitFor();return page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));}
 try{
  const temperature=temperatureProject(),sensor=temperature.logic.nodes[0],page=await open(temperature),node=card(page,sensor);
  await node.locator('header').click();
  assert.equal(await node.locator('[data-port-section="signals"] [data-port-type="boolean"]').count(),0);
  assert.equal(await node.locator('[data-port-section="data"] [data-port-type="event"]').count(),0);
  assert.equal(await node.locator('[data-port-section="data"] [data-port-id="valid"]').count(),1);
  assert.ok((await node.textContent()).includes('Команды'));assert.ok((await node.textContent()).includes('События'));assert.ok((await node.textContent()).includes('Данные'));
  await node.screenshot({path:'.artifacts/conditions/ui/temperature-card.png'});
  await page.screenshot({path:'.artifacts/conditions/ui/temperature-groups.png'});
  await page.getByRole('button',{name:'Добавить блок: Условие',exact:true}).click();
  const added=await save(page),condition=added.logic.nodes.find(n=>n.moduleId==='clex.logic.compare-number');assert.ok(condition);
  await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();await card(page,condition).locator('header').click();assert.equal(await page.getByLabel('Тип данных условия 1',{exact:true}).inputValue(),'boolean');
  await page.close();

  const fixture=conditionProject(),p=await open(fixture.project),conditionCard=card(p,fixture.nodes.condition);
  await p.getByRole('button',{name:'Показать весь граф',exact:true}).click();await conditionCard.locator('header').click();
  assert.equal(await p.getByLabel('Тип данных условия 1',{exact:true}).inputValue(),'number');
  assert.equal(await p.getByLabel('Тип данных условия 2',{exact:true}).inputValue(),'boolean');
  assert.equal(await p.getByLabel('Тип данных условия 3',{exact:true}).inputValue(),'text');
  await p.getByLabel('Объединение условий',{exact:true}).selectOption('any');
  await p.getByLabel('НЕ для условия 2',{exact:true}).check();
  const before=await save(p);assert.deepEqual(before.logic.edges,fixture.project.logic.edges);
  generateFirmware(before,catalog);
  await p.getByLabel('Значение условия 3',{exact:true}).fill('я'.repeat(129));
  assert.equal(await p.locator('.condition-row').count(),3);
  const invalid=await save(p);assert.deepEqual(invalid.logic.edges,before.logic.edges);
  await p.getByLabel('Значение условия 3',{exact:true}).fill('Па');
  await p.getByLabel('Тип данных условия 2',{exact:true}).selectOption('text');
  assert.equal(await conditionCard.locator('[data-port-id="c2.value"]').getAttribute('data-port-type'),'text');
  const changed=await save(p);assert.ok(!changed.logic.edges.some(e=>e.target===fixture.nodes.condition.id&&e.targetHandle==='c2.value'));
  await p.getByRole('button',{name:'Отменить изменение графа',exact:true}).click();
  const undone=await save(p);assert.deepEqual(undone.logic.edges,before.logic.edges);generateFirmware(undone,catalog);
  await p.reload();await p.locator('.project-open').click();await p.getByRole('button',{name:'Логика',exact:true}).click();await conditionCard.locator('header').click();
  assert.equal(await p.getByLabel('Объединение условий',{exact:true}).inputValue(),'any');assert.equal(await p.getByLabel('НЕ для условия 2',{exact:true}).isChecked(),true);
  await p.screenshot({path:'.artifacts/conditions/ui/mixed-condition.png'});
  await p.setViewportSize({width:1100,height:850});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await p.screenshot({path:'.artifacts/conditions/ui/mixed-condition-small.png'});await p.close();
  assert.deepEqual(errors,[]);console.log('PASS: commands/events/data groups, Boolean values, adding and editing mixed conditions, atomic undo, persistence, firmware generation and compact layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
