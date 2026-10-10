export const TERMINAL_SIDES = { left: 'Слева', right: 'Справа', bottom: 'Снизу', top: 'Сверху' };

export function terminalSide(module, terminal, overrides = {}) {
  if (TERMINAL_SIDES[overrides[terminal.id]]) return overrides[terminal.id];
  const width = module.visual.width, height = module.visual.height;
  const distances = { left: Math.abs(terminal.x), right: Math.abs(width - terminal.x), top: Math.abs(terminal.y), bottom: Math.abs(height - terminal.y) };
  return Object.keys(distances).reduce((best, side) => distances[side] < distances[best] ? side : best, 'left');
}

export function terminalLayout(module, overrides = {}) {
  if (!module) return { width: 230, height: 185, headerOffset: 0, terminals: [] };
  const grouped = Object.fromEntries(Object.keys(TERMINAL_SIDES).map(side => [side, []]));
  for (const terminal of module.terminals || []) grouped[terminalSide(module, terminal, overrides)].push(terminal);
  const headerOffset = grouped.top.length ? 36 : 0;
  const width = Math.max(module.visual.width, Math.max(grouped.top.length, grouped.bottom.length) * 82 + 24);
  const height = Math.max(module.visual.height + headerOffset, 110 + headerOffset + Math.max(grouped.left.length, grouped.right.length) * 35);
  return { width, height, headerOffset, terminals: (module.terminals || []).map((terminal, index) => {
    const side = terminalSide(module, terminal, overrides), siblings = grouped[side], slot = siblings.indexOf(terminal);
    const x = side === 'left' ? 0 : side === 'right' ? width : width * (slot + 1) / (siblings.length + 1);
    const y = side === 'top' ? 0 : side === 'bottom' ? height : Math.min(height - 16, (terminal.y ?? (125 + index * 35)) + headerOffset);
    return { ...terminal, x, y, side };
  }) };
}
