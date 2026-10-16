/* global document, window */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {nano,nanoProject}=await import('./nano-fixture.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE}),errors=[];
 const page=await browser.newPage({viewport:{width:1600,height:1050}});page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430');
  await page.getByRole('button',{name:'Новый проект',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:'Плата',exact:true}).selectOption(nano.id);
  assert.match(await dialog.locator('.target-choice').innerText(),/Arduino AVR 1.8.6/);assert.doesNotMatch(await dialog.locator('.target-choice').innerText(),/ESP-IDF/);
  await dialog.getByRole('textbox',{name:'Название проекта'}).fill('Проверка Nano');await dialog.getByRole('button',{name:'Создать проект',exact:true}).click();
  await page.getByRole('heading',{name:'Проверка Nano',exact:true}).waitFor();
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.getByRole('combobox',{name:'Загрузчик Nano',exact:true}).selectOption('old');
  await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();await page.screenshot({path:'.artifacts/nano-support/nano-board.png'});
  assert.equal(await page.getByRole('button',{name:'Добавить: TFT 240×320 · SPI',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Логика',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Добавить блок: Экран дисплея',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Добавить блок: Счетчик',exact:true}).isDisabled(),false);
  const p=nanoProject({blink:true});await page.evaluate(p=>localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)})),p);await page.reload();
  await page.locator('.project-open').click();await page.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();
  await page.getByRole('button',{name:'clex_flow/src/flow.cpp',exact:true}).click();assert.match(await page.locator('.firmware-source').innerText(),/digitalWrite\(13,/);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Логика',exact:true}).click();await page.screenshot({path:'.artifacts/nano-support/nano-logic.png'});
  await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('heading',{name:/Инструменты Arduino Nano/}).waitFor();assert.equal(await page.getByRole('button',{name:'Найти и проверить Arduino',exact:true}).isDisabled(),true);
  await page.screenshot({path:'.artifacts/nano-support/nano-settings.png',fullPage:true});
  await page.setViewportSize({width:1000,height:700});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS: Nano creation, board SVG, bootloader selection, compatibility gates, GPIO preview and settings. Browser preview only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
