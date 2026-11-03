import {createHash} from 'node:crypto';
import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic,nodePorts} from '../src/logic/model.js';
import {emptyVoiceProfile,voiceSignature,VOICE_MODULE,VOICE_LOGIC} from '../src/voice/model.js';
export function voiceProject({phrases=['Поднять штору','Опустить штору'],trained=true,serial=true}={}){
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
  let graph=addNode(p.logic,catalog.modules.find(m=>m.id===VOICE_LOGIC),p.components,p,catalog);
  if(serial){
    const voice=graph.nodes[0];graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.serial'),p.components,p,catalog);
    const sink=graph.nodes.at(-1),port=nodePorts(voice,catalog,p).outputs[0];
    graph=connectNodes(graph,catalog,{source:voice.id,sourceHandle:port.id,target:sink.id,targetHandle:'trigger'},{...p,logic:graph});
    graph=connectNodes(graph,catalog,{source:voice.id,sourceHandle:'phrase',target:sink.id,targetHandle:'text'},{...p,logic:graph});
  }
  return withLogic(p,graph);
}
