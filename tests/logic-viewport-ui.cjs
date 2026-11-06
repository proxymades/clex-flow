/* global document, getComputedStyle */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{chromium}=require('playwright');
(async()=>{
 const {createProject}=await import('../src/projects/model.js'),{addNode,withLogic}=await import('../src/logic/model.js'),{catalog,timer}=await import('./catalog-fixture.js');
 let project=createProject('Масштаб логики');
 project=withLogic(project,addNode(project.logic,timer,[],project,catalog));project.logic.nodes[0].position={x:4000,y:3500};project.logic.viewport={x:-1100,y:-640,zoom:1.3};
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]}),page=await browser.newPage({viewport:{width:1700,height:1200}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>{localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));localStorage.setItem('clex-flow:autosave-enabled','false');},project);
 const camera=()=>page.locator('.react-flow__viewport').evaluate(element=>getComputedStyle(element).transform);
 const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.breadcrumb').hasAttribute('data-dirty'));return saved();};
 const selected=()=>page.locator('.react-flow__node.selected').first();
 const visibleHeader=async()=>{
  const header=await selected().locator('header').boundingBox(),view=await page.locator('.reactflow-region').boundingBox();
  assert.ok(header.x>=view.x&&header.x<view.x+view.width&&header.y>=view.y&&header.y<view.y+view.height,JSON.stringify({header,view}));
 };
 const button=name=>page.getByRole('button',{name,exact:true}),command=process.platform==='darwin'?'Meta':'Control';
 try{
  await fs.mkdir('.artifacts/logic-viewport',{recursive:true});await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');await page.locator('.project-open').click();await button('Логика').click();await page.locator('.react-flow__viewport').waitFor();
  const initial=await camera();
  await button('Добавить блок: Таймер').click();await visibleHeader();assert.equal(await camera(),initial);
  let current=await save();assert.deepEqual(current.logic.viewport,project.logic.viewport);assert.equal(current.logic.nodes.length,2);
  await button('Дублировать выделенные блоки').click();await visibleHeader();assert.equal(await camera(),initial);current=await save();assert.equal(current.logic.nodes.length,3);
  await button('Отменить изменение графа').click();assert.equal(await camera(),initial);
  await button('Повторить изменение графа').click();assert.equal(await camera(),initial);await page.locator('.react-flow__node[data-id="'+current.logic.nodes.at(-1).id+'"]').locator('header').click();
  await page.keyboard.press(command+'+d');await visibleHeader();assert.equal(await camera(),initial);current=await save();assert.equal(current.logic.nodes.length,4);
  await button('Копировать выделенные блоки').click();
  const view=await page.locator('.reactflow-region').boundingBox();await page.keyboard.down('Space');await page.mouse.move(view.x+60,view.y+view.height-45);await page.mouse.down();await page.mouse.move(view.x+view.width-60,view.y+view.height-95,{steps:10});await page.mouse.up();await page.keyboard.up('Space');
  const panned=await camera();assert.notEqual(panned,initial);
  await button('Вставить блоки').click();await visibleHeader();assert.equal(await camera(),panned);current=await save();assert.equal(current.logic.nodes.length,5);
  const copyId=await selected().getAttribute('data-id');await button('Удалить выделение графа').click();assert.equal(await camera(),panned);
  await button('Отменить изменение графа').click();await page.locator('.react-flow__node[data-id="'+copyId+'"]').waitFor();assert.equal(await camera(),panned);
  await page.screenshot({path:'.artifacts/logic-viewport/preserved.png'});
  await button('Показать весь граф').click();await page.waitForFunction(before=>getComputedStyle(document.querySelector('.react-flow__viewport')).transform!==before,panned);
  assert.deepEqual(errors,[]);
  console.log('PASS logic viewport: add, toolbar/keyboard duplicate, offscreen paste, undo/redo and delete preserve camera; inserted blocks stay visible; explicit fit remains available.');
 }catch(e){await page.screenshot({path:'.artifacts/logic-viewport/failure.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
