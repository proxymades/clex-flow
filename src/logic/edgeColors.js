// Connection colors identify routes; the port colors still identify data types.
const PALETTE = ['#5ba8ef', '#efa45e', '#df83a8', '#58bfc2', '#e6c75b', '#b397e8', '#a6ce78', '#ed8f79', '#84bdde', '#d5a9cd', '#cfb58b', '#9ab1f0'];
export function logicEdgeColors(edges) {
  const colors = {};
  [...edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).forEach((edge, index) => {
    // Large graphs get extra hues rather than restarting the palette.
    colors[edge.id] = PALETTE[index] || `hsl(${(index * 137.508) % 360} 65% ${index % 2 ? 72 : 60}%)`;
  });
  return colors;
}
