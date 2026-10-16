import test from 'node:test';
import assert from 'node:assert/strict';
import { wireColors, GROUND_COLOR, POWER_COLOR } from '../src/assembly/wireColors.js';
import { displayProject } from './display-fixture.js';
import { catalog } from './catalog-fixture.js';
test('power is red, ground is grey and every display signal has a distinct stable color',()=>{
 const project=displayProject();
 const before=structuredClone(project),colors=wireColors(project,catalog);
 for(const terminal of ['gnd','vcc'])assert.equal(colors[project.assembly.connections.find(w=>w.terminalId===terminal).id],terminal==='gnd'?GROUND_COLOR:POWER_COLOR);
 const signals=project.assembly.connections.filter(w=>!['gnd','vcc'].includes(w.terminalId));
 assert.equal(new Set(signals.map(w=>colors[w.id])).size,signals.length);
 assert.deepEqual(wireColors({...project,assembly:{...project.assembly,connections:[...project.assembly.connections].reverse()}},catalog),colors);
 assert.deepEqual(project,before);
});

function luminance(hex){
 const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
test('base wire palette has high contrast against the assembly canvas, without muted brown-grey signals',()=>{
 const p=displayProject(),signal=p.assembly.connections.find(w=>w.terminalId==='sclk');
 p.assembly.connections=Array.from({length:10},(_,i)=>({...signal,id:String(i).padStart(2,'0')}));
 const colors=Object.values(wireColors(p,catalog)),background=luminance('#0d121d');
 assert.equal(new Set(colors).size,10);
 for(const color of [...colors,GROUND_COLOR,POWER_COLOR])assert.ok((luminance(color)+0.05)/(background+0.05)>=6,color+' is clearly visible on the dark canvas');
 const chromatic=colors.filter(color=>{const rgb=color.slice(1).match(/../g).map(v=>parseInt(v,16));return Math.max(...rgb)-Math.min(...rgb)>=100;});
 assert.equal(chromatic.length,9,'nine saturated signal colors and one light neutral');
});
