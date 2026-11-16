const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const {catalog}=await import('./catalog-fixture.js');
 const {buttonInputProject,BUTTON_BOARDS}=await import('./button-input-fixture.js');
 const {componentContact}=await import('../src/assembly/endpoints.js');
 const {generateFirmware}=await import('../src/firmware/generator.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});
 const url=process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1431',folder='.artifacts/button-input',errors=[];
 await fs.mkdir(folder,{recursive:true});
 const contexts=[];
 async function open(project){
  const context=await browser.newContext({viewport:{width:1600,height:1100}});contexts.push(context);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1')){localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));localStorage.setItem('clex-flow:autosave-enabled','false');}},project);
  await page.goto(url);await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-board-node').waitFor();
  return page;
 }
 const saved=page=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 async function save(page){const button=page.getByRole('button',{name:'Сохранить',exact:true});if(await button.isEnabled()){await button.click();await page.getByText('Проект сохранен',{exact:true}).waitFor();}return saved(page);}
 const preview=page=>page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true});
 const select=async(page,component)=>{await page.getByRole('button',{name:/Показать весь/}).click();await page.getByRole('button',{name:'Компонент '+component.name,exact:true}).click();};
 try{
  const fixture=buttonInputProject({pull:'external-up',resistor:false});const page=await open(fixture.project);
  assert.equal(await preview(page).isDisabled(),true);assert.ok((await page.locator('body').innerText()).includes('подключите резистор'));
  await page.getByRole('button',{name:'Добавить: Резистор',exact:true}).click();
  let current=await save(page),resistor=current.components.find(c=>c.moduleId==='clex.hardware.resistor');
  assert.equal(await page.getByRole('spinbutton',{name:'Сопротивление, Ом',exact:true}).inputValue(),'10000');
  await page.getByLabel('Подключение: Вывод 1',{exact:true}).selectOption(componentContact(fixture.button.id,'signal'));
  await page.getByLabel('Подключение: Вывод 2',{exact:true}).selectOption(fixture.power.id);
  current=await save(page);assert.equal(current.gpioAssignments.length,2);assert.equal(current.gpioAssignments.some(a=>a.componentId===resistor.id),false);
  assert.equal(await preview(page).isEnabled(),true);generateFirmware(current,catalog);
  await page.getByRole('button',{name:/Показать весь/}).click();await page.screenshot({path:folder+'/external-up.png'});
  await page.getByLabel('Подключение: Вывод 2',{exact:true}).selectOption('');await save(page);assert.equal(await preview(page).isDisabled(),true);
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-board-node').waitFor();assert.equal(await preview(page).isDisabled(),true);
  await select(page,resistor);await page.getByLabel('Подключение: Вывод 2',{exact:true}).selectOption(fixture.power.id);await save(page);
  await select(page,fixture.button);await page.getByLabel('Подтяжка',{exact:true}).selectOption('external-down');await save(page);assert.equal(await preview(page).isDisabled(),true);
  await page.getByLabel('Подключение: Общий / питание логики',{exact:true}).selectOption(fixture.power.id);
  await select(page,resistor);await page.getByLabel('Подключение: Вывод 2',{exact:true}).selectOption(fixture.ground.id);
  current=await save(page);assert.equal(await preview(page).isEnabled(),true);const bundle=generateFirmware(current,catalog);assert.ok(bundle.mainC.includes('gpio_get_level('+fixture.input.gpio+') != 0'));
  await page.screenshot({path:folder+'/external-down.png'});
  await page.getByRole('button',{name:'Логика',exact:true}).click();await page.locator('.logic-node').first().waitFor();assert.equal(await page.locator('.logic-node').count(),2);assert.equal(await page.locator('.react-flow__edge').count(),1);
  await page.getByRole('button',{name:/Показать весь/}).click();await page.screenshot({path:folder+'/logic.png'});
  await page.reload();await page.locator('.project-open').click();assert.deepEqual((await saved(page)).assembly.connections,current.assembly.connections);assert.deepEqual((await saved(page)).logic,current.logic);

  const moduleFixture=buttonInputProject({module:true,pull:'module'}),modulePage=await open(moduleFixture.project);
  await select(modulePage,moduleFixture.button);
  for(const label of ['Подключение: VCC','Подключение: GND','Подключение: OUT'])assert.equal(await modulePage.getByLabel(label,{exact:true}).count(),1);
  assert.equal(await modulePage.getByLabel('Подтяжка OUT',{exact:true}).inputValue(),'module');assert.equal(await preview(modulePage).isEnabled(),true);
  await modulePage.getByLabel('Уровень OUT при нажатии',{exact:true}).selectOption('high');let moduleSaved=await save(modulePage);
  assert.ok(generateFirmware(moduleSaved,catalog).mainC.includes('gpio_get_level('+moduleFixture.input.gpio+') != 0'));
  await modulePage.getByLabel('Подтяжка OUT',{exact:true}).selectOption('up');await save(modulePage);assert.equal(await preview(modulePage).isDisabled(),true);
  await modulePage.getByLabel('Подтяжка OUT',{exact:true}).selectOption('down');moduleSaved=await save(modulePage);assert.equal(await preview(modulePage).isEnabled(),true);
  await preview(modulePage).click();await modulePage.getByRole('button',{name:'main/main.c',exact:true}).click();assert.match(await modulePage.locator('.firmware-source').innerText(),/GPIO_PULLDOWN_ENABLE/);await modulePage.keyboard.press('Escape');
  await modulePage.getByRole('button',{name:/Показать весь/}).click();await modulePage.screenshot({path:folder+'/button-module.png'});
  await modulePage.getByLabel('Напряжение HIGH на OUT',{exact:true}).selectOption('5');await save(modulePage);assert.equal(await preview(modulePage).isDisabled(),true);
  await modulePage.getByLabel('Напряжение HIGH на OUT',{exact:true}).selectOption('3.3');await save(modulePage);
  await modulePage.setViewportSize({width:1000,height:700});await modulePage.getByRole('button',{name:/Показать весь/}).click();assert.equal(await modulePage.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth),false);await modulePage.screenshot({path:folder+'/module-small.png'});

  const oldFixture=buttonInputProject({boardId:BUTTON_BOARDS.at(-1)});oldFixture.button.moduleVersion='1.0.0';oldFixture.project.moduleVersions[oldFixture.button.moduleId]='1.0.0';
  const oldPage=await open(oldFixture.project);await select(oldPage,oldFixture.button);
  assert.equal(await oldPage.getByLabel('Подтяжка',{exact:true}).locator('option[value="down"]').evaluate(e=>e.disabled),true);
  assert.equal(await oldPage.getByLabel('Подтяжка',{exact:true}).locator('option[value="external-down"]').evaluate(e=>e.disabled),false);
  await oldPage.getByRole('spinbutton',{name:'Антидребезг, мс',exact:true}).fill('45');const oldSaved=await save(oldPage);
  assert.equal(oldSaved.components.find(c=>c.id===oldFixture.button.id).moduleVersion,'1.0.0');assert.deepEqual(oldSaved.assembly.connections,oldFixture.project.assembly.connections);generateFirmware(oldSaved,catalog);
  assert.deepEqual(errors,[]);
  console.log('PASS: isolated headless external pull wiring and errors, resistor branches and persistence, up/down common rails, existing button events, module VCC/GND/OUT and polarity, voltage guards, Nano capabilities, old-version preservation and small viewport. No device access.');
 }catch(e){for(const context of contexts){const page=context.pages()[0];if(page)await page.screenshot({path:folder+'/failure-'+contexts.indexOf(context)+'.png'});}throw e;}finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
