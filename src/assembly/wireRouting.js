const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Presentation data only. Physical IDs and the stored project are untouched.
export function allocateWireLanes(edges) {
  const groups = new Map(), lanes = new Map();
  for (const edge of edges) {
    const pin = edge.data.sourcePin;
    if (!pin) continue;
    const side = pin.x < edge.data.boardWidth / 2 ? 'left' : 'right';
    const key = edge.source + ':' + side;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.data.sourcePin.y - b.data.sourcePin.y || compare(a.target, b.target) || compare(a.targetHandle, b.targetHandle) || compare(a.id, b.id));
    group.forEach((edge, index) => lanes.set(edge.id, { laneIndex: index, laneCount: group.length }));
  }
  return edges.map(edge => ({ ...edge, data: { ...edge.data, ...lanes.get(edge.id) } }));
}

export function roundedWirePath(points) {
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

export function boardDetour({ sourceX, sourceY, targetX, targetY, targetPosition, data }) {
  const { sourcePin: pin, boardWidth: width, boardHeight: height, targetTerminal, targetWidth, targetHeight, laneIndex = 0, laneCount = 1 } = data;
  const boardX = sourceX - pin.x + 6, boardY = sourceY - pin.y;
  if (targetX <= boardX + width) return null;
  const offset = 32 + laneIndex * 12, left = boardX - offset;
  const targetNodeX = targetX - (targetTerminal?.x || 0) + (targetPosition === 'left' ? 6 : targetPosition === 'right' ? -6 : 0);
  const targetNodeY = targetY - (targetTerminal?.y || 0) + (targetPosition === 'top' ? 6 : targetPosition === 'bottom' ? -6 : 0);
  const top = Math.min(boardY, targetNodeY) - offset, bottom = Math.max(boardY + height, targetNodeY + targetHeight) + offset;
  const detourY = Math.abs(sourceY - top) + Math.abs(targetY - top) <= Math.abs(sourceY - bottom) + Math.abs(targetY - bottom) ? top : bottom;
  const verticalTarget = targetPosition === 'top' || targetPosition === 'bottom';
  // The approach must also have its own lane, not a shared vertical trunk.
  // Compress the spacing when the component is close to the board, keeping
  // every approach inside the free corridor rather than through either node.
  const corridor = targetX - boardX - width;
  const clearance = Math.min(24, corridor / (laneCount + 2));
  const spacing = Math.min(12, Math.max(0, corridor - 2 * clearance) / Math.max(1, laneCount - 1));
  const right = targetPosition === 'left'
    ? targetX - clearance - laneIndex * spacing
    : targetNodeX + targetWidth + 24 + laneIndex * 12;
  const approachY = targetY + (targetPosition === 'bottom' ? 1 : -1) * (24 + laneIndex * 12);
  const points = [[sourceX, sourceY], [left, sourceY], [left, detourY], [right, detourY]];
  if (verticalTarget) points.push([right, approachY], [targetX, approachY], [targetX, targetY]);
  else points.push([right, targetY], [targetX, targetY]);
  return { path: roundedWirePath(points), points, spacing: targetPosition === 'left' ? spacing : 12 };
}
