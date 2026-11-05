import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
for(const transport of ['uart','usb'])test('voice runtime preserves binary '+transport+' recording and processes custom wake and confirmation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'clex-voice-runtime-'));
 try{
  for(const name of ['sdkconfig.h','esp_err.h','driver/i2c_master.h','driver/uart_vfs.h','driver/usb_serial_jtag_vfs.h','esp_afe_config.h','esp_afe_sr_iface.h','esp_afe_sr_models.h','esp_heap_caps.h','esp_log.h','esp_timer.h','model_path.h','freertos/FreeRTOS.h','freertos/queue.h','freertos/task.h']){
   const path=join(dir,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,'#include "voice-runtime-support.h"\n');
  }
  const source=resolve('src/firmware/components/clex_voice'),candidates=process.env.CC?[process.env.CC]:process.platform==='win32'?['clang','gcc','cc']:['cc','clang','gcc'];
  const compiler=candidates.find(c=>spawnSync(c,['--version'],{encoding:'utf8'}).status===0),binary=join(dir,process.platform==='win32'?'voice-runtime.exe':'voice-runtime');
  assert.ok(compiler,'A host C compiler is required; set CC or install Clang/GCC.');
  const compile=spawnSync(compiler,['-std=c11','-O1','-Wall','-Wextra','-Werror','-Wno-unused-function','-DCONFIG_ESP_CONSOLE_UART_NUM=1',...(transport==='uart'?['-DCONFIG_ESP_CONSOLE_UART=1']:['-DCONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=1']),'-I'+dir,'-I'+resolve('tests/fixtures'),'-iquote',source,resolve('tests/fixtures/voice-runtime-main.c'),...['features.c','dtw.c','core.c','endpoint.c','capture.c'].map(name=>join(source,name)),...(process.platform==='win32'?[]:['-D_POSIX_C_SOURCE=200809L','-lm']),'-o',binary],{encoding:'utf8'});
  assert.equal(compile.status,0,compile.stdout+compile.stderr);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:20000});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/PASS: custom wake/);assert.match(run.stdout,/PASS: binary voice recording/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
