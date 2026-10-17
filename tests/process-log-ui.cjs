/* global window, document */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 await fs.mkdir('.artifacts',{recursive:true});
 const stem='process-panel-harness-'+Date.now();
 const component=process.env.CLEX_LOG_COMPONENT||'/src/idf/ProcessPanel.jsx';
 await fs.writeFile('.artifacts/'+stem+'.html',`<html><body><div id="fixture"></div><script type="module" src="/.artifacts/${stem}.jsx"></script></body></html>`);
 await fs.writeFile('.artifacts/'+stem+'.jsx',`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import ProcessPanel from '${component}';import '../src/styles.css';import{appendProcessEvent}from'../src/idf/processEvents.js';
 function Fixture(){const[events,setEvents]=useState([]),[height,setHeight]=useState(220),[build,setBuild]=useState(null);window.logFixture={append:(count,operation='build')=>setEvents(old=>[...old,...Array.from({length:count},(_,i)=>({sequence:old.length+i,operation,status:'running',stream:'stdout',text:'Строка '+(old.length+i)+'\\n'}))]),progress:(sequence,text,key='component')=>setEvents(old=>appendProcessEvent(old,{jobId:'test',operation:'build',status:'progress',stream:'system',sequence,progressKey:key,text})),resize:setHeight,finish:()=>setBuild({binary:'/isolated-test/firmware.bin'})};return <div style={{height,width:780,display:'grid',gridTemplateRows:'minmax(0,1fr)',position:'fixed',top:0,left:0}}><ProcessPanel idf={{events,job:{id:'test',operation:'build',status:'running'},build,fresh:true,busy:false}} issues={[]} onPreview={()=>{}} onIssue={()=>{}}/></div>;}createRoot(document.getElementById('fixture')).render(<Fixture/>);`);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const tail=()=>page.waitForFunction(()=>{const log=document.querySelector('.process-log');return log&&log.scrollHeight-log.scrollTop-log.clientHeight<3;},{},{timeout:1500});
 try{
  await page.goto((process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420')+'/.artifacts/'+stem+'.html');
  await page.getByRole('log').waitFor();
  for(let i=0;i<8;i++){await page.evaluate(()=>window.logFixture.append(80));await tail();}
  await page.evaluate(()=>window.logFixture.resize(130));await tail();
  await page.evaluate(()=>window.logFixture.finish());await tail();
  const rows=await page.locator('.process-line').count();
  for(let i=0;i<8;i++)await page.evaluate(i=>window.logFixture.progress(100000+i,'Загрузка lvgl/lvgl 9.2.2: '+i+' / 15,2 МБ · 320 КБ/с'),i);
  assert.equal(await page.locator('.process-line').count(),rows+1);
  await page.getByText('Загрузка lvgl/lvgl 9.2.2: 7 / 15,2 МБ · 320 КБ/с',{exact:true}).waitFor();await tail();

  await page.getByRole('log').hover();await page.mouse.wheel(0,-700);
  await page.getByRole('button',{name:'К последним сообщениям',exact:true}).waitFor();
  const before=await page.getByRole('log').evaluate(element=>element.scrollTop);
  await page.evaluate(()=>window.logFixture.append(60));
  await page.evaluate(()=>window.logFixture.progress(100010,'Загрузка lvgl/lvgl 9.2.2: 8,4 / 15,2 МБ · 55% · 0 КБ/с · данные не поступают 15 с'));

  assert.ok(await page.getByRole('log').evaluate(element=>element.scrollHeight-element.scrollTop-element.clientHeight)>100);
  assert.ok(Math.abs(await page.getByRole('log').evaluate(element=>element.scrollTop)-before)<3,'manual reading remains in place');
  await page.getByRole('button',{name:'К последним сообщениям',exact:true}).click();await tail();
  await page.evaluate(()=>window.logFixture.append(80));await tail();
  await page.getByRole('button',{name:'Монитор',exact:true}).click();
  await page.evaluate(()=>window.logFixture.append(90,'monitor'));await tail();
  await page.getByRole('button',{name:'Сборка и прошивка',exact:true}).click();await tail();
  await page.evaluate(()=>window.logFixture.resize(260));
  await page.evaluate(()=>window.logFixture.progress(100012,'Загрузка lvgl/lvgl 9.2.2: 8,4 / 15,2 МБ · 55% · 0 КБ/с · данные не поступают 15 с','download-preview'));
  await page.evaluate(()=>window.logFixture.progress(100011,'Распаковка lvgl/lvgl 9.2.2','unpack'));await tail();
  await page.screenshot({path:'.artifacts/download-progress-log.png'});
  assert.deepEqual(errors,[]);console.log('PASS: burst output follows tail; resizing and build footer preserve tail; manual scroll pauses; tail button resumes; Serial and tab switching follow.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
