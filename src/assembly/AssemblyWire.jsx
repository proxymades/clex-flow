import { useRef, useState } from 'react';
import { BaseEdge, useReactFlow } from '@xyflow/react';
import { orthogonalWireRoute, simplifyWirePoints, roundedWirePath } from './wireRouting.js';

export default function AssemblyWire({ id, sourceX, sourceY, targetX, targetY, targetPosition, data }) {
 const flow=useReactFlow(),drag=useRef(null),[draft,setDraft]=useState(null);
 const route=data.route || orthogonalWireRoute({sourceX,sourceY,targetX,targetY,targetPosition,data});
 const points=draft?.points || route.points;
 const segments=draft?[{index:draft.index,point:draft.handle,horizontal:draft.horizontal}]:points.slice(1).map((b,index)=>({index,point:[(points[index][0]+b[0])/2,(points[index][1]+b[1])/2],horizontal:points[index][1]===b[1]})).filter(segment=>{
  const a=points[segment.index],b=points[segment.index+1];return Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])>=24;
 });
 const trimEndpoint=(values,distance)=>{
  const result=values.map(p=>[...p]);
  while(result.length>1 && distance>0){const a=result[0],b=result[1],span=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);if(span<=distance){distance-=span;result.shift();}else{result[0]=[a[0]+(b[0]-a[0])*distance/span,a[1]+(b[1]-a[1])*distance/span];distance=0;}}
  return result;
 };
 const hitPoints=trimEndpoint(trimEndpoint(points,12).reverse(),12).reverse();
 const cancel=()=>{if(drag.current){drag.current=null;setDraft(null);data.onRouteInteraction?.(false);}};
 const commit=values=>{const normalized=simplifyWirePoints(values),controls=normalized.slice(1,-1);data.onRouteChange?.(id,controls.length?controls.slice(0,32).map(([x,y])=>({x,y})):null);setDraft(null);};
 const shifted=(state,value)=>{
  const result=state.points.map(p=>[...p]),axis=state.horizontal?1:0,a=state.index,b=a+1;
  result[a][axis]=value;result[b][axis]=value;
  if(a===0)result.unshift([...state.points[0]]);
  if(b===state.points.length-1)result.push([...state.points.at(-1)]);
  const handle=[...state.handle];handle[axis]=value;
  return {points:result,handle,index:state.index,horizontal:state.horizontal};
 };
 const begin=(event,segment)=>{
  if(!data.editable || event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
  drag.current={...segment,handle:[...segment.point],points:points.map(p=>[...p]),moved:false};data.onRouteInteraction?.(true);
 };
 const move=event=>{
  if(!drag.current)return;event.preventDefault();event.stopPropagation();const p=flow.screenToFlowPosition({x:event.clientX,y:event.clientY});
  const state=drag.current,value=Math.max(-50000,Math.min(50000,Math.round((state.horizontal?p.y:p.x)/4)*4));
  state.value=shifted(state,value);state.moved=true;setDraft(state.value);
 };
 const finish=event=>{if(!drag.current)return;event.stopPropagation();const state=drag.current;drag.current=null;if(state.moved)commit(state.value.points);else setDraft(null);data.onRouteInteraction?.(false);};
 return <g className="physical-wire" data-wire={id} data-route-points={JSON.stringify(points)} data-route-mode={data.manualRoute?.length?'manual':'auto'} role="button" tabIndex={0} aria-label={data.label} onClick={event=>{event.stopPropagation();data.onSelect(id);}} onKeyDown={event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();event.stopPropagation();data.onSelect(id);}}}>
  <path className="wire-outline" d={roundedWirePath(hitPoints,data.selected?2:4)} fill="none" stroke="#0b1019" strokeWidth={data.selected?7.6:5.8} strokeLinecap="round" strokeLinejoin="round" style={{pointerEvents:'none',opacity:data.dimmed?0.3:1}}/>
  <BaseEdge id={id} path={roundedWirePath(points,data.selected?2:4)} className="visible-wire" interactionWidth={0} style={{pointerEvents:'none',stroke:data.color,strokeWidth:data.selected?4:2.8,strokeDasharray:data.ground?'5 4':undefined,opacity:data.dimmed?0.3:1}}/>
  {hitPoints.length>1 && <path className="wire-hit-path" d={roundedWirePath(hitPoints)} fill="none" stroke="transparent" strokeWidth="8" style={{pointerEvents:'stroke'}}/>}
  <title>{data.diagnostic || data.label}{route.blocked?' · Маршрут перекрыт: переместите компонент или поправьте участки':''}</title>
  {data.selected && data.editable && segments.map(segment=><circle key={segment.index} className="wire-bend-control nodrag nopan" style={{pointerEvents:'all',cursor:segment.horizontal?'ns-resize':'ew-resize'}} data-bend={segment.index} cx={segment.point[0]} cy={segment.point[1]} r="6" fill="#172536" stroke={data.color} strokeWidth="2" role="button" tabIndex={0} aria-label={'Участок соединения '+(segment.index+1)} onPointerDown={event=>begin(event,segment)} onMouseDown={event=>event.stopPropagation()} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event=>{
   const delta=segment.horizontal?{ArrowUp:-1,ArrowDown:1}[event.key]:{ArrowLeft:-1,ArrowRight:1}[event.key];if(!delta)return;
   event.preventDefault();event.stopPropagation();const axis=segment.horizontal?1:0,state={...segment,handle:segment.point,points};commit(shifted(state,segment.point[axis]+delta*(event.shiftKey?16:4)).points);
  }}><title>{segment.horizontal?'Сдвинуть участок вверх или вниз':'Сдвинуть участок влево или вправо'}</title></circle>)}
 </g>;
}
