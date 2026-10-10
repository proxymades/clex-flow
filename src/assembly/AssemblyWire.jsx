import { BaseEdge, getBezierPath, Position } from '@xyflow/react';

function aroundBoard(sourceX, sourceY, targetX, targetY, pin, width, height, id, targetPosition, targetTerminal, targetWidth, targetHeight) {
  const boardX = sourceX - pin.x + 6, boardY = sourceY - pin.y;
  if (targetX <= boardX + width) return null;
  const channel = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3 * 8;
  const gap = 32 + channel, left = boardX - gap;
  const targetNodeX = targetX - (targetTerminal?.x || 0) + (targetPosition === Position.Left ? 6 : targetPosition === Position.Right ? -6 : 0);
  const targetNodeY = targetY - (targetTerminal?.y || 0) + (targetPosition === Position.Top ? 6 : targetPosition === Position.Bottom ? -6 : 0);
  const top = Math.min(boardY, targetNodeY) - gap, bottom = Math.max(boardY + height, targetNodeY + targetHeight) + gap;
  const detourY = Math.abs(sourceY - top) + Math.abs(targetY - top) <= Math.abs(sourceY - bottom) + Math.abs(targetY - bottom) ? top : bottom;
  const verticalTarget = targetPosition === Position.Top || targetPosition === Position.Bottom;
  const approachX = targetX + (targetPosition === Position.Right ? 24 : -24);
  const approachY = targetY + (targetPosition === Position.Bottom ? 24 : -24);
  const right = Math.max(boardX + width + gap, verticalTarget ? targetNodeX + targetWidth + 24 : approachX);
  const points = [[sourceX, sourceY], [left, sourceY], [left, detourY], [right, detourY]];
  if (verticalTarget) points.push([right, approachY], [targetX, approachY], [targetX, targetY]);
  else points.push([right, targetY], [targetX, targetY]);
  let path = 'M' + points[0].join(' ');
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], point = points[i], after = points[i + 1];
    const a = Math.hypot(point[0] - before[0], point[1] - before[1]), b = Math.hypot(after[0] - point[0], after[1] - point[1]);
    const radius = Math.min(8, a / 2, b / 2);
    const entry = point.map((value, axis) => value - (value - before[axis]) / (a || 1) * radius);
    const exit = point.map((value, axis) => value + (after[axis] - value) / (b || 1) * radius);
    path += ' L' + entry.join(' ') + ' Q' + point.join(' ') + ' ' + exit.join(' ');
  }
  return path + ' L' + points.at(-1).join(' ');
}

export default function AssemblyWire({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const [bezier] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  // A left-side physical contact is inside the SVG node's label area.
  // Route around the board so its opaque image does not hide the wire.
  const path = sourcePosition === Position.Left && data.sourcePin
    ? aroundBoard(sourceX, sourceY, targetX, targetY, data.sourcePin, data.boardWidth, data.boardHeight, id, targetPosition, data.targetTerminal, data.targetWidth, data.targetHeight) || bezier
    : bezier;
  return <g className="physical-wire" data-wire={id} role="button" tabIndex={0} aria-label={data.label} onClick={event => { event.stopPropagation(); data.onSelect(id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); data.onSelect(id); } }}>
    <BaseEdge id={id} path={path} className="visible-wire" interactionWidth={18} style={{ stroke: data.color, strokeWidth: data.selected ? 4 : 2.2, strokeDasharray: data.ground ? '5 4' : undefined, opacity: data.highlighted ? 1 : 0.75 }} />
    <title>{data.diagnostic || data.label}</title>
  </g>;
}
