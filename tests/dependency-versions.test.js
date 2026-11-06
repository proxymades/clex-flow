import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const exact = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;

test('JavaScript dependencies use exact versions from the committed lockfile',()=>{
 const manifest=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
 for(const group of ['dependencies','devDependencies']){
  for(const [name,version] of Object.entries(manifest[group])){
   assert.match(version,exact,name);
   assert.equal(lock.packages[''][group][name],version,name);
   assert.equal(lock.packages['node_modules/'+name].version,version,name);
  }
 }
});

test('firmware profiles pin shared and nested component versions consistently',()=>{
 const profiles=JSON.parse(read('src/firmware/runtime-profiles.json')),versions=new Map();
 for(const [id,profile] of Object.entries(profiles)){
  for(const [name,version] of Object.entries(profile.dependencies)){
   assert.match(version,/^\d+\.\d+\.\d+(?:~\d+)?$/,id+'/'+name);
   if(versions.has(name))assert.equal(version,versions.get(name),name);
   versions.set(name,version);
  }
  if(profile.dependencies['espressif/esp-sr']){
   assert.equal(profile.dependencies['espressif/esp-dl'],'3.3.14',id);
   for(const name of ['espressif/cjson','espressif/dl_fft','espressif/esp_new_jpeg']){
    assert.ok(profile.dependencies[name],id+'/'+name);
   }
  }
 }
});

test('Rust dependencies use exact locked versions and desktop commands retain the lockfile',()=>{
 const manifest=read('src-tauri/Cargo.toml'),lock=read('src-tauri/Cargo.lock'),versions=new Map();
 for(const block of lock.split('[[package]]').slice(1)){
  const name=block.match(/^name = "([^"]+)"/m)?.[1],version=block.match(/^version = "([^"]+)"/m)?.[1];
  if(name&&version){
   if(!versions.has(name))versions.set(name,new Set());
   versions.get(name).add(version.split('+')[0]);
  }
 }
 for(const match of manifest.matchAll(/\[([^\]]+)\]\n([\s\S]*?)(?=\n\[|$)/g)){
  if(!['dependencies','build-dependencies','dev-dependencies'].includes(match[1]))continue;
  for(const line of match[2].split('\n').filter(line=>line.trim()&&!line.trim().startsWith('#'))){
   const entry=line.match(/^([\w-]+)\s*=\s*(?:"([^"]+)"|\{.*?version\s*=\s*"([^"]+)")/);
   assert.ok(entry,line);
   const name=entry[1],version=entry[2]||entry[3];
   assert.match(version,/^=\d+\.\d+\.\d+$/,name);
   assert.ok(versions.get(name)?.has(version.slice(1)),name);
  }
 }
 const scripts=JSON.parse(read('package.json')).scripts;
 for(const name of ['desktop','desktop:build'])assert.match(scripts[name],/(?:^|\s)--locked(?:\s|$)/);
 assert.match(read('.nvmrc').trim(),exact);
 assert.match(read('rust-toolchain.toml'),/^channel = "\d+\.\d+\.\d+"$/m);
});
