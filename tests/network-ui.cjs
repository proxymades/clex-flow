/* global document, window */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {networkProject}=await import('./network-fixture.js');const fixture=networkProject();
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(project=>{localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[project.id]:JSON.stringify(project)}));},fixture);
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).first().click();await page.getByText('Проект сохранен',{exact:true}).waitFor();};
 const current=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');await page.locator('.project-open').click();
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  const eth=fixture.components.find(component=>component.moduleId==='clex.hardware.ethernet'),display=fixture.components.find(component=>component.moduleId!=='clex.hardware.ethernet');
  await page.locator('.react-flow__node').filter({hasText:eth.name}).click();
  const spi=page.getByRole('combobox',{name:'Аппаратный SPI',exact:true});
  assert.equal(await spi.inputValue(),'2');assert.notEqual(await spi.locator('option[value="3"]').getAttribute('disabled'),null);
  await spi.selectOption('');
  await page.locator('.react-flow__node').filter({hasText:display.name}).click();await spi.selectOption('2');
  await page.locator('.react-flow__node').filter({hasText:eth.name}).click();await spi.selectOption('3');
  await page.getByLabel('Настройка IPv4',{exact:true}).selectOption('static');
  for(const [name,value] of [['IP-адрес','10.20.30.40'],['Маска подсети','255.255.255.0'],['Шлюз','10.20.30.1'],['DNS (необязательно)','10.20.30.1']])await page.getByLabel(name,{exact:true}).fill(value);
  await page.getByLabel('Настройка IPv4',{exact:true}).selectOption('dhcp');assert.equal(await page.getByLabel('Маска подсети',{exact:true}).count(),0);
  await save();await page.getByRole('button',{name:'Логика',exact:true}).click();await page.locator('.react-flow__edge').nth(5).waitFor();
  await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();
  await page.locator('.logic-node').filter({hasText:'Экран дисплея'}).locator('header').dblclick();const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.locator('.screen-element-list button').nth(1).click();
  await dialog.getByLabel('Настроить состояние',{exact:true}).selectOption(fixture.screens[display.id].elements[1].states[2].id);
  await dialog.getByLabel('Надпись состояния',{exact:true}).fill('Сеть работает');await dialog.getByLabel('Фон состояния',{exact:true}).fill('#214533');await dialog.getByLabel('Цвет точки',{exact:true}).fill('#88ee44');
  await dialog.locator('.screen-indicator').filter({hasText:'Сеть работает'}).waitFor();
  await dialog.getByLabel('Показывать точку',{exact:true}).uncheck();assert.equal(await dialog.locator('.screen-indicator').first().locator('.indicator-dot').count(),0);
  await dialog.getByLabel('Показывать точку',{exact:true}).check();await dialog.getByLabel('Расположение точки',{exact:true}).selectOption('right');
  const resize=await dialog.getByRole('button',{name:'Изменить размер индикатора',exact:true}).boundingBox();
  const before=Number(await dialog.getByLabel('Высота',{exact:true}).inputValue());
  await page.mouse.move(resize.x+5,resize.y+5);await page.mouse.down();await page.mouse.move(resize.x+5,resize.y+30,{steps:8});await page.mouse.up();assert.ok(Number(await dialog.getByLabel('Высота',{exact:true}).inputValue())>before);
  await page.screenshot({path:'.artifacts/network-indicator-editor.png'});
  await dialog.getByRole('button',{name:'Сохранить интерфейс',exact:true}).click();await save();
  const saved=await current();assert.equal(saved.components.find(component=>component.id===eth.id).parameters.spiHost,'3');assert.equal(saved.components.find(component=>component.id===display.id).parameters.spiHost,'2');assert.equal(saved.screens[display.id].elements[1].states[2].text,'Сеть работает');assert.equal(saved.screens[display.id].elements[1].editStateId,undefined);assert.equal(saved.logic.edges.length,6);
  await page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();await page.getByRole('button',{name:'main/main.c',exact:true}).click();assert.match(await page.locator('.firmware-source').innerText(),/esp_eth_mac_new_w5500/);await page.keyboard.press('Escape');
  await page.screenshot({path:'.artifacts/network-logic.png'});
  await page.setViewportSize({width:1000,height:700});await page.locator('.logic-node').filter({hasText:'Экран дисплея'}).locator('header').dblclick();await dialog.waitFor();await page.screenshot({path:'.artifacts/network-indicator-small.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS: free SPI selection and exchange, DHCP/static fields, network ports, custom indicator state colors/captions, dot toggle and position, mouse resizing, persistence, source preview and small layout.');
 }catch(error){await page.screenshot({path:'.artifacts/network-ui-failure.png'});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
