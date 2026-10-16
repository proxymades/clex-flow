import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {boardFamily,selectableBoards} from '../src/catalog/boardSelection.js';
test('board selector excludes profiles without pins and searches names, MCU and manufacturer',()=>{
 const boards=selectableBoards(catalog.boards);assert.ok(boards.length);assert.ok(boards.every(board=>board.pins.length));assert.equal(boards.some(board=>board.id==='esp32-s3-generic'),false);
 assert.equal(selectableBoards(catalog.boards,{query:'  NANO ch340  '})[0].id,'arduino-nano-atmega328p-ch340');
 assert.ok(selectableBoards(catalog.boards,{query:'ESP32 S3'}).every(board=>board.target==='esp32s3'));
 assert.equal(selectableBoards(catalog.boards,{query:'P4NRW32 waveshare'})[0].id,'waveshare-esp32-p4-nano');
 assert.deepEqual(selectableBoards(catalog.boards,{query:'несуществующая плата'}),[]);
});
test('manufacturer, family and search combine and never change the catalog',()=>{
 const before=structuredClone(catalog.boards);const results=selectableBoards(catalog.boards,{family:'ESP32',manufacturer:'Waveshare',query:'nano'});assert.equal(results.length,1);assert.equal(results[0].id,'waveshare-esp32-p4-nano');
 assert.equal(selectableBoards(catalog.boards,{family:'Arduino AVR',manufacturer:'Waveshare'}).length,0);assert.deepEqual(catalog.boards,before);
 assert.equal(boardFamily({family:'RP2040',platform:'pico-sdk'}),'RP2040');
});
test('a catalog of 100 boards remains complete and a specific model can be found',()=>{
 const base=selectableBoards(catalog.boards)[0];const boards=Array.from({length:100},(_,index)=>({...base,id:'test-'+index,name:'Контроллер '+index,manufacturer:index%2?'Завод А':'Завод Б'}));
 assert.equal(selectableBoards(boards).length,100);assert.equal(selectableBoards(boards,{manufacturer:'Завод А'}).length,50);assert.equal(selectableBoards(boards,{query:'Контроллер 99'})[0].id,'test-99');
});
