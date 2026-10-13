/* global DOMPoint, document, getComputedStyle */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {peripheralProject}=await import('./peripheral-fixture.js'),{catalog}=await import('./catalog-fixture.js'),{connectTerminal}=await import('../src/assembly/model.js'),{generateFirmware,firmwareFingerprint}=await import('../src/firmware/generator.js');
 let project=peripheralProject({audio:false,camera:false});const display=project.components.find(c=>catalog.modules.find(m=>m.id===c.moduleId)?.display);
 project=connectTerminal(project,catalog,display.id,'vcc','P2-1');project=connectTerminal(project,catalog,display.id,'gnd','P2-3');
 const before=await firmwareFingerprint(generateFirmware(project,catalog));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE}),page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const saved=()=>page.evaluate(()=>JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
 const save=async()=>{await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Проект сохранен',{exact:true}).waitFor();return saved();};
 try{
  await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1'))localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));},project);
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430');await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();
  await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  const id=project.assembly.connections.find(w=>w.terminalId==='vcc').id,wire=page.locator('.physical-wire[data-wire="'+id+'"]');
  const pinData=catalog.boards.find(board=>board.id===project.boardId).pins.find(pin=>pin.id==='P2-1');
  const points=JSON.parse(await wire.getAttribute('data-route-points'));assert.deepEqual(points[0],[project.assembly.positions.board.x+pinData.x,project.assembly.positions.board.y+pinData.y]);
  const distance=points.slice(1).reduce((sum,p,i)=>sum+Math.abs(p[0]-points[i][0])+Math.abs(p[1]-points[i][1]),0),direct=Math.abs(points[0][0]-points.at(-1)[0])+Math.abs(points[0][1]-points.at(-1)[1]);
  assert.ok(distance<direct+180,'no old perimeter loop');
  await wire.focus();await page.keyboard.press('Enter');const handle=wire.locator('.wire-bend-control').first();await handle.waitFor();
  const box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+28,box.y+box.height/2-25,{steps:12});
  const preview=await wire.evaluate(e=>{const points=JSON.parse(e.dataset.routePoints),h=e.querySelector('.wire-bend-control');return{points,handle:[Number(h.getAttribute('cx')),Number(h.getAttribute('cy'))]};});
  assert.deepEqual(preview.points[0],points[0]);assert.deepEqual(preview.points.at(-1),points.at(-1));
  assert.ok(preview.points.slice(1).some((b,i)=>{const a=preview.points[i],h=preview.handle;return a[0]===b[0] && h[0]===a[0] && h[1]>=Math.min(a[1],b[1]) && h[1]<=Math.max(a[1],b[1]) || a[1]===b[1] && h[1]===a[1] && h[0]>=Math.min(a[0],b[0]) && h[0]<=Math.max(a[0],b[0]);}),'drag handle stays on its segment');
  await page.mouse.up();
  assert.equal(await wire.getAttribute('data-route-mode'),'manual');const edited=await save();assert.ok(edited.assembly.connections.find(w=>w.id===id).route.length);
  assert.deepEqual(edited.gpioAssignments,project.gpioAssignments);assert.equal(await firmwareFingerprint(generateFirmware(edited,catalog)),before);
  const route=JSON.parse(await wire.getAttribute('data-route-points'));assert.deepEqual(route[0],points[0]);assert.deepEqual(route.at(-1),points.at(-1));
  assert.ok(route.every((p,i)=>!i || p[0]===route[i-1][0] || p[1]===route[i-1][1]));
  await page.screenshot({path:'.artifacts/p4-peripherals/manual-route.png'});
  await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
  const restored=page.locator('.physical-wire[data-wire="'+id+'"]');assert.equal(await restored.getAttribute('data-route-mode'),'manual');assert.deepEqual(JSON.parse(await restored.getAttribute('data-route-points')),route);

  const movedPath=page.locator('.physical-wire[data-wire="'+id+'"]');
  const checkRoute=async()=>{
   const points=JSON.parse(await movedPath.getAttribute('data-route-points'));
   for(let i=1;i<points.length;i++){
    assert.ok(points[i-1][0]===points[i][0] || points[i-1][1]===points[i][1],'moved route stays orthogonal');
    assert.notDeepEqual(points[i-1],points[i]);
    if(i>1)assert.ok(points[i-2][0]!==points[i][0] || points[i-2][1]!==points[i][1],'no stale backtracking segment');
   }
   return points;
  };
  for(const [nodeId,dx,dy] of [[display.id,-95,-110],['board',48,65],[display.id,50,42]]){
   const beforePoints=await checkRoute(),stateBefore=await saved(),node=page.locator('.react-flow__node[data-id="'+nodeId+'"]'),bounds=await node.boundingBox();
   await page.mouse.move(bounds.x+bounds.width/2,bounds.y+18);await page.mouse.down();
   await page.mouse.move(bounds.x+bounds.width/2+dx,bounds.y+18+dy,{steps:14});
   const live=await checkRoute();assert.notDeepEqual(live,beforePoints,'manual wire follows the node during drag');
   await page.mouse.up();
   const after=await save(),position=after.assembly.positions[nodeId],oldPosition=stateBefore.assembly.positions[nodeId],delta=[position.x-oldPosition.x,position.y-oldPosition.y];
   const movedIndex=nodeId==='board'?0:live.length-1,fixedIndex=nodeId==='board'?live.length-1:0;
   const expectedEndpoint=beforePoints[nodeId==='board'?0:beforePoints.length-1].map((value,axis)=>value+delta[axis]);
   live[movedIndex].forEach((value,axis)=>assert.ok(Math.abs(value-expectedEndpoint[axis])<1e-7,'contact follows node displacement'));
   assert.deepEqual(live[fixedIndex],beforePoints[nodeId==='board'?beforePoints.length-1:0]);
   assert.deepEqual(await checkRoute(),live,'drop preserves live route geometry');
   assert.deepEqual(after.assembly.connections.find(w=>w.id===id).route,live.slice(1,-1).map(([x,y])=>({x,y})),'new waypoint positions are saved');
   assert.deepEqual(after.gpioAssignments,project.gpioAssignments);assert.equal(await firmwareFingerprint(generateFirmware(after,catalog)),before);
   await page.reload();await page.locator('.project-open').click();await page.getByRole('button',{name:'Монтаж',exact:true}).click();await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
   assert.deepEqual(await checkRoute(),live,'reload preserves reattached route');
  }
  await page.screenshot({path:'.artifacts/p4-peripherals/manual-route-after-node-move.png'});

  await restored.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Автоматический маршрут',exact:true}).click();assert.equal(await restored.getAttribute('data-route-mode'),'auto');
  const reset=await save();assert.equal(reset.assembly.connections.find(w=>w.id===id).route,undefined);assert.equal(await firmwareFingerprint(generateFirmware(reset,catalog)),before);
  assert.equal(await page.locator('.physical-wire').count(),2);
  const groundId=project.assembly.connections.find(w=>w.terminalId==='gnd').id;
  const ground=await page.locator('.physical-wire[data-wire="'+groundId+'"]').evaluate(e=>{
   const path=e.querySelector('.visible-wire'),points=JSON.parse(e.dataset.routePoints);
   const segments=points.slice(1).map((b,i)=>({a:points[i],b})).filter(s=>s.a[1]===s.b[1]).sort((u,v)=>Math.abs(v.a[0]-v.b[0])-Math.abs(u.a[0]-u.b[0]));
   const {a,b}=segments[0],p=new DOMPoint((a[0]+b[0])/2,a[1]).matrixTransform(path.getScreenCTM());
   return{dash:getComputedStyle(path).strokeDasharray,topWire:document.elementFromPoint(p.x,p.y)?.closest('.physical-wire')?.dataset.wire};
  });
  assert.notEqual(ground.dash,'none');assert.equal(ground.topWire,groundId,'unselected GND remains visible and selectable above the board');
  await page.screenshot({path:'.artifacts/p4-peripherals/short-routes.png'});
  const pin=await page.locator('.board-pin[data-pin="P2-1"] circle').boundingBox();await page.mouse.click(pin.x+pin.width/2,pin.y+pin.height/2);await page.locator('.inspector-pin').waitFor();assert.equal(await page.locator('.inspector-pin').innerText(),'5V');
  assert.deepEqual(errors,[]);console.log('PASS: P4 internal pin routing, visible wires above own board, segment drag with attached handle, fixed endpoints, component/board moves with saved reattached waypoints, orthogonal path, save/reload/reset and unchanged GPIO/firmware.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
