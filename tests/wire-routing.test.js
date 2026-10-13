import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateWireLanes,orthogonalWireRoute,routeAssemblyEdges,wireFitPadding,wireObstacles,segmentCrossesObstacle,manualWirePoints,reanchorManualRoute} from '../src/assembly/wireRouting.js';
import {catalog} from './catalog-fixture.js';
import {peripheralProject} from './peripheral-fixture.js';
import {physicalEdges} from '../src/assembly/flow.js';
import {terminalLayout} from '../src/assembly/terminalLayout.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
import {transformAssembly} from '../src/assembly/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
function fixture(){
 const p=peripheralProject({audio:false,camera:false}),board=catalog.boards.find(b=>b.id===p.boardId),nodes=[{id:'board',position:p.assembly.positions.board,width:board.width,height:board.height}];
 for(const component of p.components){const layout=terminalLayout(catalog.modules.find(m=>m.id===component.moduleId));nodes.push({id:component.id,position:p.assembly.positions[component.id],width:layout.width,height:layout.height});}
 const edges=allocateWireLanes(physicalEdges(p).map(edge=>{
  const wire=p.assembly.connections.find(w=>w.id===edge.id),c=p.components.find(c=>c.id===wire.componentId),layout=terminalLayout(catalog.modules.find(m=>m.id===c.moduleId));
  return {...edge,data:{sourcePin:board.pins.find(pin=>pin.id===wire.boardPinId),boardWidth:board.width,boardHeight:board.height,targetTerminal:layout.terminals.find(t=>t.id===wire.terminalId)}};
 }));return {p,board,nodes,edges};
}
const segmentOverlap=(a,b,c,d)=>{
 const horizontal=a[1]===b[1];if(horizontal!==(c[1]===d[1]))return 0;
 const axis=horizontal?0:1;if(Math.abs(a[1-axis]-c[1-axis])>0.001)return 0;
 return Math.max(0,Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis])));
};
test('internal P4 pin exits across its own board with short orthogonal geometry and avoids all other pin labels and components',()=>{
 const {board,nodes,edges}=fixture(),routed=routeAssemblyEdges(edges,nodes,board);
 for(const edge of routed){const {route}=edge.data,pin=edge.data.sourcePin;
  assert.equal(route.blocked,false);assert.deepEqual(route.points[0],[nodes[0].position.x+pin.x,nodes[0].position.y+pin.y]);
  assert.ok(route.points.every((p,i)=>!i || p[0]===route.points[i-1][0] || p[1]===route.points[i-1][1]));
  const distance=route.points.reduce((sum,p,i)=>i?sum+Math.abs(p[0]-route.points[i-1][0])+Math.abs(p[1]-route.points[i-1][1]):0,0);
  const [start,end]=[route.points[0],route.points.at(-1)],direct=Math.abs(start[0]-end[0])+Math.abs(start[1]-end[1]);assert.ok(distance<direct+180,'no large perimeter detour');
  assert.ok(Math.min(...route.points.map(p=>p[1]))>=Math.min(start[1],end[1])-80,'line stays close to its pin rows');
  const target=edge.target;const obstacles=wireObstacles({...edge.data,sceneNodes:nodes.filter(n=>n.id!==target)});
  for(let i=1;i<route.points.length;i++)assert.equal(obstacles.some(o=>segmentCrossesObstacle(route.points[i-1],route.points[i],o)),false);
 }
 const [a,b]=routed.map(e=>e.data.route.points);
 for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++)assert.equal(segmentOverlap(a[i-1],a[i],b[j-1],b[j]),0,'parallel wires do not share a segment');
});
test('routing lanes and paths are stable after serialized edge order changes',()=>{
 const {board,nodes,edges}=fixture(),a=routeAssemblyEdges(edges,nodes,board),b=routeAssemblyEdges(allocateWireLanes([...edges].reverse()),nodes,board);
 for(const edge of a)assert.deepEqual(edge.data.route.points,b.find(e=>e.id===edge.id).data.route.points);
 const sameColumn=Array.from({length:3},(_,i)=>({id:['a','d','g'][i],source:'board',target:'display',targetHandle:String(i),data:{sourcePin:{x:458,y:222+i*30},boardWidth:724}}));
 assert.deepEqual(allocateWireLanes(sameColumn).map(e=>e.data.laneIndex),[0,1,2]);
});
test('all target sides retain exact anchor and outward approach without treating board body as an obstacle',()=>{
 for(const side of ['left','right','top','bottom']){
  const position={x:940,y:100},width=250,height=220,terminal={left:[0,125],right:[250,125],top:[125,0],bottom:[125,220]}[side],end=[position.x+terminal[0],position.y+terminal[1]];
  const route=orthogonalWireRoute({data:{sourceAnchor:[558,262],targetAnchor:end,sceneNodes:[{id:'display',position,width,height}],boardPins:[]},targetPosition:side});
  assert.deepEqual(route.points[0],[558,262]);assert.deepEqual(route.points.at(-1),end);assert.equal(route.blocked,false);
  const previous=route.points.at(-2);if(side==='left')assert.ok(previous[0]<end[0]);if(side==='right')assert.ok(previous[0]>end[0]);if(side==='top')assert.ok(previous[1]<end[1]);if(side==='bottom')assert.ok(previous[1]>end[1]);
 }
});
test('manual routes persist with project, remain orthogonal as endpoints move and never change GPIO or firmware identity',async()=>{
 const {p,board,nodes,edges}=fixture(),before=await firmwareFingerprint(generateFirmware(p,catalog));
 p.assembly.connections[0].route=[{x:570,y:206},{x:850,y:206},{x:850,y:225}];
 const restored=parseProject(serializeProject(p));assert.deepEqual(restored.assembly.connections[0].route,p.assembly.connections[0].route);
 assert.equal(await firmwareFingerprint(generateFirmware(restored,catalog)),before);
 const data={...edges[0].data,manualRoute:p.assembly.connections[0].route,sourceAnchor:[558,262],targetAnchor:[940,225]};
 for(const delta of [0,100]){const result=orthogonalWireRoute({data:{...data,sourceAnchor:[558+delta,262+delta]}});assert.ok(result.manual);assert.deepEqual(result.points[0],[558+delta,262+delta]);assert.ok(result.points.every((p,i)=>!i || p[0]===result.points[i-1][0] || p[1]===result.points[i-1][1]));}
 for(const route of [[{x:NaN,y:0}],Array(33).fill({x:0,y:0}),[{x:50001,y:0}]])assert.throws(()=>serializeProject({...p,assembly:{...p.assembly,connections:p.assembly.connections.map((w,i)=>i===0?{...w,route}:w)}}),/маршрут/);
 assert.equal(wireFitPadding(nodes,routeAssemblyEdges(edges,nodes,board))>=0.12,true);
 assert.deepEqual(manualWirePoints([0,0],[80,60],[{x:20,y:40}]).at(-1),[80,60]);
});

test('manual routes reattach moved contacts without the stale tails from old endpoint positions',()=>{
 const power=[{x:400,y:305},{x:810,y:305}],ground=[{x:180,y:280},{x:336,y:280},{x:336,y:171}];
 assert.deepEqual(manualWirePoints([400,513],[757,171],power),[[400,513],[400,305],[757,305],[757,171]]);
 assert.deepEqual(manualWirePoints([180,560],[757,198],ground),[[180,560],[180,280],[336,280],[336,198],[757,198]]);
 assert.deepEqual(reanchorManualRoute([400,513],[810,171],power,[400,513],[757,171]),[[400,513],[400,305],[757,305],[757,171]]);
 assert.deepEqual(reanchorManualRoute([180,560],[810,171],ground,[180,560],[757,198]),[[180,560],[180,280],[336,280],[336,198],[757,198]]);
 for(const [start,end,controls] of [
  [[0,0],[120,100],[{x:40,y:0},{x:40,y:100}]],
  [[0,0],[120,100],[{x:0,y:40},{x:120,y:40}]],
  [[0,0],[120,100],[{x:120,y:0}]],
  [[0,0],[120,0],[{x:40,y:0}]],
 ]){
  for(const [a,b] of [[[20,30],end],[start,[60,-20]],[[20,30],[60,-20]],[[20,30],[140,130]]]){
   const points=reanchorManualRoute(start,end,controls,a,b);
   assert.deepEqual(points[0],a);assert.deepEqual(points.at(-1),b);
   for(let i=1;i<points.length;i++){
    assert.ok(points[i-1][0]===points[i][0] || points[i-1][1]===points[i][1]);
    assert.notDeepEqual(points[i-1],points[i]);
    if(i>1)assert.ok(points[i-2][0]!==points[i][0] || points[i-2][1]!==points[i][1],'no collinear return or redundant bend');
   }
  }
 }
});
test('moving assembly commits reattached routes atomically with positions and reload restores the live geometry',async()=>{
 const {p,board,nodes,edges}=fixture(),component=p.components.find(c=>catalog.modules.find(m=>m.id===c.moduleId)?.display);
 const edge=edges.find(edge=>edge.target===component.id),terminal=edge.data.targetTerminal,pin=edge.data.sourcePin;
 const start=[nodes[0].position.x+pin.x,nodes[0].position.y+pin.y],end=[p.assembly.positions[component.id].x+terminal.x,p.assembly.positions[component.id].y+terminal.y];
 p.assembly.connections.find(w=>w.id===edge.id).route=[{x:start[0],y:start[1]-60},{x:end[0]-60,y:start[1]-60},{x:end[0]-60,y:end[1]}];
 const original=structuredClone(p),fingerprint=await firmwareFingerprint(generateFirmware(p,catalog));
 let current=p;
 for(const changes of [
  {[component.id]:{x:p.assembly.positions[component.id].x-220,y:p.assembly.positions[component.id].y-160}},
  {board:{x:p.assembly.positions.board.x+110,y:p.assembly.positions.board.y+90}},
  {[component.id]:p.assembly.positions[component.id],board:p.assembly.positions.board},
 ]){
  const projected={...edge,data:{...edge.data,manualRoute:current.assembly.connections.find(w=>w.id===edge.id).route,manualSourceAnchor:[current.assembly.positions.board.x+pin.x,current.assembly.positions.board.y+pin.y],manualTargetAnchor:[current.assembly.positions[component.id].x+terminal.x,current.assembly.positions[component.id].y+terminal.y]}};
  const liveNodes=nodes.map(node=>({...node,position:changes[node.id] || current.assembly.positions[node.id]}));
  const preview=routeAssemblyEdges([projected],liveNodes,board)[0].data.route.points;
  const snapshot=structuredClone(current);
  const moved=transformAssembly(current,catalog,{positions:changes}),wire=moved.assembly.connections.find(w=>w.id===edge.id);
  assert.deepEqual(wire.route,preview.slice(1,-1).map(([x,y])=>({x,y})));
  const restored=parseProject(serializeProject(moved));
  assert.deepEqual(manualWirePoints(preview[0],preview.at(-1),restored.assembly.connections.find(w=>w.id===edge.id).route),preview);
  assert.deepEqual(restored.gpioAssignments,original.gpioAssignments);
  assert.equal(await firmwareFingerprint(generateFirmware(restored,catalog)),fingerprint);
  assert.deepEqual(current,snapshot,'input project is not mutated');
  current=restored;
 }
 const delta={x:75,y:45},translated=transformAssembly(p,catalog,{positions:Object.fromEntries(Object.entries(p.assembly.positions).map(([id,position])=>[id,{x:position.x+delta.x,y:position.y+delta.y}]))});
 assert.deepEqual(translated.assembly.connections.find(w=>w.id===edge.id).route,p.assembly.connections.find(w=>w.id===edge.id).route.map(point=>({x:point.x+delta.x,y:point.y+delta.y})));
});

test('a manually routed wire stays manual when moving the component makes its path straight',()=>{
 const {p,edges}=fixture(),edge=edges[0],pin=edge.data.sourcePin,terminal=edge.data.targetTerminal;
 const position=p.assembly.positions.board,start=[position.x+pin.x,position.y+pin.y];
 const old=p.assembly.positions[edge.target],end=[old.x+terminal.x,old.y+terminal.y];
 p.assembly.connections.find(wire=>wire.id===edge.id).route=[{x:start[0],y:end[1]}];
 const moved=transformAssembly(p,catalog,{positions:{[edge.target]:{x:old.x,y:start[1]-terminal.y}}}),wire=moved.assembly.connections.find(wire=>wire.id===edge.id);
 assert.ok(wire.route?.length,'moving a node preserves manual route mode');
 const result=manualWirePoints(start,[end[0],start[1]],wire.route);
 assert.deepEqual(result,[start,[end[0],start[1]]]);
 assert.deepEqual(parseProject(serializeProject(moved)).assembly.connections,moved.assembly.connections);
});
