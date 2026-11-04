const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const {catalog}=await import('./catalog-fixture.js');
 const {firmwareProject}=await import('./firmware-fixture.js');
 const {displayProject}=await import('./display-fixture.js');
 const {mosfetProject}=await import('./mosfet-fixture.js');
 const {addHardware,connectTerminal,connectionProblem}=await import('../src/assembly/model.js');
 const {withLogic,addNode}=await import('../src/logic/model.js');
 const {generateFirmware}=await import('../src/firmware/generator.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});
 const errors=[],url=process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430';
 await fs.mkdir('.artifacts/logic-simplification/ui',{recursive:true});
 async function open(project){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1'))localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));},project);
  await page.goto(url);await page.locator('.project-open').click();return page;
 }
 const logic=page=>page.getByRole('button',{name:'Логика',exact:true}).click();
 const fit=page=>page.getByRole('button',{name:'Показать весь граф',exact:true}).click();
 const card=(page,node)=>page.locator('.react-flow__node[data-id="'+node.id+'"]');
 const port=(page,node,direction,id)=>card(page,node).locator('.logic-port.'+direction+'[data-port-id="'+id+'"] button');
 const saved=page=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 async function save(page){await page.getByRole('button',{name:'Сохранить',exact:true}).first().click();await page.getByText('Проект сохранен',{exact:true}).waitFor();return saved(page);}
 try{
  let p=firmwareProject();p=withLogic(p,{...p.logic,nodes:[],edges:[]});
  const page=await open(p);await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Кнопки',exact:true}).count(),1);await logic(page);
  await page.getByRole('textbox',{name:'Поиск блоков',exact:true}).fill('кнопка');
  const button=p.components.find(c=>c.moduleId==='clex.hardware.button'),led=p.components.find(c=>c.moduleId==='clex.hardware.led');
  await page.getByRole('button',{name:'Добавить блок: События кнопки · '+button.name,exact:true}).click();
  await page.getByRole('textbox',{name:'Поиск блоков',exact:true}).fill('');
  await page.getByRole('button',{name:'Добавить блок: Управлять светодиодом · '+led.name,exact:true}).click();
  let ready=await save(page),input=ready.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-edge'),output=ready.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-set');
  assert.equal(input.parameters.componentId,button.id);assert.equal(output.parameters.componentId,led.id);
  await fit(page);await port(page,input,'output','active').click();await port(page,output,'input','toggle').click();
  ready=await save(page);assert.equal(ready.logic.edges.length,1);assert.equal(ready.logic.edges[0].targetHandle,'toggle');
  assert.equal(await page.locator('[data-port-type="boolean"]').count(),0);
  await card(page,output).locator('header').click();assert.equal(await page.getByLabel('Действие',{exact:true}).count(),0);
  assert.equal(await page.getByRole('checkbox',{name:'Дополнительные контакты',exact:true}).count(),0);
  assert.equal(await port(page,output,'output','done').count(),1);
  await page.screenshot({path:'.artifacts/logic-simplification/ui/button-output.png'});
  await page.reload();await page.locator('.project-open').click();await logic(page);
  await port(page,output,'output','done').waitFor();assert.equal(await port(page,output,'output','done').count(),1);generateFirmware(await saved(page),catalog);await page.close();

  p=displayProject();p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.button'),catalog);
  const mounted=p.components.at(-1),board=catalog.boards.find(b=>b.id===p.boardId);
  for(const terminal of ['signal','ground'])p=connectTerminal(p,catalog,mounted.id,terminal,board.pins.find(pin=>!connectionProblem(p,catalog,mounted.id,terminal,pin.id)).id);
  p=withLogic(p,addNode(p.logic,catalog.modules.find(m=>m.id==='clex.logic.gpio-edge'),p.components,p,catalog));
  const view=p.logic.nodes.find(n=>n.moduleId==='clex.logic.display'),edge=p.logic.nodes.at(-1);
  view.position={x:420,y:60};edge.position={x:40,y:60};
  const screenPage=await open(p);await logic(screenPage);await card(screenPage,view).locator('header').click();
  await screenPage.getByRole('button',{name:'Открыть редактор экрана',exact:true}).click();
  const editor=screenPage.locator('.display-editor');await editor.getByRole('button',{name:'Добавить индикатор',exact:true}).click();
  assert.equal(await editor.getByLabel('Режим состояния',{exact:true}).inputValue(),'events');
  assert.equal(await editor.getByLabel('Тип значения состояния',{exact:true}).count(),0);
  assert.equal(await editor.getByLabel('Значение состояния',{exact:true}).count(),0);
  await editor.getByLabel('Название состояния',{exact:true}).fill('Отпущена');
  await editor.getByLabel('Надпись состояния',{exact:true}).fill('Кнопка отпущена');
  await editor.getByLabel('Настроить состояние',{exact:true}).selectOption({label:'Включено'});
  await editor.getByLabel('Название состояния',{exact:true}).fill('Нажата');
  await editor.getByLabel('Надпись состояния',{exact:true}).fill('Кнопка нажата');
  await screenPage.screenshot({path:'.artifacts/logic-simplification/ui/indicator-editor.png'});
  await editor.getByRole('button',{name:'Сохранить интерфейс',exact:true}).click();
  ready=await save(screenPage);const indicator=ready.screens[view.parameters.componentId].elements.find(e=>e.type==='indicator');
  await fit(screenPage);
  for(const [event,state]of [['active',indicator.states[1]],['inactive',indicator.states[0]]]){
   await port(screenPage,edge,'output',event).click();
   await port(screenPage,view,'input','show.'+indicator.id+'.'+state.id).click();
  }
  ready=await save(screenPage);assert.equal(ready.logic.edges.length,2);assert.ok(ready.logic.edges.every(e=>e.dataType==='event'));generateFirmware(ready,catalog);
  await screenPage.screenshot({path:'.artifacts/logic-simplification/ui/indicator-events.png'});
  await screenPage.close();

  const fixture=mosfetProject();p=fixture.project;const component=fixture.component,node=fixture.blocks[0].node,extra={};
  for(const kind of ['led','relay']){p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.'+kind),catalog);extra[kind]=p.components.at(-1);}
  const outputPage=await open(p);await logic(outputPage);await card(outputPage,node).locator('header').click();
  const device=outputPage.getByLabel('Выходной компонент',{exact:true});
  await device.selectOption(extra.led.id);assert.equal(await outputPage.getByLabel('Канал',{exact:true}).count(),0);
  await device.selectOption(extra.relay.id);assert.ok(await outputPage.getByLabel('Канал',{exact:true}).isVisible());
  await device.selectOption(component.id);await outputPage.getByLabel('Канал',{exact:true}).selectOption('2');
  ready=await save(outputPage);assert.deepEqual(ready.logic.edges,p.logic.edges);
  assert.equal(ready.logic.nodes.find(n=>n.id===node.id).parameters.channel,'2');await outputPage.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: button discovery, device-bound actions, one-wire toggle, optional ports and reload, event indicator editing/connections/firmware, output component and channel selection.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
