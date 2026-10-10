const SIGNAL_COLORS = ['#5ba8ef', '#efa45e', '#e6c75b', '#df83a8', '#58bfc2', '#b5a06b', '#91b9d8', '#cc9476', '#cad27f', '#bb91a3'];
export const GROUND_COLOR = '#97a6bd';
export const POWER_COLOR = '#ef6666';
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
function signalColor(index) {
  if (index < SIGNAL_COLORS.length) return SIGNAL_COLORS[index];
  // Extra signals use distinct hues outside the red power band and the
  // violet/neon-green interface bands. No finite palette is reused.
  const offset = ((index - SIGNAL_COLORS.length) * 67) % 173;
  const hue = offset < 63 ? 22 + offset : offset < 143 ? 155 + offset - 63 : 310 + offset - 143;
  return `hsl(${hue} 58% ${index % 2 ? 68 : 54}%)`;
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
