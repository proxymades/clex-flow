const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const executable=process.env.CLEX_BROWSER_EXECUTABLE;
 if(!executable)throw Error('Set CLEX_BROWSER_EXECUTABLE to a project-local test browser.');
 const root=await fs.realpath(process.cwd()),browserPath=await fs.realpath(executable);
 if(!browserPath.startsWith(root+path.sep))throw Error('Use a project-local test browser.');
 const {numericProject}=await import('./numeric-fixture.js');
 const board=process.env.CLEX_NUMERIC_UI_BOARD||'doit-esp32-devkit-v1-30pin';
 const {project,nodes}=numericProject(board,{mqtt:!board.startsWith('arduino')});
 const browser=await chromium.launch({headless:true,executablePath:browserPath}),page=await browser.newPage({viewport:{width:1900,height:1400}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(p=>{
  if(!localStorage.getItem('clex-flow:projects:v1')){
   localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));
   localStorage.setItem('clex-flow:autosave-enabled','false');
  }
 },project);
 const card=node=>page.locator('.react-flow__node[data-id="'+node.id+'"]');
 await fs.mkdir('.artifacts/numeric/ui',{recursive:true});
 try {
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1457');await page.locator('.project-open').click();
  await page.getByRole('button',{name:'Логика',exact:true}).click();
  for(const name of ['Текст в число','Сравнение числа'])assert.equal(await page.getByRole('button',{name:'Добавить блок: '+name,exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();
  await card(nodes.parse).locator('.logic-drag-handle').click();
  assert.ok(!(await card(nodes.parse).innerText()).includes('Пустое сообщение'));
  assert.ok(!(await card(nodes.condition).innerText()).includes('Пустое сообщение'));
  assert.equal(await page.getByLabel('Формат текста',{exact:true}).inputValue(),'affixes');
  assert.equal(await page.getByLabel('Текст после числа',{exact:true}).inputValue(),'Па');
  assert.equal(await page.getByLabel('Текст после числа',{exact:true}).getAttribute('rows'),'1');
  assert.ok((await page.getByLabel('Текст после числа',{exact:true}).boundingBox()).height<=48);
  await page.getByLabel('Формат текста',{exact:true}).selectOption('plain');
  assert.equal(await page.getByLabel('Текст после числа',{exact:true}).count(),0);
  await page.getByLabel('Формат текста',{exact:true}).selectOption('affixes');
  await page.getByLabel('Десятичный разделитель',{exact:true}).selectOption('comma');
  await page.screenshot({path:'.artifacts/numeric/ui/'+board+'-parse.png'});
  await card(nodes.condition).locator('.logic-drag-handle').click();
  await page.getByLabel('Нижняя граница',{exact:true}).fill('-10000.25');
  await page.getByLabel('Верхняя граница',{exact:true}).fill('10000.25');
  for(const port of ['below','inside','above','isBelow','isInside','isAbove'])assert.equal(await card(nodes.condition).locator('[data-port-id="'+port+'"]').count(),1);
  await page.screenshot({path:'.artifacts/numeric/ui/'+board+'-range.png'});
  await page.getByLabel('Режим проверки',{exact:true}).selectOption('compare');
  assert.equal(await page.getByLabel('Нижняя граница',{exact:true}).count(),0);
  await page.getByLabel('Условие',{exact:true}).selectOption('gte');
  await page.getByLabel('Число для сравнения',{exact:true}).fill('15000.5');
  assert.equal(await card(nodes.condition).locator('[data-port-id="isBelow"]').count(),0);
  assert.equal(await card(nodes.condition).locator('[data-port-id="result"]').count(),1);
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.locator('.dirty-dot').waitFor({state:'detached'});
  await page.screenshot({path:'.artifacts/numeric/ui/'+board+'-compare.png'});
  await page.reload();await page.locator('.project-open').click();
  await page.getByRole('button',{name:'Логика',exact:true}).click();await card(nodes.condition).locator('.logic-drag-handle').click();
  assert.equal(await page.getByLabel('Режим проверки',{exact:true}).inputValue(),'compare');
  assert.equal(await page.getByLabel('Число для сравнения',{exact:true}).inputValue(),'15000.5');
  const saved=await page.evaluate(id=>JSON.parse(JSON.parse(localStorage.getItem('clex-flow:projects:v1'))[id]),project.id);
  assert.equal(saved.logic.nodes.find(n=>n.id===nodes.condition.id).parameters.lower,-10000.25);
  assert.ok(!saved.logic.edges.some(e=>e.source===nodes.condition.id&&['isBelow','isAbove'].includes(e.sourceHandle)));
  assert.deepEqual(errors,[]);
  console.log('PASS numeric UI: library, formats, signed fractional limits, dynamic ports, mode switching and persistence on '+board);
 } catch(error){await page.screenshot({path:'.artifacts/numeric/ui/failure.png'});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
