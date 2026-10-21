// Summarise a V8 .cpuprofile: self time per file and per function, and inclusive time per function.
// node cpuprofile-top.js <file.cpuprofile> [rows=40] [filter]
// Inclusive time counts each sample once per function even under recursion. Times are ms over the
// whole profile; divide by the frames in the window for ms per frame.
'use strict';
const fs = require('fs');
const [file, rowsArg, filter] = process.argv.slice(2);
const rows = Number(rowsArg) || 40;
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);

const short = url => (url || '').split('/').slice(-2).join('/') || '(native)';
const label = n => `${n.callFrame.functionName || '(anonymous)'} ${short(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;

const dt = profile.timeDeltas;
const self = new Map(), selfFile = new Map(), inclusive = new Map();
let total = 0;
profile.samples.forEach((id, i) => {
  const ms = (dt[i + 1] !== undefined ? dt[i + 1] : dt[i]) / 1000;
  total += ms;
  const n = nodes.get(id);
  self.set(label(n), (self.get(label(n)) || 0) + ms);
  const f = n.callFrame.url ? short(n.callFrame.url) : n.callFrame.functionName;
  selfFile.set(f, (selfFile.get(f) || 0) + ms);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const l = label(nodes.get(cur));
    if (seen.has(l)) continue;
    seen.add(l);
    inclusive.set(l, (inclusive.get(l) || 0) + ms);
  }
});
const show = (title, map, n) => {
  console.log(`\n== ${title}`);
  [...map].filter(([k]) => !filter || k.includes(filter)).sort((a, b) => b[1] - a[1]).slice(0, n)
    .forEach(([k, v]) => console.log(`${v.toFixed(0).padStart(7)} ms ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`));
};
console.log(`profile ${total.toFixed(0)} ms, ${profile.samples.length} samples`);
show('self time by file', selfFile, 25);
show('self time by function', self, rows);
show('inclusive time by function', inclusive, rows);
