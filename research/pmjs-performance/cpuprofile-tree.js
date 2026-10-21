// Top-down call tree of a V8 .cpuprofile, in milliseconds per rendered frame.
// node cpuprofile-tree.js <file.cpuprofile> <frames> [root substring] [min ms/frame=0.3] [depth=14]
// <frames> is the number of frames rendered during the profile (fps x seconds), so every figure reads
// as "ms of this per frame". Identical call paths under the root are merged (recursion included), and
// each line shows inclusive and self ms/frame. The root is the first frame whose label contains the
// substring (default: the whole profile).
'use strict';
const fs = require('fs');
const [file, framesArg, rootMatch = '', minArg, depthArg] = process.argv.slice(2);
const frames = Number(framesArg), min = Number(minArg) || 0.3, maxDepth = Number(depthArg) || 14;
if (!file || !frames) { console.error('usage: cpuprofile-tree.js <file> <frames> [root] [min] [depth]'); process.exit(1); }
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const short = url => (url || '').split('/').slice(-1)[0].replace(/%20/g, ' ').slice(0, 40) || 'native';
const label = n => `${n.callFrame.functionName || '(anon)'} ${short(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;

// Merged tree keyed by label path below the first root match on each sample's stack.
const tree = { name: rootMatch || '(all)', total: 0, self: 0, kids: new Map() };
let all = 0;
profile.samples.forEach((id, i) => {
  const ms = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i]) / 1000;
  all += ms;
  const stack = [];
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) stack.push(label(nodes.get(cur)));
  stack.reverse();
  let start = 0;
  if (rootMatch) {
    start = stack.findIndex(l => l.includes(rootMatch));
    if (start < 0) return;
    start++;
  }
  let at = tree;
  at.total += ms;
  for (let d = start; d < stack.length; d++) {
    let next = at.kids.get(stack[d]);
    if (!next) at.kids.set(stack[d], next = { name: stack[d], total: 0, self: 0, kids: new Map() });
    next.total += ms;
    at = next;
  }
  at.self += ms;
});
const per = v => (v / frames).toFixed(2).padStart(6);
console.log(`profile ${all.toFixed(0)} ms, ${frames} frames -> ${(all / frames).toFixed(1)} ms/frame; under root ${per(tree.total)} ms/frame`);
(function print(node, depth, indent) {
  const kids = [...node.kids.values()].sort((a, b) => b.total - a.total);
  for (const k of kids) {
    if (k.total / frames < min) continue;
    console.log(`${per(k.total)} ${per(k.self)}  ${indent}${k.name}`);
    if (depth + 1 < maxDepth) print(k, depth + 1, indent + '  ');
  }
})(tree, 0, '');
