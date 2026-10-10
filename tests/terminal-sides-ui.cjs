/* global getComputedStyle */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
 const { firmwareProject } = await import('./firmware-fixture.js');
 const { serializeProject } = await import('../src/projects/model.js');
 const browser = await chromium.launch({ headless:true, executablePath:process.env.CLEX_BROWSER_EXECUTABLE || process.argv[2] });
 const page = await browser.newPage({ viewport:{width:1440,height:1000} }), errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).first().click();await page.getByText('Проект сохранён',{exact:true}).waitFor();};
 try {
  await page.goto('http://127.0.0.1:1420');
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Открыть JSON',exact:true}).click();
  await(await chooser).setFiles({name:'sides.clex.json',mimeType:'application/json',buffer:Buffer.from(serializeProject(firmwareProject()))});
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  await page.getByRole('button',{name:'Компонент Внешний светодиод 1',exact:true}).click();
  const before=await saved(), id=before.components[0].id;
  for(const [label,side] of [['Анод через R','right'],['Катод / GND','bottom']])await page.getByRole('combobox',{name:'Сторона контакта: '+label,exact:true}).selectOption(side);
  await save();let current=await saved();
  assert.deepEqual(current.assembly.connections,before.assembly.connections);assert.deepEqual(current.gpioAssignments,before.gpioAssignments);
  assert.deepEqual(current.assembly.portSides[id],{anode:'right',cathode:'bottom'});
  const node=page.locator('.react-flow__node[data-id="'+id+'"]');
  assert.equal(await node.locator('.assembly-handle[data-handleid="anode"]').getAttribute('data-handlepos'),'right');
  assert.equal(await node.locator('.assembly-handle[data-handleid="cathode"]').getAttribute('data-handlepos'),'bottom');
  const paddings=await page.locator('select').evaluateAll(elements=>elements.map(element=>({top:parseFloat(getComputedStyle(element).paddingTop),bottom:parseFloat(getComputedStyle(element).paddingBottom),appearance:getComputedStyle(element).appearance})));
  assert.ok(paddings.every(style=>style.top>=8&&style.bottom>=8&&style.appearance==='none'));
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  await page.getByRole('button',{name:'Компонент Внешний светодиод 1',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Сторона контакта: Анод через R',exact:true}).inputValue(),'right');
  await page.getByRole('combobox',{name:'Сторона контакта: Анод через R',exact:true}).selectOption('top');await save();
  assert.equal(await node.locator('.assembly-handle[data-handleid="anode"]').getAttribute('data-handlepos'),'top');
  await page.screenshot({path:'.artifacts/terminal-sides.png'});
  await page.getByRole('button',{name:'Удалить компонент',exact:true}).click();await save();
  assert.equal((await saved()).assembly.portSides[id],undefined);
  assert.deepEqual(errors,[]);console.log('PASS: individual contact sides, live handles, unchanged GPIO/wire IDs, persistence, deletion cleanup and padded select controls.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
