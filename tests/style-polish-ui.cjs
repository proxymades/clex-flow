/* global document, window, getComputedStyle */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {networkProject}=await import('./network-fixture.js');
 const project=networkProject(),display=project.logic.nodes.find(node=>node.moduleId==='clex.logic.display');
 project.name='Проверка оформления';Object.values(project.screens)[0].elements[0].text='Ёжик и ёлка';
 const browser=await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE||process.argv[2]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(p=>{if(!localStorage.getItem('clex-flow:projects:v1'))localStorage.setItem('clex-flow:projects:v1',JSON.stringify({[p.id]:JSON.stringify(p)}));},project);
 const url=process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430';
 async function gaps(root){const failures=await root.evaluate(element=>{
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const buttons=[...element.querySelectorAll('button.button')].filter(visible),parents=[...new Set(buttons.map(b=>b.parentElement))],bad=[];
  for(const parent of parents){const items=buttons.filter(b=>b.parentElement===parent);for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i].getBoundingClientRect(),b=items[j].getBoundingClientRect();const horizontal=Math.max(a.left,b.left)-Math.min(a.right,b.right),vertical=Math.max(a.top,b.top)-Math.min(a.bottom,b.bottom);if(horizontal<5&&vertical<5)bad.push(items[i].textContent+' / '+items[j].textContent);}}
  return bad;
 });assert.deepEqual(failures,[],'standalone action buttons have spacing');}
 try{
  await page.goto(url);assert.equal(await page.getByRole('button',{name:'Новый проект',exact:true}).count(),1);assert.equal(await page.locator('.topbar').getByRole('button',{name:'Новый проект',exact:true}).count(),0);await gaps(page.locator('body'));
  await page.getByRole('button',{name:'Новый проект',exact:true}).click();await gaps(page.getByRole('dialog'));await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await page.locator('.project-open').click();await page.getByRole('button',{name:'Логика',exact:true}).click();await page.locator('.logic-node').first().waitFor();await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();await page.waitForTimeout(150);
  const renderedEdges=await page.locator('.react-flow__edge').evaluateAll(elements=>elements.map(edge=>{const path=edge.querySelector('.react-flow__edge-path'),markerId=path.getAttribute('marker-end').match(/#(.+?)['"]?\)$/)[1],marker=document.getElementById(markerId);return {id:edge.dataset.id,stroke:path.style.stroke,dash:path.style.strokeDasharray,marker:marker?.querySelector('polyline')?.style.stroke};}));
  assert.equal(new Set(renderedEdges.map(edge=>edge.stroke)).size,project.logic.edges.length,'each route has a distinct color');
  for(const edge of renderedEdges){assert.equal(Boolean(edge.dash),project.logic.edges.find(item=>item.id===edge.id).dataType==='event');assert.equal(edge.marker,edge.stroke,'arrow and line colors match');}
  const viewport=await page.locator('.reactflow-region').boundingBox();await page.locator('.react-flow__viewport').evaluate(element=>{element.style.transform='translate(0px,0px) scale(1)';});
  // Inspect layout in node coordinates, independent of the chosen zoom.
  const rows=await page.locator('.logic-port-row.single-port-row').evaluateAll(elements=>elements.map(row=>{const label=row.querySelector('.port-label-copy'),port=row.querySelector('.logic-port'),dot=row.querySelector('.port-type-dot'),button=row.querySelector('button');return {text:label.textContent,full:port.getBoundingClientRect().width/row.getBoundingClientRect().width,clamp:getComputedStyle(label).webkitLineClamp,dotNear:port.classList.contains('output')?dot.getBoundingClientRect().left>label.getBoundingClientRect().right-1:dot.getBoundingClientRect().right<label.getBoundingClientRect().left+1,overflow:label.scrollWidth>label.clientWidth+1,height:button.getBoundingClientRect().height};}));
  assert.ok(rows.length>=10);assert.ok(rows.every(row=>row.full>.98&&row.clamp==='none'&&row.dotNear&&!row.overflow),JSON.stringify(rows));
  await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();await page.waitForTimeout(150);
  const card=page.locator('.react-flow__node[data-id="'+display.id+'"]');await card.locator('header').click();
  const networkCard=page.locator('.react-flow__node[data-id="'+project.logic.nodes.find(node=>node.moduleId==='clex.logic.ethernet').id+'"]');
  await networkCard.locator('header').click();
  const focus=await page.locator('.react-flow__edge').evaluateAll(elements=>elements.map(edge=>({id:edge.dataset.id,opacity:Number(edge.querySelector('.react-flow__edge-path').style.opacity)})));
  assert.ok(focus.some(edge=>edge.opacity===0.25));assert.ok(focus.some(edge=>edge.opacity===1));await card.locator('header').click();
  await gaps(page.locator('.workspace-properties'));assert.equal(await page.locator('.workspace-properties .inspector-screen-actions .button').count(),2);
  await page.screenshot({path:'.artifacts/style-polish-logic.png',animations:'disabled'});
  await page.getByRole('button',{name:'Открыть редактор экрана',exact:true}).click();const editor=page.getByRole('dialog');await editor.waitFor();await gaps(editor);assert.equal(await editor.locator('.screen-element-list button svg').count(),Object.values(project.screens)[0].elements.length);assert.ok(await editor.locator('[data-element-type="indicator"] .lucide-circle-dot').count()>0);assert.ok(await editor.locator('[data-element-type="text"] .lucide-type').count()>0);assert.equal(await editor.locator('[data-screen-element]').filter({hasText:'Ёжик и ёлка'}).count(),1);await page.screenshot({path:'.artifacts/style-polish-editor.png',animations:'disabled'});await editor.getByRole('button',{name:'Отмена',exact:true}).click();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();await gaps(page.locator('.settings-page'));await page.setViewportSize({width:1000,height:700});await gaps(page.locator('.settings-page'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await page.getByRole('button',{name:'Текущий проект',exact:true}).click();await page.getByRole('button',{name:'Логика',exact:true}).click();await page.locator('.logic-node').first().waitFor();await page.getByRole('button',{name:'Показать весь граф',exact:true}).click();await page.waitForTimeout(150);await card.locator('header').click();await gaps(page.locator('.workspace-properties'));await page.screenshot({path:'.artifacts/style-polish-small.png',animations:'disabled'});
  const tags=await page.locator('.log-level').allTextContents();assert.ok(tags.length>0);assert.ok(tags.every(text=>!['ОК','ОШ','ВНИМ','ВЫВ'].includes(text)));assert.ok(viewport.width>0);assert.deepEqual(errors,[]);
  console.log('PASS: distinct route colors, signal dashes and selected-node route emphasis; full-width one-sided contacts, full labels, aligned type dots, separated action buttons across home/dialog/editor/inspector/settings, complete log labels, no duplicate topbar action, preserved user Ё text and small layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
