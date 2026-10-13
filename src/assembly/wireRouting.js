import { boardPinLabel } from './pinLayout.js';

const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a,b) => a[0]===b[0] && a[1]===b[1];
const length = (a,b) => Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
export function allocateWireLanes(edges) {
 const groups=new Map(),lanes=new Map();
 for(const edge of edges){const pin=edge.data.sourcePin;if(!pin)continue;const key=edge.source+':'+pin.x;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(edge);}
 for(const group of groups.values()){
  group.sort((a,b)=>a.data.sourcePin.y-b.data.sourcePin.y || compare(a.target,b.target) || compare(a.targetHandle,b.targetHandle) || compare(a.id,b.id));
  group.forEach((edge,index)=>lanes.set(edge.id,{laneIndex:index,laneCount:group.length}));
 }
 return edges.map(edge=>({...edge,data:{...edge.data,...lanes.get(edge.id)}}));
}
export function simplifyWirePoints(points){
 const result=[];
 for(const point of points){
  while(result.length>1){
   const a=result.at(-2),b=result.at(-1);
   if(a[0]===b[0] && b[0]===point[0] || a[1]===b[1] && b[1]===point[1])result.pop();else break;
  }
  if(!result.length || !same(result.at(-1),point))result.push([...point]);
 }
 return result;
}
export function roundedWirePath(points,maxRadius=4){
 if(!points.length)return '';
 let path='M'+points[0].join(' ');
 for(let i=1;i<points.length-1;i++){
  const before=points[i-1],point=points[i],after=points[i+1],a=length(before,point),b=length(point,after),radius=Math.min(maxRadius,a/2,b/2);
  const entry=point.map((value,axis)=>value-(value-before[axis])/(a||1)*radius),exit=point.map((value,axis)=>value+(after[axis]-value)/(b||1)*radius);
  path+=' L'+entry.join(' ')+' Q'+point.join(' ')+' '+exit.join(' ');
 }
 return path+' L'+points.at(-1).join(' ');
}
const inflate=(r,pad)=>({left:r.x-pad,top:r.y-pad,right:r.x+r.width+pad,bottom:r.y+r.height+pad});
export function wireObstacles(data){
 const board=data.boardPosition || {x:0,y:0};
 const obstacles=(data.boardPins || []).flatMap(pin=>{
  const label=boardPinLabel(pin),labelWidth=Math.max(label.width-10,label.text.length*label.fontSize*0.61);
  const chosen=pin.id===data.sourcePin?.id;
  const x=board.x+pin.x,y=board.y+pin.y;
  const legacyWidth=Math.max(98,(String(pin.physicalNumber)+' · '+pin.label).length*6.1+14);
  const labelRect=pin.labelX===undefined?{x:pin.side==='left'?x-legacyWidth:x+10,y:y-8,width:legacyWidth-10,height:15}:{x:board.x+(pin.side==='left'?label.textX-labelWidth:label.textX),y:y-8,width:labelWidth,height:15};
  return [inflate(labelRect,2),...(!chosen?[inflate({x:x-16,y:y-7,width:32,height:14},2)]:[])];
 });
 for(const rectangle of data.boardKeepOut || [])obstacles.push(inflate({x:board.x+rectangle.x,y:board.y+rectangle.y,width:rectangle.width,height:rectangle.height},2));
 for(const node of data.sceneNodes || [])if(node.id!=='board')obstacles.push(inflate({x:node.position.x,y:node.position.y,width:node.width || node.measured?.width || 0,height:node.height || node.measured?.height || 0},8));
 return obstacles;
}
const inside=(p,r)=>p[0]>r.left && p[0]<r.right && p[1]>r.top && p[1]<r.bottom;
export function segmentCrossesObstacle(a,b,r){
 if(a[0]===b[0])return a[0]>r.left && a[0]<r.right && Math.max(a[1],b[1])>r.top && Math.min(a[1],b[1])<r.bottom;
 if(a[1]===b[1])return a[1]>r.top && a[1]<r.bottom && Math.max(a[0],b[0])>r.left && Math.min(a[0],b[0])<r.right;
 return true;
}
function segmentPenalty(a,b,routes){
 let penalty=0;
 for(const route of routes)for(let i=1;i<route.length;i++){
  const c=route[i-1],d=route[i],horizontal=a[1]===b[1],otherHorizontal=c[1]===d[1];
  if(horizontal===otherHorizontal){
   const axis=horizontal?0:1,constant=1-axis;
   if(Math.abs(a[constant]-c[constant])<5){const overlap=Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis]));if(overlap>0)penalty+=overlap*12;}
  }else{
   const h=horizontal?[a,b]:[c,d],v=horizontal?[c,d]:[a,b];
   if(v[0][0]>Math.min(h[0][0],h[1][0]) && v[0][0]<Math.max(h[0][0],h[1][0]) && h[0][1]>Math.min(v[0][1],v[1][1]) && h[0][1]<Math.max(v[0][1],v[1][1]))penalty+=16;
  }
 }
 return penalty;
}
function shortRoute(start,end,obstacles,routes,laneIndex){
 const xs=new Set([start[0]-18,start[0]+18,start[0]-26,start[0]+26,start[0]-18-laneIndex%8*8,start[0]+18+laneIndex%8*8]);
 const ys=new Set([start[1],end[1],start[1]-12,start[1]+12,start[1]-20-laneIndex%8*8,start[1]+20+laneIndex%8*8,end[1]-12,end[1]+12]);
 const relevant=obstacles.filter(r=>r.left<Math.max(start[0],end[0])+64 && r.right>Math.min(start[0],end[0])-64 && r.top<Math.max(start[1],end[1])+160 && r.bottom>Math.min(start[1],end[1])-160);
 if(relevant.some(r=>inside(end,r)))return null;
 for(const r of relevant){ys.add(r.top);ys.add(r.bottom);if(Math.abs(r.left-start[0])<80)xs.add(r.left);if(Math.abs(r.right-start[0])<80)xs.add(r.right);}
 const rows=[...ys].sort((a,b)=>(Math.abs(a-start[1])+Math.abs(a-end[1]))-(Math.abs(b-start[1])+Math.abs(b-end[1]))).slice(0,32);
 const candidates=[simplifyWirePoints([start,[end[0],start[1]],end]),simplifyWirePoints([start,[start[0],end[1]],end])];
 for(const y of rows){candidates.push(simplifyWirePoints([start,[start[0],y],[end[0],y],end]));for(const x of xs)candidates.push(simplifyWirePoints([start,[x,start[1]],[x,y],[end[0],y],end]));}
 const estimate=points=>points.reduce((sum,p,i)=>sum+(i?length(points[i-1],p):0),0)+Math.max(0,points.length-2)*12;
 const sorted=candidates.map(points=>({points,cost:estimate(points)})).sort((a,b)=>a.cost-b.cost);let best=null,score=Infinity;
 for(const candidate of sorted){if(candidate.cost>=score)break;const p=candidate.points;if(p.slice(1).some((b,i)=>relevant.some(r=>segmentCrossesObstacle(p[i],b,r))))continue;
  const cost=candidate.cost+p.slice(1).reduce((sum,b,i)=>sum+segmentPenalty(p[i],b,routes),0);if(cost<score){score=cost;best=p;}}
 return best;
}
// Sparse rectilinear visibility grid. The board body is deliberately not an obstacle.
function searchRoute(start,end,obstacles,routes,laneIndex,padding){
 const bounds={left:Math.min(start[0],end[0])-padding,right:Math.max(start[0],end[0])+padding,top:Math.min(start[1],end[1])-padding,bottom:Math.max(start[1],end[1])+padding};
 const relevant=obstacles.filter(r=>r.left<bounds.right && r.right>bounds.left && r.top<bounds.bottom && r.bottom>bounds.top);
 if(relevant.some(r=>inside(end,r)))return null;
 const xs=new Set([start[0],end[0],bounds.left,bounds.right]),ys=new Set([start[1],end[1],bounds.top,bounds.bottom]);
 const gap=12+(laneIndex%12)*8;
 for(const sign of [-1,1]){xs.add(start[0]+sign*gap);xs.add(end[0]+sign*gap);ys.add(start[1]+sign*gap);ys.add(end[1]+sign*gap);}
 for(const r of relevant){xs.add(Math.max(bounds.left,r.left));xs.add(Math.min(bounds.right,r.right));ys.add(Math.max(bounds.top,r.top));ys.add(Math.min(bounds.bottom,r.bottom));}
 for(const route of routes)for(const p of route){if(p[0]>bounds.left && p[0]<bounds.right){xs.add(p[0]-8);xs.add(p[0]+8);}if(p[1]>bounds.top && p[1]<bounds.bottom){ys.add(p[1]-8);ys.add(p[1]+8);}}
 const x=[...xs].filter(v=>v>=bounds.left && v<=bounds.right).sort((a,b)=>a-b),y=[...ys].filter(v=>v>=bounds.top && v<=bounds.bottom).sort((a,b)=>a-b);
 const width=x.length,startIndex=y.indexOf(start[1])*width+x.indexOf(start[0]),endIndex=y.indexOf(end[1])*width+x.indexOf(end[0]);
 const point=index=>[x[index%width],y[Math.floor(index/width)]];
 const queue=[],distances=new Map(),parents=new Map(),blocked=new Map(),clear=new Map(),penalties=new Map();
 const push=item=>{queue.push(item);let i=queue.length-1;while(i>0){const p=(i-1)>>1;if(queue[p].score<=item.score)break;queue[i]=queue[p];i=p;}queue[i]=item;};
 const pop=()=>{const first=queue[0],last=queue.pop();if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length && queue[child+1].score<queue[child].score)child++;if(queue[child].score>=last.score)break;queue[i]=queue[child];i=child;}queue[i]=last;}return first;};
 const key=(index,direction)=>index*3+direction;
 distances.set(key(startIndex,0),0);push({index:startIndex,direction:0,cost:0,score:length(start,end)});
 let visited=0;
 while(queue.length && visited++<24000){
  const current=pop(),k=key(current.index,current.direction);if(current.cost!==distances.get(k))continue;
  if(current.index===endIndex){const points=[];let cursor=k;while(cursor!==undefined){points.push(point(Math.floor(cursor/3)));cursor=parents.get(cursor);}return simplifyWirePoints(points.reverse());}
  const column=current.index%width,row=Math.floor(current.index/width),a=point(current.index);
  for(const [dc,dr,direction] of [[-1,0,1],[1,0,1],[0,-1,2],[0,1,2]]){
   const col=column+dc,r=row+dr;if(col<0 || col>=width || r<0 || r>=y.length)continue;
   const next=r*width+col,b=point(next),nk=key(next,direction);
   if(!blocked.has(next))blocked.set(next,relevant.some(o=>inside(b,o)));
   if(blocked.get(next))continue;
   const segmentKey=current.index<next?current.index+':'+next:next+':'+current.index;
   if(!clear.has(segmentKey))clear.set(segmentKey,!relevant.some(o=>segmentCrossesObstacle(a,b,o)));
   if(!clear.get(segmentKey))continue;
   if(!penalties.has(segmentKey))penalties.set(segmentKey,segmentPenalty(a,b,routes));
   const cost=current.cost+length(a,b)+(current.direction && current.direction!==direction?12:0)+penalties.get(segmentKey);
   if(cost>=(distances.get(nk)??Infinity))continue;
   distances.set(nk,cost);parents.set(nk,k);push({index:next,direction,cost,score:cost+length(b,end)});
  }
 }
 return null;
}
export function manualWirePoints(start,end,waypoints){
 const points=[start];
 for(const raw of [...waypoints,end]){
  const p=Array.isArray(raw)?raw:[raw.x,raw.y],a=points.at(-1);
  if(a[0]!==p[0] && a[1]!==p[1]){
   const previous=points.at(-2),vertical=previous && previous[0]===a[0];points.push(vertical?[a[0],p[1]]:[p[0],a[1]]);
  }
  points.push([...p]);
 }
 return simplifyWirePoints(points);
}
// Reattach endpoint-adjacent segments while retaining the user's interior lanes.
export function reanchorManualRoute(start,end,waypoints,nextStart=start,nextEnd=end){
 const points=manualWirePoints(start,end,waypoints),sourceDelta=nextStart.map((value,axis)=>value-start[axis]),targetDelta=nextEnd.map((value,axis)=>value-end[axis]);
 if(same(sourceDelta,targetDelta))return points.map(point=>point.map((value,axis)=>value+sourceDelta[axis]));
 if(points.length<3){
  const corner=start[1]===end[1]?[nextEnd[0],nextStart[1]]:[nextStart[0],nextEnd[1]];
  return simplifyWirePoints([nextStart,corner,nextEnd]);
 }
 const result=points.map(point=>[...point]),last=points.length-1;
 result[0]=[...nextStart];result[last]=[...nextEnd];
 const sourceAxis=points[0][0]===points[1][0]?0:1,targetAxis=points[last][0]===points[last-1][0]?0:1;
 result[1][sourceAxis]=nextStart[sourceAxis];result[last-1][targetAxis]=nextEnd[targetAxis];
 return simplifyWirePoints(result);
}
export function orthogonalWireRoute({sourceX,sourceY,targetX,targetY,targetPosition='left',data},previous=[]){
 const start=data.sourceAnchor || [sourceX,sourceY],end=data.targetAnchor || [targetX,targetY];
 if(data.manualRoute?.length){const points=reanchorManualRoute(data.manualSourceAnchor || start,data.manualTargetAnchor || end,data.manualRoute,start,end);return {points,path:roundedWirePath(points),manual:true,spacing:8};}
 const obstacles=wireObstacles(data),normal={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]}[targetPosition] || [-1,0];
 const preferred=18+(data.laneIndex||0)%8*8;
 const gap=[preferred,18,10].find(value=>!obstacles.some(o=>inside([end[0]+normal[0]*value,end[1]+normal[1]*value],o))) || 10;
 const approach=[end[0]+normal[0]*gap,end[1]+normal[1]*gap];
 let points=shortRoute(start,approach,obstacles,previous,data.laneIndex||0);
 for(const padding of points?[]:[48,160,480]){points=searchRoute(start,approach,obstacles,previous,data.laneIndex||0,padding);if(points)break;}
 const fallback=!points;
 if(!points)points=manualWirePoints(start,approach,[]);
 points=simplifyWirePoints([...points,end]);
 return {points,path:roundedWirePath(points),spacing:8,blocked:fallback};
}
// Kept as a callable adapter for existing integrations; all contacts use the new router.
export const boardDetour=orthogonalWireRoute;
export function routeAssemblyEdges(edges,nodes,board){
 const byId=new Map(nodes.map(node=>[node.id,node])),origin=byId.get('board')?.position || {x:0,y:0},routes=[];
 const result=new Map();
 const sorted=[...edges].sort((a,b)=>(a.data.sourcePin?.y ?? Infinity)-(b.data.sourcePin?.y ?? Infinity) || compare(a.id,b.id));
 for(const edge of sorted){
  const target=byId.get(edge.target),pin=edge.data.sourcePin,terminal=edge.data.targetTerminal;if(!target || !pin || !terminal)continue;
  const data={...edge.data,sourceAnchor:[origin.x+pin.x,origin.y+pin.y],targetAnchor:[target.position.x+terminal.x,target.position.y+terminal.y],boardPosition:origin,boardPins:board.pins,boardKeepOut:board.routing?.keepOutAreas || [],sceneNodes:nodes};
  const route=orthogonalWireRoute({data,targetPosition:terminal.side},routes);routes.push(route.points);result.set(edge.id,{...edge,zIndex:edge.selected?12:4,data:{...data,route}});
 }
 return edges.map(edge=>result.get(edge.id) || edge);
}
export function wireFitPadding(nodes,edges){
 if(!nodes.length)return 0.12;
 const xs=nodes.flatMap(node=>[node.position.x,node.position.x+(node.width || node.measured?.width || 0)]),ys=nodes.flatMap(node=>[node.position.y,node.position.y+(node.height || node.measured?.height || 0)]);
 const points=edges.flatMap(edge=>edge.data.route?.points || []);
 const dx=Math.max(...xs)-Math.min(...xs),dy=Math.max(...ys)-Math.min(...ys);
 const margin=Math.max(0,Math.min(...xs)-Math.min(...xs,...points.map(p=>p[0])),Math.max(...xs,...points.map(p=>p[0]))-Math.max(...xs),Math.min(...ys)-Math.min(...ys,...points.map(p=>p[1])),Math.max(...ys,...points.map(p=>p[1]))-Math.max(...ys));
 return Math.max(0.12,2*(margin+16)/Math.max(1,Math.min(dx,dy)));
}
