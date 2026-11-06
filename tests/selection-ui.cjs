/* global document, innerWidth */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{chromium}=require('playwright');
(async()=>{
 const {selectionProject}=await import('./selection-fixture.js'),{project,select}=selectionProject('text');
 project.logic.nodes.forEach((node,i)=>node.position=node.id===select.id?{x:100,y:20}:{x:2000,y:i*300});project.logic.viewport={x:20,y:20,zoom:1};
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]}),page=await browser.newPage({viewport:{width:1600,height:1200}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1')){localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));localStorage.setItem('clex-flow:autosave-enabled','false');}},project);
 const card=page.locator('.react-flow__node[data-id="'+select.id+'"]'),saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();};
 const open=async()=>{await page.locator('.project-open').click();await page.getByRole('button',{name:'Логика',exact:true}).click();await card.locator('header').click();};
 try{
  await fs.mkdir('.artifacts/selection-ui',{recursive:true});await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');await open();
  assert.equal(await page.getByLabel('Тип значения',{exact:true}).inputValue(),'text');
  assert.equal(await card.locator('[data-port-id="value"]').getAttribute('data-port-type'),'text');
  await page.getByLabel('Значение варианта 2',{exact:true}).fill('STOP');await save();
  let current=await saved();assert.deepEqual(current.logic.edges,project.logic.edges);
  await page.getByRole('button',{name:'Добавить вариант',exact:true}).click();await page.getByLabel('Значение варианта 5',{exact:true}).fill('Включи "свет"');
  await card.locator('[data-port-id="case5"]').waitFor();await save();current=await saved();assert.equal(JSON.parse(current.logic.nodes.find(n=>n.id===select.id).parameters.cases)[4].value,'Включи "свет"');
  await page.getByLabel('Значение варианта 5',{exact:true}).fill('ON');await page.getByRole('alert').filter({hasText:'Укажите разные значения'}).waitFor();assert.equal(await card.locator('[data-port-id="case3"]').count(),1);
  await page.getByLabel('Значение варианта 5',{exact:true}).fill('TEST');await save();
  await page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();await page.getByRole('button',{name:'main/main.c',exact:true}).click();assert.match(await page.locator('.firmware-source').innerText(),/strcmp\(selected,"GROUP ON"\)/);await page.keyboard.press('Escape');
  await card.screenshot({path:'.artifacts/selection-ui/text.png'});
  await page.getByRole('button',{name:'Удалить вариант 2',exact:true}).click();await save();current=await saved();
  assert.ok(!current.logic.edges.some(e=>e.source===select.id&&e.sourceHandle==='case2'));assert.ok(current.logic.edges.some(e=>e.source===select.id&&e.sourceHandle==='case3'));
  await page.getByLabel('Тип значения',{exact:true}).selectOption('number');assert.equal(await card.locator('[data-port-id="value"]').getAttribute('data-port-type'),'number');assert.equal(await card.locator('[data-port-id="case1"]').count(),1);
  await page.getByRole('button',{name:'Отменить изменение графа',exact:true}).click();await card.locator('header').click();assert.equal(await page.getByLabel('Тип значения',{exact:true}).inputValue(),'text');assert.equal(await card.locator('[data-port-id="case3"]').count(),1);
  await page.getByLabel('Тип значения',{exact:true}).selectOption('boolean');assert.equal(await card.locator('[data-port-id="yes"]').count(),1);assert.equal(await card.locator('[data-port-id="no"]').count(),1);assert.equal(await card.locator('[data-port-id="other"]').count(),0);assert.equal(await page.getByRole('button',{name:'Добавить вариант',exact:true}).count(),0);
  await save();current=await saved();assert.equal(current.logic.edges.filter(e=>e.target===select.id&&e.targetHandle==='trigger').length,1);assert.ok(!current.logic.edges.some(e=>e.source===select.id||e.target===select.id&&e.targetHandle==='value'));
  await card.screenshot({path:'.artifacts/selection-ui/boolean.png'});await page.reload();await open();assert.equal(await page.getByLabel('Тип значения',{exact:true}).inputValue(),'boolean');await page.setViewportSize({width:1100,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS selection UI: typed inputs, editable/addable cases, duplicate validation, stable connected outputs, removal cleanup, generated C preview, type-change cleanup, undo, save/reload and small layout.');
 }catch(error){await page.screenshot({path:'.artifacts/selection-ui/failure.png'});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
