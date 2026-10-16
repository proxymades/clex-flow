/* global getComputedStyle */
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
 const {displayProject}=await import('./display-fixture.js'),{p4Project}=await import('./p4-fixture.js'),{peripheralProject}=await import('./peripheral-fixture.js'),{catalog}=await import('./catalog-fixture.js');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});
 const output='.artifacts/perimeter-routing';mkdirSync(output,{recursive:true});
 try{
  for(const [name,make,placement] of [['s3-right',displayProject,'right'],['s3-below',displayProject,'below'],['p4-right',p4Project,'right'],['p4-dsi',()=>peripheralProject({audio:false,camera:false}),'right']]){
   const p=make(),board=catalog.boards.find(b=>b.id===p.boardId),display=p.components.find(c=>catalog.modules.find(m=>m.id===c.moduleId)?.display);
   p.assembly.positions.board={x:400,y:100};
   p.components.forEach((c,i)=>{p.assembly.positions[c.id]=placement==='right'?{x:400+board.width+180+i*300,y:180}:{x:120+i*300,y:100+board.height+120};});
   const page=await browser.newPage({viewport:{width:1680,height:1120}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(p=>localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)})),p);
   await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430');
   await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();
   await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
   await page.locator('.physical-wire').nth(p.assembly.connections.length-1).waitFor();
   const wires=await page.locator('.physical-wire').evaluateAll(es=>es.map(e=>({id:e.dataset.wire,points:JSON.parse(e.dataset.routePoints),opacity:getComputedStyle(e.querySelector('.visible-wire')).opacity,outline:Boolean(e.querySelector('.wire-outline')),color:getComputedStyle(e.querySelector('.visible-wire')).stroke})));
   assert.equal(wires.length,p.assembly.connections.length);
   for(const w of wires){assert.equal(w.opacity,'1');assert.ok(w.outline);assert.ok(w.points.every((b,i)=>!i||b[0]===w.points[i-1][0]||b[1]===w.points[i-1][1]));}
   await page.screenshot({path:output+'/'+name+'.png'});
   const selected=page.locator('.physical-wire').first();await selected.focus();await page.keyboard.press('Enter');
   assert.equal(await selected.locator('.visible-wire').evaluate(e=>getComputedStyle(e).opacity),'1');
   assert.equal(await page.locator('.physical-wire').nth(1).locator('.visible-wire').evaluate(e=>getComputedStyle(e).opacity),'0.3');
   await page.screenshot({path:output+'/'+name+'-selected.png'});
   await page.locator('.assembly-flow-region .react-flow__pane').click({position:{x:5,y:80}});
   const cleared=await page.locator('.physical-wire .visible-wire').evaluateAll(es=>es.map(e=>getComputedStyle(e).opacity));
   assert.ok(cleared.every(opacity=>opacity==='1'),'clearing selection restores all wires');
   await page.getByRole('button',{name:'Компонент '+display.name,exact:true}).click();
   assert.deepEqual(errors,[]);console.log('PASS: '+name+' perimeter, visible saturated wires, crossing outlines and selected-wire focus');
   await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
