import {componentContact} from './endpoints.js';
export function physicalConnection(connection) {
  if(!connection.sourceHandle||!connection.targetHandle)throw new Error('Выберите контакт платы или компонента с обеих сторон.');
  if (connection.source === 'board' && connection.target !== 'board') {
    return { componentId: connection.target, terminalId: connection.targetHandle, pinId: connection.sourceHandle };
  }
  if (connection.target === 'board' && connection.source !== 'board') {
    return { componentId: connection.source, terminalId: connection.sourceHandle, pinId: connection.targetHandle };
  }
  if(connection.source!==connection.target&&connection.source&&connection.target)return {componentId:connection.target,terminalId:connection.targetHandle,pinId:componentContact(connection.source,connection.sourceHandle)};
  throw new Error('Выберите два разных компонента или плату и компонент.');
}

export function physicalEdges(project) {
  return project.assembly.connections.map(wire => ({
    id: wire.id, type: 'physical', source: wire.sourceComponentId||'board', sourceHandle: wire.sourceTerminalId||wire.boardPinId,
    target: wire.componentId, targetHandle: wire.terminalId,
  }));
}
