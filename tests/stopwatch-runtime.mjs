import process from 'node:process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { STOPWATCH_RUNTIME } from '../src/firmware/drivers/esp-idf/stopwatch.js';
const checks=String.raw`
int main(void) {
 clex_stopwatch_t watch;
 clex_stopwatch_initialize(&watch,true,5000000);
 assert(clex_stopwatch_refresh(&watch,5000000));
 assert(!clex_stopwatch_refresh(&watch,5999999));
 assert(clex_stopwatch_refresh(&watch,6000000));
 assert(strcmp(watch.text,"00:00:01")==0);
 assert(clex_stopwatch_refresh(&watch,64000000));
 assert(strcmp(watch.text,"00:00:59")==0);
 assert(clex_stopwatch_refresh(&watch,65000000));
 assert(strcmp(watch.text,"00:01:00")==0);
 assert(clex_stopwatch_pause(&watch,65750000));
 assert(!watch.running && watch.elapsed_us==60750000);
 assert(!clex_stopwatch_refresh(&watch,190000000));
 assert(clex_stopwatch_start(&watch,205000000));
 assert(!clex_stopwatch_refresh(&watch,205249999));
 assert(clex_stopwatch_refresh(&watch,205250000));
 assert(strcmp(watch.text,"00:01:01")==0);
 assert(!clex_stopwatch_start(&watch,205500000));
 assert(watch.started_us==205000000);
 assert(clex_stopwatch_refresh(&watch,206250000));
 assert(strcmp(watch.text,"00:01:02")==0);
 assert(clex_stopwatch_reset(&watch,207700000) && watch.running);
 assert(strcmp(watch.text,"00:00:00")==0);
 assert(clex_stopwatch_refresh(&watch,208700000));
 assert(strcmp(watch.text,"00:00:01")==0);
 assert(clex_stopwatch_pause(&watch,209200000));
 assert(!clex_stopwatch_pause(&watch,209700000));
 assert(clex_stopwatch_reset(&watch,210700000) && !watch.running);
 assert(!clex_stopwatch_refresh(&watch,810700000));
 assert(strcmp(watch.text,"00:00:00")==0);
 clex_stopwatch_initialize(&watch,false,0);
 assert(clex_stopwatch_refresh(&watch,500000000) && !watch.running && watch.seconds==0);
 assert(clex_stopwatch_start(&watch,500000000));
 assert(clex_stopwatch_refresh(&watch,507000000));
 assert(strcmp(watch.text,"00:00:07")==0);
 clex_stopwatch_initialize(&watch,true,0);
 assert(clex_stopwatch_refresh(&watch,3600000000LL));
 assert(strcmp(watch.text,"01:00:00")==0);
 assert(clex_stopwatch_refresh(&watch,86400000000LL));
 assert(strcmp(watch.text,"24:00:00")==0);
 assert(clex_stopwatch_refresh(&watch,363599000000LL));
 assert(strcmp(watch.text,"100:59:59")==0);
 watch.elapsed_us=INT64_MAX-10;watch.started_us=0;
 assert(clex_stopwatch_refresh(&watch,100));
 assert(watch.seconds==(uint64_t)(INT64_MAX/1000000));
 assert(clex_stopwatch_pause(&watch,100) && watch.elapsed_us==INT64_MAX);
 puts("PASS: stopwatch format, rollovers, pause/resume fractions, idempotent start, reset, disabled auto-start, missed polls, overflow protection.");
 return 0;
}
`;
const temporary=mkdtempSync(join(tmpdir(),'clex-stopwatch-'));
try {
 const source=join(temporary,'stopwatch.c'),binary=join(temporary,'stopwatch');
 writeFileSync(source,'#include <stdint.h>\n#include <stdbool.h>\n#include <stdio.h>\n#include <string.h>\n#include <assert.h>\n'+STOPWATCH_RUNTIME+checks);
 execFileSync(process.env.CLEX_HOST_CC || 'clang',['-std=c11','-Wall','-Wextra','-Werror',source,'-o',binary],{stdio:'inherit'});
 execFileSync(binary,[],{stdio:'inherit'});
} finally {
 rmSync(temporary,{recursive:true,force:true});
}
