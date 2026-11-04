import { VOICE_MODULE, SPEAKER_MODULE, voiceSpeakers } from '../voice/model.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function upgradeVoice(project){
  if(!Array.isArray(project.components)||!Array.isArray(project.logic?.nodes)||!project.assembly?.positions||!project.moduleVersions)return project;
  const legacy=project.components.filter(c=>c?.moduleId===VOICE_MODULE&&object(c.parameters)&&!Object.hasOwn(c.parameters,'activationSound')&&Object.hasOwn(c.parameters,'volume'));
  const needsDefaults=project.components.some(c=>c?.moduleId===VOICE_MODULE&&object(c.parameters)&&(!Object.hasOwn(c.parameters,'activationSoundType')||!Object.hasOwn(c.parameters,'activationAudio')||!Object.hasOwn(c.parameters,'microphoneId')||!Object.hasOwn(c.parameters,'wakeMode')||!Object.hasOwn(c.parameters,'wakeProfile')));
  if(!legacy.length&&!needsDefaults)return project;
  const components=project.components.map(c=>({...c,parameters:{...c.parameters}})),positions={...project.assembly.positions},nodes=project.logic.nodes.map(n=>({...n,parameters:{...n.parameters}})),moduleVersions={...project.moduleVersions};
  for(const old of legacy){
    const voice=components.find(c=>c.id===old.id),{volume,...parameters}=voice.parameters;
    const hasTones=nodes.some(n=>n.moduleId==='clex.logic.tone'&&n.parameters.componentId===voice.id);
    let speaker=voiceSpeakers({components},voice)[0];
    if((volume>0||hasTones)&&!speaker){
      if(components.length>=100)throw Error('Для переноса звука активации нужен отдельный компонент «Динамик». Уменьшите число компонентов в проекте.');
      let number=1;while(components.some(c=>c.name==='Динамик '+number))number++;
      const base=voice.id.slice(0,80)+'-speaker';let id=base,suffix=1;while(components.some(c=>c.id===id))id=base+'-'+suffix++;
      speaker={id,moduleId:SPEAKER_MODULE,moduleVersion:'1.0.0',name:'Динамик '+number,parameters:{interfaceId:parameters.interfaceId}};
      const origin=positions[voice.id]||positions.board;
      // Put the separate speaker near the existing voice component.
      const candidates=[];
      const rows=[0,...Array.from({length:20},(_,i)=>[i+1,-i-1]).flat()],cols=[1,-1,0,...Array.from({length:8},(_,i)=>[i+2,-i-2]).flat()];
      for(const row of rows)for(const col of cols)if(row||col)candidates.push({x:origin.x+col*300,y:origin.y+row*225});
      const position=candidates.find(p=>Math.abs(p.x)<=5000&&Math.abs(p.y)<=5000&&Object.values(positions).every(v=>Math.abs(v.x-p.x)>=280||Math.abs(v.y-p.y)>=210));
      if(!position)throw Error('Не удалось разместить компонент «Динамик» рядом с голосовым компонентом.');
      components.push(speaker);positions[speaker.id]=position;moduleVersions[SPEAKER_MODULE]='1.0.0';
    }
    voice.parameters={...parameters,activationSound:volume>0,speakerId:speaker?.id||'',activationVolume:volume};
    for(const node of nodes)if(node.moduleId==='clex.logic.tone'&&node.parameters.componentId===voice.id)node.parameters.componentId=speaker.id;
  }
  for(const voice of components.filter(c=>c.moduleId===VOICE_MODULE)){voice.parameters={activationSoundType:'tone',activationAudio:'',microphoneId:'',wakeMode:'builtin',wakeProfile:'',...voice.parameters};}
  return {...project,components,moduleVersions,assembly:{...project.assembly,positions},logic:{...project.logic,nodes}};
}
