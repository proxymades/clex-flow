/* global document */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{chromium}=require('playwright');
(async()=>{
 const {selectNumberProject}=await import('./select-number-fixture.js'),{project,nodes}=selectNumberProject();
 const old=nodes.select;
 old.moduleVersion='1.0.0';old.name='Прежний выбор';old.parameters={firstValue:3,secondValue:7};
 project.moduleVersions[old.moduleId]='1.0.0';
 project.logic.edges=project.logic.edges.map(edge=>edge.source===old.id?{...edge,sourceHandle:({case1:'first',case2:'second'})[edge.sourceHandle]||edge.sourceHandle}:edge);
 const order=[nodes.timer,nodes.counter,old,nodes.first,nodes.second,nodes.other];
 order.forEach((node,i)=>node.position={x:(i%3)*420+60,y:Math.floor(i/3)*520+50});
 project.logic.viewport={x:20,y:20,zoom:0.65};
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]}),page=await browser.newPage({viewport:{width:1800,height:1300}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1')){localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));localStorage.setItem('clex-flow:autosave-enabled','false');}},project);
 const card=id=>page.locator('.react-flow__node[data-id="'+id+'"]');
 const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();};
 const open=async()=>{await page.locator('.project-open').click();await page.getByRole('button',{name:'Логика',exact:true}).click();};
 const port=(id,handle)=>card(id).locator('[data-port-id="'+handle+'"] button');
 const preview=page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true});
 try{
  await fs.mkdir('.artifacts/block-versions',{recursive:true});
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');await open();await card(old.id).locator('header').click();
  await card(old.id).locator('.logic-version-warning').waitFor();
  assert.match(await card(old.id).locator('.logic-version-warning').innerText(),/v1\.0\.0.*v2\.0\.0/);
  assert.match(await card(old.id).locator('.logic-version-warning').innerText(),/формат настроек/);
  assert.equal(await page.getByLabel('Тип значения',{exact:true}).count(),0);
  assert.equal(await card(old.id).locator('.react-flow__handle').count(),5);
  assert.equal(await card(old.id).locator('.react-flow__handle.connectable').count(),0);
  assert.equal(await preview.isDisabled(),true);assert.match(await preview.getAttribute('title'),/Замените/);
  await page.waitForFunction(count=>document.querySelectorAll('.react-flow__edge-path').length===count,project.logic.edges.length);
  await page.screenshot({path:'.artifacts/block-versions/old-block.png'});
  const library=page.locator('.logic-library .hardware-library-item');
  assert.ok((await library.count())>0);
  for(const entry of await library.all())assert.match(await entry.locator('small').innerText(),/v\d+\.\d+\.\d+/);
  const add=page.getByRole('button',{name:'Добавить блок: Выбор по значению',exact:true});
  assert.match(await add.locator('small').innerText(),/v2\.0\.0/);await add.click();
  assert.equal(await page.getByLabel('Тип значения',{exact:true}).inputValue(),'number');
  await page.getByLabel('Значение варианта 1',{exact:true}).fill('3');await page.getByLabel('Значение варианта 2',{exact:true}).fill('7');
  await save();let current=await saved();
  const replacement=current.logic.nodes.find(node=>node.moduleId===old.moduleId&&node.id!==old.id);
  assert.ok(replacement);assert.equal(replacement.moduleVersion,'2.0.0');assert.deepEqual(current.logic.edges,project.logic.edges);
  assert.deepEqual(current.logic.nodes.find(node=>node.id===old.id).parameters,old.parameters);
  await page.reload();await open();await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();
  await card(old.id).locator('.logic-version-warning').waitFor();await card(replacement.id).waitFor();
  assert.equal(await card(replacement.id).locator('.logic-version-warning').count(),0);
  await page.screenshot({path:'.artifacts/block-versions/side-by-side.png'});
  for(const [source,output,target,input] of [
   [nodes.counter.id,'done',replacement.id,'trigger'],[nodes.counter.id,'value',replacement.id,'value'],
   [replacement.id,'case1',nodes.first.id,'trigger'],[replacement.id,'case2',nodes.second.id,'trigger'],[replacement.id,'other',nodes.other.id,'trigger'],
  ]){await port(source,output).click();await port(target,input).click();}
  assert.equal(await preview.isDisabled(),true);
  await card(old.id).locator('header').click();await page.getByRole('button',{name:'Удалить блок',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.logic-version-warning'));
  await preview.waitFor({state:'visible'});assert.equal(await preview.isEnabled(),true);
  await page.getByRole('button',{name:'Отменить изменение графа',exact:true}).click();await card(old.id).locator('.logic-version-warning').waitFor();assert.equal(await preview.isDisabled(),true);
  await page.getByRole('button',{name:'Повторить изменение графа',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.logic-version-warning'));assert.equal(await preview.isEnabled(),true);
  await save();current=await saved();assert.ok(!current.logic.nodes.some(node=>node.id===old.id));assert.equal(current.logic.edges.length,6);
  await preview.click();await page.getByRole('button',{name:'main/main.c',exact:true}).click();assert.match(await page.locator('.firmware-source').innerText(),/selected\s*==\s*7\.0/);await page.keyboard.press('Escape');
  await page.reload();await open();assert.equal(await preview.isEnabled(),true);assert.equal(await page.locator('.logic-version-warning').count(),0);assert.deepEqual(errors,[]);
  console.log('PASS logic versions UI: warnings, saved old contacts and lines, library versions, mixed-version save/reload, manual rewiring, replacement, build gating and undo/redo.');
 }catch(error){await page.screenshot({path:'.artifacts/block-versions/failure.png'});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
