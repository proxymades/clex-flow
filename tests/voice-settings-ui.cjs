/* global getComputedStyle, document, innerWidth */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
(async()=>{
 const {audioPlayProject}=await import('./audio-play-fixture.js');
 const {prepareActivationAudio,activationWave}=await import('../src/voice/audio.js');
 const {parseProject}=await import('../src/projects/model.js');
 await fs.mkdir('.artifacts/voice',{recursive:true});
 const project=audioPlayProject(),voice=project.components[0],original=voice.parameters.profile;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1'))localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));},project);
 const stored=()=>page.evaluate(id=>JSON.parse(JSON.parse(localStorage.getItem('clex-flow:projects:v1'))[id]),project.id);
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430');await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  await page.getByRole('button',{name:'Компонент '+voice.name,exact:true}).click();
  await page.getByLabel('Режим фразы активации',{exact:true}).selectOption('custom');
  await page.getByLabel('Своя фраза активации',{exact:true}).fill('Добрый вечер, дом');
  await page.getByRole('button',{name:'Настроить фразу активации',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Настройка фразы активации',exact:true}).waitFor();
  const port=await dialog.getByLabel('USB-порт голосового компонента').boundingBox(),refresh=await dialog.getByRole('button',{name:'Обновить порты',exact:true}).boundingBox();
  assert.ok(Math.abs(port.y+port.height-refresh.y-refresh.height)<2,'port and refresh share a row');
  await dialog.getByRole('button',{name:'2. Записи',exact:true}).click();
  assert.match(await dialog.innerText(),/Осталось 13/);assert.match(await dialog.innerText(),/только фразу активации/);
  const maxFont=await dialog.locator('input,button,p').evaluateAll(els=>Math.max(...els.map(e=>parseFloat(getComputedStyle(e).fontSize))));assert.ok(maxFont<=14);
  await page.screenshot({path:'.artifacts/voice/custom-wake-dialog.png'});
  await dialog.locator('footer').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  let saved=await stored();assert.equal(saved.components[0].parameters.profile,original);assert.equal(JSON.parse(saved.components[0].parameters.wakeProfile).commands[0].phrase,'Добрый вечер, дом');assert.deepEqual(saved.logic.edges,project.logic.edges);
  await page.screenshot({path:'.artifacts/voice/custom-wake-settings.png'});
  await page.getByLabel('Режим фразы активации',{exact:true}).selectOption('builtin');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();saved=await stored();assert.equal(JSON.parse(saved.components[0].parameters.wakeProfile).commands[0].phrase,'Добрый вечер, дом');
  await page.getByRole('button',{name:'Логика',exact:true}).click();
  const playback=project.logic.nodes.at(-1),node=page.locator('.react-flow__node[data-id="'+playback.id+'"]');await node.locator('header').click();
  const wave=activationWave(prepareActivationAudio([Float32Array.from({length:4800},(_,i)=>.2*Math.sin(i*.1))],16000,'confirmation.wav'));
  await page.getByLabel('Файл аудиозаписи',{exact:true}).setInputFiles({name:'confirmation.wav',mimeType:'audio/wav',buffer:Buffer.from(wave)});
  await page.getByText('confirmation.wav · 0.3 сек.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Аудиозапись',exact:true}).count(),0);
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();saved=await stored();parseProject(JSON.stringify(saved));
  assert.equal(JSON.parse(saved.logic.nodes.find(n=>n.id===playback.id).parameters.audio).name,'confirmation.wav');
  await page.screenshot({path:'.artifacts/voice/custom-confirmation.png'});
  await page.setViewportSize({width:1000,height:700});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.getByRole('button',{name:'Компонент '+voice.name,exact:true}).click();
  await page.getByLabel('Режим фразы активации',{exact:true}).selectOption('custom');assert.equal(await page.getByLabel('Своя фраза активации',{exact:true}).inputValue(),'Добрый вечер, дом');
  assert.deepEqual(errors,[]);console.log('PASS: custom wake UI, recording plan, command preservation, switching, WAV upload, persistence and compact layout.');
 }catch(e){await page.screenshot({path:'.artifacts/voice/custom-ui-debug.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
