const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const {catalog}=await import('./catalog-fixture.js');
 const {generateFirmware}=await import('../src/firmware/generator.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:1500,height:1050}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const url=process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1431',folder='.artifacts/esp32-c3';await fs.mkdir(folder,{recursive:true});
 const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();return saved();};
 try{
  await page.goto(url);await page.getByRole('button',{name:'Новый проект',exact:true}).click();
  await page.getByRole('textbox',{name:'Название проекта',exact:true}).fill('ESP32-C3 Super Mini – проверка');
  await page.getByRole('button',{name:'Сменить плату',exact:true}).click();await page.getByLabel('Поиск платы',{exact:true}).fill('ESP32 C3 Super Mini');
  assert.equal(await page.locator('.board-picker-results .board-option').count(),1);
  await page.screenshot({path:folder+'/picker.png'});
  await page.getByRole('button',{name:'Выбрать плату: ESP32-C3 Super Mini',exact:true}).click();
  await page.getByRole('button',{name:'Создать проект',exact:true}).click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  assert.match(await page.locator('.selected-board-card').innerText(),/ESP32-C3 Super Mini/);
  await page.locator('.assembly-board-node .board-pin').first().waitFor();
  assert.equal(await page.locator('.assembly-board-node .board-pin').count(),16);
  for(const pin of ['L4','L5','L7','L8','R6'])assert.match(await page.locator('.board-pin[data-pin="'+pin+'"]').getAttribute('aria-label'),/ограничен/);
  const drawing=await page.locator('.board-drawing').getAttribute('href');assert.equal((await context.request.get(new URL(drawing,url).href)).status(),200);
  for(const id of ['clex.hardware.wifi','clex.hardware.mqtt','clex.hardware.espnow','clex.display.spi-240x320'])assert.equal(await page.getByRole('button',{name:'Добавить: '+catalog.modules.find(m=>m.id===id).name,exact:true}).isEnabled(),true,id);
  for(const id of ['clex.hardware.voice','clex.hardware.ethernet'])assert.equal(await page.getByRole('button',{name:'Добавить: '+catalog.modules.find(m=>m.id===id).name,exact:true}).isDisabled(),true,id);
  for(const kind of ['led','button'])await page.getByRole('button',{name:'Добавить: '+catalog.modules.find(m=>m.id==='clex.hardware.'+kind).name,exact:true}).click();
  let p=await save();const [led,button]=p.components;
  await page.getByRole('button',{name:/Показать весь/}).click();
  for(const [component,terminal,pin]of [[led,'anode','R5'],[led,'cathode','R2'],[button,'signal','R4'],[button,'ground','R2']]){
   await page.locator('.react-flow__node[data-id="'+component.id+'"] [data-terminal="'+terminal+'"]').click();
   await page.locator('.board-pin[data-pin="'+pin+'"]').click();
  }
  p=await save();assert.equal(p.boardId,'esp32-c3-super-mini');assert.equal(p.assembly.connections.length,4);assert.deepEqual(p.gpioAssignments.map(a=>a.gpio).sort(),[3,4]);
  await page.screenshot({path:folder+'/assembly.png'});
  await page.getByRole('button',{name:'Логика',exact:true}).click();
  for(const name of ['События кнопки · '+button.name,'Управлять светодиодом · '+led.name])await page.getByRole('button',{name:'Добавить блок: '+name,exact:true}).click();
  p=await save();const input=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-edge'),output=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-set');
  await page.getByRole('button',{name:/Показать весь/}).click();
  await page.locator('.react-flow__node[data-id="'+input.id+'"] .logic-port.output[data-port-id="active"] button').click();
  await page.locator('.react-flow__node[data-id="'+output.id+'"] .logic-port.input[data-port-id="toggle"] button').click();
  p=await save();assert.equal(p.logic.edges.length,1);assert.equal(generateFirmware(p,catalog).target,'esp32c3');
  await page.screenshot({path:folder+'/logic.png'});
  await page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();await page.getByRole('button',{name:'sdkconfig.defaults',exact:true}).click();
  const source=await page.locator('.firmware-source').innerText();assert.match(source,/CONFIG_IDF_TARGET="esp32c3"/);assert.match(source,/USB_SERIAL_JTAG=y/);assert.match(source,/FLASHSIZE_4MB=y/);
  await page.screenshot({path:folder+'/firmware.png'});await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Собрать',exact:true}).isDisabled(),true);
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  const reopened=await saved();assert.deepEqual(reopened.assembly.connections,p.assembly.connections);assert.deepEqual(reopened.logic,p.logic);assert.equal(reopened.boardId,p.boardId);
  await page.setViewportSize({width:1000,height:700});await page.getByRole('button',{name:/Показать весь/}).click();await page.screenshot({path:folder+'/assembly-small.png'});
  assert.equal(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: headless C3 selection, 16 contacts and SVG, compatibility gates, manual LED/button wiring, event-to-toggle logic, source preview, isolated save/reopen and small viewport. No device access.');
 }catch(e){await page.screenshot({path:folder+'/ui-failure.png'});throw e;}finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
