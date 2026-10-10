import { BaseEdge, getBezierPath, Position } from '@xyflow/react';

import { boardDetour } from './wireRouting.js';

export default function AssemblyWire({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const [bezier] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  // A left-side physical contact is inside the SVG node's label area.
  // Route around the board so its opaque image does not hide the wire.
  const detour = sourcePosition === Position.Left && data.sourcePin
    ? boardDetour({ sourceX, sourceY, targetX, targetY, targetPosition, data }) : null;
  const path = detour?.path || bezier;
  return <g className="physical-wire" data-wire={id} role="button" tabIndex={0} aria-label={data.label} onClick={event => { event.stopPropagation(); data.onSelect(id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); data.onSelect(id); } }}>
    <BaseEdge id={id} path={path} className="visible-wire" interactionWidth={detour && data.laneCount > 1 ? Math.min(18, Math.max(4, detour.spacing * 1.2)) : 18} style={{ stroke: data.color, strokeWidth: data.selected ? 4 : 2.2, strokeDasharray: data.ground ? '5 4' : undefined, opacity: data.highlighted ? 1 : 0.75 }} />
    <title>{data.diagnostic || data.label}</title>
  </g>;
}
