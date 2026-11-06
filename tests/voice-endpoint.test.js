import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('voice endpoint keeps rejected fragments across pauses without delaying confident commands',()=>{
 const dir=mkdtempSync(join(tmpdir(),'clex-voice-endpoint-'));
 try{
  const candidates=process.env.CC?[process.env.CC]:process.platform==='win32'?['clang','gcc','cc']:['cc','clang','gcc'];
  const compiler=candidates.find(c=>spawnSync(c,['--version'],{encoding:'utf8'}).status===0);
  assert.ok(compiler,'A host C compiler is required; set CC or install Clang/GCC.');
  const source=resolve('src/firmware/components/clex_voice'),binary=join(dir,process.platform==='win32'?'voice-endpoint.exe':'voice-endpoint');
  const compile=spawnSync(compiler,['-std=c11','-O1','-Wall','-Wextra','-Werror','-I'+source,resolve('tests/fixtures/voice-endpoint-main.c'),join(source,'endpoint.c'),'-o',binary],{encoding:'utf8'});
  assert.equal(compile.status,0,compile.stdout+compile.stderr);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  assert.match(run.stdout,/PASS: a confident command/);
  assert.match(run.stdout,/PASS: a rejected fragment/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
