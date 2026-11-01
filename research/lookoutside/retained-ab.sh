#!/bin/sh
# Never benchmark a flag which this renderer doesn't implement.
set -eu
ROOT=/mnt/mmc/ports/lookoutside-test
B=$ROOT/harness
[ -z "$(pidof node 2>/dev/null || true)" ] || { echo 'Game active';exit 2; }
env LD_LIBRARY_PATH="$ROOT/runtime/lib" "$ROOT/runtime/bin/node" - "$B" "${CAPABILITY_RUN:-baseline}" <<'JS'
const fs=require('node:fs'),root=process.argv[2];
const run=process.argv[3];if(!/^[a-zA-Z0-9_-]+$/.test(run))throw Error('Invalid capability run');
const rows=fs.readFileSync(root+'/results/'+run+'/results.jsonl','utf8').trim().split('\n').map(JSON.parse);
const cap=rows.find(r=>r.type==='retained-capability');
if(!cap)throw Error('Missing runtime capability check');
const available=cap.registered&&cap.statsAvailable&&(cap.renderer==='pixi5'?cap.pixi5Api:cap.pixi4Api);
const result={status:available?'available':'not-applicable',capability:cap,capabilityRun:run,performancePairsRun:0,
  reason:available?'Candidate can be tested':'The active renderer does not implement the retained encoder'};
fs.writeFileSync(root+'/retained-ab-result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
if(!available)process.exit(3);
if(!rows.some(r=>r.type==='complete'))throw Error('A clean baseline is required before performance testing');
JS
GAME_BENCH_DISABLE_OPT=render.retained-encoding sh "$B/run-device.sh" baseline retained-a1
sleep 12
GAME_BENCH_DISABLE_OPT='' sh "$B/run-device.sh" baseline retained-b1
sleep 12
GAME_BENCH_DISABLE_OPT='' sh "$B/run-device.sh" baseline retained-b2
sleep 12
GAME_BENCH_DISABLE_OPT=render.retained-encoding sh "$B/run-device.sh" baseline retained-a2
env LD_LIBRARY_PATH="$ROOT/runtime/lib" "$ROOT/runtime/bin/node" - "$B" <<'JS'
const fs=require('node:fs'),root=process.argv[2];
for(const label of ['a1','b1','b2','a2']){
 const rows=fs.readFileSync(root+'/results/retained-'+label+'/results.jsonl','utf8').trim().split('\n').map(JSON.parse);
 const phases=rows.filter(r=>r.type==='phase'),on=label[0]==='b';
 if(phases.length!==4||phases.some(r=>!r.retained||(on?r.retained.frames<=0:r.retained.frames!==0)))
   throw Error('Encoder did not demonstrably toggle: '+label);
}
const path=root+'/retained-ab-result.json',r=JSON.parse(fs.readFileSync(path));
r.status='completed';r.performancePairsRun=2;fs.writeFileSync(path,JSON.stringify(r,null,2));
JS
