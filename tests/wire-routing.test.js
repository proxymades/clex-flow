import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateWireLanes, boardDetour, wireFitPadding } from '../src/assembly/wireRouting.js';
const edge = (id, y, target='display') => ({id,source:'board',target,targetHandle:id,data:{sourcePin:{x:170,y},boardWidth:490,boardHeight:700,targetTerminal:{x:0,y:125},targetWidth:250,targetHeight:375}});
const route = (edge, targetY=350, targetX=800, targetPosition='left') => boardDetour({sourceX:264,sourceY:40+edge.data.sourcePin.y,targetX,targetY,targetPosition,data:edge.data});
test('colliding old wire hashes receive distinct lanes, independent of serialized order',()=>{
 const edges=[edge('a',300),edge('d',350),edge('g',400,'other')];
 const before=structuredClone(edges),assigned=allocateWireLanes(edges),reversed=allocateWireLanes([...edges].reverse());
 assert.deepEqual(edges,before);
 assert.deepEqual(assigned.map(e=>e.data.laneIndex),[0,1,2]);
 for(const item of assigned)assert.equal(item.data.laneIndex,reversed.find(e=>e.id===item.id).data.laneIndex);
 const routes=assigned.map(e=>route(e));
 for(const axis of [0,1])assert.equal(new Set(routes.map(r=>r.points[2][axis])).size,3);
 assert.equal(new Set(routes.map(r=>r.points[3][0])).size,3);
});
test('approach lanes fit between close board and display instead of entering either node',()=>{
 const edges=allocateWireLanes(Array.from({length:7},(_,i)=>edge('wire-'+i,280+i*25)));
 const routes=edges.map(e=>route(e,400,620)); // Board origin 100, right edge 590.
 assert.equal(new Set(routes.map(r=>r.points[3][0])).size,7);
 for(const result of routes){assert.ok(result.points[3][0]>590&&result.points[3][0]<620);assert.ok(result.spacing>0);assert.doesNotMatch(result.path,/NaN|Infinity/);}
});
test('moving nodes and changing target sides keep endpoints and separated approach lanes',()=>{
 const [a,b]=allocateWireLanes([edge('a',300),edge('d',350)]);
 for(const side of ['left','right','top','bottom']){
  const first=route(a,side==='bottom'?700:350,950,side),second=route(b,side==='bottom'?740:400,950,side);
  assert.deepEqual(first.points[0],[264,340]);assert.deepEqual(first.points.at(-1),[950,side==='bottom'?700:350]);
  assert.notEqual(first.points[3][0],second.points[3][0]);
 }
 assert.equal(route(a,350,550),null);
});

test('fit reserves enough space for the expanded detour lanes',()=>{
 const edges=allocateWireLanes(Array.from({length:6},(_,i)=>edge('wire-'+i,200+i*30)));
 const nodes=[{position:{x:100,y:40},width:490,height:640},{position:{x:670,y:100},width:250,height:375}];
 assert.ok(wireFitPadding(nodes,edges)>=2*96/640);
 assert.equal(wireFitPadding(nodes,[]),0.12);
});
