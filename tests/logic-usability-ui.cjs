/* global window, document */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {dynamicDisplayProject}=await import('./dynamic-display-fixture.js');
 const {networkProject}=await import('./network-fixture.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const errors=[],url=process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430';
 async function open(project){const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1'))localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));},project);await page.goto(url);await page.locator('.project-open').click();await page.getByRole('button',{name:'Логика',exact:true}).click();await page.locator('.logic-node').first().waitFor();return page;}
 const save=async page=>{await page.getByRole('button',{name:'Сохранить',exact:true}).first().click();await page.getByText('Проект сохранен',{exact:true}).waitFor();};
 const saved=page=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 try{
  const project=dynamicDisplayProject(),counter=project.logic.nodes.find(n=>n.moduleId==='clex.logic.counter'),display=project.logic.nodes.find(n=>n.moduleId==='clex.logic.display');
  project.logic.edges=project.logic.edges.filter(edge=>edge.target!==display.id);
  counter.position={x:390,y:100};project.logic.nodes.find(n=>n.moduleId==='clex.logic.timer').position={x:720,y:100};
  const page=await open(project),card=page.locator('.react-flow__node[data-id="'+counter.id+'"]');
  await card.getByRole('button',{name:/Прибавить 1/}).hover();await card.getByRole('tooltip').filter({hasText:'прибавляет 1'}).waitFor({state:'visible'});
  assert.equal(await card.locator('[data-port-id="reset"]').count(),0);
  await card.locator('header').click();await page.getByRole('spinbutton',{name:'Изменение за сигнал',exact:true}).fill('-2');await card.getByRole('button',{name:/Вычесть 2/}).waitFor();
  await page.getByRole('spinbutton',{name:'Изменение за сигнал',exact:true}).fill('5');await card.getByRole('button',{name:/Прибавить 5/}).waitFor();
  await page.getByRole('spinbutton',{name:'Изменение за сигнал',exact:true}).fill('1');
  await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();
  await page.waitForTimeout(200);
  const handle=await card.locator('.react-flow__handle.source[data-handleid="value"]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+80,handle.y+20,{steps:4});
  await page.screenshot({path:'.artifacts/logic-usability-drag.png'});
  await page.locator('.react-flow__node[data-id="'+display.id+'"] .compatible-port').first().waitFor();assert.equal(await card.locator('.compatible-port').count(),0);await page.mouse.up();
  await page.locator('.react-flow__node[data-id="'+display.id+'"] .node-bind-button').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  const option=dialog.getByRole('combobox',{name:'Источник данных',exact:true});const matching=await option.locator('option').evaluateAll(items=>items.filter(item=>item.textContent.includes('Показывать значение счетчика')).map(item=>item.value));assert.equal(matching.length,1);await option.selectOption(matching[0]);
  await dialog.getByRole('button',{name:'Подключить',exact:true}).click();await page.locator('.react-flow__edge').nth(2).waitFor();await save(page);let value=await saved(page);assert.equal(value.logic.edges.length,3);assert.equal(value.logic.edges.filter(edge=>edge.target===display.id).length,2);
  await page.getByRole('button',{name:'Отменить изменение графа',exact:true}).click();await save(page);assert.equal((await saved(page)).logic.edges.length,1);
  await page.getByRole('button',{name:'Повторить изменение графа',exact:true}).click();await save(page);assert.equal((await saved(page)).logic.edges.length,3);
  await card.getByRole('button',{name:/Дополнительные контакты/}).click();await card.locator('[data-port-id="reset"]').waitFor();
  const clock=project.logic.nodes.find(n=>n.moduleId==='clex.logic.timer');await page.locator('.react-flow__node[data-id="'+clock.id+'"] [data-port-id="tick"] button').click();await card.locator('[data-port-id="reset"] button').click();await page.locator('.react-flow__edge').nth(3).waitFor();await card.getByRole('button',{name:/Свернуть дополнительные/}).click();assert.equal(await card.locator('[data-port-id="reset"]').count(),1);await save(page);
  await page.screenshot({path:'.artifacts/logic-usability-counter.png'});await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Логика',exact:true}).click();await page.locator('.react-flow__node[data-id="'+counter.id+'"] [data-port-id="reset"]').waitFor();assert.equal(await page.locator('.react-flow__node[data-id="'+counter.id+'"] [data-port-id="reset"]').count(),1);
  await page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();await page.getByRole('button',{name:'main/main.c',exact:true}).click();assert.match(await page.locator('.firmware-source').innerText(),/static int32_t value_/);await page.keyboard.press('Escape');await page.close();
  const net=networkProject(),networkPage=await open(net),networkDisplay=net.logic.nodes.find(n=>n.moduleId==='clex.logic.display');
  await networkPage.locator('.react-flow__node[data-id="'+networkDisplay.id+'"] .node-bind-button').click();const helper=networkPage.getByRole('dialog');await helper.waitFor();assert.equal(await networkPage.getByRole('dialog').count(),1);await networkPage.locator('.react-flow__node[data-id="'+networkDisplay.id+'"] .node-bind-button').dispatchEvent('dblclick');assert.equal(await networkPage.getByRole('dialog').count(),1);assert.equal(await networkPage.locator('.display-editor').count(),0);
  await helper.getByRole('combobox',{name:'Элемент экрана',exact:true}).selectOption(net.screens[networkDisplay.parameters.componentId].elements.find(e=>e.name==='Интернет').id);
  await helper.getByRole('combobox',{name:'Когда показывать',exact:true}).selectOption('done');await helper.getByRole('button',{name:'Подключить',exact:true}).click();await save(networkPage);const result=await saved(networkPage);
  assert.equal(result.logic.edges.length,7);assert.ok(result.logic.edges.some(edge=>edge.sourceHandle==='ipChanged'&&edge.targetHandle==='trigger'));assert.ok(result.logic.edges.some(edge=>edge.sourceHandle==='done'&&edge.targetHandle.startsWith('update.')));
  await networkPage.getByRole('button',{name:'Показать весь граф',exact:true}).click();await networkPage.waitForTimeout(200);assert.equal(await networkPage.locator('.logic-connect-error').count(),0);
  await networkPage.screenshot({path:'.artifacts/logic-usability-network.png'});await networkPage.setViewportSize({width:1000,height:700});await networkPage.locator('.react-flow__node[data-id="'+networkDisplay.id+'"] .node-bind-button').click();await helper.waitFor();await networkPage.waitForTimeout(200);await networkPage.screenshot({animations:'disabled',path:'.artifacts/logic-usability-helper-small.png'});assert.equal(await networkPage.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);await networkPage.close();
  assert.deepEqual(errors,[]);console.log('PASS: contextual step labels, hover tooltips, compatible drag targets, helper-created data/events, atomic undo/redo, connected hidden contacts and reload, firmware preview, completion-only network reset and small layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
