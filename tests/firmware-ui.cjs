/* global document, window */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async()=>{
 const {firmwareProject}=await import('./firmware-fixture.js');
 const browser=await chromium.launch({headless:true,...(process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]?{executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  const project=firmwareProject(true);
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');
  const storage=await page.evaluate(()=>Object.keys(localStorage).find(key=>key.includes('projects')));
  // Use the same serialized browser store as the normal project service.
  await page.evaluate(({project,key})=>localStorage.setItem(key,JSON.stringify({[project.id]:JSON.stringify(project)})),{project,key:storage||'clex-flow:projects:v1'});
  await page.reload();
  await page.locator('.project-open').click();
  assert.equal(await page.getByRole('button',{name:'Собрать',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Прошить',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Открыть монитор',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  assert.match(await page.locator('.firmware-source').innerText(),/gpio_set_level\(17,/);
  await page.getByRole('button',{name:'sdkconfig.defaults',exact:true}).click();
  assert.match(await page.locator('.firmware-source').innerText(),/USB_SERIAL_JTAG=y/);
  await page.screenshot({path:'.artifacts/clex-flow-firmware-preview.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Проверить пути',exact:true}).isDisabled(),true);
  await page.getByRole('combobox',{name:'Консоль прошивки',exact:true}).selectOption('uart');
  await page.getByRole('button',{name:'Эксперимент',exact:true}).click();
  await page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();
  await page.getByRole('button',{name:'sdkconfig.defaults',exact:true}).click();
  assert.match(await page.locator('.firmware-source').innerText(),/UART_DEFAULT=y/);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1000,height:700});
  await page.screenshot({path:'.artifacts/clex-flow-firmware-small.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  const outside=await page.locator('.topbar-actions').evaluate(element=>element.getBoundingClientRect().right>window.innerWidth);
  assert.equal(outside,false);
  assert.deepEqual(errors,[]);
  console.log('PASS: fixed source preview, GPIO code, USB/UART defaults, native-only gates, missing port, 1000x700 toolbar. No runtime errors. Browser test does not simulate a successful build or device.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
