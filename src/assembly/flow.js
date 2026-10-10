export function physicalConnection(connection) {
  if (connection.source === 'board' && connection.target !== 'board') {
    return { componentId: connection.target, terminalId: connection.targetHandle, pinId: connection.sourceHandle };
  }
  if (connection.target === 'board' && connection.source !== 'board') {
    return { componentId: connection.source, terminalId: connection.sourceHandle, pinId: connection.targetHandle };
  }
  throw new Error('Соединяйте контакт платы с контактом компонента.');
}

export function physicalEdges(project) {
  return project.assembly.connections.map(wire => ({
    id: wire.id, type: 'physical', source: 'board', sourceHandle: wire.boardPinId,
    target: wire.componentId, targetHandle: wire.terminalId,
  }));
}
