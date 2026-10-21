'use strict';

// Synthetic host-only probe: no game launch, native addon, or device required.
// node --expose-gc research/pmjs-performance/map-retention-probe.cjs [baseline-ref]
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../pmjs');

function compile(filename, source) {
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

async function collect() {
  for (let i = 0; i < 3; ++i) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
  }
  return process.memoryUsage();
}

async function main() {
  if (!global.gc) throw new Error('run with --expose-gc');
  const baseline = process.argv[2];
  const preparationFile = path.join(root, 'runner/map-preparation.cjs');
  const source = baseline ? execFileSync('git', ['show', baseline+':runner/map-preparation.cjs'],
    { cwd: root, encoding: 'utf8' }) : fs.readFileSync(preparationFile, 'utf8');
  const { prepareMaps } = compile(preparationFile, source);
  // Reuse only the maintained mock fixture, without registering its test cases.
  const fixtureFile = path.join(root, 'test/map-preparation.test.cjs');
  const tests = fs.readFileSync(fixtureFile, 'utf8');
  const { fixture } = compile(fixtureFile,
    tests.slice(0, tests.indexOf('\ntest('))+'\nmodule.exports = { fixture };');
  const f = fixture({});
  const count = 32, width = 192, height = 192;
  function writeMaps() {
    const data = Array(width*height*6).fill(0);
    data[0] = 1;
    for (let id = 1; id <= count; ++id) {
      fs.writeFileSync(path.join(f.gameRoot, 'data/Map'+String(id).padStart(3, '0')+'.json'),
        JSON.stringify({ ...f.map, width, height, data }));
    }
  }
  writeMaps();
  // First populate the on-disk compilation index, then exercise its slow warm path.
  await prepareMaps(f);
  const before = await collect();
  globalThis.retainedPreparation = await prepareMaps(f);
  const after = await collect();
  const report = globalThis.retainedPreparation;
  console.log(JSON.stringify({ revision: baseline || 'working-tree', maps: count,
    tileEntries: count*width*height*6, selected: report.selected,
    compilationHits: report.compilationHits, error: report.error || null,
    retainsMapInputs: Object.hasOwn(report, 'mapInputs'),
    heapBefore: before.heapUsed, heapAfter: after.heapUsed,
    retainedHeapDelta: after.heapUsed-before.heapUsed, rssAfter: after.rss }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
