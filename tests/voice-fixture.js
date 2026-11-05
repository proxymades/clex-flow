import {prepareActivationAudio} from '../src/voice/audio.js';
import {createHash} from 'node:crypto';
import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic,nodePorts} from '../src/logic/model.js';
import {emptyVoiceProfile,voiceSignature,emptyWakeProfile,readVoiceProfile,VOICE_MODULE,VOICE_LOGIC,SPEAKER_MODULE} from '../src/voice/model.js';
export function voiceProject({phrases=['Поднять штору','Опустить штору'],trained=true,serial=true,speaker=false,activationSound=false,customAudio=false,recognitionSound=false}={}){
  let p=createProject('Голосовые команды','','waveshare-esp32-p4-nano');
  p=addHardware(p,catalog.modules.find(m=>m.id===VOICE_MODULE),catalog);
  const component=p.components[0],profile=emptyVoiceProfile();
  profile.commands=phrases.map(phrase=>({id:crypto.randomUUID(),phrase}));
  if(trained){
    profile.samples=profile.commands.flatMap((c,j)=>Array.from({length:3},(_,i)=>({id:createHash('sha256').update(c.id+':'+i).digest('hex'),kind:'command',commandId:c.id,frames:12,data:Buffer.from(Int16Array.from({length:144},(_,k)=>(k%12)*100+j*50+i).buffer).toString('base64'),quality:{rms:150,peak:1200,clipped:0}})));
    for(const kind of ['unknown','background'])for(let i=0;i<3;i++)profile.samples.push({id:createHash('sha256').update(kind+':'+i).digest('hex'),kind,commandId:null,frames:12,data:Buffer.alloc(288,i).toString('base64'),quality:{rms:10,peak:30,clipped:0}});
    profile.model={version:1,signature:voiceSignature(profile),referenceIds:profile.samples.map(s=>s.id),threshold:.3,ratio:.97,ready:true,validation:{total:phrases.length+2,commands:phrases.length,correct:phrases.length,rejected:0,wrong:0,falseCommands:0},test:{total:phrases.length+2,commands:phrases.length,correct:phrases.length,rejected:0,wrong:0,falseCommands:0}};
  }
  component.parameters.profile=JSON.stringify(profile);
  if(speaker){
    p=addHardware(p,catalog.modules.find(m=>m.id===SPEAKER_MODULE),catalog);
    component.parameters.speakerId=p.components.at(-1).id;
  }
  component.parameters.activationSound=activationSound;
  if(customAudio){component.parameters.activationSoundType='recording';component.parameters.activationAudio=JSON.stringify(prepareActivationAudio([Float32Array.from({length:3200},(_,i)=>.2*Math.sin(i*2*Math.PI*440/16000))],16000,'ready.wav'));}
  if(recognitionSound){component.parameters.recognitionSound=true;component.parameters.recognitionAudio=JSON.stringify(prepareActivationAudio([Float32Array.from({length:4800},(_,i)=>.2*Math.sin(i*2*Math.PI*330/16000))],16000,'trying.wav'));component.parameters.recognitionVolume=60;}
  let graph=addNode(p.logic,catalog.modules.find(m=>m.id===VOICE_LOGIC),p.components,p,catalog);
  if(serial){
    const voice=graph.nodes[0];graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.serial'),p.components,p,catalog);
    const sink=graph.nodes.at(-1),port=nodePorts(voice,catalog,p).outputs[0];
    graph=connectNodes(graph,catalog,{source:voice.id,sourceHandle:port.id,target:sink.id,targetHandle:'trigger'},{...p,logic:graph});
    graph=connectNodes(graph,catalog,{source:voice.id,sourceHandle:'phrase',target:sink.id,targetHandle:'text'},{...p,logic:graph});
  }
  return withLogic(p,graph);
}

export function withCustomWake(project,{trained=true,phrase='Добрый вечер, дом'}={}){
 const voice=project.components.find(c=>c.moduleId===VOICE_MODULE),profile=emptyWakeProfile();
 profile.commands=[{id:crypto.randomUUID(),phrase}];profile.inputKey=readVoiceProfile(voice).inputKey||'';
 if(trained){
  for(const [label,kind] of ['command','unknown','background'].entries())for(let example=0;example<5;example++){
   const values=Int16Array.from({length:144},(_,i)=>1000*(label+1)+(i%12)*37+example);
   profile.samples.push({id:createHash('sha256').update(phrase+':'+label+':'+example).digest('hex'),kind,commandId:kind==='command'?profile.commands[0].id:null,frames:12,data:Buffer.from(values.buffer).toString('base64'),quality:{rms:150,peak:1200,clipped:0}});
  }
  const report={total:3,commands:1,correct:1,rejected:0,wrong:0,falseCommands:0};
  profile.model={version:1,signature:voiceSignature(profile),referenceIds:profile.samples.filter((_,i)=>i%5!==4).map(s=>s.id),threshold:.3,ratio:.9,ready:true,validation:{...report},test:{...report}};
 }
 voice.parameters.wakeMode='custom';voice.parameters.wakeProfile=JSON.stringify(profile);
 return project;
}
