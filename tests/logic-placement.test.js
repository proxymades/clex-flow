import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,timer,serial} from './catalog-fixture.js';
import {createProject,serializeProject,parseProject} from '../src/projects/model.js';
import {addNode,pasteNodes,selectionSnapshot,withLogic} from '../src/logic/model.js';
import {placeNodesInViewport} from '../src/logic/placement.js';

function fixture(){
 let project=createProject('Размещение');
 project=withLogic(project,addNode(project.logic,timer,[],project,catalog));
 return project;
}
test('adding outside the visible area moves only the new block and preserves a zoomed, panned camera',()=>{
 const project=fixture();project.logic.nodes[0].position={x:4000,y:3500};
 project.logic.viewport={x:-900,y:400,zoom:1.6};
 const before=structuredClone(project),graph=addNode(project.logic,timer,[],project,catalog),id=graph.nodes.at(-1).id;
 const placed=placeNodesInViewport(graph,[id],{width:1000,height:800},catalog,project),node=placed.nodes.at(-1);
 assert.deepEqual(placed.viewport,before.logic.viewport);assert.deepEqual(placed.nodes[0],before.logic.nodes[0]);assert.deepEqual(project,before);
 assert.ok(node.position.x*1.6-900>=24);assert.ok((node.position.x+336)*1.6-900<=976);
 assert.ok(node.position.y*1.6+400>=24);assert.ok((node.position.y+282)*1.6+400<=776);
 assert.deepEqual(parseProject(serializeProject(withLogic(project,placed))).logic,placed);
});
test('pasting an offscreen group keeps relative positions and internal connections',()=>{
 const project=fixture();let graph=addNode(project.logic,serial,[],project,catalog);
 graph.nodes[0].position={x:100,y:100};graph.nodes[1].position={x:580,y:140};
 graph.edges=[{id:'saved-link',source:graph.nodes[0].id,target:graph.nodes[1].id,sourceHandle:'tick',targetHandle:'trigger',dataType:'event'}];
 graph.viewport={x:-2000,y:-800,zoom:.7};
 const original=structuredClone(graph),copy=pasteNodes(graph,selectionSnapshot(graph,graph.nodes.map(n=>n.id)));
 const placed=placeNodesInViewport(copy.graph,copy.ids,{width:1200,height:900},catalog,{...project,logic:graph});
 const [first,second]=placed.nodes.filter(n=>copy.ids.includes(n.id));
 assert.equal(second.position.x-first.position.x,480);assert.equal(second.position.y-first.position.y,40);
 assert.deepEqual(placed.nodes.slice(0,2),original.nodes);assert.deepEqual(placed.viewport,original.viewport);assert.deepEqual(placed.edges,copy.graph.edges);
 assert.ok(first.position.x*.7-2000>=24);assert.ok(first.position.y*.7-800>=24);assert.deepEqual(graph,original);
});
test('a visible duplicate retains its nearby placement',()=>{
 const project=fixture(),copy=pasteNodes(project.logic,selectionSnapshot(project.logic,[project.logic.nodes[0].id]));
 assert.equal(placeNodesInViewport(copy.graph,copy.ids,{width:1200,height:900},catalog,project),copy.graph);
});
test('copying a group at the graph limit preserves spacing instead of clamping each node separately',()=>{
 const project=fixture();let graph=addNode(project.logic,timer,[],project,catalog);
 graph.nodes[0].position={x:4960,y:4900};graph.nodes[1].position={x:4990,y:4990};
 const copy=pasteNodes(graph,selectionSnapshot(graph,graph.nodes.map(n=>n.id))),nodes=copy.graph.nodes.slice(-2);
 assert.equal(nodes[1].position.x-nodes[0].position.x,30);assert.equal(nodes[1].position.y-nodes[0].position.y,90);
 assert.ok(nodes.every(n=>n.position.x<=5000&&n.position.y<=5000));
});
test('a group larger than the visible area retains its geometry and camera without zooming out',()=>{
 const project=fixture();let graph=addNode(project.logic,timer,[],project,catalog);
 graph.nodes[0].position={x:3000,y:3000};graph.nodes[1].position={x:4500,y:4500};graph.viewport={x:0,y:0,zoom:2};
 const placed=placeNodesInViewport(graph,graph.nodes.map(n=>n.id),{width:600,height:500},catalog,project);
 assert.deepEqual(placed.viewport,graph.viewport);
 assert.equal(placed.nodes[1].position.x-placed.nodes[0].position.x,1500);assert.equal(placed.nodes[1].position.y-placed.nodes[0].position.y,1500);
 assert.ok(placed.nodes[0].position.x*2>=24&&placed.nodes[0].position.x*2<600);
 assert.ok(placed.nodes[0].position.y*2>=24&&placed.nodes[0].position.y*2<500);
 assert.equal(placeNodesInViewport(graph,[],{width:600,height:500},catalog,project),graph);
 assert.equal(placeNodesInViewport(graph,[graph.nodes[0].id],null,catalog,project),graph);
});
