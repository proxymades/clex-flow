import {catalog} from './catalog-fixture.js';
import {relayProject} from './relay-fixture.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';

export const COUNTDOWN_BOARDS = ['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'];

export function countdownProject(boardId = COUNTDOWN_BOARDS[0], {durationSeconds = 5, cancelOnRelease = false, activeLevel = 'low'} = {}) {
  let {project,component,blocks} = relayProject({boardId,channels:'1',connected:[1],powerSource:'external',activeLevel});
  project = addHardware(project,catalog.modules.find(module=>module.id==='clex.hardware.button'),catalog);
  const button = project.components.at(-1), board = catalog.boards.find(board=>board.id===boardId);
  const signal = board.pins.find(pin=>!connectionProblem(project,catalog,button.id,'signal',pin.id));
  project = connectTerminal(project,catalog,button.id,'signal',signal.id);
  project = connectTerminal(project,catalog,button.id,'ground',board.pins.find(pin=>pin.kind==='ground').id);
  let graph = {...project.logic,nodes:blocks,edges:[]};
  const add = id => {
    graph = addNode(graph,catalog.modules.find(module=>module.id===id),project.components,{...project,logic:graph},catalog);
    return graph.nodes.at(-1);
  };
  const pressed = add('clex.logic.gpio-edge');
  pressed.parameters.componentId = button.id;
  const countdown = add('clex.logic.countdown');
  countdown.parameters.durationSeconds = durationSeconds;
  const output = blocks[0];
  const link = (source,sourceHandle,target,targetHandle) => {
    graph = connectNodes(graph,catalog,{source:source.id,sourceHandle,target:target.id,targetHandle},{...project,logic:graph});
  };
  link(pressed,'active',countdown,'start');
  link(countdown,'started',output,'on');
  link(countdown,'elapsed',output,'off');
  if (cancelOnRelease) link(pressed,'inactive',countdown,'cancel');
  project = withLogic(project,graph);
  return {project,countdown,pressed,output,component,button};
}
