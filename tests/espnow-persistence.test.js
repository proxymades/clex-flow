import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostC} from './host-c.js';
import {catalog} from './catalog-fixture.js';
import {espNowProject} from './espnow-fixture.js';
import {espNowIssues} from '../src/espnow/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware,firmwareFingerprint,cString} from '../src/firmware/generator.js';
import {espNowPersistence} from '../src/firmware/drivers/esp-idf/espnow-persistence.js';

test('mode persistence defaults off and older projects keep exactly the same disabled firmware',async()=>{
  const {project,component}=espNowProject();
  assert.equal(component.parameters.rememberMode,false);
  const disabled=generateFirmware(project,catalog);
  assert.doesNotMatch(disabled.mainC,/nvs_(open|get_blob|set_blob|commit)\(/);
  delete component.parameters.rememberMode;
  assert.deepEqual(parseProject(serializeProject(project)),project);
  assert.equal(await firmwareFingerprint(generateFirmware(project,catalog)),await firmwareFingerprint(disabled));
  component.parameters.rememberMode='true';
  assert.ok(espNowIssues(component,catalog.boards.find(board=>board.id===project.boardId)).some(message=>message.includes('сохранения')));
});

test('enabled persistence changes firmware and uses stable project/component storage ownership',async()=>{
  const {project,component}=espNowProject();
  const disabled=await firmwareFingerprint(generateFirmware(project,catalog));
  component.parameters.rememberMode=true;
  assert.deepEqual(parseProject(serializeProject(project)),project);
  const enabled=generateFirmware(project,catalog);
  assert.notEqual(await firmwareFingerprint(enabled),disabled);
  assert.match(enabled.mainC,/#include "nvs.h"/);
  assert.match(enabled.mainC,/int mode=en_mode_load\(0\)/);
  assert.match(enabled.mainC,/clex_en_status.mode=mode;if\(!en_mode_save\(mode\)\)return false/);
  assert.match(enabled.mainC,/else en_mode_clear_error\(\)/);
  assert.doesNotMatch(enabled.mainC,/nvs_(erase|flash_erase)/);
  const namespace=source=>source.match(/en_storage_namespace\[\]="([^"]+)"/)[1];
  const original=namespace(enabled.mainC);
  assert.equal(original.length,15);
  project.name='Новое название';project.logic.nodes[0].position.x+=100;
  assert.equal(namespace(generateFirmware(project,catalog).mainC),original);
  project.id=crypto.randomUUID();
  assert.notEqual(namespace(generateFirmware(project,catalog).mainC),original);
  assert.match(espNowPersistence(project.id,'another-radio',cString,true),new RegExp(project.id+'/another-radio'));
});

const support=String.raw`
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_ERR_INVALID_STATE 1
#define ESP_ERR_NVS_NOT_FOUND 2
#define ESP_ERR_NVS_INVALID_LENGTH 3
#define EN_ALLOW_MODE 1
static struct {bool ready;int mode;char error[128];} clex_en_status={.ready=true};
static bool en_dirty;
static int rates[2],fail_rate;
static const char *esp_err_to_name(int err){return err?"TEST_ERROR":"ESP_OK";}
static void en_error(const char *message){snprintf(clex_en_status.error,sizeof(clex_en_status.error),"%s",message);}
static unsigned en_count(void){return 2;}
static esp_err_t en_rate(unsigned peer,int mode){if(fail_rate&&peer==1){fail_rate=0;return ESP_ERR_INVALID_STATE;}rates[peer]=mode;return ESP_OK;}
`;
const nvs=String.raw`
typedef int nvs_handle_t;
#define NVS_READONLY 0
#define NVS_READWRITE 1
static unsigned opens,closes,sets,commits;
static bool namespace_exists,fail_open,fail_read,fail_write,fail_commit;
static unsigned char durable[256],pending[256];static size_t durable_length,pending_length;
static char stored_namespace[16];
static esp_err_t nvs_open(const char *name,int access,nvs_handle_t *handle){
 opens++;if(fail_open)return ESP_ERR_INVALID_STATE;assert(strlen(name)<=15);
 if(!namespace_exists){if(access==NVS_READONLY)return ESP_ERR_NVS_NOT_FOUND;namespace_exists=true;snprintf(stored_namespace,sizeof(stored_namespace),"%s",name);}
 assert(!strcmp(name,stored_namespace));*handle=1;return ESP_OK;
}
static esp_err_t nvs_get_blob(nvs_handle_t handle,const char *key,void *out,size_t *length){
 assert(handle==1&&!strcmp(key,"tx_mode"));if(fail_read)return ESP_ERR_INVALID_STATE;if(!durable_length)return ESP_ERR_NVS_NOT_FOUND;
 if(*length<durable_length){*length=durable_length;return ESP_ERR_NVS_INVALID_LENGTH;}memcpy(out,durable,durable_length);*length=durable_length;return ESP_OK;
}
static esp_err_t nvs_set_blob(nvs_handle_t handle,const char *key,const void *value,size_t length){
 assert(handle==1&&!strcmp(key,"tx_mode")&&length<sizeof(pending));sets++;if(fail_write)return ESP_ERR_INVALID_STATE;
 memcpy(pending,value,length);pending_length=length;return ESP_OK;
}
static esp_err_t nvs_commit(nvs_handle_t handle){assert(handle==1);commits++;if(fail_commit)return ESP_ERR_INVALID_STATE;memcpy(durable,pending,pending_length);durable_length=pending_length;return ESP_OK;}
static void nvs_close(nvs_handle_t handle){assert(handle==1);closes++;pending_length=0;}
`;
const boot=String.raw`
static void boot(int initial){clex_en_status.error[0]=0;en_dirty=false;clex_en_status.mode=en_mode_load(initial);for(unsigned i=0;i<en_count();i++)assert(en_rate(i,clex_en_status.mode)==ESP_OK);}
`;
const checks=String.raw`
int main(void){
 boot(0);assert(clex_en_status.mode==0&&sets==0&&!clex_en_status.error[0]);
 assert(clex_en_set_mode(1));assert(clex_en_status.mode==1&&rates[0]==1&&rates[1]==1&&sets==1&&commits==1);
 unsigned unchanged=sets;assert(clex_en_set_mode(1));assert(sets==unchanged);
 boot(0);assert(clex_en_status.mode==1&&rates[0]==1&&rates[1]==1&&sets==unchanged);
 fail_rate=1;assert(!clex_en_set_mode(0));assert(clex_en_status.mode==1&&rates[0]==1&&rates[1]==1&&sets==unchanged);
 assert(clex_en_set_mode(0));boot(1);assert(clex_en_status.mode==0);
 // Failed writes expose the actual live mode, return failure and can be retried
 // even when the requested live mode is already installed. No false ACK success.
 for(int failure=0;failure<3;failure++){
  int desired=1-clex_en_status.mode;fail_open=failure==0;fail_write=failure==1;fail_commit=failure==2;
  assert(!clex_en_set_mode(desired));assert(clex_en_status.mode==desired&&rates[0]==desired&&rates[1]==desired);
  assert(strstr(clex_en_status.error,"TEST_ERROR"));en_mode_clear_error();assert(clex_en_status.error[0]);
  fail_open=fail_write=fail_commit=false;assert(clex_en_set_mode(desired));assert(!clex_en_status.error[0]);boot(1-desired);assert(clex_en_status.mode==desired);
 }
 // Returning to an already saved mode also clears an obsolete write error.
 int saved=clex_en_status.mode;fail_open=true;assert(!clex_en_set_mode(1-saved));fail_open=false;
 unchanged=sets;assert(clex_en_set_mode(saved));assert(sets==unchanged&&!clex_en_status.error[0]);
 fail_read=true;boot(0);assert(clex_en_status.mode==0&&clex_en_status.error[0]);fail_read=false;assert(clex_en_set_mode(0));assert(!clex_en_status.error[0]);
 // Invalid mode/version/owner/length is never applied; the initial value wins.
 for(int bad=0;bad<5;bad++){
  assert(clex_en_set_mode(0));en_mode_record_t record;memcpy(&record,durable,sizeof(record));
  if(bad==0){record.mode=7;}
  if(bad==1){record.version=9;}
  if(bad==2){memset(record.owner,'X',sizeof(record.owner));}
  memcpy(durable,&record,sizeof(record));durable_length=sizeof(record)+(bad==3?1:bad==4?-1:0);
  boot(1);assert(clex_en_status.mode==1&&clex_en_status.error[0]);assert(clex_en_set_mode(1));assert(!clex_en_status.error[0]);
 }
 durable_length=0;boot(1);assert(clex_en_status.mode==1&&!clex_en_status.error[0]);
 printf("PASS: save/restore, initial fallback, unchanged-write suppression, PHY rollback, storage failures/retry, invalid records, scoped ownership; %u opens, %u closes\n",opens,closes);
 return 0;
}
`;
for(const enabled of [false,true]) {
  test('generated radio mode persistence executes with saving '+(enabled?'enabled':'disabled'),()=>{
    const {project,component}=espNowProject();component.parameters.rememberMode=enabled;
    const source=generateFirmware(project,catalog).mainC;
    const start=source.indexOf('static bool __attribute__((unused)) clex_en_set_mode(int mode){');assert.ok(start>=0);
    let end=source.indexOf('{',start)+1,depth=1;
    while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}assert.equal(depth,0);
    const program=support+(enabled?nvs:'')+espNowPersistence(project.id,component.id,cString,enabled)+source.slice(start,end)+boot+(enabled?checks:'int main(void){boot(0);assert(clex_en_set_mode(1));assert(clex_en_status.mode==1);boot(0);assert(clex_en_status.mode==0);boot(1);assert(clex_en_status.mode==1);return 0;}');
    runHostC(program,'clex-espnow-save-');
  });
}
