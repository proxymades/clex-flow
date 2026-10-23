import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('src/firmware/components');
const packages={};
function filesAt(dir){return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>entry.isDirectory()?filesAt(join(dir,entry.name)):[join(dir,entry.name)]);}
for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
 if(!entry.isDirectory())continue;
 const files=Object.fromEntries(filesAt(join(root,entry.name)).map(path=>['components/'+relative(root,path).replaceAll('\\','/'),readFileSync(path,'utf8')]));
 packages[entry.name]={digest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
const path=resolve('src/firmware/component-files.json'),source=JSON.stringify(packages,null,2)+'\n';
if(process.argv.includes('--check')){
 if(readFileSync(path,'utf8')!==source)throw Error('Firmware component package is stale. Run node scripts/pack-firmware-components.mjs.');
 console.log('Firmware component sources match embedded packages.');
}else{writeFileSync(path,source);console.log('Packed firmware components: '+Object.keys(packages).join(', '));}
