import {catalog} from './catalog-fixture.js';
import {voiceProject,withCustomWake} from './voice-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {prepareActivationAudio} from '../src/voice/audio.js';
export function audioPlayProject({voice=true,customWake=false}={}){
 let p=voice?voiceProject({speaker:true,activationSound:true,serial:false}):addHardware(createProject('Воспроизведение записи','','waveshare-esp32-p4-nano'),catalog.modules.find(m=>m.id==='clex.hardware.audio'),catalog);
 if(customWake)withCustomWake(p);
 let graph=p.logic;
 if(!voice)graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.timer'),p.components,p,catalog);
 graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.tone'),p.components,p,catalog);
 const tone=graph.nodes.at(-1);graph=connectNodes(graph,catalog,{source:graph.nodes[0].id,sourceHandle:voice?'recognized':'tick',target:tone.id,targetHandle:'trigger'},{...p,logic:graph});
 graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.audio-play'),p.components,p,catalog);
 const playback=graph.nodes.at(-1);playback.parameters.audio=JSON.stringify(prepareActivationAudio([Float32Array.from({length:3200},(_,i)=>.2*Math.sin(i*2*Math.PI*440/16000))],16000,'done.wav'));
 graph=connectNodes(graph,catalog,{source:tone.id,sourceHandle:'done',target:playback.id,targetHandle:'trigger'},{...p,logic:graph});
 return withLogic(p,graph);
}
