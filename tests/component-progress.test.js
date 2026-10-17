import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('component progress observer preserves SDK behavior, reports real bytes and retains existing Python customization',()=>{
 const python=(process.platform==='win32'?['python','python3']:['python3','python']).find(candidate=>spawnSync(candidate,['--version'],{encoding:'utf8'}).status===0);
 assert.ok(python,'Python is required for the build progress observer tests.');
 const result=spawnSync(python,['-B',fileURLToPath(new URL('./component_progress_test.py',import.meta.url))],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:30000});
 assert.equal(result.status,0,result.stdout+result.stderr||result.error?.message);
});
