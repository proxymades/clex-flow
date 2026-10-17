import test from 'node:test';
import assert from 'node:assert/strict';
import {appendProcessEvent} from '../src/idf/processEvents.js';

test('download progress updates one row while keeping original messages and separate stages',()=>{
 const notice={jobId:'build',operation:'build',sequence:1,status:'output',text:'NOTICE: lvgl/lvgl'};
 const first={...notice,sequence:2,status:'progress',progressKey:'archive',text:'0 МБ'};
 const items=[notice,first];
 const next=appendProcessEvent(items,{...first,sequence:3,text:'8,4 / 15,2 МБ'});
 assert.equal(next.length,2);assert.equal(next[1].text,'8,4 / 15,2 МБ');assert.equal(items[1].text,'0 МБ');
 const unpack=appendProcessEvent(next,{...first,sequence:4,progressKey:'unpack',text:'Распаковка'});
 assert.equal(unpack.length,3);assert.equal(unpack[1].text,'8,4 / 15,2 МБ');
 assert.equal(appendProcessEvent(unpack,{...first,jobId:'another',sequence:5}).length,4);
});
test('ordinary output is never collapsed and retained history stays bounded',()=>{
 const event={jobId:'build',operation:'build',status:'output',text:'compiler output'};
 let events=[];for(let sequence=0;sequence<1300;sequence++)events=appendProcessEvent(events,{...event,sequence});
 assert.equal(events.length,1200);assert.equal(events[0].sequence,100);assert.equal(events.at(-1).sequence,1299);
});
