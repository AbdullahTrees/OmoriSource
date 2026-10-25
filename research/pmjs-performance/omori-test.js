// In-game test driver for OMORI (test only). Runs under both runtimes:
//   PMJS  loaded with `--patch` (device runner omori-test.sh in this folder);
//   NW.js loaded by launcher/compat.js when OMORI_TEST_MODE is set (PC research/pc-test/run.ps1).
// It waits for the title screen, plays a new game into the requested maps, and prints one
// "[omori-test] {json}" line per result, then quits. The game code it drives is the same in
// both runtimes; runtime differences are contained in env(), require(), quitGame() and capture().
// Env variables (set by drivers):
//   OMORI_TEST_MODE     startup | perf | room | verify
//   OMORI_TEST_MAPS     perf/verify maps, "id" or "id:x:y" comma-separated
//                       (default 14:45:44,111:15:25,87:27:27: Player's house, Rain Town, White Space)
//   OMORI_TEST_ROOM     room mode map, "id:x:y"
//   OMORI_TEST_WALK     room mode: 1 walks the player around a loop while measuring
//   OMORI_TEST_SETTLE   seconds after arrival before measuring (default 18: GTP_OmoriFixes staggers
//                       mini-label window creation over the first ~17 s on a map, which is slower)
//   OMORI_TEST_MEASURE  seconds per measurement (default 8)
//   OMORI_TEST_PATCH    sprite patch per phase when launcher/omori-performance.js is loaded, e.g. "on,off"
//                       (default: leave it as loaded, one phase)
//   OMORI_TEST_SHOTS    directory for framebuffer captures (640x480 BGRA; omori-handover/tools/fb2png.py)
//   OMORI_TEST_PROFILE  directory for a V8 CPU profile of each measurement (<label>.cpuprofile;
//                       cpuprofile-tree.js reads them). Sampling costs some fps.
//   OMORI_TEST_CENSUS   1: before each measurement, a scene-tree census (what the renderer walks per
//                       frame) and exact calls per frame of the 40 most called functions
//   trace mode:
//   OMORI_TEST_STEPS    trace steps to record (default 1200 logic steps)
//   OMORI_TEST_TRACE    JSONL file for the trace, one line per logic step
//   OMORI_TEST_SEED     seeded PRNG seed for Math.random (default 1234). Installed at script load,
//                       before any game code runs, so every run of the same script plays the same
//                       session; input comes only from the script (auto-confirm + walkLoop).
// Trace records, one compact JSON line per logic step (SceneManager.updateMain is hooked after it
// runs): step, scene name, map id, player state, every event's state, digests of switches,
// variables, self-switches and picture states, message window text and visibility, screen
// tone/flash/shake, and every visible character sprite's position/opacity/frame/bitmap url.
// Compare two traces with research/pc-test/trace-diff.js.
// Every result is one "[omori-test] {json}" line; the game quits when the mode is done.
//   startup: time from runtime start to the title screen, heap and RSS there (catalog status is in the log).
//   perf:    per map, fps, frame time p50/p95/max, native draw ms.
//   room:    one map, same figures; with OMORI_TEST_WALK the player walks a loop during the measurement.
//   verify:  per map, cutscene waits (logic steps) and camera-jump captures with the sprite patch on and off.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window; // NW.js 0.29 has no globalThis
  var require = root.__pmjsBuiltinRequire || root.require;
  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    // NW.js injects Node into the page: process.env is the real environment there.
    return root.process && process.env ? process.env[name] : undefined;
  }
  var MODE = env('OMORI_TEST_MODE') || 'perf';
  var SETTLE_MS = (Number(env('OMORI_TEST_SETTLE')) || 18) * 1000;
  var MEASURE_MS = (Number(env('OMORI_TEST_MEASURE')) || 8) * 1000;
  var SHOTS = env('OMORI_TEST_SHOTS');
  var BREAKDOWN = env('OMORI_TEST_BREAKDOWN') === '1';
  var INVENTORY = env('OMORI_TEST_INVENTORY') === '1';
  var SERIES = Number(env('OMORI_TEST_SERIES')) || 0;
  var SCROLL = env('OMORI_TEST_SCROLL') === '1';
  // Transfer -> scene started: map data and tilemap setup, which is what map preparation changes.
  var lastLoadMs = null;
  var CPU = env('OMORI_TEST_CPU') === '1';

  // Seeded PRNG for trace mode (mulberry32), installed at script load before any game code runs,
  // so the new game and every scripted session replay identically. Game code draws randomness
  // only through Math.random (Math.randomInt in rpg_core.js and every plugin build on it).
  // resetSeed() is also called right before the new game starts, because the title screen runs a
  // run-dependent number of update steps before the driver begins (its first poll interval) and
  // may draw randomness; the reseed makes the whole scripted session independent of that.
  var SEED = (Number(env('OMORI_TEST_SEED')) || 1234) >>> 0;
  var seedState = SEED;
  function resetSeed() { seedState = SEED; }
  if (MODE === 'trace') Math.random = function () {
    seedState = (seedState + 0x6D2B79F5) >>> 0;
    var t = seedState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + (t ^ (t >>> 7))) | t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  function places(text) {
    return String(text).split(',').map(function (entry) { return entry.split(':').map(Number); });
  }
  var MAPS = places(env('OMORI_TEST_MAPS') || '14:45:44,111:15:25,87:27:27');
  var PATCH = env('OMORI_TEST_PATCH') ? String(env('OMORI_TEST_PATCH')).split(',') : [null];

  var SINK = env('OMORI_TEST_SINK');
  function log(value) {
    var line = '[omori-test] ' + JSON.stringify(value);
    console.log(line);
    // PMJS captures console output into log.txt; the PC runner gets it through this sink file
    // (and through --enable-logging=stderr). Plain ids: NW.js 0.29 (Node 9) has no "node:" ids.
    if (SINK) try { require('fs').appendFileSync(SINK, line + '\n'); } catch (e) {}
  }
  function round(n) { return Math.round(n * 10) / 10; }
  function mb(n) { return Math.round(n / 1048576); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  async function until(test, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) { if (test()) return true; await wait(100); }
    return false;
  }
  async function frames(count) {
    var target = Graphics.frameCount + count;
    await until(function () { return Graphics.frameCount >= target; }, 5000);
  }
  function memory() {
    var v8 = require('v8'), usage = require('process').memoryUsage();
    return { heapMB: mb(v8.getHeapStatistics().used_heap_size), rssMB: mb(usage.rss) };
  }
  // Prepared-image use: hits without a full decode prove the cache is active, and the fallback
  // reasons show why an image used the original instead.
  function imageStats() {
    var host = root.NativeHost;
    if (!host || !host.images || typeof host.images.memory !== 'function') return null;
    try {
      var m = host.images.memory();
      return { liveCount: m.liveCount, gpuBytes: m.gpuBytes, cpuBytes: m.cpuBytes,
        preparedHits: m.preparedHits, preparedRegions: m.preparedRegions,
        preparedMaterializations: m.preparedMaterializations,
        preparedPageDecodes: m.preparedPageDecodes, preparedSharedPageHits: m.preparedSharedPageHits,
        preparedFallbacks: m.preparedFallbacks };
    } catch (_) { return null; }
  }
  function digestFunction(fn) {
    if (typeof fn !== 'function') return '';
    var crypto = require('crypto');
    return crypto.createHash('sha256')
      .update(Function.prototype.toString.call(fn).replace(/\r\n/g, '\n')).digest('hex');
  }
  // The live tilemap class and its child-sort composition; YED's _sortChildren cost depends on it.
  function tilemapInfo() {
    var sp = SceneManager._scene && SceneManager._scene._spriteset;
    var tm = sp && sp._tilemap;
    if (!tm) return null;
    var proto = Object.getPrototypeOf(tm);
    try {
      return { constructor: tm.constructor && tm.constructor.name,
        children: tm.children ? tm.children.length : 0,
        sortChildren: digestFunction(proto._sortChildren),
        compareChildOrder: digestFunction(proto._compareChildOrder) };
    } catch (_) { return null; }
  }
  function setPatch(state) {
    if (state && root.OmoriPerformance) root.OmoriPerformance.enabled = state !== 'off';
    return root.OmoriPerformance ? (root.OmoriPerformance.enabled ? 'on' : 'off') : 'absent';
  }

  function quitGame() {
    if (root.NativeHost && NativeHost.runtime && NativeHost.runtime.quit) {
      return NativeHost.runtime.quit();
    }
    // NW.js: close every window (App.quit ends the process).
    try { var gui = require('nw.gui'); if (gui.App) return gui.App.quit(); } catch (e) {}
    try { if (root.nw && root.nw.App) return root.nw.App.quit(); } catch (e) {}
    if (root.process && process.exit) process.exit(0);
  }

  // Message boxes and choices are confirmed without device input. "ok" reads as pressed only while
  // a message is open at the moment the game asks, pulsed every 8 frames so it registers as fresh
  // presses; it can never reach the map (a timer-driven key state could land on the frame after a
  // message closed and make the player interact, e.g. with White Space's laptop). In trace mode the
  // pulse clock is the LOGIC STEP counter instead of Graphics.frameCount: how many rendered frames
  // a step takes, and which frameCount lands on which logic step, depend on the machine and load
  // timing, so frame-based pulses would press 'ok' at different logic steps between runs. The
  // isLongPressed override never fires while a message is open in trace mode, so the extra
  // updateMain of Scene_Map.isFastForward (which would double-advance the map interpreter)
  // cannot trigger from a script pulse: vanilla behaviour without a player holding the key.
  function installAutoConfirm() {
    var clock = MODE === 'trace'
      ? function () { return TR.steps; }
      : function () { return Graphics.frameCount; };
    ['isPressed', 'isTriggered', 'isRepeated'].forEach(function (name) {
      var original = Input[name];
      Input[name] = function (key) {
        if (key === 'ok' && $gameMessage && $gameMessage.isBusy()) return clock() % 8 === 0;
        return original.apply(this, arguments);
      };
    });
    var originalLong = Input.isLongPressed;
    Input.isLongPressed = function (key) {
      if (key === 'ok' && $gameMessage && $gameMessage.isBusy()) return MODE !== 'trace' && clock() % 8 === 0;
      return originalLong.apply(this, arguments);
    };
  }

  function capture(name) {
    if (!SHOTS) return null;
    try {
      var fs = require('fs'), Buffer = require('buffer').Buffer, pathMod = require('path');
      (function makeDirs(dir) {
        if (fs.existsSync(dir)) return;
        makeDirs(pathMod.dirname(dir));
        fs.mkdirSync(dir);
      })(SHOTS);
      // PMJS on the device: copy the shown framebuffer page (640x480 BGRA; fb2png.py converts).
      if (fs.existsSync('/sys/class/graphics/fb0/pan')) {
        var pan = fs.readFileSync('/sys/class/graphics/fb0/pan', 'utf8').trim().split(',').map(Number);
        var size = 640 * 480 * 4, page = Buffer.alloc(size), fd = fs.openSync('/dev/fb0', 'r');
        try { fs.readSync(fd, page, 0, size, Math.round((pan[1] || 0) / 480) * size); } finally { fs.closeSync(fd); }
        fs.writeFileSync(SHOTS + '/' + name + '.raw', page);
        return name;
      }
      // NW.js: render the current scene and read the framebuffer as a PNG. No-argument
      // extract.canvas() reads the renderer target (640x480, the view); a target argument would
      // bake the object's bounds instead (not the visible screen).
      var renderer = Graphics._renderer;
      var object = SceneManager._scene || renderer.lastObjectRendered;
      renderer.render(object);
      var source = renderer.plugins && renderer.plugins.extract ? renderer.plugins.extract.canvas() : renderer.view;
      var data = source.toDataURL('image/png');
      fs.writeFileSync(SHOTS + '/' + name + '.png', Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
      return name;
    } catch (error) { return name + ': ' + error.message; }
  }

  // V8 sampling profiler over a measurement window (OMORI_TEST_PROFILE). Profiling is optional
  // and skipped with a logged note when the runtime has no inspector session (NW.js 0.29's
  // Node 9 has the module, but wins nothing if the API is missing).
  var PROFILE = env('OMORI_TEST_PROFILE'), session = null, sessionBroken = false;
  function post(method, params) {
    return new Promise(function (resolve, reject) {
      session.post(method, params || {}, function (error, result) { if (error) reject(error); else resolve(result); });
    });
  }
  function ensureSession() {
    if (session) return true;
    if (sessionBroken) return false;
    try { session = new (require('inspector').Session)(); session.connect(); return true; }
    catch (error) {
      sessionBroken = true; session = null;
      log({ profile: 'unavailable', error: String(error && error.message || error) });
      return false;
    }
  }
  async function profileStart() {
    if (!PROFILE || !ensureSession()) return;
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 500 });
    await post('Profiler.start');
  }
  // Exact calls per rendered frame over `count` frames (V8 precise coverage), for the census.
  // Functions are keyed by name and file; the 40 most called are returned.
  async function callCounts(count) {
    if (!ensureSession()) return [];
    await post('Profiler.enable');
    await post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    await post('Profiler.takePreciseCoverage');
    var f0 = Graphics.frameCount;
    await frames(count);
    var rendered = Graphics.frameCount - f0;
    var result = await post('Profiler.takePreciseCoverage');
    await post('Profiler.stopPreciseCoverage');
    var totals = {};
    result.result.forEach(function (script) {
      var file = String(script.url).split('/').pop().slice(0, 40);
      script.functions.forEach(function (fn) {
        var calls = fn.ranges[0] && fn.ranges[0].count;
        if (!calls || !fn.functionName) return;
        var key = fn.functionName + ' ' + file;
        totals[key] = (totals[key] || 0) + calls;
      });
    });
    // OMORI_TEST_CALLS_MATCH=<regexp>: also report every function whose key matches.
    var match = env('OMORI_TEST_CALLS_MATCH') ? new RegExp(env('OMORI_TEST_CALLS_MATCH')) : null;
    var keys = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    return keys.filter(function (key, index) { return index < 40 || match && match.test(key); })
      .map(function (key) { return [key, round(totals[key] / rendered)]; });
  }

  async function profileStop(name) {
    if (!PROFILE || !session) return null;
    var result = await post('Profiler.stop'), fs = require('fs');
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.writeFileSync(PROFILE + '/' + name + '.cpuprofile', JSON.stringify(result.profile));
    return name + '.cpuprofile';
  }

  // Scene-tree census (OMORI_TEST_CENSUS=1): the nodes a frame walks (visible subtrees), by class,
  // with how many lie wholly off screen, how many of those have children (so a leaf-only cull keeps
  // them), and which child classes those are.
  function census() {
    var classes = {}, total = 0, offscreen = 0, offContainers = 0, offSubtreeNodes = 0;
    var screen = new PIXI.Rectangle(0, 0, Graphics.width, Graphics.height);
    function size(node) {
      var n = 1, kids = node.children || [];
      for (var i = 0; i < kids.length; i++) if (kids[i].visible) n += size(kids[i]);
      return n;
    }
    function visit(node) {
      if (!node.visible) return;
      total++;
      var name = node.constructor && node.constructor.name || '?';
      var row = classes[name] || (classes[name] = { n: 0, off: 0, offWithKids: 0, kids: {} });
      row.n++;
      var kids = node.children || [], visibleKids = kids.filter(function (k) { return k.visible; });
      if (node !== SceneManager._scene && typeof node.getBounds === 'function') {
        var b = node.getBounds(true);
        var off = b.width > 0 && b.height > 0 && (b.x + b.width < 0 || b.y + b.height < 0 || b.x > screen.width || b.y > screen.height);
        if (off) {
          offscreen++; row.off++;
          if (visibleKids.length) {
            offContainers++; row.offWithKids++;
            offSubtreeNodes += size(node) - 1;
            visibleKids.forEach(function (k) {
              var kn = k.constructor && k.constructor.name || '?';
              row.kids[kn] = (row.kids[kn] || 0) + 1;
            });
          }
        }
      }
      for (var i = 0; i < kids.length; i++) visit(kids[i]);
    }
    visit(SceneManager._scene);
    // The tilemap holds characters, YED priority-tile sprites and other map sprites as children.
    var tilemap = SceneManager._scene._spriteset && SceneManager._scene._spriteset._tilemap;
    var tilemapKids = tilemap ? tilemap.children.length : 0;
    var tilemapVisible = tilemap ? tilemap.children.filter(function (k) { return k.visible; }).length : 0;
    var top = Object.keys(classes).sort(function (a, b) { return classes[b].n - classes[a].n; }).slice(0, 14);
    return { nodes: total, tilemapChildren: tilemapKids, tilemapVisible: tilemapVisible, offscreen: offscreen, offContainers: offContainers, offSubtreeNodes: offSubtreeNodes,
      byClass: top.map(function (name) { var r = classes[name]; return [name, r.n, r.off, r.offWithKids, r.kids]; }) };
  }

  // Frame-phase breakdown (OMORI_TEST_BREAKDOWN=1): inclusive wall-time buckets inside the host
  // tick. `logic` is SceneManager.updateScene (all n logic steps of the frame), `build` is
  // renderScene (PMJS scene encoding), `tick` is the whole host tick. The wrappers add a few
  // performance.now() calls per step: use the breakdown for attribution, and a run without it for
  // fps comparisons. Everything is averaged over rendered frames; perStep divides by updateMain
  // calls, which is the figure that matters for a 60 fps target (at 30 fps GTP runs 2 steps/frame).
  var BP = { acc: null, worst: null };
  function blankBreakdown() {
    return { tick: 0, logic: 0, build: 0, render: 0, main: 0, managers: 0, sceneMap: 0,
      spriteset: 0, gameMap: 0, overlay: 0, input: 0, audio: 0, video: 0, steps: 0 };
  }
  // Numeric counters exposed by the fast-path patches (OmoriPerformance, OmoriPerf.*), sampled
  // once per measurement window and divided by rendered frames.
  function counterSnapshot() {
    var out = {};
    function walk(value, prefix, depth) {
      if (!value || typeof value !== 'object' || depth > 3) return;
      Object.keys(value).forEach(function (key) {
        var child = value[key];
        if (typeof child === 'number') out[prefix + '.' + key] = child;
        else if (child && typeof child === 'object') walk(child, prefix + '.' + key, depth + 1);
      });
    }
    if (root.OmoriPerformance) walk(root.OmoriPerformance, 'OmoriPerformance', 0);
    if (root.OmoriPerf) walk(root.OmoriPerf, 'OmoriPerf', 0);
    if (typeof root.nativeTileRebuilds === 'number') {
      out['pmjs.nativeTileRebuilds'] = root.nativeTileRebuilds;
    }
    if (typeof root.nativeTileRects === 'number') {
      out['pmjs.nativeTileRects'] = root.nativeTileRects;
    }
    return out;
  }
  // Logic steps per rendered frame, counted with a bare increment: the step count decides
  // whether the game is in its 2-step catch-up loop, which is the fps cliff, not logic cost.
  var logicSteps = 0, stepCounterInstalled = false;
  function installStepCounter() {
    if (stepCounterInstalled || !root.SceneManager || typeof SceneManager.updateScene !== 'function') return;
    stepCounterInstalled = true;
    var updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () { ++logicSteps; return updateScene.apply(this, arguments); };
  }
  function counterDeltas(before, after, frames) {
    var out = null;
    Object.keys(after).forEach(function (key) {
      var delta = after[key] - (before[key] || 0);
      if (!delta) return;
      out = out || {};
      out[key] = round(delta / Math.max(1, frames));
    });
    return out;
  }
  function probe(owner, name, key) {
    var original = owner && owner[name];
    if (typeof original !== 'function') return;
    owner[name] = function () {
      var t = performance.now();
      try { return original.apply(this, arguments); }
      finally { if (BP.acc) BP.acc[key] += performance.now() - t; }
    };
  }
  function installBreakdown() {
    if (!BREAKDOWN || BP.acc) return;
    BP.acc = blankBreakdown();
    probe(SceneManager, 'updateScene', 'logic');
    probe(SceneManager, 'renderScene', 'build');
    probe(SceneManager, 'updateMain', 'main');
    probe(SceneManager, 'updateManagers', 'managers');
    probe(SceneManager, 'updateOverlayFix', 'overlay');
    probe(SceneManager, 'updateInputData', 'input');
    probe(SceneManager, 'updateWebAudio', 'audio');
    probe(SceneManager, 'updateVideos', 'video');
    probe(Scene_Map.prototype, 'update', 'sceneMap');
    probe(Spriteset_Map.prototype, 'update', 'spriteset');
    probe(Game_Map.prototype, 'update', 'gameMap');
    if (typeof globalThis.__pmjsRender === 'function') probe(globalThis, '__pmjsRender', 'render');
    // The tick is wrapped separately: the window average hides a single 300-650 ms menu-open
    // frame, so keep the bucket split of the slowest tick in the window. A scene open runs its
    // constructor in SceneManager.push and its create() inside a later tick, which is exactly the
    // frame this captures.
    if (typeof globalThis.__pmjsTick === 'function') {
      var hostTick = globalThis.__pmjsTick;
      globalThis.__pmjsTick = function () {
        var before = null;
        if (BP.acc) {
          before = {};
          Object.keys(BP.acc).forEach(function (key) { before[key] = BP.acc[key]; });
        }
        var started = performance.now();
        try {
          return hostTick.apply(this, arguments);
        } finally {
          var elapsed = performance.now() - started;
          if (BP.acc) {
            var frame = { tick: elapsed };
            Object.keys(BP.acc).forEach(function (key) {
              if (key !== 'tick') frame[key] = BP.acc[key] - (before[key] || 0);
            });
            BP.acc.tick += elapsed;
            if (!BP.worst || elapsed > BP.worst.tick) BP.worst = frame;
          }
        }
      };
    }
    var updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function () {
      if (BP.acc) BP.acc.steps++;
      return updateMain.apply(this, arguments);
    };
  }

  // sceneMs and presentMs exist only in instrumented test builds (split of drawMs).
  var NATIVE_COSTS = ['uploadMs', 'drawMs', 'memoryMs', 'sceneMs', 'presentMs'];
  function renderStats() {
    var stats = root.NativeHost && NativeHost.render && typeof NativeHost.render.stats === 'function' ? NativeHost.render.stats() : null;
    var costs = stats && stats.frameCosts;
    return costs ? NATIVE_COSTS.map(function (key) { return Number(costs[key]) || 0; }) : null;
  }

  // Scene inventory: what the encoder sees, by class, and which plain-sprite conditions the live
  // nodes satisfy. Diagnostic only (OMORI_TEST_INVENTORY=1).
  function inventory() {
    var rows = {}, total = 0;
    function visit(node) {
      if (!node || !node.visible) return;
      total++;
      var name = node.constructor && node.constructor.name || '?';
      var row = rows[name] || (rows[name] = { nodes: 0, textures: 0, noFilters: 0,
        emptyFilters: 0, filters: 0, tone: 0, blend: 0, tintTexture: 0, mask: 0,
        withChildren: 0, cacheAsBitmap: 0, rotated: 0, noImage: 0 });
      row.nodes++;
      if (node.texture) {
        row.textures++;
        var filters = node._filters;
        if (!filters) row.noFilters++;
        else if (!filters.length) row.emptyFilters++;
        else row.filters++;
        var tone = node._colorTone;
        if (tone && (tone[0] || tone[1] || tone[2] || tone[3])) row.tone++;
        var blend = node._blendColor;
        if (blend && blend[3] > 0) row.blend++;
        if (node._tintTexture) row.tintTexture++;
        if (node.mask) row.mask++;
        if (node.children && node.children.length) row.withChildren++;
        if (node._cacheAsBitmap) row.cacheAsBitmap++;
        var rotation = ((Number(node.texture.rotate) || 0) % 16 + 16) % 16;
        if (rotation % 2) row.rotated++;
        var base = node.texture.baseTexture;
        if (!base || !base.source) row.noImage++;
      }
      var children = node.children || [];
      for (var index = 0; index < children.length; index++) visit(children[index]);
    }
    visit(SceneManager._scene);
    var top = Object.keys(rows).sort(function (a, b) { return rows[b].nodes - rows[a].nodes; });
    return { nodes: total, byClass: top.map(function (name) {
      var row = rows[name];
      return [name, row.nodes, row.textures, row.noFilters, row.emptyFilters, row.filters,
        row.tone, row.blend, row.tintTexture, row.mask, row.withChildren,
        row.cacheAsBitmap, row.rotated, row.noImage];
    }), columns: ['class', 'nodes', 'textures', 'noFilters', 'emptyFilters', 'filters',
      'tone', 'blend', 'tintTexture', 'mask', 'withChildren', 'cacheAsBitmap',
      'rotated', 'noImage'] };
  }

  // Per-thread CPU of the Node worker (OMORI_TEST_CPU=1): utime+stime from
  // /proc/self/task/<tid>/stat at the edges of the measurement window. Linux USER_HZ is 100 on
  // this device, so one tick is 10 ms; a thread at 100% of one core reports 100.
  function threadCpu() {
    if (!CPU) return null;
    var fs = require('fs'), out = {};
    fs.readdirSync('/proc/self/task').forEach(function (tid) {
      try {
        var stat = fs.readFileSync('/proc/self/task/' + tid + '/stat', 'utf8');
        var name = fs.readFileSync('/proc/self/task/' + tid + '/comm', 'utf8').trim();
        var fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        out[tid] = { name: name, ticks: Number(fields[11]) + Number(fields[12]) };
      } catch (error) { /* thread exited */ }
    });
    return out;
  }
  function threadCpuDeltas(before, after, ms) {
    if (!before || !after) return null;
    var out = {};
    Object.keys(after).forEach(function (tid) {
      var old = before[tid];
      if (!old) return;
      var ticks = after[tid].ticks - old.ticks;
      if (ticks <= 0) return;
      out[after[tid].name + ':' + tid] = round(ticks * 10 * 100 / Math.max(1, ms));
    });
    return out;
  }

  // fps and frame-time percentiles over one window, sampled per rendered frame.
  function measure(ms) {
    if (BREAKDOWN) { installBreakdown(); BP.acc = blankBreakdown(); BP.worst = null; }
    installStepCounter();
    var counters0 = counterSnapshot();
    var steps0 = logicSteps;
    var cpu0 = threadCpu();
    return new Promise(function (resolve) {
      var times = [], draws = [], last = 0, started = performance.now(), f0 = Graphics.frameCount;
      (function frame(now) {
        if (last) times.push(now - last);
        last = now;
        var draw = renderStats();
        if (draw !== null) draws.push(draw);
        if (now - started < ms) return requestAnimationFrame(frame);
        times.sort(function (a, b) { return a - b; });
        var pick = function (q) { return round(times[Math.min(times.length - 1, Math.floor(q * times.length))] || 0); };
        var frames = Graphics.frameCount - f0, elapsed = now - started;
        var steps = logicSteps - steps0;
        var drawAvg = draws.length ? draws.reduce(function (a, d) { return a + (d[1] || 0); }, 0) / draws.length : 0;
        var b = BREAKDOWN ? BP.acc : null;
        var avg = function (v) { return round(v / Math.max(1, frames)); };
        var per = function (v) { return round(v / Math.max(1, b ? b.steps : 0)); };
        var counters = counterDeltas(counters0, counterSnapshot(), frames);
        resolve({ fps: round(frames * 1000 / elapsed),
          ft: [pick(0.5), pick(0.95), round(times[times.length - 1] || 0)],
          steps: steps, stepsPerFrame: round(steps / Math.max(1, frames)),
          // Native renderFrame costs per frame: canvas uploads, GL submission, memory accounting.
          native: draws.length ? NATIVE_COSTS.reduce(function (out, key, k) {
            out[key] = round(draws.reduce(function (a, d) { return a + d[k]; }, 0) / draws.length);
            return out;
          }, {}) : null,
          breakdown: b ? {
            frames: frames,
            steps: b.steps,
            stepsPerFrame: round(b.steps / Math.max(1, frames)),
            // Slowest tick in the window, with the same buckets, so one open hitch can be
            // attributed even inside a multi-second window.
            worst: BP.worst ? {
              tick: round(BP.worst.tick), logic: round(BP.worst.logic),
              build: round(BP.worst.build), render: round(BP.worst.render),
              main: round(BP.worst.main), managers: round(BP.worst.managers),
              sceneMap: round(BP.worst.sceneMap), spriteset: round(BP.worst.spriteset),
              gameMap: round(BP.worst.gameMap), overlay: round(BP.worst.overlay),
              input: round(BP.worst.input), audio: round(BP.worst.audio),
              video: round(BP.worst.video), steps: BP.worst.steps,
              other: round(BP.worst.tick - BP.worst.logic - BP.worst.build - BP.worst.render)
            } : null,
            avgFrame: round(elapsed / Math.max(1, frames)),
            ms: {
              tick: avg(b.tick), logic: avg(b.logic), build: avg(b.build), render: avg(b.render),
              draw: round(drawAvg), main: avg(b.main), managers: avg(b.managers),
              sceneMap: avg(b.sceneMap), spriteset: avg(b.spriteset), gameMap: avg(b.gameMap),
              overlay: avg(b.overlay), input: avg(b.input), audio: avg(b.audio), video: avg(b.video),
              // Frame time not inside the measured sync buckets: ticker/scheduler plumbing, swap,
              // input polling and any idle wait.
              other: round(elapsed / Math.max(1, frames) - avg(b.logic) - avg(b.build) - avg(b.render) - drawAvg)
            },
            perStep: {
              logic: per(b.logic), main: per(b.main), sceneMap: per(b.sceneMap),
              spriteset: per(b.spriteset), gameMap: per(b.gameMap)
            }
          } : null,
          counters: counters, cpu: threadCpuDeltas(cpu0, threadCpu(), elapsed) });
      })(performance.now());
    });
  }

  async function goTo(place) {
    var id = place[0], loadStarted = performance.now();
    $gamePlayer.reserveTransfer(id, place[1] || 0, place[2] || 0, 2, 0);
    if (!(SceneManager._scene instanceof Scene_Map)) SceneManager.goto(Scene_Map);
    var arrived = await until(function () {
      return SceneManager._scene instanceof Scene_Map && $gameMap.mapId() === id && !SceneManager.isSceneChanging();
    }, 60000);
    lastLoadMs = Math.round(performance.now() - loadStarted);
    // In trace mode, skip wall-clock settle: TRACE_START logic-step offset absorbs variable load timing.
    // Wall-clock wait lets a variable number of logic steps run, diverging PRNG state before recording.
    if (MODE !== 'trace') await wait(SETTLE_MS);
    return arrived;
  }

  async function measured(label) {
    var phases = [];
    for (var state of PATCH) {
      var patch = setPatch(state);
      if (state) await wait(1000);
      if (env('OMORI_TEST_CENSUS') === '1') {
        log({ census: label, scene: census() });
        log({ calls: label, perFrame: await callCounts(60) });
      }
      if (INVENTORY) log({ inventory: label, scene: inventory() });
      await profileStart();
      var result = await measure(MEASURE_MS);
      result.patch = patch;
      result.profile = await profileStop(label + '-' + patch + '-' + phases.length);
      result.shot = capture(label + '-' + patch + '-' + phases.length);
      phases.push(result);
    }
    return phases;
  }

  // ---------------------------------------------------------------------- menus mode
  // UI cost is dominated by two things a steady room measurement cannot show: the scene
  // construction on open (one tick of hundreds of ms) and the update path while windows/text are
  // live. This mode drives the real game entry points -- Scene_Map.callMenu(), the menu's own
  // commandOptions() (which transfers command/status windows into the options scene) and
  // $gameMessage.add() -- from inside a logic step, so the work lands in the tick like a player
  // keypress, and measures each phase with the same breakdown/profile machinery as room mode.
  function sceneName() {
    return SceneManager._scene && SceneManager._scene.constructor && SceneManager._scene.constructor.name;
  }

  // Run fn at the end of the next SceneManager.updateScene, inside the host tick. Scene changes
  // caused by a keypress happen inside a step; calling push() from between frames would move the
  // scene constructor outside the measured tick and hide the very hitch we are chasing.
  function runNextStep(fn, label) {
    var original = SceneManager.updateScene, fired = false;
    SceneManager.updateScene = function () {
      var result = original.apply(this, arguments);
      if (!fired) {
        fired = true;
        SceneManager.updateScene = original;
        try { fn(); } catch (error) {
          log({ uiError: label, error: String(error && error.stack || error).slice(0, 400) });
        }
      }
      return result;
    };
  }

  async function waitScene(name, ms) {
    return until(function () {
      return sceneName() === name && !SceneManager.isSceneChanging() && SceneManager.isCurrentSceneStarted();
    }, ms);
  }

  async function uiMeasure(label, ms, trigger, triggerLabel) {
    var before = sceneName();
    await profileStart();
    var pending = measure(ms);
    if (trigger) runNextStep(trigger, triggerLabel || label);
    var result = await pending;
    result.scenes = [before, sceneName()];
    result.profile = await profileStop(label);
    result.shot = capture(label);
    return result;
  }

  function openMenu() {
    var scene = SceneManager._scene;
    if (scene && typeof scene.callMenu === 'function') return scene.callMenu();
    SceneManager.push(Scene_Menu);
  }

  function openOptions() {
    var scene = SceneManager._scene;
    if (scene && typeof scene.commandOptions === 'function') return scene.commandOptions();
    throw new Error('commandOptions missing on ' + sceneName());
  }

  // Scripted directional input for the move phases. A real player holding a direction makes
  // Window_Selectable move the cursor through Input.isRepeated; pulses are counted in logic
  // steps, not frames, so the same script covers a 1-step and a 2-step frame. Only directions
  // are scripted: changing an option value would write the player's configuration.
  var UI = { installed: false, step: 0, down: {}, danceKeys: null, interval: 10, max: 0, count: 0, index: 0, nextStep: 0 };
  function installUiInput() {
    if (UI.installed) return;
    UI.installed = true;
    var updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {
      UI.step++;
      if (UI.danceKeys && UI.count < UI.max && UI.step >= UI.nextStep) {
        var key = UI.danceKeys[UI.index % UI.danceKeys.length];
        UI.down[key] = { start: UI.step, end: UI.step + 1 };
        UI.index++;
        UI.count++;
        UI.nextStep = UI.step + UI.interval;
      }
      return updateScene.apply(this, arguments);
    };
    function virtual(key, kind) {
      var down = UI.down[key];
      if (!down) return false;
      if (kind === 'triggered') return UI.step === down.start;
      return UI.step >= down.start && UI.step < down.end;
    }
    var pressed = Input.isPressed, triggered = Input.isTriggered, repeated = Input.isRepeated;
    Input.isPressed = function (key) { return virtual(key, 'pressed') || pressed.apply(this, arguments); };
    Input.isTriggered = function (key) { return virtual(key, 'triggered') || triggered.apply(this, arguments); };
    Input.isRepeated = function (key) { return virtual(key, 'pressed') || repeated.apply(this, arguments); };
  }
  function dance(keys, interval, max) {
    installUiInput();
    UI.danceKeys = keys;
    UI.interval = interval;
    UI.max = max;
    UI.count = 0;
    UI.index = 0;
    UI.nextStep = UI.step + interval;
  }
  function danceStop() {
    UI.danceKeys = null;
    UI.down = {};
  }

  async function uiSequence(room) {
    var out = { loadMs: null };
    out.arrived = await goTo(room);
    out.loadMs = lastLoadMs;
    out.mapBefore = await uiMeasure('ui-map-before', MEASURE_MS);

    // Cold open (the first menu in a session pays atlas/window construction).
    out.menuOpen = await uiMeasure('ui-menu-open', 3000, openMenu, 'callMenu');
    out.menuStarted = await waitScene('Scene_Menu', 8000);
    await wait(800);
    out.menu = await uiMeasure('ui-menu', MEASURE_MS);
    if (INVENTORY) log({ inventory: 'ui-menu', scene: inventory() });
    if (env('OMORI_TEST_CENSUS') === '1') log({ census: 'ui-menu', scene: census() });
    // Cursor across the command row: the cursor-rect sprite and the command window redraw were
    // measurable only while a key moves; a still menu does not pay them.
    dance(['right', 'right', 'left', 'left'], 10, 24);
    out.menuMove = await uiMeasure('ui-menu-move', MEASURE_MS);
    danceStop();

    // Options is entered through the menu command: it transfers the menu's command/status
    // windows, so pushing the scene directly would not be the real construction path.
    out.optionsOpen = await uiMeasure('ui-options-open', 2500, openOptions, 'commandOptions');
    out.optionsStarted = await waitScene('Scene_OmoMenuOptions', 8000);
    await wait(800);
    out.options = await uiMeasure('ui-options', MEASURE_MS);
    if (INVENTORY) log({ inventory: 'ui-options', scene: inventory() });
    if (env('OMORI_TEST_CENSUS') === '1') log({ census: 'ui-options', scene: census() });
    // Switching categories shows/hides whole option windows, the heaviest menu animation. Only
    // up/down: left/right edits a value and writes the player's configuration.
    dance(['down', 'down', 'up', 'up'], 10, 24);
    out.optionsMove = await uiMeasure('ui-options-move', MEASURE_MS);
    danceStop();

    // Back to the menu, then to the map. pop() reconstructs the scene: the map's return cost is
    // the menu-close cost plus Scene_Map.create, which is what the player sees after closing.
    SceneManager.pop();
    out.backToMenu = await waitScene('Scene_Menu', 8000);
    await wait(400);
    out.menuBack = await uiMeasure('ui-menu-back', 1200);
    SceneManager.pop();
    out.backToMap = await waitScene('Scene_Map', 8000);
    await wait(400);
    out.mapAfter = await uiMeasure('ui-map-after', MEASURE_MS);

    // Warm open: same scene after the first one, to separate one-time atlas/window costs from
    // the recurring construction cost.
    out.menuOpenWarm = await uiMeasure('ui-menu-open-warm', 3000, openMenu, 'callMenu');
    out.menuWarmStarted = await waitScene('Scene_Menu', 8000);
    await wait(800);
    out.menuWarm = await uiMeasure('ui-menu-warm', MEASURE_MS);
    SceneManager.pop();
    out.backToMapWarm = await waitScene('Scene_Map', 8000);
    await wait(400);

    // Message window on the same map: the map's own cost is already in mapAfter/mapBefore, so
    // message-specific work is the delta. Auto-confirm is off in this mode, so the text shows at
    // the normal speed and then waits, exactly as for a player who does not press anything.
    var text = env('OMORI_TEST_MESSAGE') ||
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ';
    out.messageOpen = await uiMeasure('ui-message-open', 3000, function () {
      $gameMessage.add(text + text + text + text);
    }, 'message-add');
    out.messageBusy = await until(function () { return $gameMessage.isBusy(); }, 5000);
    await wait(300);
    out.message = await uiMeasure('ui-message', MEASURE_MS);
    if (INVENTORY) log({ inventory: 'ui-message', scene: inventory() });
    if (env('OMORI_TEST_CENSUS') === '1') log({ census: 'ui-message', scene: census() });
    out.messageClose = await uiMeasure('ui-message-close', 1500, function () {
      $gameMessage.clear();
    }, 'message-clear');
    return out;
  }

  // Room mode with OMORI_TEST_SWEEP=<step>: the player (and so the camera) is placed on a grid of
  // tiles `step` apart across the map; at each point, after 1.5 s, fps and native costs over 2 s,
  // with the visible character sprites that have a graphic and whether a map event is running.
  async function sweep(step) {
    var points = [], w = $gameMap.width(), h = $gameMap.height();
    for (var y = Math.min(7, h - 1); y < h; y += step) {
      for (var x = Math.min(10, w - 1); x < w; x += step) {
        $gamePlayer.locate(x, y);
        await wait(1500);
        var result = await measure(2000);
        var characters = SceneManager._scene._spriteset._characterSprites.filter(function (sprite) {
          var b = sprite.getBounds(true);
          return sprite.visible && b.width > 0 && b.x + b.width > 0 && b.y + b.height > 0 &&
            b.x < Graphics.width && b.y < Graphics.height;
        }).length;
        points.push({ x: x, y: y, view: [round($gameMap.displayX()), round($gameMap.displayY())],
          event: $gameMap.isEventRunning(), characters: characters, fps: result.fps, ft: result.ft,
          native: result.native });
      }
    }
    return points;
  }

  // A loop of player moves, repeated while measuring (room mode with OMORI_TEST_WALK=1).
  function walkLoop() {
    var route = { list: [], repeat: true, skippable: true, wait: false };
    [8, 8, 8, 4, 4, 4, 2, 2, 2, 6, 6, 6].forEach(function (dir) {
      route.list.push({ code: { 2: 1, 4: 2, 6: 3, 8: 4 }[dir], indent: null });
    });
    route.list.push({ code: 0 });
    $gamePlayer.forceMoveRoute(route);
  }

  // ---------------------------------------------------------------------- trace mode
  var TRACE_FILE = env('OMORI_TEST_TRACE');
  var TRACE_STEPS = Number(env('OMORI_TEST_TRACE_STEPS')) || 1200;
  // Steps between the new game and the first recorded step (default 600, 10 s at full speed).
  // A fixed offset in LOGIC STEPS, not wall time: bitmap and audio loads take a run-dependent
  // number of steps, so a wall-time settle would leave the recording at different points of the
  // step stream. With a fixed offset both runs record from step offset+1 onwards, whatever the
  // load timing did before it, provided each logic step maps to the same state transitions.
  var TRACE_START = Number(env('OMORI_TEST_TRACE_START')) || 600;
  var traceBuffer = [];
  var TR = { steps: 0, phase: 0, restored: null, errors: 0 };

  function digest(value) {
    var json = JSON.stringify(value) || 'null';
    var h = 0x811c9dc5, i = 0;
    while (i < json.length) { h ^= json.charCodeAt(i++); h = (h * 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8) + (json.length >= 65536 ? '+' : '.') + json.length;
  }

  function r3(n) { return typeof n === 'number' && isFinite(n) ? Math.round(n * 1000) / 1000 : n; }

  // One compact JSON object per logic step. Field keys: s step, sc scene class, m map id,
  // p player [x,y,realX,realY,direction,pattern,transparent], ev every event
  // [id,x,y,realX,realY,direction,pattern,pageIndex,opacity,erased], sw/vr/ss digests of
  // switches/variables/self-switches, msg [messageWindow visible, text], scr
  // [tone r,g,b,gray, flash r,g,b,a, flashDuration, shakePower, shakeSpeed, shakeDuration,
  // brightness], pics digest of picture states, spr every VISIBLE character sprite
  // [x,y,opacity,bitmapUrl,[frame x,y,w,h]] (creation order, player first).
  function traceStep(step) {
    var scene = SceneManager._scene, screen = $gameScreen;
    var player = $gamePlayer;
    var tone = screen._tone || [], flash = screen._flashColor || [];
    var state = {
      s: step,
      sc: scene ? scene.constructor.name : 'null',
      m: $gameMap.mapId(),
      p: [player.x, player.y, r3(player._realX), r3(player._realY), player._direction,
        player.pattern(), player.isTransparent() ? 1 : 0],
      ev: [],
      sw: digest($gameSwitches._data),
      vr: digest($gameVariables._data),
      ss: digest($gameSelfSwitches._data),
      msg: [scene && scene._messageWindow && scene._messageWindow.visible ? 1 : 0,
        $gameMessage._texts.join('\u0001')],
      scr: [tone[0], tone[1], tone[2], tone[3], flash[0], flash[1], flash[2], flash[3],
        screen._flashDuration, screen._shakePower, screen._shakeSpeed, screen._shakeDuration,
        screen._brightness],
      pics: digest($gameScreen._pictures.map(function (pic) {
        return pic ? [pic._name, pic._origin, pic._x, pic._y, pic._scaleX, pic._scaleY,
          pic._angle, pic._opacity, pic._blendMode, pic._tone] : null;
      })),
      spr: []
    };
    $gameMap.events().forEach(function (event) {
      state.ev.push([event.eventId(), event.x, event.y, r3(event._realX), r3(event._realY),
        event._direction, event.pattern(), event._pageIndex, event.opacity(),
        event._erased ? 1 : 0]);
    });
    var spriteset = scene && scene._spriteset, chars = spriteset && spriteset._characterSprites;
    if (chars) chars.forEach(function (sprite) {
      if (!sprite.visible) return;
      var frame = sprite._frame, bitmap = sprite.bitmap;
      state.spr.push([r3(sprite.x), r3(sprite.y), Math.round(sprite.opacity),
        bitmap ? (bitmap._url || '') : '', frame ? [frame.x, frame.y, frame.width, frame.height] : null]);
    });
    return state;
  }

  function traceFlush() {
    if (TRACE_FILE && traceBuffer.length) {
      try {
        var fs = require('fs'), pathMod = require('path');
        (function makeDirs(dir) {
          if (fs.existsSync(dir)) return;
          makeDirs(pathMod.dirname(dir));
          fs.mkdirSync(dir);
        })(pathMod.dirname(TRACE_FILE));
        fs.appendFileSync(TRACE_FILE, traceBuffer.join('\n') + '\n');
      } catch (e) {}
    }
    traceBuffer.length = 0;
  }

  // Hook the top of the SceneManager.updateMain chain: counting every logic step, and once
  // TR.steps reaches TRACE_START, recording the following TRACE_STEPS steps (the hook is
  // installed before the transfer to the room, so the arrival and any bitmap-load wait steps
  // land inside the counted offset). Phase 2 ends recording; runTrace then restores.
  function traceHookInstall() {
    TR.restored = SceneManager.updateMain;
    SceneManager.updateMain = function () {
      var result = TR.restored.apply(this, arguments);
      traceAfterStep();
      return result;
    };
  }

  // Steps are counted only from the first logic step on the target map with its scene started:
  // the loading frames before that vary from run to run, and so does the randomness drawn
  // during them, so the PRNG is reseeded at that step as well.
  function onTargetMap() {
    return SceneManager._scene instanceof Scene_Map && SceneManager.isCurrentSceneStarted() &&
      !SceneManager.isSceneChanging() && $gameMap.mapId() === TR.map;
  }

  function traceAfterStep() {
    if (TR.phase === 2) return;
    if (!TR.counting) {
      if (!onTargetMap()) return;
      TR.counting = true;
      resetSeed();
    }
    TR.steps++;
    if (TR.steps % 50 === 0) traceFlush();
    if (TR.phase === 0) {
      if (TR.steps >= TRACE_START) {
        TR.phase = 1;
        if (TR.beginRecordedPhase) TR.beginRecordedPhase();
      }
      return;
    }
    var step = TR.steps - TRACE_START;
    if (step <= TRACE_STEPS && TR.phase === 1) {
      try { traceBuffer.push(JSON.stringify(traceStep(step))); }
      catch (error) {
        if (TR.errors++ < 3) log({ traceError: String(error && error.stack || error).slice(0, 300) });
      }
      if (step === TRACE_STEPS) { traceFlush(); TR.phase = 2; }
    }
  }

  // Record TRACE_STEPS logic steps into the JSONL file (identity check runs use the same seed
  // and the same script input, so the two traces must match line for line; compare with
  // research/pc-test/trace-diff.js). The step-counted offset (TRACE_START) absorbs the
  // run-dependent load timing; the walk loop starts exactly at the first recorded step.
  function runTrace(room) {
    return new Promise(function (resolve) {
      TR.map = room[0];
      traceHookInstall();
      (async function () {
        var arrived = await goTo(room);
        TR.beginRecordedPhase = function () {
          TR.beginRecordedPhase = null;
          if (env('OMORI_TEST_WALK') === '1') walkLoop();
        };
        var done = await until(function () { return TR.phase >= 2; }, 300000);
        SceneManager.updateMain = TR.restored;
        traceFlush();
        resolve({ mode: 'trace', seed: (Number(env('OMORI_TEST_SEED')) || 1234) >>> 0,
          steps: TRACE_STEPS, recorded: done ? Math.min(TR.steps - TRACE_START, TRACE_STEPS) : null,
          walk: env('OMORI_TEST_WALK') === '1', arrived: arrived,
          map: room[0], file: TRACE_FILE, errors: TR.errors });
      })().catch(function (error) {
        resolve({ mode: 'trace', failed: String(error && error.stack || error).slice(0, 400) });
      });
    });
  }

  async function verify(place) {
    var far = $gameMap.events().filter(function (event) {
      return event && (event.characterName() !== '' || event.tileId() > 0);
    }).map(function (event) {
      return { event: event, d: Math.abs(event.screenX() - 320) + Math.abs(event.screenY() - 240) };
    }).sort(function (a, b) { return b.d - a.d; })[0].event;
    var steps = 0, watch = null, mapUpdate = Game_Map.prototype.update;
    Game_Map.prototype.update = function () {
      steps++;
      var result = mapUpdate.apply(this, arguments);
      if (watch && !watch.done && !this._interpreter.isRunning()) watch.done = steps;
      return result;
    };
    async function timed(list) {
      await until(function () { return !$gameMap.isEventRunning() && !$gameMessage.isBusy(); }, 10000);
      watch = { start: steps, done: 0 };
      $gameMap._interpreter.setup(list, 0);
      await until(function () { return watch.done > 0; }, 20000);
      var result = watch.done ? watch.done - watch.start : 'timeout';
      watch = null;
      return result;
    }
    var animation = $dataAnimations.findIndex(function (a, i) { return i > 0 && a; });
    var home = [$gamePlayer.x, $gamePlayer.y], runs = [];
    for (var state of ['on', 'off']) {
      setPatch(state);
      var balloon = await timed([{ code: 213, indent: 0, parameters: [far.eventId(), 1, true] }, { code: 0, indent: 0, parameters: [] }]);
      var anim = await timed([{ code: 212, indent: 0, parameters: [far.eventId(), animation, true] }, { code: 0, indent: 0, parameters: [] }]);
      $gamePlayer.locate(home[0], home[1]);
      await wait(1500);
      $gamePlayer.locate(far.x, far.y + 1);
      await frames(1);
      var shots = [capture('map' + place[0] + '-jump1-' + state)];
      await frames(2);
      shots.push(capture('map' + place[0] + '-jump3-' + state));
      runs.push({ patch: state, balloonSteps: balloon, animationSteps: anim, shots: shots });
    }
    Game_Map.prototype.update = mapUpdate;
    setPatch('on');
    return { farEvent: far.eventId(), runs: runs };
  }

  async function run() {
    if (MODE === 'startup') {
      var m = memory();
      log({ mode: 'startup', titleMs: Math.round(performance.now()), heapMB: m.heapMB, rssMB: m.rssMB });
      return;
    }
    if (env('OMORI_TEST_DIGESTS') === '1') {      var crypto = require('crypto');
      function digestOf(fn) {
        return typeof fn === 'function' ? crypto.createHash('sha256')
          .update(Function.prototype.toString.call(fn).replace(/\r\n/g, '\n')).digest('hex') : '';
      }
      function getterOf(object, name) {
        var descriptor = Object.getOwnPropertyDescriptor(object, name);
        return descriptor && descriptor.get;
      }
      log({ digests: {
        isSlippery: digestOf(Game_Map.prototype.isSlippery),
        regionId: digestOf(Game_Map.prototype.regionId),
        width: digestOf(Game_Map.prototype.width),
        height: digestOf(Game_Map.prototype.height),
        isValid: digestOf(Game_Map.prototype.isValid),
        terrainTag: digestOf(Game_Map.prototype.terrainTag),
        tileset: digestOf(Game_Map.prototype.tileset),
        tiledDataGet: digestOf(getterOf(Game_Map.prototype, 'tiledData')),
        currentMapLevelGet: digestOf(getterOf(Game_Map.prototype, 'currentMapLevel')),
        isHalfTile: digestOf(Game_Map.prototype.isHalfTile),
        sortChildren: typeof root.Tilemap === 'function' ? digestOf(root.Tilemap.prototype._sortChildren) : '',
        compareChildOrder: root.TiledTilemap && root.TiledTilemap.prototype
          ? digestOf(root.TiledTilemap.prototype._compareChildOrder) : '',
        setupMiniLabel: digestOf(Sprite_Character.prototype.setupMiniLabel),
        spriteUpdate: digestOf(Sprite.prototype.update),
        spriteBaseUpdate: digestOf(Sprite_Base.prototype.update)
      } });
    }
    if (root.OmoriPerformance) {
      log({ perfState: { installed: !!root.OmoriPerformance.installed,
        enabled: !!root.OmoriPerformance.enabled } });
    }
    // Menus mode leaves input alone: an auto-confirmed message would close before the text
    // animation could be measured.
    if (MODE !== 'menus') installAutoConfirm();
    if (MODE === 'trace') resetSeed();
    DataManager.setupNewGame();
    if (MODE === 'trace') {
      var traceRoom = places(env('OMORI_TEST_ROOM') || '87:27:27')[0];
      log(await runTrace(traceRoom));
      return;
    }
    if (MODE === 'room') {
      var room = places(env('OMORI_TEST_ROOM') || '14:45:44')[0];
      var arrived = await goTo(room);
      if (env('OMORI_TEST_SWEEP')) {
        log({ mode: 'sweep', map: room[0], arrived: arrived, points: await sweep(Number(env('OMORI_TEST_SWEEP')) || 10) });
        return;
      }
      if (env('OMORI_TEST_WALK') === '1') walkLoop();
      // Camera-only pan: scroll the display without moving the player, so tilemap/camera work
      // is separated from player/follower/visibility work. Alternates direction at map edges.
      if (SCROLL) {
        var scrollDirection = 1;
        setInterval(function () {
          if (typeof $gameMap === 'undefined' || !$gameMap ||
              typeof $gameMap.startScroll !== 'function') return;
          if (typeof $gameMap.isScrolling === 'function' && $gameMap.isScrolling()) return;
          $gameMap.startScroll(scrollDirection * 2, 0, 120);
          scrollDirection = -scrollDirection;
        }, 250);
      }
      // Time series: consecutive 2 s windows from arrival, for entry/stagger/pan curves.
      // Use --settle 0; each window reports fps, frame times, the phase breakdown and counters.
      if (SERIES > 0) {
        var windows = [];
        for (var windowIndex = 0; windowIndex < SERIES; windowIndex++) {
          var window = await measure(2000);
          window.t = windowIndex * 2;
          windows.push(window);
        }
        log({ mode: 'series', map: room[0], loadMs: lastLoadMs, walk: env('OMORI_TEST_WALK') === '1',
          windows: windows, mem: memory() });
        return;
      }
      log({ mode: 'room', map: room[0], loadMs: lastLoadMs, arrived: arrived, walk: env('OMORI_TEST_WALK') === '1',
        phases: await measured('room' + room[0]), mem: memory(), imageStats: imageStats(), tilemap: tilemapInfo() });
      if (env('OMORI_TEST_SPRITES') === '1') {
        var sp = SceneManager._scene._spriteset, ps = sp && sp._characterSprites[0];
        var pSprite = sp ? sp._characterSprites.filter(function (s) { return s._character === $gamePlayer; })[0] : null;
        var sprState = function (s) { return s && {
          constructor: s.constructor && s.constructor.name, visible: s.visible, opacity: s.opacity,
          spriteXY: [s.x, s.y], scale: [s.scale.x, s.scale.y],
          bitmapW: s.bitmap && s.bitmap.width, loadingState: s.bitmap && s.bitmap._loadingState,
          url: s.bitmap && s.bitmap._url, error: s.bitmap && s.bitmap.isError() }; };
        log({ sprites: { first: sprState(ps), playerSprite: sprState(pSprite),
          player: { name: $gamePlayer.characterName(), realXY: [$gamePlayer._realX, $gamePlayer._realY],
            screenXY: [$gamePlayer.screenX(), $gamePlayer.screenY()], transparent: $gamePlayer.isTransparent() },
          focus: document.hasFocus && document.hasFocus(),
          eventRunning: $gameMap.isEventRunning(), playerEventcon: $gamePlayer.eventconId(),
          switches: { welcome: $gameSwitches.value(950) },
          pcx: $gamePlayer.x, pcy: $gamePlayer.y, mapEventsRunning: $gameMap._events.filter(function (e) { return e && e._interpreter && e._interpreter.isRunning(); }).length,
          characterSprites: sp._characterSprites.length,
          imageCacheErrors: Object.keys(ImageManager._imageCache._items).filter(function (k) {
            var b = ImageManager._imageCache._items[k].bitmap || ImageManager._imageCache._items[k];
            return b && b.isError && b.isError(); }).length,
          tilemapChildren: sp._tilemap && sp._tilemap.children.length } });
      }
      return;
    }
    if (MODE === 'menus') {
      var uiRoom = places(env('OMORI_TEST_ROOM') || '92:17:23')[0];
      log({ mode: 'menus', map: uiRoom[0], result: await uiSequence(uiRoom),
        mem: memory(), imageStats: imageStats() });
      return;
    }
    for (var place of MAPS) {
      var ok = await goTo(place);
      if (MODE === 'verify') log({ mode: 'verify', map: place[0], arrived: ok, result: await verify(place) });
      else log({ mode: 'perf', map: place[0], loadMs: lastLoadMs, arrived: ok, phases: await measured('map' + place[0]), mem: memory(), imageStats: imageStats(), tilemap: tilemapInfo() });
    }
  }

  var started = false;
  var timer = setInterval(function () {
    if (started || !root.SceneManager || !SceneManager._scene) return;
    if (SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
    started = true;
    clearInterval(timer);
    run().catch(function (error) { log({ failed: String(error && error.stack || error).slice(0, 400) }); })
      .then(function () { log({ done: MODE }); quitGame(); });
  }, 250);
})();
