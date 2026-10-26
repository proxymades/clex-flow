import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {generateFirmware,cString} from '../src/firmware/generator.js';
import {numericFirmware} from '../src/firmware/drivers/numeric.js';
import {relayFirmware} from '../src/firmware/drivers/relay.js';

export function numericGraphSource(project,nodes,{includeSource=false,extraNodes=[]}={}) {
 const bundle=generateFirmware(project,catalog),sorted=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),index=new Map(sorted.map((n,i)=>[n.id,i]));
 const ids=['parse','condition','low','high',...(includeSource?['source']:[])].map(key=>index.get(nodes[key].id)).concat(extraNodes.map(node=>index.get(node.id)));
 const matcher=new RegExp('static void (node_(?:'+ids.join('|')+')(?:_emit_[a-zA-Z0-9_]+)?)\\((?:void)?\\)\\s*\\{','g');
 const functions=[];
 for(const match of bundle.mainC.matchAll(matcher)){
  let end=match.index+match[0].length,depth=1;
  while(depth&&end<bundle.mainC.length){if(bundle.mainC[end]==='{')depth++;if(bundle.mainC[end]==='}')depth--;end++;}
  assert.equal(depth,0);functions.push({name:match[1],body:bundle.mainC.slice(match.index,end)});
 }
 const runtime=numericFirmware(sorted,index,cString),relay=relayFirmware(project,sorted,index,bundle.platform);
 const prototypes=functions.map(fn=>'static void '+fn.name+'(void) __attribute__((unused));').join('\n');
 return {bundle,index,source:runtime.source+'\n'+relay.declarations+'\n'+prototypes+'\n'+functions.map(fn=>fn.body).join('\n')};
}
