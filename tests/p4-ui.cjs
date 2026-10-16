/* global DOMParser */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
 const {p4Project} = await import('./p4-fixture.js');
 const browser = await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE}), errors=[];
 const page = await browser.newPage({viewport:{width:1600,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 const url=process.env.CLEX_PREVIEW_URL || 'http://127.0.0.1:1430';
 try {
  await page.goto(url);
  await page.getByRole('button',{name:'Новый проект',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Сменить плату',exact:true}).click();await page.getByRole('button',{name:'Выбрать плату: ESP32-P4-NANO',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Название проекта'}).fill('P4 UI check');
  await dialog.getByRole('button',{name:'Создать проект',exact:true}).click();
  await page.getByRole('heading',{name:'P4 UI check',exact:true}).waitFor();
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  await page.locator('.assembly-board-node').waitFor();
  assert.equal(await page.locator('.assembly-board-node g[data-pin]').count(),52);
  await page.locator('.assembly-board-node').click();
  const revision=page.getByRole('combobox',{name:'Ревизия ESP32-P4',exact:true});
  assert.equal(await revision.inputValue(),'pre-v3');
  await revision.selectOption('v3');
  assert.match(await page.locator('.board-peripherals').innerText(),/ES8311/);
  assert.match(await page.locator('.board-peripherals').innerText(),/MIPI-CSI/);
  const labels=await page.locator('.assembly-board-node g[data-pin] text').evaluateAll(elements=>elements.map(e=>{const r=e.getBBox();return{x:r.x,y:r.y,right:r.x+r.width,bottom:r.y+r.height,label:e.textContent};}));
  const svgWidth=Number(await page.locator('.assembly-board-node > svg').getAttribute('width'));
  assert.deepEqual(labels.filter(label=>label.x<0||label.right>svgWidth),[],'all header labels fit inside board SVG');
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],b=labels[j];assert.ok(!(a.x<b.right && a.right>b.x && a.y<b.bottom && a.bottom>b.y),'header labels do not overlap: '+a.label+' / '+b.label);}

  const alignment=await page.locator('.board-drawing').evaluate(async image=>{
   const source=await fetch(image.href.baseVal).then(response=>response.text()),drawing=new DOMParser().parseFromString(source,'image/svg+xml');
   const headers=[...drawing.querySelectorAll('#p1-header,#p2-header')];
   const centers=headers.flatMap(rect=>Array.from({length:13},(_,row)=>[12,36].map(offset=>({x:Number(rect.getAttribute('x'))+offset,y:Number(rect.getAttribute('y'))+14+row*34}))).flat());
   const circles=[...image.ownerSVGElement.querySelectorAll('.board-pin > circle')];
   return {squareCount:drawing.querySelectorAll('rect[width="12"][height="12"]').length,offCenter:circles.filter(circle=>!centers.some(center=>center.x===Number(circle.getAttribute('cx')) && center.y===Number(circle.getAttribute('cy')))).map(circle=>circle.parentElement.dataset.pin),
    drawingWidth:Number(drawing.documentElement.getAttribute('width')),imageWidth:Number(image.getAttribute('width'))};
  });
  assert.equal(alignment.squareCount,0);assert.deepEqual(alignment.offCenter,[]);assert.equal(alignment.drawingWidth,alignment.imageWidth);

  await page.locator('.assembly-board-node').screenshot({path:'.artifacts/p4-redraw/board-in-editor.png'});
  await page.screenshot({path:'.artifacts/p4-board.png'});
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const consoleSelector=page.getByRole('combobox',{name:'Консоль прошивки',exact:true});
  assert.equal(await consoleSelector.inputValue(),'uart');assert.equal(await consoleSelector.locator('option').count(),1);
  assert.match(await page.locator('.sdk-manager').innerText(),/esp32p4/);
  assert.match(await page.locator('.sdk-manager').innerText(),/RISC-V/);
  await page.close();
  const ready = await browser.newPage({viewport:{width:1600,height:1100}}),project=p4Project(true);
  ready.on('pageerror',e=>errors.push(e.message));
  await ready.addInitScript(p=>localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)})),project);
  await ready.goto(url);await ready.locator('.project-open').click();
  await ready.getByRole('button',{name:'Монтаж',exact:true}).click();await ready.locator('.assembly-board-node').waitFor();
  const ethernet=project.components.find(c=>c.moduleId==='clex.hardware.ethernet');
  await ready.locator('.react-flow__node[data-id="'+ethernet.id+'"]').click();
  const properties=ready.locator('.workspace-properties');
  assert.equal(await properties.getByRole('combobox',{name:'Аппаратный SPI',exact:true}).count(),0);
  assert.match(await properties.innerText(),/IP101GRI/);
  await ready.getByRole('button',{name:'Посмотреть исходники прошивки',exact:true}).click();
  await ready.getByRole('button',{name:'sdkconfig.defaults',exact:true}).click();
  assert.match(await ready.locator('.firmware-source').innerText(),/CONFIG_IDF_TARGET="esp32p4"/);
  await ready.getByRole('button',{name:'main/main.c',exact:true}).click();
  assert.match(await ready.locator('.firmware-source').innerText(),/esp_eth_phy_new_ip101/);
  assert.deepEqual(errors,[]);
  console.log('PASS: P4 creation, 52 labeled pins, revision, documented interfaces, UART/RISC-V SDK settings, RMII without SPI selector and real firmware preview.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
