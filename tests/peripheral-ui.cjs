/* global document, Image */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {peripheralProject}=await import('./peripheral-fixture.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE}),errors=[];
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),url=process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430';
 page.on('pageerror',e=>errors.push(e.message));
 const selectedVisible=async()=>{
  await page.waitForFunction(()=>{
   const node=document.querySelector('.assembly-hardware-node.hardware-selected'),region=document.querySelector('.assembly-flow-region[data-ready="true"]');
   if(!node || !region)return false;const a=node.getBoundingClientRect(),b=region.getBoundingClientRect();
   return a.left>=b.left+20 && a.right<=b.right-20 && a.top>=b.top+20 && a.bottom<=b.bottom-20;
  });
 };
 try{
  await page.goto(url);await page.getByRole('button',{name:'Новый проект',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Сменить плату',exact:true}).click();await page.getByRole('button',{name:'Выбрать плату: ESP32-P4-NANO',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Название проекта'}).fill('Периферия P4');await dialog.getByRole('button',{name:'Создать проект',exact:true}).click();
  await page.getByRole('heading',{name:'Периферия P4',exact:true}).waitFor();await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  await page.getByRole('button',{name:'Добавить: Динамик',exact:true}).click();await page.locator('.react-flow__node-physicalHardware').first().waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Аудиоинтерфейс',exact:true}).inputValue(),'audio');await selectedVisible();
  const region=await page.locator('.assembly-flow-region').boundingBox();
  const boardTransform=await page.locator('.react-flow__node[data-id="board"]').evaluate(node=>node.style.transform),viewportTransform=await page.locator('.react-flow__viewport').evaluate(node=>node.style.transform);
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.down('Space');await page.locator('.canvas-space-pan').waitFor();await page.mouse.move(region.x+region.width/2,region.y+region.height/2);await page.mouse.down();await page.mouse.move(region.x+region.width/2-420,region.y+region.height/2-330,{steps:12});await page.mouse.up();await page.keyboard.up('Space');
  assert.equal(await page.locator('.react-flow__node[data-id="board"]').evaluate(node=>node.style.transform),boardTransform,'pan preserves board position');
  assert.notEqual(await page.locator('.react-flow__viewport').evaluate(node=>node.style.transform),viewportTransform,'canvas pan actually changed the viewport');
  await page.getByRole('button',{name:'Добавить: RPi Camera (B) · OV5647',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Разъем камеры',exact:true}).inputValue(),'mipi-camera');await selectedVisible();
  await page.getByRole('button',{name:'Добавить: 10.1″ DSI Touch (A) · 800×1280',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Разъем дисплея',exact:true}).inputValue(),'mipi-display');await selectedVisible();

  const imageErrors=await page.locator('.assembly-hardware-node image').evaluateAll(images=>Promise.all(images.map(image=>new Promise(resolve=>{
   const probe=new Image();probe.onload=()=>resolve(null);probe.onerror=()=>resolve(image.href.baseVal.slice(0,80));probe.src=image.href.baseVal;
  }))));
  assert.deepEqual(imageErrors.filter(Boolean),[],'hardware SVG images load successfully');

  await page.screenshot({path:'.artifacts/p4-redraw/new-component-visible.png'});
  const power=page.getByRole('combobox',{name:'Подключение: Питание · 5 В',exact:true});await power.selectOption('P1-2');await page.getByRole('combobox',{name:'Подключение: GND',exact:true}).selectOption('P1-9');
  await page.getByRole('button',{name:'Логика',exact:true}).click();
  await page.getByRole('button',{name:'Добавить блок: Экран дисплея',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Дисплей',exact:true}).inputValue().then(Boolean),true);
  await page.getByRole('button',{name:'Открыть редактор экрана',exact:true}).click();
  const editor=page.getByRole('dialog');await editor.getByText('800 × 1280',{exact:true}).waitFor();
  await editor.getByRole('button',{name:'Добавить текст',exact:true}).click();
  assert.match(await editor.locator('.screen-element-list').innerText(),/Привет, мир! CLEX Flow/);
  assert.equal(await editor.locator('.screen-pixels').getAttribute('data-screen-width'),'800');
  await page.screenshot({path:'.artifacts/p4-peripherals/editor-800x1280.png'});
  await editor.getByRole('button',{name:'Сохранить интерфейс',exact:true}).click();
  await page.getByRole('button',{name:'Добавить блок: Звуковой сигнал',exact:true}).click();
  await page.getByRole('button',{name:'Добавить блок: Сделать кадр',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.close();
  const ready=await browser.newPage({viewport:{width:1600,height:1100}}),p=peripheralProject();ready.on('pageerror',e=>errors.push(e.message));
  await ready.addInitScript(p=>localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)})),p);await ready.goto(url);await ready.locator('.project-open').click();
  await ready.getByRole('button',{name:'Логика',exact:true}).click();await ready.locator('.logic-node').first().waitFor();
  assert.equal(await ready.locator('.workspace-log .error-level').count(),0);
  await ready.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();await ready.getByRole('button',{name:'main/main.c',exact:true}).click();
  const code=await ready.locator('.firmware-source').innerText();assert.match(code,/esp_lcd_new_panel_jd9365/);assert.match(code,/esp_codec_dev_write/);assert.match(code,/VIDIOC_DQBUF/);
  assert.deepEqual(errors,[]);console.log('PASS: real UI adds audio, CSI and DSI providers, power wiring, shared display binding and editor 800x1280, media blocks, persistence and compiled source preview.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
