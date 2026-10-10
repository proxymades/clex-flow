import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
// Dev-only converter; it is never installed or invoked in the user's SDK.
const converter = resolve(process.argv[2] || '.artifacts/font-converter/node_modules/lv_font_conv/lv_font_conv.js');
const require = createRequire(converter), opentype = require('opentype.js');
const fontPath = 'src/displays/fonts/Montserrat-Medium.ttf';
const bytes = await readFile(fontPath);
if(createHash('sha256').update(bytes).digest('hex') !== '421f26b23e2be6b98373d32acd3cb2897b154d4bf0a77d26534ce476e4cbed53') throw new Error('Unexpected source font revision');
const font = opentype.loadSync(fontPath), sets = JSON.parse(await readFile('src/displays/fonts/character-sets.json','utf8'));
const points = Object.values(sets).flatMap(set=>set.ranges.flatMap(([first,last])=>Array.from({length:last-first+1},(_,i)=>first+i))).filter(cp=>font.charToGlyphIndex(String.fromCodePoint(cp))!==0);
const ranges=[];for(const cp of [...new Set(points)].sort((a,b)=>a-b)){const prev=ranges.at(-1);if(prev&&prev[1]+1===cp)prev[1]=cp;else ranges.push([cp,cp]);}
const range = ranges.map(([first,last])=>first===last?'0x'+first.toString(16):'0x'+first.toString(16)+'-0x'+last.toString(16)).join(',');
const dir=await mkdtemp(join(tmpdir(),'clex-fonts-')), result={};
try{
 for(const size of [14,20,28]){
  const symbol='clex_font_montserrat_'+size,path=join(dir,symbol+'.c');
  const conversion=spawnSync(process.execPath,[converter,'--font',fontPath,'--range',range,'--size',String(size),'--bpp','4','--format','lvgl','--no-compress','--lv-include','lvgl.h','--lv-font-name',symbol,'-o',path],{encoding:'utf8'});
  if(conversion.status!==0)throw new Error(conversion.stderr||'Font conversion failed');
  let source=await readFile(path,'utf8');
  source=source.replace(/^ \* Opts:.*$/m,' * Generated with lv_font_conv 1.5.3; Basic Latin and Cyrillic subsets. Source: Montserrat-Medium.ttf (LVGL v9.2.2).');
  const lineHeight=Number(source.match(/\.line_height = (\d+)/)[1]),baseline=Number(source.match(/\.base_line = (\d+)/)[1]);
  result['montserrat_'+size]={symbol,size,lineHeight,baseline,ranges:[...ranges,[10,10]],characterSets:Object.keys(sets),sha256:createHash('sha256').update(source).digest('hex'),source};
 }
 await writeFile('src/displays/fonts/lvgl-fonts.json',JSON.stringify(result));
 const modulePath='src/catalog/modules/clex.display.spi-240x320.json',module=JSON.parse(await readFile(modulePath,'utf8'));
 for(const definition of module.display.graphics.fonts){const metadata=Object.fromEntries(Object.entries(result[definition.id]).filter(([key])=>!['source','symbol','sha256'].includes(key)));Object.assign(definition,metadata);definition.name='Montserrat · латиница / кириллица';}
 await writeFile(modulePath,JSON.stringify(module,null,2)+'\n');
 console.log('Generated '+Object.keys(result).length+' LVGL fonts, '+points.length+' glyphs per font.');
}finally{await rm(dir,{recursive:true,force:true});}
