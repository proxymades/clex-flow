import {LOGIC_NODE_WIDTH,nodePorts,graphModule} from './model.js';
import {portSections} from './portGroups.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const area=rect=>rect.width*rect.height;
const intersection=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));

function nodeRect(node,catalog,project){
 const sections=portSections(nodePorts(node,catalog,project));
 const height=146+sections.reduce((sum,section)=>sum+24+36*Math.max(section.inputs.length,section.outputs.length),0)+Math.max(0,sections.length-1)*16+(graphModule(node,catalog)?.editor==='screen'?200:0);
 return {...node.position,width:LOGIC_NODE_WIDTH,height};
}
// Move only the inserted group. Camera and internal distances stay unchanged.
export function placeNodesInViewport(graph,ids,size,catalog,project){
 if(!ids.length||!size?.width||!size?.height)return graph;
 const selected=new Set(ids),added=graph.nodes.filter(node=>selected.has(node.id));
 if(!added.length)return graph;
 const rects=added.map(node=>nodeRect(node,catalog,project)),viewport=graph.viewport;
 const margin=24/viewport.zoom;
 const view={x:-viewport.x/viewport.zoom+margin,y:-viewport.y/viewport.zoom+margin,width:Math.max(1,(size.width-48)/viewport.zoom),height:Math.max(1,(size.height-48)/viewport.zoom)};
 const x=Math.min(...rects.map(rect=>rect.x)),y=Math.min(...rects.map(rect=>rect.y));
 const group={x,y,width:Math.max(...rects.map(rect=>rect.x+rect.width))-x,height:Math.max(...rects.map(rect=>rect.y+rect.height))-y};
 if(intersection(group,view)>=area(group)-.01)return graph;
 const occupied=graph.nodes.filter(node=>!selected.has(node.id)).map(node=>nodeRect(node,catalog,project));
 const gap=24,center={x:view.x+Math.max(0,(view.width-group.width)/2),y:view.y+Math.max(0,(view.height-group.height)/2)};
 const candidates=[center,{x:view.x,y:view.y},{x:view.x+Math.max(0,view.width-group.width),y:view.y}];
 for(const rect of occupied)candidates.push({x:rect.x+rect.width+gap,y:rect.y},{x:rect.x-group.width-gap,y:rect.y},{x:rect.x,y:rect.y+rect.height+gap},{x:rect.x,y:rect.y-group.height-gap});
 const maxX=Math.max(...added.map(node=>node.position.x)),maxY=Math.max(...added.map(node=>node.position.y));
 const translate=point=>({
  x:clamp(point.x-group.x,-5000-group.x,5000-maxX),
  y:clamp(point.y-group.y,-5000-group.y,5000-maxY),
 });
 let best=null;
 for(const point of candidates){
  const delta=translate({x:clamp(point.x,view.x,view.x+Math.max(0,view.width-Math.min(group.width,96))),y:clamp(point.y,view.y,view.y+Math.max(0,view.height-84))});
  const rect={...group,x:group.x+delta.x,y:group.y+delta.y};
  const overlap=occupied.reduce((sum,item)=>sum+intersection(rect,item),0);
  const outside=area(group)-intersection(rect,view);
  const distance=Math.hypot(rect.x-center.x,rect.y-center.y);
  const score=overlap*4+outside+distance*.01;
  if(!best||score<best.score)best={delta,score};
 }
 return {...graph,nodes:graph.nodes.map(node=>selected.has(node.id)?{...node,position:{x:node.position.x+best.delta.x,y:node.position.y+best.delta.y}}:node)};
}
