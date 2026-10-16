// Saturated, separated hues remain legible as thin lines on the dark canvas.
const SIGNAL_COLORS = ['#37d7ff', '#ffb52e', '#c58aff', '#56ed87', '#ff83d1', '#f5ec55', '#789bff', '#e9f4ff', '#24dfcb', '#ff9a60'];
export const GROUND_COLOR = '#d1dbea';
export const POWER_COLOR = '#ff6565';
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
function signalColor(index) {
  if (index < SIGNAL_COLORS.length) return SIGNAL_COLORS[index];
  // Extra signals use distinct hues outside the red power band and the
  // violet/neon-green interface bands instead of restarting the base palette.
  const offset = ((index - SIGNAL_COLORS.length) * 67) % 173;
  const hue = offset < 63 ? 22 + offset : offset < 143 ? 155 + offset - 63 : 310 + offset - 143;
  return `hsl(${hue} 90% ${index % 2 ? 75 : 63}%)`;
}
export function wireColors(project, catalog) {
  const colors = {}, signals = [];
  for (const wire of project.assembly.connections) {
    const component = project.components.find(component => component.id === wire.componentId);
    const terminal = catalog.modules.find(module => module.id === component?.moduleId)?.terminals.find(terminal => terminal.id === wire.terminalId);
    if (terminal?.kind === 'ground') colors[wire.id] = GROUND_COLOR;
    else if (terminal?.kind === 'power') colors[wire.id] = POWER_COLOR;
    else signals.push(wire);
  }
  signals.sort((a,b)=>compare(a.id,b.id)).forEach((wire,index)=>{colors[wire.id]=signalColor(index);});
  return colors;
}
