// Compare two OMORI trace files (one JSON line per logic step, written by the trace mode of
// research/pmjs-performance/omori-test.js) and report the first step that differs.
//
// Usage:
//   node trace-diff.js <a.jsonl> <b.jsonl>
//
// On a difference it prints the step number, scene and map, then every field of that step that
// differs. For the big arrays (ev = one entry per map event, spr = one entry per visible
// character sprite) it lists the differing element indexes with both values, so a first glance
// shows which event or sprite went off the rails (combine with the id in the entry's first slot).
// When everything matches it prints: identical (N steps).
'use strict';

const fs = require('fs');

function parse(path) {
  return fs.readFileSync(path, 'utf8').split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function fmt(value) {
  const json = JSON.stringify(value);
  return json !== undefined && json.length > 200 ? json.slice(0, 200) + '…' : String(json);
}

function diffArrays(field, a, b) {
  const L = Math.max(a.length, b.length), indexes = [];
  for (let i = 0; i < L; i++) {
    if (i >= a.length) { indexes.push([i, 'absent', fmt(b[i])]); continue; }
    if (i >= b.length) { indexes.push([i, fmt(a[i]), 'absent']); continue; }
    if (fmt(a[i]) !== fmt(b[i])) indexes.push([i, fmt(a[i]), fmt(b[i])]);
  }
  return L === 0 ? [] : indexes.map(([i, x, y]) => '    ' + field + '[' + i + ']  A: ' + x + '  B: ' + y);
}

function print(field, a, b) {
  const da = JSON.stringify(a), db = JSON.stringify(b);
  if (da === db) return false;
  console.log('  ' + field + '\n    A: ' + fmt(a) + '\n    B: ' + fmt(b));
  if ((field === 'ev' || field === 'spr') && Array.isArray(a) && Array.isArray(b)) {
    diffArrays(field, a, b).slice(0, 20).forEach((line) => console.log(line.replace(/^/, '')));
    if (a.length !== b.length) console.log('    lengths: A ' + a.length + ', B ' + b.length);
  }
  return true;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length !== 2 || files.includes('-h')) {
    console.log('usage: node trace-diff.js <traceA.jsonl> <traceB.jsonl>');
    return 2;
  }
  let a, b;
  try { a = parse(files[0]); b = parse(files[1]); }
  catch (error) { console.log('trace-diff: ' + error.message); return 2; }

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) { console.log('A ends after ' + a.length + ' steps; B continues with\n  step ' + b[i].s); return 1; }
    if (i >= b.length) { console.log('B ends after ' + b.length + ' steps; A continues with\n  step ' + a[i].s); return 1; }
    const fa = a[i], fb = b[i];
    if (fa.s !== fb.s) {
      console.log('step sequence mismatch at line ' + (i + 1) + ': A step ' + fa.s + ', B step ' + fb.s);
      return 1;
    }
    const fields = Object.keys(Object.assign({}, fa, fb));
    const differing = fields.filter((field) => fa[field] !== undefined && fb[field] !== undefined &&
      JSON.stringify(fa[field]) !== JSON.stringify(fb[field]));
    if (differing.length) {
      console.log('first differing step ' + fa.s + ' (scene ' + fa.sc + ', map ' + fa.m + '):');
      differing.forEach((field) => print(field, fa[field], fb[field]));
      return 1;
    }
  }
  console.log('identical (' + a.length + ' steps)');
  return 0;
}

process.exitCode = main();
