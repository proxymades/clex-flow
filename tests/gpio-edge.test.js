import test from'node:test';import assert from'node:assert/strict';import{inputEdgeProject}from'./input-edge-fixture.js';import{catalog}from'./catalog-fixture.js';import{generateFirmware}from'../src/firmware/generator.js';import{nodeDisplayName,presentPort}from'../src/logic/presentation.js';
test('input change is universal for S3, P4 and Nano, with equipment-specific button labels',()=>{
 for(const id of['waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340']){
  const p=inputEdgeProject(id),node=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-edge'),m=catalog.modules.find(m=>m.id===node.moduleId),b=generateFirmware(p,catalog);assert.match(nodeDisplayName(node,p,catalog),/События кнопки/);assert.equal(presentPort(m.outputs.find(o=>o.id==='falling'),node,p,catalog).name,'Кнопка нажата');assert.match(b.mainC,/input_stable_/);assert.equal(p.logic.nodes.some(n=>n.moduleId==='clex.logic.timer'),false);
 }
});
test('generic input binding uses a terminal capability rather than a button module ID',async()=>{
 const{hardwareBinding,addNode}=await import('../src/logic/model.js');const p=inputEdgeProject(),button=p.components.find(c=>c.moduleId==='clex.hardware.button');button.moduleId='custom.digital-input';const extended={...catalog,modules:[...catalog.modules,{...catalog.modules.find(m=>m.id==='clex.hardware.button'),id:'custom.digital-input'}]};const node=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-edge');assert.equal(hardwareBinding(node,p,extended).error,null);const graph=addNode({nodes:[],edges:[],viewport:p.logic.viewport},extended.modules.find(m=>m.id===node.moduleId),p.components,p,extended);assert.equal(graph.nodes[0].parameters.componentId,button.id);
});
