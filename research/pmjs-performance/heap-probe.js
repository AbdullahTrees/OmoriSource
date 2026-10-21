// Heap and CPU probe (PMJS only, test only): where does the JS heap go, and where does frame time go?
//
// PMJS:  pmjs <game> --patch heap-probe.js   (set PMJS_BENCH_AUTOPLAY=0 if pmjs-bench.js is loaded)
//
// Patches run inside the bootstrap, after PMJS's own startup preparation and before any game script,
// so the first forced-GC reading is what the runner left live. From there V8's sampling heap profiler
// attributes everything the game allocates and keeps. Readings ("[heap] {json}"):
//   patch-load   live heap before any game code (runner/PMJS leftovers + PMJS's own JS)
//   title        after boot, plugins and data load
//   map          after a new game and HEAP_PROBE_SETTLE seconds (default 12) on map HEAP_PROBE_MAP (87)
// Then it logs the top live allocation sites ("[heap-top]"), records a HEAP_PROBE_CPU-second CPU
// profile (default 10) on that map, writes both profiles to HEAP_PROBE_DIR and quits.
(function () {
  'use strict';
  var require = globalThis.__pmjsBuiltinRequire;
  if (typeof require !== 'function') { console.log('[heap] no builtin require; probe disabled'); return; }
  var v8 = require('node:v8'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  var inspector = require('node:inspector'), hostProcess = require('node:process');

  function env(name) { return NativeHost.runtime.env(name); }
  var DIR = env('HEAP_PROBE_DIR') || '/tmp';
  var MAP = Number(env('HEAP_PROBE_MAP')) || 87;
  var SETTLE_MS = (Number(env('HEAP_PROBE_SETTLE')) || 12) * 1000;
  var CPU_MS = (Number(env('HEAP_PROBE_CPU')) || 10) * 1000;

  v8.setFlagsFromString('--expose-gc');
  var gc = vm.runInNewContext('gc');
  var session = new inspector.Session();
  session.connect();
  function post(method, params) {
    return new Promise(function (resolve, reject) {
      session.post(method, params || {}, function (error, result) { if (error) reject(error); else resolve(result); });
    });
  }
  function mb(n) { return Math.round(n / 1048576 * 10) / 10; }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  async function until(test, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) { if (test()) return true; await wait(250); }
    return false;
  }

  function reading(label) {
    gc(); gc();
    var spaces = {};
    v8.getHeapSpaceStatistics().forEach(function (s) { if (s.space_used_size > 1048576) spaces[s.space_name] = mb(s.space_used_size); });
    var memory = hostProcess.memoryUsage();
    console.log('[heap] ' + JSON.stringify({ at: label, liveMB: mb(v8.getHeapStatistics().used_heap_size),
      spaces: spaces, rssMB: memory.rss ? mb(memory.rss) : null, externalMB: memory.external ? mb(memory.external) : null }));
  }

  // Aggregate the sampled live allocations by function and by file.
  function top(profile) {
    var byFunction = Object.create(null), byFile = Object.create(null), total = 0;
    (function walk(node, stack) {
      var frame = node.callFrame, file = (frame.url || '(native)').split('/').slice(-2).join('/');
      var name = (frame.functionName || '(anonymous)') + ' ' + file + ':' + (frame.lineNumber + 1);
      var here = stack.concat(name);
      if (node.selfSize) {
        total += node.selfSize;
        byFunction[name] = (byFunction[name] || 0) + node.selfSize;
        byFile[file] = (byFile[file] || 0) + node.selfSize;
        // Attribute to the nearest caller frame too: allocation leaves are often JSON.parse or Array.
        var caller = here.length > 1 ? here[here.length - 2] : '(root)';
        byFunction['  <- ' + caller] = (byFunction['  <- ' + caller] || 0) + node.selfSize;
      }
      (node.children || []).forEach(function (child) { walk(child, here); });
    })(profile.head, []);
    function list(table, n) {
      return Object.keys(table).sort(function (a, b) { return table[b] - table[a]; }).slice(0, n)
        .map(function (k) { return mb(table[k]) + ' MB  ' + k; });
    }
    console.log('[heap-top] sampled live total ' + mb(total) + ' MB');
    list(byFile, 20).forEach(function (line) { console.log('[heap-top] file ' + line); });
    list(byFunction, 40).forEach(function (line) { console.log('[heap-top] fn   ' + line); });
  }

  reading('patch-load');
  // A runtime started with PMJS_EARLY_HEAP_SAMPLING=1 (diagnostic session.cjs hook) has sampled since
  // the worker started: what it still holds now is what the runner and PMJS keep for the session.
  var early = globalThis.__pmjsEarlyHeapSession;
  if (early) {
    early.post('HeapProfiler.stopSampling', function (error, result) {
      if (error) { console.log('[heap] early sampling failed: ' + error.message); return; }
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(path.join(DIR, 'runner.heapprofile'), JSON.stringify(result.profile));
      console.log('[heap-top] --- live at patch load, sampled since worker start (runner + PMJS) ---');
      top(result.profile);
      console.log('[heap-top] --- game allocations from here on ---');
    });
  }
  var sampling = post('HeapProfiler.enable').then(function () {
    return post('HeapProfiler.startSampling', { samplingInterval: 16384 });
  });

  async function run() {
    await sampling;
    reading('title');
    DataManager.setupNewGame();
    $gamePlayer.reserveTransfer(MAP, 28, 27, 2, 0);
    SceneManager.goto(Scene_Map);
    await until(function () { return SceneManager._scene instanceof Scene_Map && $gameMap.mapId() === MAP && !SceneManager.isSceneChanging(); }, 60000);
    await wait(SETTLE_MS);
    reading('map');
    var heap = await post('HeapProfiler.stopSampling');
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'map-' + MAP + '.heapprofile'), JSON.stringify(heap.profile));
    top(heap.profile);
    heap = null;
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 500 });
    await post('Profiler.start');
    var frames0 = Graphics.frameCount, t0 = performance.now();
    await wait(CPU_MS);
    var fps = Math.round((Graphics.frameCount - frames0) * 10000 / (performance.now() - t0)) / 10;
    var cpu = await post('Profiler.stop');
    fs.writeFileSync(path.join(DIR, 'map-' + MAP + '.cpuprofile'), JSON.stringify(cpu.profile));
    console.log('[heap] cpu profile written, ' + fps + ' fps while profiling');
    console.log('[heap] done');
    NativeHost.runtime.quit();
  }

  var started = false;
  var timer = setInterval(function () {
    if (started || !globalThis.SceneManager || !SceneManager._scene) return;
    if (SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
    started = true;
    clearInterval(timer);
    run().catch(function (error) { console.log('[heap] failed: ' + (error && error.stack || error)); });
  }, 1000);
})();
