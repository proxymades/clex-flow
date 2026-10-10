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
