// Which parts of a PMJS preparation-state.json changed between two snapshots.
// node state-diff.js <before.json> <after.json>
// Prints, per top-level key of `data` (and one level below for objects), how many entries were added,
// removed or changed, with a few examples.
const fs = require('fs');
const [a, b] = process.argv.slice(2).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
console.log('top-level:', Object.keys(b).join(','), 'checksum changed:', a.checksum !== b.checksum);
const before = a.data || {}, after = b.data || {};
for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
  const x = before[key], y = after[key];
  if (JSON.stringify(x) === JSON.stringify(y)) continue;
  if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) {
    let added = 0, removed = 0, changed = 0;
    const samples = [];
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!(k in x)) added++;
      else if (!(k in y)) removed++;
      else if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) {
        changed++;
        if (samples.length < 2) samples.push({ key: k.slice(-60), before: JSON.stringify(x[k]).slice(0, 300), after: JSON.stringify(y[k]).slice(0, 300) });
      }
    }
    console.log(`data.${key}: added ${added}, removed ${removed}, changed ${changed}`);
    for (const s of samples) console.log('  ', JSON.stringify(s));
  } else {
    console.log(`data.${key}: changed (${JSON.stringify(x).slice(0, 200)} -> ${JSON.stringify(y).slice(0, 200)})`);
  }
}
