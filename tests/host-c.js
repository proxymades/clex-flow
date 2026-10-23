import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';

let compiler;
export function runHostC(source,prefix,headers={}) {
  if(!compiler) {
    const candidates=process.env.CC?[process.env.CC]:process.platform==='win32'?['clang','gcc','cc']:['cc','clang','gcc'];
    compiler=candidates.find(candidate=>spawnSync(candidate,['--version'],{encoding:'utf8'}).status===0);
    assert.ok(compiler,'A host C compiler is required: set CC or install Clang/GCC.');
  }
  const dir=mkdtempSync(join(tmpdir(),prefix));
  try {
    const file=join(dir,'runtime.c'),executable=join(dir,process.platform==='win32'?'runtime.exe':'runtime');
    writeFileSync(file,source);
    for(const [name,content] of Object.entries(headers)) {
      const header=join(dir,name);
      mkdirSync(dirname(header),{recursive:true});
      writeFileSync(header,content);
    }
    const compiled=spawnSync(compiler,['-std=c11','-Wall','-Wextra','-Werror','-I',dir,file,'-o',executable],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(executable,[],{encoding:'utf8'});
    assert.equal(run.status,0,run.stdout+run.stderr||run.error?.message);
    return run.stdout;
  }finally{rmSync(dir,{recursive:true,force:true});}
}
