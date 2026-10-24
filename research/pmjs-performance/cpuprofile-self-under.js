// Self time per function, counting only samples whose stack contains a root frame, in ms per frame.
// node cpuprofile-self-under.js <file.cpuprofile> <frames> <root substring> [rows=30]
// Answers "inside X, which functions actually burn the time" when X's tree is deep or recursive.
'use strict';
const fs = require('fs');
const path = require('path');
const [file, framesArg, rootText, rowsArg] = process.argv.slice(2);
const frames = Number(framesArg), rows = Number(rowsArg) || 30;
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
function label(n) {
  const f = n.callFrame;
  return (f.functionName || '(anon)') + ' ' + path.basename(decodeURIComponent(f.url || 'native')).slice(0, 40) + ':' + (f.lineNumber + 1);
}
const under = new Map();
function isUnder(id) {
  if (under.has(id)) return under.get(id);
  const result = label(byId.get(id)).includes(rootText) || (parent.has(id) && isUnder(parent.get(id)));
  under.set(id, result);
  return result;
}
const self = new Map();
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  if (!isUnder(id)) continue;
  const ms = (profile.timeDeltas[i + 1] !== undefined ? profile.timeDeltas[i + 1] : profile.timeDeltas[i]) / 1000;
  total += ms;
  const key = label(byId.get(id));
  self.set(key, (self.get(key) || 0) + ms);
}
console.log('under "' + rootText + '": ' + (total / frames).toFixed(2) + ' ms/frame');
[...self].sort((a, b) => b[1] - a[1]).slice(0, rows).forEach(([key, ms]) => {
  console.log((ms / frames).toFixed(2).padStart(7) + '  ' + key);
});
