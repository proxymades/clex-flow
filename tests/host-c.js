import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';

const compilers={};
export const runHostC=(source,prefix,headers={})=>runHost(source,prefix,headers,false);
export const runHostCpp=(source,prefix,headers={})=>runHost(source,prefix,headers,true);
function runHost(source,prefix,headers,cxx) {
  const language=cxx?'c++':'c';
  if(!compilers[language]) {
    const configured=cxx?process.env.CXX:process.env.CC;
    const candidates=configured?[configured]:cxx?['c++','clang++','g++']:process.platform==='win32'?['clang','gcc','cc']:['cc','clang','gcc'];
    compilers[language]=candidates.find(candidate=>spawnSync(candidate,['--version'],{encoding:'utf8'}).status===0);
    assert.ok(compilers[language],'A host compiler is required: set CC/CXX or install Clang/GCC.');
  }
  const dir=mkdtempSync(join(tmpdir(),prefix));
  try {
    const file=join(dir,cxx?'runtime.cpp':'runtime.c'),executable=join(dir,process.platform==='win32'?'runtime.exe':'runtime');
    writeFileSync(file,source);
    for(const [name,content] of Object.entries(headers)) {
      const header=join(dir,name);
      mkdirSync(dirname(header),{recursive:true});
      writeFileSync(header,content);
    }
    const compiled=spawnSync(compilers[language],[cxx?'-std=c++11':'-std=c11','-Wall','-Wextra','-Werror','-I',dir,file,'-o',executable],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
    const run=spawnSync(executable,[],{encoding:'utf8'});
    assert.equal(run.status,0,run.stdout+run.stderr||run.error?.message);
    return run.stdout;
  }finally{rmSync(dir,{recursive:true,force:true});}
}
