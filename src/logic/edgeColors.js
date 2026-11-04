import {TYPE_COLORS} from './model.js';
// The line and its contacts use the same type color.
export function logicEdgeColors(edges){
 return Object.fromEntries(edges.map(edge=>[edge.id,TYPE_COLORS[edge.dataType]||'#94a3b8']));
}
