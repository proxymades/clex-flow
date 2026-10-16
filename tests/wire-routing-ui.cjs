const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {displayProject}=await import('./display-fixture.js');
 const {catalog}=await import('./catalog-fixture.js');
 const {POWER_COLOR}=await import('../src/assembly/wireColors.js');
 const {connectTerminal}=await import('../src/assembly/model.js');
 const {serializeProject}=await import('../src/projects/model.js');
 const {generateFirmware,firmwareFingerprint}=await import('../src/firmware/generator.js');
 let project=displayProject();const id=project.components[0].id;
 project=connectTerminal(project,catalog,id,'gnd','P38');
 project.assembly.connections.forEach((wire,i)=>{wire.id=String.fromCharCode(97+i*3);}); // Old hash put all of these in the same lane.
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();};
 const separated=async()=>{
  const paths=await page.locator('.physical-wire').evaluateAll(elements=>Object.fromEntries(elements.map(element=>[element.dataset.wire,JSON.parse(element.dataset.routePoints)])));
  const ground=paths[project.assembly.connections.find(w=>w.terminalId==='gnd').id],power=paths[project.assembly.connections.find(w=>w.terminalId==='vcc').id];
  assert.ok(ground.length>=3 && power.length>=3);
  for(let i=1;i<ground.length;i++)for(let j=1;j<power.length;j++){
   const a=ground[i-1],b=ground[i],c=power[j-1],d=power[j],horizontal=a[1]===b[1];if(horizontal!==(c[1]===d[1]))continue;
   const axis=horizontal?0:1;if(Math.abs(a[1-axis]-c[1-axis])>0.01)continue;
   const overlap=Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis]));assert.ok(overlap<=0,'parallel power and ground segments stay separate');
  }
 };
 try{
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1420');
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Открыть JSON',exact:true}).click();
  await(await chooser).setFiles({name:'routes.clex.json',mimeType:'application/json',buffer:Buffer.from(serializeProject(project))});
  await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  await page.locator('.physical-wire').nth(6).waitFor();await separated();
  const styles=await page.locator('.physical-wire').evaluateAll(elements=>Object.fromEntries(elements.map(element=>{const path=element.querySelector('.visible-wire');return[element.dataset.wire,{stroke:path.style.stroke,dash:path.style.strokeDasharray}];})));
  const powerId=project.assembly.connections.find(w=>w.terminalId==='vcc').id,groundId=project.assembly.connections.find(w=>w.terminalId==='gnd').id;
  assert.equal(styles[powerId].stroke,'rgb('+POWER_COLOR.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')+')');assert.ok(styles[groundId].dash);
  const signals=project.assembly.connections.filter(w=>!['vcc','gnd'].includes(w.terminalId));
  assert.equal(new Set(signals.map(w=>styles[w.id].stroke)).size,signals.length);
  const frame=await page.locator('.assembly-flow-region').boundingBox();
  const bounds=await page.locator('.visible-wire').evaluateAll(elements=>elements.map(e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom};}));
  for(const b of bounds)assert.ok(b.x>=frame.x-1&&b.y>=frame.y-1&&b.right<=frame.x+frame.width+1&&b.bottom<=frame.y+frame.height+1,'detours fit inside initial view');
  const before=await saved(),fingerprint=await firmwareFingerprint(generateFirmware(before,catalog));
  await page.screenshot({path:'.artifacts/wire-routing-display.png'});
  const node=page.locator('.react-flow__node[data-id="'+id+'"]'),box=await node.boundingBox();
  await page.mouse.move(box.x+45,box.y+18);await page.mouse.down();await page.mouse.move(box.x+90,box.y+50,{steps:16});await page.mouse.up();
  await save();await separated();
  await page.getByRole('button',{name:'Компонент '+project.components[0].name,exact:true}).click();
  await page.getByRole('combobox',{name:'Сторона контакта: GND',exact:true}).selectOption('bottom');
  await page.getByRole('combobox',{name:'Сторона контакта: VCC · 3,3 В',exact:true}).selectOption('right');
  await save();await separated();
  const after=await saved();assert.deepEqual(after.assembly.connections,before.assembly.connections);assert.deepEqual(after.gpioAssignments,before.gpioAssignments);
  assert.equal(await firmwareFingerprint(generateFirmware(after,catalog)),fingerprint);
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();await separated();
  const restored=await page.locator('.physical-wire').evaluateAll(elements=>Object.fromEntries(elements.map(element=>[element.dataset.wire,element.querySelector('.visible-wire').style.stroke])));
  for(const [id,style] of Object.entries(styles))assert.equal(restored[id],style.stroke);
  await page.screenshot({path:'.artifacts/wire-routing-sides.png'});
  assert.deepEqual(errors,[]);console.log('PASS: old lane collision reproduced as input; separate source/corridor lanes, live node drag, changed contact sides and reload; physical IDs, GPIO and firmware unchanged.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
