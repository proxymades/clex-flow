/* global window, document */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');

(async()=>{
 const {voiceProject,withCustomWake}=await import('./voice-fixture.js');
 const {prepareActivationAudio,activationWave}=await import('../src/voice/audio.js');
 const project=withCustomWake(voiceProject({speaker:true,activationSound:true,customAudio:true}));
 const wave=activationWave(prepareActivationAudio([Float32Array.from({length:48000},(_,i)=>.2*Math.sin(i*.1))],16000,'sample.wav'));
 const stem='voice-workflow-harness-'+process.pid;await fs.mkdir('.artifacts/voice-workflow',{recursive:true});
 await fs.writeFile('.artifacts/'+stem+'.html','<html><body><div id="root"></div><script type="module" src="/.artifacts/'+stem+'.jsx"></script></body></html>');
 await fs.writeFile('.artifacts/'+stem+'.jsx',`import React,{useState}from'react';import{createRoot}from'react-dom/client';import VoiceSettings from '../src/voice/VoiceSettings.jsx';import{catalog}from'../src/catalog/index.js';import'../src/styles.css';import'../src/voice/voice.css';const initial=${JSON.stringify(project)};function Fixture(){const[p,setP]=useState(initial),[fresh,setFresh]=useState(false),[flashed,setFlashed]=useState(false);window.voiceFixtureProject=p;const idf={port:'fixture-port',ports:[{path:'fixture-port'}],compatible:true,fingerprint:'fixture-source',preview:{},fresh,flashed,busy:false,events:[],job:flashed?{operation:'flash',status:'success'}:null,startBuild:async()=>{window.voiceFixture.builds++;window.voiceFixture.builtProfile=p.components[0].parameters.profile;window.voiceFixture.builtWake=p.components[0].parameters.wakeProfile;setFresh(true);setFlashed(false);},startFlash:async()=>{window.voiceFixture.flashes++;setFlashed(true);},refreshPorts:async()=>{},setPort:()=>{}};return <div style={{height:'100vh',overflow:'auto',padding:24}}><div style={{maxWidth:460}}><VoiceSettings component={p.components[0]} project={p} board={catalog.boards.find(b=>b.id===p.boardId)} busy={false} idf={idf} onChange={(id,patch)=>{const before=p.components.find(c=>c.id===id);if(JSON.stringify(before)===JSON.stringify({...before,...patch}))return;setFresh(false);setFlashed(false);setP(old=>({...old,components:old.components.map(c=>c.id===id?{...c,...patch}:c)}));}}/></div></div>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(base64=>{
  window.isTauri=true;window.voiceFixture={audio:0,playing:0,builds:0,flashes:0};
  document.addEventListener('playing',()=>window.voiceFixture.playing++,true);
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  let next=1;const callbacks=new Map();
  window.__TAURI_INTERNALS__={transformCallback:fn=>{const id=next++;callbacks.set(id,fn);return id;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args)=>{
   if(command==='plugin:event|listen'){window.voiceFixture.progress=callbacks.get(args.handler);return next++;}
   if(command==='plugin:event|unlisten')return null;
   if(command==='idf_cancel'){window.voiceFixture.endTest?.();return null;}
   if(command==='voice_test'){window.voiceFixture.testId=args.id;return new Promise(resolve=>{window.voiceFixture.endTest=resolve;});}
   if(command==='voice_audio'){window.voiceFixture.audio++;return base64;}
   if(command==='voice_record'){window.voiceFixture.recordId=args.id;return new Promise(resolve=>{window.voiceFixture.finishRecord=resolve;});}
   throw Error('Unexpected RPC '+command);
  }};
 },Buffer.from(wave).toString('base64'));
 try{
  await page.goto((process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1431')+'/.artifacts/'+stem+'.html');
  assert.equal(await page.getByLabel('Ожидание голосовой команды',{exact:true}).inputValue(),'5');
  await page.getByText(/Одно обращение – одна команда/).waitFor();
  await page.getByLabel('Звук после распознавания команды',{exact:true}).check();
  await page.getByLabel('Файл ответа на распознанную команду',{exact:true}).setInputFiles({name:'trying.wav',mimeType:'audio/wav',buffer:Buffer.from(wave)});
  await page.getByText('trying.wav · 3.0 сек.',{exact:true}).waitFor();
  const volume=page.getByLabel('Громкость ответа на команду',{exact:true});
  await volume.focus();for(let i=0;i<25;i++)await volume.press('ArrowLeft');
  const stored=await page.evaluate(()=>window.voiceFixtureProject);
  assert.equal(stored.components[0].parameters.recognitionSound,true);assert.equal(stored.components[0].parameters.recognitionVolume,60);
  assert.equal(stored.components[0].parameters.profile,project.components[0].parameters.profile);assert.deepEqual(stored.logic,project.logic);
  await page.screenshot({path:'.artifacts/voice-workflow/recognition-response.png'});
  await page.getByLabel('Звук после распознавания команды',{exact:true}).uncheck();
  assert.equal(await page.evaluate(()=>window.voiceFixtureProject.components[0].parameters.recognitionSound),false);
  assert.ok(await page.evaluate(()=>window.voiceFixtureProject.components[0].parameters.recognitionAudio));
  await page.getByRole('button',{name:'Настроить распознавание',exact:true}).click();const dialog=page.getByRole('dialog');
  for(const label of ['1. Плата','2. Записи','3. Модель','4. Проверка']){
   await dialog.getByRole('button',{name:label,exact:true}).click();
   assert.equal(await dialog.getByRole('button',{name:/^(Собрать прошивку|Собрано)$/}).count(),1);
   assert.equal(await dialog.getByLabel('USB-порт голосового компонента').count(),1);
  }
  await dialog.getByRole('button',{name:'3. Модель',exact:true}).click();
  assert.equal(await dialog.getByRole('button',{name:'Записать на плату',exact:true}).isEnabled(),false);
  await dialog.getByRole('button',{name:'Собрать прошивку',exact:true}).click();
  await dialog.getByRole('button',{name:'Записать на плату',exact:true}).click();
  await dialog.getByText('На плате текущая прошивка проекта. Можно перейти к проверке.',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Собрано',exact:true}).count(),1);
  assert.equal(await dialog.getByRole('button',{name:'Записано',exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>window.voiceFixture.builds),1);assert.equal(await page.evaluate(()=>window.voiceFixture.flashes),1);
  assert.equal(await page.evaluate(()=>window.voiceFixture.builtProfile),project.components[0].parameters.profile);
  assert.equal(await page.evaluate(()=>window.voiceFixture.builtWake),project.components[0].parameters.wakeProfile);
  await page.screenshot({path:'.artifacts/voice-workflow/model-actions.png'});
  await dialog.getByRole('button',{name:'2. Записи',exact:true}).click();
  await dialog.getByRole('button',{name:'Прослушать запись 1',exact:true}).click();
  await page.waitForFunction(()=>window.voiceFixture.playing===1);
  assert.equal(await page.evaluate(()=>window.voiceFixture.audio),1);
  assert.equal(await dialog.getByLabel('Прослушивание выбранной записи').evaluate(el=>el.paused),false);
  await dialog.getByRole('button',{name:'Прослушать запись 2',exact:true}).click();
  await page.waitForFunction(()=>window.voiceFixture.playing===2);
  assert.equal(await page.evaluate(()=>window.voiceFixture.audio),2);
  await dialog.getByRole('button',{name:'4. Проверка',exact:true}).click();
  await dialog.getByRole('button',{name:'Начать проверку',exact:true}).click();
  await page.waitForFunction(()=>Boolean(window.voiceFixture.testId));
  await page.evaluate(()=>window.voiceFixture.progress({payload:{id:window.voiceFixture.testId,state:'result',message:'CLEX_VOICE_ERROR microphone_read'}}));
  await dialog.getByRole('alert').filter({hasText:'Плата повторяет попытку'}).waitFor();
  await page.evaluate(()=>window.voiceFixture.progress({payload:{id:window.voiceFixture.testId,state:'result',message:'CLEX_VOICE_RECOVERED microphone'}}));
  await dialog.getByText('Приём звука восстановлен. Повторите фразу.',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('alert').count(),0);
  await dialog.locator('footer').getByRole('button',{name:'Остановить',exact:true}).click();
  await dialog.locator('footer').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Настроить фразу активации',exact:true}).click();
  await dialog.getByRole('button',{name:'3. Модель',exact:true}).click();
  assert.equal(await dialog.getByRole('button',{name:'Собрано',exact:true}).count(),1);
  await page.setViewportSize({width:1000,height:700});await page.screenshot({path:'.artifacts/voice-workflow/wake-model-actions.png'});
  assert.equal(await page.evaluate(()=>window.voiceFixture.builds),1);assert.equal(await page.evaluate(()=>window.voiceFixture.flashes),1);
  await dialog.locator('footer').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Настроить распознавание',exact:true}).click();
  await dialog.getByRole('button',{name:'2. Записи',exact:true}).click();
  await dialog.getByRole('button',{name:'Начать сеанс записи',exact:true}).click();
  await dialog.getByRole('button',{name:'Записать 3 секунды',exact:true}).click();
  await page.waitForFunction(()=>Boolean(window.voiceFixture.recordId));
  for(const [state,message]of [['countdown','1'],['waiting-for-speech','Произнесите фразу. Запись начнётся с голоса']])
   await page.evaluate(({state,message})=>window.voiceFixture.progress({payload:{id:window.voiceFixture.recordId,state,message}}),{state,message});
  await dialog.locator('.voice-countdown').filter({hasText:'Произнесите фразу. Запись начнётся с голоса'}).waitFor();
  assert.equal(await dialog.locator('.voice-countdown').innerText(),'Произнесите фразу. Запись начнётся с голоса');
  await page.screenshot({path:'.artifacts/voice-workflow/waiting-for-speech.png'});
  await page.evaluate(()=>window.voiceFixture.progress({payload:{id:window.voiceFixture.recordId,state:'recording',message:'Говорите'}}));
  await dialog.locator('.voice-countdown').filter({hasText:/Говорите · 3/}).waitFor();
  assert.match(await dialog.locator('.voice-countdown').innerText(),/Говорите · 3/);
  const sample={...JSON.parse(project.components[0].parameters.profile).samples[0],id:'f'.repeat(64)};
  await page.evaluate(sample=>window.voiceFixture.finishRecord(sample),sample);
  await dialog.locator('footer').getByRole('button',{name:'Закрыть',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>JSON.parse(window.voiceFixtureProject.components[0].parameters.profile).model===null);
  assert.deepEqual(errors,[]);
  console.log('PASS: one shared firmware control group across all tabs, reuse after closing, speech-onset feedback, one-click playback, preserved models/graph and recovery feedback. Device RPCs are isolated mocks.');
 }finally{await browser.close();await fs.unlink('.artifacts/'+stem+'.html');await fs.unlink('.artifacts/'+stem+'.jsx');}
})().catch(error=>{console.error(error);process.exitCode=1;});
