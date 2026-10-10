/* global window, document */
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 const url=process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420';
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(url);
  assert.equal(await page.getByRole('button',{name:'Текущий проект',exact:true}).count(),0);
  assert.equal(await page.locator('.app-sidebar').getByText('ESP32-S3',{exact:true}).count(),0);
  assert.doesNotMatch(await page.locator('.blueprint').textContent(),/ESP32|S3/);
  assert.equal(await page.getByText('Путь к первому Blink',{exact:true}).count(),0);
  assert.equal(await page.locator('.version-tag').count(),0);
  await page.screenshot({animations:'disabled',path:'.artifacts/interface-home.png'});
  await page.getByRole('button',{name:/^Библиотека/}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await dialog.locator('.library-catalog-card').count(),3);
  await dialog.getByRole('textbox',{name:'Поиск в библиотеке'}).fill('дисплей');
  assert.equal(await dialog.locator('.library-catalog-card').count(),1);
  await dialog.getByRole('tab',{name:'Блоки логики',exact:true}).click();
  assert.equal(await dialog.locator('.library-catalog-card').count(),6);
  await dialog.getByRole('tab',{name:'Платы',exact:true}).click();
  assert.equal(await dialog.locator('.library-catalog-card').count(),2);
  await page.screenshot({animations:'disabled',path:'.artifacts/interface-library.png'});
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).last().click();
  await page.getByRole('button',{name:'Новый проект',exact:true}).first().click();
  await page.getByRole('textbox',{name:'Название проекта'}).fill('Interface check');
  await page.getByRole('button',{name:'Создать проект',exact:true}).click();
  await page.getByRole('heading',{name:'Interface check',exact:true}).waitFor();
  assert.equal(await page.locator('.workspace-library').count(),0);
  assert.equal(await page.getByText('Формат проекта',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Текущий проект',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Текущий проект',exact:true}).click();
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  assert.equal(await page.locator('.workspace-library').count(),1);
  await page.getByRole('button',{name:'Обзор проекта',exact:true}).click();
  await page.setViewportSize({width:1000,height:700});
  await page.screenshot({animations:'disabled',path:'.artifacts/interface-overview-small.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: neutral home, single version, contextual project navigation, searchable real catalog and overview without hardware palette, small layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
