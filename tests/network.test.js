import test from 'node:test';
import assert from 'node:assert/strict';
import {networkProject,ethernetModule} from './network-fixture.js';
import {catalog} from './catalog-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {validateAssembly,addHardware} from '../src/assembly/model.js';
import {validateGraph,connectNodes,withLogic,connectionProblem} from '../src/logic/model.js';
import {elementUpdatePort,saveScreen} from '../src/displays/model.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {indicatorState,newIndicator} from '../src/displays/indicator.js';
import {probeUrl,ipv4} from '../src/network/model.js';
import {displayProject} from './display-fixture.js';
test('indicator and real network bindings round-trip using ordinary graph connections',()=>{
 const project=networkProject();assert.deepEqual(parseProject(serializeProject(project)),project);
 assert.deepEqual([...validateAssembly(project,catalog),...validateGraph(project,catalog)].filter(issue=>issue.severity==='error'),[]);
 assert.equal(project.logic.nodes.length,3);assert.equal(project.logic.edges.length,6);
 const bundle=generateFirmware(project,catalog);assert.equal(bundle.networkRuntime,'esp-idf-network-1');
 assert.match(bundle.mainC,/esp_eth_mac_new_w5500/);assert.match(bundle.mainC,/IP_EVENT_ETH_GOT_IP/);assert.match(bundle.mainC,/dns_gethostbyname_addrtype/);assert.match(bundle.mainC,/esp_http_client_fetch_headers/);
 assert.match(bundle.mainC,/clex_graphics_set_indicator_state/);assert.match(bundle.files['sdkconfig.defaults'],/ETH_SPI_ETHERNET_W5500=y/);
 assert.match(bundle.files['partitions.csv'],/0x300000/);assert.doesNotMatch(bundle.mainC,/192\.168\.1\.100|PoE.*connected/);
});
test('display and Ethernet can exchange SPI controllers; collisions and unavailable providers are rejected',()=>{
 const project=networkProject(),display=project.components.find(component=>component.moduleId!==ethernetModule.id),network=project.components.find(component=>component.moduleId===ethernetModule.id);
 assert.equal(display.parameters.spiHost,'3');assert.equal(network.parameters.spiHost,'2');
 display.parameters.spiHost='2';network.parameters.spiHost='3';assert.deepEqual(validateAssembly(project,catalog).filter(issue=>issue.severity==='error'),[]);
 assert.match(generateFirmware(project,catalog).mainC,/spi_bus_initialize\(SPI3_HOST, &bus/);
 network.parameters.spiHost='2';assert.ok(validateAssembly(project,catalog).some(issue=>issue.code==='spi-conflict'));assert.throws(()=>generateFirmware(project,catalog),/свободный SPI/);
 const unsupported={...displayProject(),boardId:'espressif-devkitc-1-v1-1-n8r8'};assert.throws(()=>addHardware(unsupported,ethernetModule,catalog),/нет описанного/);
});
test('indicator state names and colors are user-defined and boolean mappings are exact',()=>{
 const indicator=newIndicator(catalog.modules.find(module=>module.display).display);indicator.mode='dynamic';indicator.valueType='boolean';indicator.initialValue=false;
 indicator.states[0].value=false;indicator.states[0].text='Холодно';indicator.states[0].dotColor='#112233';indicator.states[1].value=true;indicator.states[1].text='Горячо';
 assert.equal(indicatorState(indicator,true).text,'Горячо');assert.equal(indicatorState(indicator,false).dotColor,'#112233');
});
test('static addressing and probe URLs are validated before generating firmware',()=>{
 const project=networkProject(),network=project.components.find(component=>component.moduleId===ethernetModule.id);
 network.parameters.addressMode='static';assert.ok(validateAssembly(project,catalog).some(issue=>issue.code==='network-config'));
 Object.assign(network.parameters,{staticIp:'10.20.30.40',netmask:'255.255.255.0',gateway:'10.20.30.1',dns:'10.20.30.1'});
 const source=generateFirmware(project,catalog).mainC;assert.match(source,/esp_netif_dhcpc_stop/);assert.match(source,/10\.20\.30\.40/);
 network.parameters.staticIp='010.020.030.040';assert.match(generateFirmware(project,catalog).mainC,/esp_netif_str_to_ip4\("10\.20\.30\.40"/);
 assert.equal(ipv4('300.1.2.3'),null);assert.equal(probeUrl('file:///tmp/example'),null);assert.equal(probeUrl('https://user:secret@example.com'),null);
});

test('one indicator accepts independent state and arbitrary text through existing ports',()=>{
 let project=networkProject();const display=project.components.find(component=>component.moduleId!==ethernetModule.id);
 const indicator=project.screens[display.id].elements.find(element=>element.type==='indicator');indicator.captionDynamic=true;indicator.initialCaption='Ожидание адреса';
 const ethernet=project.logic.nodes.find(node=>node.moduleId==='clex.logic.ethernet'),view=project.logic.nodes.find(node=>node.moduleId==='clex.logic.display');
 let graph=project.logic;const caption='caption.'+indicator.id;
 for(const [sourceHandle,targetHandle] of [['ip',caption],['changed',elementUpdatePort(caption)]])graph=connectNodes(graph,catalog,{source:ethernet.id,sourceHandle,target:view.id,targetHandle},{...project,logic:graph});
 project=withLogic(project,graph);assert.deepEqual(validateGraph(project,catalog).filter(issue=>issue.severity==='error'),[]);
 assert.deepEqual(parseProject(serializeProject(project)),project);
 const source=generateFirmware(project,catalog).mainC;assert.match(source,/clex_graphics_set_indicator_caption/);
 assert.match(connectionProblem(graph,catalog,{source:ethernet.id,sourceHandle:'link',target:view.id,targetHandle:caption},null,project),/Несовместимые типы/);
 const screen=structuredClone(project.screens[display.id]);screen.elements.find(element=>element.id===indicator.id).captionDynamic=false;
 const saved=saveScreen(project,display.id,screen);
 assert.ok(!saved.logic.edges.some(edge=>edge.targetHandle===caption||edge.targetHandle===elementUpdatePort(caption)));
 assert.ok(saved.logic.edges.some(edge=>edge.targetHandle===indicator.id));
});
test('several Ethernet output ports keep independent values and boolean state keys',()=>{
 const project=networkProject(),display=project.components.find(component=>component.moduleId!==ethernetModule.id),screen=project.screens[display.id];
 const indicator=screen.elements.find(element=>element.type==='indicator');indicator.valueType='boolean';indicator.initialValue=false;
 indicator.states=indicator.states.slice(0,2);indicator.states[0].value=false;indicator.states[1].value=true;indicator.fallbackStateId=indicator.states[0].id;
 const stateEdge=project.logic.edges.find(edge=>edge.targetHandle===indicator.id);stateEdge.sourceHandle='link';stateEdge.dataType='boolean';
 const ipElement=screen.elements.find(element=>element.name==='IP-адрес');project.logic.edges.find(edge=>edge.targetHandle===ipElement.id).sourceHandle='gateway';
 const source=generateFirmware(project,catalog).mainC;
 assert.match(source,/\(ethernet_value_\d+\.link\) \? "true" : "false"/);assert.match(source,/clex_graphics_set_text\([^;]+ethernet_value_\d+\.gateway\)/);
});

test('completion-only indicator updates remain valid with a separate IP-change reset event',()=>{
 const project=networkProject(),probe=project.logic.nodes.find(node=>node.moduleId==='clex.logic.internet-check'),ethernet=project.logic.nodes.find(node=>node.moduleId==='clex.logic.ethernet'),display=project.logic.nodes.find(node=>node.moduleId==='clex.logic.display');
 project.logic.edges=project.logic.edges.map(edge=>edge.source===probe.id&&edge.dataType==='event'?{...edge,sourceHandle:'done'}:edge);
 const steady=withLogic(project,connectNodes(project.logic,catalog,{source:ethernet.id,sourceHandle:'ipChanged',target:display.id,targetHandle:'trigger'},project));
 assert.deepEqual(validateGraph(steady,catalog).filter(issue=>issue.severity==='error'),[]);
 assert.deepEqual(parseProject(serializeProject(steady)),steady);
 assert.ok(!steady.logic.edges.some(edge=>edge.source===probe.id&&edge.dataType==='event'&&edge.sourceHandle==='changed'));
 assert.match(generateFirmware(steady,catalog).mainC,/if \(event.flags\) node_\d+_emit_done\(\)/);
});
