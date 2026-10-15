import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteQueue } from '../src/projects/writeQueue.js';
import { displayProject } from './display-fixture.js';
import { serializeProject, parseProject } from '../src/projects/model.js';

test('a retained queue recovers from an old screen validator using the current writer', async () => {
  const project = displayProject();
  project.screens[project.components[0].id].elements.push({ id:'logo', type:'image', x:20, y:20, width:1, height:1, image:{format:'rgba8888',width:1,height:1,data:'/wAA/w=='} });
  const queue = createWriteQueue(() => { throw new Error('Некорректный элемент интерфейса экрана.'); });
  await assert.rejects(queue(project), /Некорректный элемент/);
  const saved = [];
  queue.setWriter(value => saved.push(serializeProject(value)));
  await queue(project);
  assert.deepEqual(parseProject(saved[0]).screens, project.screens);
});
test('changing the writer keeps pending writes serialized and uses the current handler for subsequent values', async () => {
  const calls = [];
  let finish;
  const queue = createWriteQueue(value => new Promise(resolve => { calls.push('old:' + value); finish = resolve; }));
  const first = queue(1);
  await Promise.resolve();
  const second = queue(2);
  queue.setWriter(value => calls.push('new:' + value));
  await Promise.resolve();
  assert.deepEqual(calls, ['old:1']);
  finish();
  await first; await second;
  assert.deepEqual(calls, ['old:1', 'new:2']);
});


test('flush waits for pending writes, including a recovered failure, before a storage switch', async () => {
  const calls = [];
  let finish;
  const queue = createWriteQueue(value => new Promise(resolve => { calls.push(value); finish = resolve; }));
  const pending = queue('old directory');
  await Promise.resolve();
  let flushed = false;
  const flush = queue.flush().then(() => { flushed = true; });
  await Promise.resolve(); assert.equal(flushed, false);
  finish(); await pending; await flush; assert.equal(flushed, true);
  queue.setWriter(() => { throw new Error('write failed'); });
  await assert.rejects(queue('failed'), /write failed/);
  await queue.flush();
  queue.setWriter(value => calls.push(value));
  await queue('new directory');
  assert.deepEqual(calls, ['old directory', 'new directory']);
});
