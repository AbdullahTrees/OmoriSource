'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const overlay = path.resolve(__dirname, '../../.local/pmjs-games/isat/bench-overlay');
const { createFrameStats } = require(path.join(overlay, 'share/pmjs/runner/frame-stats.cjs'));
function fixture() {
  let clock = 0;
  const rows = [];
  const stats = createFrameStats({ file: 'unused', now: () => clock, observeGc: false,
    write: text => rows.push(JSON.parse(text)), memoryUsage: () => ({ rss: 0 }) });
  return { stats, rows, at: value => { clock = value; }, finish() {
    stats.markTick();stats.markRender();stats.markRenderFrame();stats.markSwap();stats.frameEnd();stats.stop();
    return rows[0];
  } };
}
test('nested same-slot timing preserves the complete outer union', () => {
  const f = fixture();f.stats.frameStart();f.stats.guest.enter(1);
  f.at(2);f.stats.guest.enter(1);f.at(5);f.stats.guest.leave(1);
  f.at(10);f.stats.guest.leave(1);
  assert.equal(f.finish().phases.encode.mean, 10);
});
test('different slots retain overlapping logical spans without pretending they are disjoint', () => {
  const f = fixture();f.stats.frameStart();f.stats.guest.enter(0);
  f.at(2);f.stats.guest.enter(1);f.at(5);f.stats.guest.leave(1);
  f.at(10);f.stats.guest.leave(0);const row = f.finish();
  assert.equal(row.phases.prepare.mean, 10);assert.equal(row.phases.encode.mean, 3);
});
test('an abandoned span does not contaminate the next frame', () => {
  const f=fixture();f.stats.frameStart();f.stats.guest.enter(1);f.at(20);
  f.stats.frameStart();f.stats.guest.enter(1);f.at(24);f.stats.guest.leave(1);
  assert.equal(f.finish().phases.encode.mean,4);
});
test('frame summary handles empty, capped and hitching samples', () => {
  const context = vm.createContext({ NativeHost: { runtime: { env() { return ''; } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'benchmark.js'),'utf8'),context);
  const summarize=context.PMJSBenchSummary;
  assert.equal(summarize([]),null);
  assert.ok(Math.abs(summarize([1000/60,1000/60]).fps-60)<1e-8);
  const row=summarize([10,10,10,110]);
  assert.equal(row.meanMs,35);assert.equal(row.p95,110);assert.equal(row.hitches100ms,1);
});
