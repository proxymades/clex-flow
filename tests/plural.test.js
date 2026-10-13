import test from 'node:test';
import assert from 'node:assert/strict';
import { pluralForm, formatCount } from '../src/utils/plural.js';

test('Russian quantities handle ones, fews and the 11-14 exception at every hundred', () => {
  const forms = ['компонент', 'компонента', 'компонентов'];
  for (const n of [1,21,31,41,101,121,1001]) assert.equal(pluralForm(n,forms),'компонент',String(n));
  for (const n of [2,3,4,22,23,24,44,102,124]) assert.equal(pluralForm(n,forms),'компонента',String(n));
  for (const n of [0,5,10,11,12,13,14,20,25,100,111,112,113,114]) assert.equal(pluralForm(n,forms),'компонентов',String(n));
  assert.equal(formatCount(44,forms),'44 компонента');
  assert.equal(formatCount(21,forms),'21 компонент');
});
test('the helper supports irregular nouns, adjectives, negative and fractional values', () => {
  assert.equal(formatCount(1,['связь','связи','связей']),'1 связь');
  assert.equal(formatCount(2,['связь','связи','связей']),'2 связи');
  assert.equal(formatCount(11,['ошибка','ошибки','ошибок']),'11 ошибок');
  assert.equal(formatCount(1,['аппаратный модуль','аппаратных модуля','аппаратных модулей']),'1 аппаратный модуль');
  assert.equal(pluralForm(-21,['блок','блока','блоков']),'блок');
  assert.equal(pluralForm(1.5,['компонент','компонента','компонентов']),'компонента');
});
