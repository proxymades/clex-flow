import {resolveRelayModule} from '../relay/model.js';
import { physicalEdges } from './flow.js';
import { terminalLayout } from './terminalLayout.js';
import { allocateWireLanes } from './wireRouting.js';

// Только геометрия. Выделение, подсветка и камера не запускают поиск маршрутов.
export function assemblyRoutingScene({ components, positions, connections, portSides }, board, catalog) {
  const layouts = new Map(components.map(component => [component.id,
    terminalLayout(resolveRelayModule(component,catalog.modules.find(module => module.id === component.moduleId)), portSides?.[component.id]),
  ]));
  const nodes = [{ id: 'board', position: positions.board, width: board.width, height: board.height },
    ...components.map(component => {
      const layout = layouts.get(component.id);
      return { id: component.id, position: positions[component.id], width: layout.width, height: layout.height };
    }),
  ];
  const wires = new Map(connections.map(wire => [wire.id, wire]));
  const edges = allocateWireLanes(physicalEdges({ assembly: { connections } }).map(edge => {
    const wire = wires.get(edge.id), sourceLayout = layouts.get(wire.sourceComponentId), targetLayout = layouts.get(wire.componentId);
    const pin = sourceLayout ? sourceLayout.terminals.find(terminal => terminal.id === wire.sourceTerminalId) : board.pins.find(pin => pin.id === wire.boardPinId);
    const terminal = targetLayout?.terminals.find(terminal => terminal.id === wire.terminalId);
    const source = positions[wire.sourceComponentId || 'board'], target = positions[wire.componentId];
    return { ...edge, data: {
      sourcePin: pin, targetTerminal: terminal, manualRoute: wire.route,
      manualSourceAnchor: pin && [source.x + pin.x, source.y + pin.y],
      manualTargetAnchor: terminal && [target.x + terminal.x, target.y + terminal.y],
      targetWidth: targetLayout?.width, targetHeight: targetLayout?.height,
      boardWidth: sourceLayout ? 0 : board.width, boardHeight: sourceLayout ? 0 : board.height,
      sourceComponentId: wire.sourceComponentId, sourceWidth: sourceLayout?.width, sourceHeight: sourceLayout?.height,
    } };
  }));
  return { nodes, edges };
}
