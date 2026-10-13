import { dynamicDisplayProject } from './dynamic-display-fixture.js';
import { networkProject } from './network-fixture.js';
import { connectTerminal } from '../src/assembly/model.js';
import { catalog } from './catalog-fixture.js';
export function p4Project(network = false, revision = 'pre-v3') {
  let project = network ? networkProject() : dynamicDisplayProject(true);
  project = { ...project, boardId: 'waveshare-esp32-p4-nano', boardSettings: { chipRevision: revision }, gpioAssignments: [], assembly: { ...project.assembly, connections: [] } };
  const board=catalog.boards.find(board=>board.id===project.boardId);
  project.components.forEach((component,index)=>{project.assembly.positions[component.id]={x:project.assembly.positions.board.x+board.width+80+index*270,y:100};});
  const display = project.components.find(component => component.moduleId === 'clex.display.spi-240x320');
  for (const [terminal, pin] of [['gnd','P1-9'],['vcc','P1-1'],['sclk','P1-13'],['mosi','P1-15'],['cs','P1-16'],['dc','P1-7'],['reset','P1-23']]) {
    project = connectTerminal(project, catalog, display.id, terminal, pin);
  }
  return project;
}
