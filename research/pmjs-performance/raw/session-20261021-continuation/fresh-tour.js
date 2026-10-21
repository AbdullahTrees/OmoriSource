// Map tour: visits a spread of OMORI maps and logs per-map performance and state (test only).
//
// PMJS:   pmjs <game> --patch map-tour.js        (set PMJS_BENCH_AUTOPLAY=0 if pmjs-bench.js is loaded)
// NW.js:  load it from the launcher like any injected script; PMJS-only fields are then omitted.
//
// After the title screen it starts a new game and, for each map: transfers there, moves the player
// to a passable tile near the map centre, waits OMORI_TOUR_SETTLE seconds (default 8) for fades and
// autorun events, then measures for OMORI_TOUR_MEASURE seconds (default 15). Each map logs one
// "[tour] {json}" line; a "[tour-summary]" table follows the last map. OMORI_TOUR_MAPS overrides the
// list ("87,90,98" or "87:28:27,..." with explicit coordinates).
//
// It needs no input: message boxes and choices are confirmed through the game's own input state,
// and battles or game over that interrupt it are left (see autopilot). OMORI_TOUR_TEXT sets the
// per-map text test length in seconds (default 6, 0 disables it).
//
// Fields: fps (rendered frames/s), ft = frame time p50/p95/max in ms (stutter shows in p95/max),
// drawMs/uploadMs = PMJS native renderer CPU time per frame, draws = draw calls per frame,
// messageShare = fraction of measured frames with a message box open, tickMs = game JavaScript per
// frame (PMJS __pmjsTick), textDraw = text draw calls/ms through PMJS's native path vs the stock
// Canvas fallback, nodes = display objects in the scene, text = the same while the standard test
// message is shown, filters = live filters in the scene tree with their key strengths,
// mem = process/heap/image MB, state = what the game was doing (scene, actual map, message/event
// running), autopilot = confirms sent and battles/game overs left so far, errors = uncaught errors.
// OMORI_TOUR_PROFILE=<dir> also records a V8 CPU profile of every measurement window (see profiler).
(function () {
  'use strict';
  // NW.js 0.29 (Chromium 65) predates globalThis.
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  // Spread across regions (ids, names and effect notes from data/MapInfos.json and the map events).
  var MAPS = [
    [87, 'DREAM WORLD', 'WHITESPACE', 'horror (cutscene)'],
    [90, 'DREAM WORLD', 'NORTH COAST', 'displacement'],
    [98, 'DREAM WORLD', 'OLD SHOE INTERIOR', 'horror'],
    [111, 'DREAM WORLD', 'RAIN TOWN', ''],
    [152, 'DREAM WORLD', 'PYREFLY FOREST', 'displacement'],
    [157, 'DREAM WORLD', 'PYREFLY SIDE-II', ''],
    [201, 'DREAM WORLD', 'ENTRANCE TO ABYSS', ''],
    [209, 'DREAM WORLD', 'MAIN PIER', 'displacement'],
    [245, 'DREAM WORLD', 'MOLLY LOST ROOM 5', ''],
    [354, 'DREAM WORLD', 'LOST FOREST (VI)', ''],
    [267, 'BLACKSPACE', 'HUB: LOST FOREST 2 (WATER)', 'horror'],
    [281, 'BLACKSPACE', 'LIL BASIL FOREST CLEARING', ''],
    [309, 'BLACKSPACE', 'SOMETHING BATTLE STAGE', 'displacement'],
    [371, 'BLACKSPACE', 'CROSSROADS DAY', ''],
    [457, 'BLACKSPACE', 'CHURCH OF SOMETHING LONG', 'horror'],
    [463, 'BLACKSPACE', 'BASILS RAFT PATH', ''],
    [14, 'FARAWAY (DAY)', "PLAYER'S HOUSE (DAY)", 'displacement'],
    [18, 'FARAWAY (DAY)', "PLAYER'S HOUSE (SUNSET)", 'displacement'],
    [26, 'FARAWAY (DAY)', "CHARLIE'S HOUSE (DAY)", ''],
    [51, 'FARAWAY (DAY)', "JESSE'S HOUSE (SUNSET)", ''],
    [75, 'FARAWAY (DAY)', 'CROSSROADS (DAY)', ''],
    [78, 'FARAWAY (NIGHT)', "PLAYER'S HOME (NIGHT)", 'horror+displacement'],
    [80, 'FARAWAY (NIGHT)', "BASIL'S HOME (NIGHT)", ''],
    [85, 'FARAWAY (NIGHT)', 'CHURCH (NIGHT)', ''],
    [322, 'HALLUCINATION', 'FEAR OF HEIGHTS', 'displacement'],
    [324, 'HALLUCINATION', 'FEAR OF DROWNING', '']
  ];

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  var SETTLE_MS = (Number(env('OMORI_TOUR_SETTLE')) || 8) * 1000;
  var MEASURE_MS = (Number(env('OMORI_TOUR_MEASURE')) || 15) * 1000;
  var TEXT_MS = env('OMORI_TOUR_TEXT') === undefined || env('OMORI_TOUR_TEXT') === '' ? 6000
    : Number(env('OMORI_TOUR_TEXT')) * 1000;
  var ARRIVE_TIMEOUT_MS = 60000;
  var tour = MAPS.map(function (m) { return { id: m[0], region: m[1], name: m[2], effects: m[3] }; });
  if (env('OMORI_TOUR_MAPS')) {
    tour = String(env('OMORI_TOUR_MAPS')).split(',').map(function (entry) {
      var p = entry.split(':').map(Number);
      return { id: p[0], x: p[1], y: p[2], region: '', name: '', effects: '' };
    });
  }

  function log(tag, value) { console.log('[' + tag + '] ' + (typeof value === 'string' ? value : JSON.stringify(value))); }
  function round(n, d) { var f = Math.pow(10, d || 1); return Math.round(n * f) / f; }
  function mb(bytes) { return typeof bytes === 'number' ? round(bytes / 1048576, 1) : null; }
  function percentile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0; }
  function sceneName() { return SceneManager._scene ? SceneManager._scene.constructor.name : '-'; }

  // Uncaught errors during a measurement window are counted and the first few kept.
  var errors = [];
  root.addEventListener && root.addEventListener('error', function (event) {
    errors.push(String(event && (event.message || (event.error && event.error.message)) || 'error').slice(0, 160));
  });

  function renderStats() {
    try {
      var s = root.NativeHost && NativeHost.render && NativeHost.render.stats ? NativeHost.render.stats() : null;
      // stats() returns one cached object that is mutated in place, so copy the numbers.
      return s ? { frames: s.frames, drawCalls: s.drawCalls, costs: s.frameCosts ? {
        drawMs: s.frameCosts.drawMs, uploadMs: s.frameCosts.uploadMs } : null } : null;
    } catch (_) { return null; }
  }

  function memory() {
    var out = {};
    try {
      var proc = root.__pmjsBuiltinRequire ? root.__pmjsBuiltinRequire('node:process')
        : (typeof process !== 'undefined' ? process : null);
      if (proc && proc.memoryUsage) {
        var u = proc.memoryUsage();
        out.rss = mb(u.rss); out.heap = mb(u.heapUsed);
      }
    } catch (_) {}
    try {
      var images = NativeHost.images.memory(0);
      out.imgGpu = mb(images.gpuBytes); out.imgCpu = mb(images.cpuBytes);
    } catch (_) {}
    return out;
  }

  // Live filters anywhere in the scene tree, with the values that decide whether they do anything.
  function filters() {
    var out = [], seen = new Set();
    (function walk(node, depth) {
      if (!node || depth > 8 || seen.has(node)) return;
      seen.add(node);
      (node.filters || []).forEach(function (f) {
        if (!f) return;
        var name = f.constructor ? f.constructor.name : '?';
        var bits = [];
        ['blur', 'strength', 'bloomScale', 'amplitude', 'scale', 'alpha', 'noise', 'offset'].forEach(function (key) {
          var v = f[key];
          if (typeof v === 'number') bits.push(key + '=' + round(v, 2));
          else if (v && typeof v.x === 'number') bits.push(key + '=' + round(v.x, 2) + ',' + round(v.y, 2));
        });
        out.push(name + (f.enabled === false ? '(off)' : '') + (bits.length ? '{' + bits.join(' ') + '}' : ''));
      });
      (node.children || []).forEach(function (child) { walk(child, depth + 1); });
    })(SceneManager._scene, 0);
    return out;
  }

  function placePlayer() {
    // Nearest passable, event-free tile to the map centre, so the camera shows a typical view.
    var cx = Math.floor($gameMap.width() / 2), cy = Math.floor($gameMap.height() / 2);
    for (var r = 0; r < Math.max($gameMap.width(), $gameMap.height()); r++) {
      for (var dx = -r; dx <= r; dx++) {
        for (var dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var x = cx + dx, y = cy + dy;
          if ($gameMap.isValid(x, y) && $gameMap.isPassable(x, y, 2) && !$gameMap.eventsXy(x, y).length) {
            $gamePlayer.locate(x, y);
            return [x, y];
          }
        }
      }
    }
    return [$gamePlayer.x, $gamePlayer.y];
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function until(test, timeoutMs) {
    var started = performance.now();
    return new Promise(function (resolve) {
      (function poll() {
        if (test()) resolve(true);
        else if (performance.now() - started > timeoutMs) resolve(false);
        else setTimeout(poll, 250);
      })();
    });
  }

  // Hands-free play. Message boxes and choices are answered with the game's own confirm input (not a
  // real button press, so the firmware menu receives nothing); choices take their default option.
  // Battles and game over that interrupt the tour are left so the next map can load.
  var autopilot = { paused: false, presses: 0, battles: 0, gameOvers: 0 };
  setInterval(function () {
    if (!root.SceneManager || !SceneManager._scene || !root.$gameMessage) return;
    var scene = SceneManager._scene;
    if (scene.constructor.name === 'Scene_Battle' && !scene._tourAborted && root.BattleManager) {
      scene._tourAborted = true;
      autopilot.battles++;
      log('tour', 'battle interrupted the tour; aborting it');
      BattleManager.abort();
      return;
    }
    if (scene.constructor.name === 'Scene_Gameover' && !scene._tourLeft) {
      scene._tourLeft = true;
      autopilot.gameOvers++;
      log('tour', 'game over interrupted the tour; returning to the map');
      SceneManager.goto(Scene_Map);
      return;
    }
    if (autopilot.paused || !$gameMessage.isBusy()) { Input._currentState.ok = false; return; }
    // Alternate pressed/released so every press is a fresh trigger.
    Input._currentState.ok = !Input._currentState.ok;
    if (Input._currentState.ok) autopilot.presses++;
  }, 120);

  // Where frame time goes (PMJS only): game JavaScript per frame (__pmjsTick = MV update + scene
  // command building) and text drawing, split into PMJS's native text path and the stock Canvas
  // fallback. Installed lazily because PMJS defines these after the patch loads.
  var probes = { tickMs: 0, ticks: 0, nativeText: 0, nativeTextMs: 0, canvasText: 0, canvasTextMs: 0 };
  function installProbes() {
    if (probes.installed) return;
    var host = root.PMJS && PMJS.web && PMJS.web.canvas;
    if (typeof root.__pmjsTick !== 'function' || !host || typeof host.drawNativeText !== 'function') return;
    probes.installed = true;
    var afterPresent = root.__pmjsAfterPresent;
    probes.presentTimes = [];
    root.__pmjsAfterPresent = function () {
      probes.presentTimes.push(performance.now());
      if (afterPresent) return afterPresent.apply(this, arguments);
    };
    var tick = root.__pmjsTick;
    root.__pmjsTick = function () {
      var t0 = performance.now(), result = tick.apply(this, arguments);
      return Promise.resolve(result).then(function (value) {
        probes.tickMs += performance.now() - t0; probes.ticks++; return value;
      });
    };
    var nativeText = host.drawNativeText;
    host.drawNativeText = function () {
      var t0 = performance.now();
      try { return nativeText.apply(this, arguments); }
      finally { probes.nativeText++; probes.nativeTextMs += performance.now() - t0; }
    };
    var body = Bitmap.prototype._drawTextBody;
    Bitmap.prototype._drawTextBody = function () {
      var t0 = performance.now();
      try { return body.apply(this, arguments); }
      finally { probes.canvasText++; probes.canvasTextMs += performance.now() - t0; }
    };
  }
  function probeSnapshot() {
    return { tickMs: probes.tickMs, ticks: probes.ticks, nativeText: probes.nativeText,
      nativeTextMs: probes.nativeTextMs, canvasText: probes.canvasText, canvasTextMs: probes.canvasTextMs };
  }
  function countNodes() {
    var n = 0, seen = new Set();
    (function walk(node, depth) {
      if (!node || depth > 12 || seen.has(node)) return;
      seen.add(node); n++;
      (node.children || []).forEach(function (child) { walk(child, depth + 1); });
    })(SceneManager._scene, 0);
    return n;
  }

  function measure(durationMs) {
    installProbes();
    return new Promise(function (resolve) {
      var times = [], last = 0, started = performance.now();
      var frames0 = Graphics.frameCount, stats0 = renderStats(), probe0 = probeSnapshot();
      var drawMs = 0, uploadMs = 0, costSamples = 0, messageFrames = 0, sampled = 0;
      errors.length = 0;
      (function frame(now) {
        if (last) times.push(now - last);
        last = now;
        sampled++;
        if ($gameMessage.isBusy()) messageFrames++;
        var s = renderStats();
        if (s && s.costs) { drawMs += s.costs.drawMs || 0; uploadMs += s.costs.uploadMs || 0; costSamples++; }
        if (now - started < durationMs) return requestAnimationFrame(frame);
        var elapsed = now - started, rendered = Graphics.frameCount - frames0, stats1 = renderStats();
        var probe1 = probeSnapshot(), ticks = probe1.ticks - probe0.ticks;
        times.sort(function (a, b) { return a - b; });
        resolve({
          tickMs: ticks ? round((probe1.tickMs - probe0.tickMs) / ticks, 2) : null,
          textDraw: { native: probe1.nativeText - probe0.nativeText,
            nativeMs: round(probe1.nativeTextMs - probe0.nativeTextMs, 1),
            canvas: probe1.canvasText - probe0.canvasText,
            canvasMs: round(probe1.canvasTextMs - probe0.canvasTextMs, 1) },
          nodes: countNodes(),
          fps: round(rendered * 1000 / elapsed),
          hostPresents: probes.presentTimes.filter(function(t) { return t >= started && t <= now; }).length,
          hostPresentHz: round(probes.presentTimes.filter(function(t) { return t >= started && t <= now; }).length * 1000 / elapsed),
          weather: { type: $gameScreen.weatherType(), power: $gameScreen.weatherPower(),
            sprites: SceneManager._scene._spriteset && SceneManager._scene._spriteset._weather && SceneManager._scene._spriteset._weather._sprites.length },
          ft: [round(percentile(times, 0.5)), round(percentile(times, 0.95)), round(times[times.length - 1] || 0)],
          drawMs: costSamples ? round(drawMs / costSamples, 2) : null,
          uploadMs: costSamples ? round(uploadMs / costSamples, 2) : null,
          draws: stats0 && stats1 && typeof stats1.drawCalls === 'number' && rendered > 0
            ? round((stats1.drawCalls - stats0.drawCalls) / rendered) : null,
          messageShare: sampled ? round(messageFrames / sampled, 2) : 0
        });
      })(performance.now());
    });
  }

  // Same two-line message on every map: frames while the box opens and the text types out, then
  // while it sits complete. Comparable text-drawing cost per map, before and after optimisations.
  async function measureText() {
    var free = await until(function () { return !$gameMessage.isBusy() && !$gameMap.isEventRunning(); }, 15000);
    if (!free || sceneName() !== 'Scene_Map') return null;
    autopilot.paused = true;
    $gameMessage.add('Map tour text test: the quick brown fox jumps over the lazy dog.');
    $gameMessage.add('0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz');
    var result = await measure(TEXT_MS);
    autopilot.paused = false;
    await until(function () { return !$gameMessage.isBusy(); }, 15000);
    return { fps: result.fps, ft: result.ft, tickMs: result.tickMs, textDraw: result.textDraw, nodes: result.nodes };
  }

  // PMJS map preparation: prepared tile sets used/refused so far with reasons, and whether the startup
  // catalog still exists. A "stale" reason deletes the catalog, so the next launch revalidates every map.
  function mapPreparation() {
    var maps = root.PMJS && PMJS.maps && PMJS.maps.stats, require = root.__pmjsBuiltinRequire;
    if (!maps) return null;
    var catalog = null;
    try {
      var dir = require('node:path').join(env('XDG_CACHE_HOME') || '', 'maps');
      catalog = require('node:fs').readdirSync(dir).some(function (f) { return /^catalog-[a-f0-9]{64}\.json$/.test(f); });
    } catch (_) {}
    return { selected: maps.selected, refused: maps.refused, unscoped: maps.unscoped, reasons: JSON.parse(JSON.stringify(maps.reasons)), catalog: catalog };
  }

  // OMORI_TOUR_PROFILE=<dir> (PMJS only): V8 sampling CPU profile of each measurement window, written
  // as <dir>/map-<id>[-text].cpuprofile (open in Chrome DevTools > Performance, or speedscope).
  // Sampling costs a little fps, so profiled runs are for finding hot spots, not for the fps table.
  var profiler = (function () {
    var dir = env('OMORI_TOUR_PROFILE'), require = root.__pmjsBuiltinRequire, session = null;
    if (!dir || typeof require !== 'function') return null;
    function post(method, params) {
      return new Promise(function (resolve, reject) {
        session.post(method, params || {}, function (error, result) { if (error) reject(error); else resolve(result); });
      });
    }
    return {
      start: function () {
        if (!session) {
          session = new (require('node:inspector').Session)();
          session.connect();
        }
        return post('Profiler.enable').then(function () { return post('Profiler.setSamplingInterval', { interval: 500 }); })
          .then(function () { return post('Profiler.start'); });
      },
      stop: function (name) {
        return post('Profiler.stop').then(function (result) {
          var fs = require('node:fs'), file = require('node:path').join(dir, name + '.cpuprofile');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(result.profile));
          return file;
        });
      }
    };
  })();

  async function profiled(name, body) {
    if (!profiler) return body();
    await profiler.start();
    try { return await body(); }
    finally { log('tour', 'profile ' + await profiler.stop(name)); }
  }

  async function visit(entry, index) {
    var target = entry.id;
    // Diagnostic isolation: clear previous map's game objects, weather, events and switches.
    DataManager.setupNewGame();
    SceneManager.goto(Scene_Map);
    log('fresh-map', { id: target, weather: $gameScreen.weatherType(), power: $gameScreen.weatherPower() });
    $gamePlayer.reserveTransfer(target, entry.x || 0, entry.y || 0, 2, 0);
    if (sceneName() !== 'Scene_Map') SceneManager.goto(Scene_Map);
    var arrived = await until(function () {
      return sceneName() === 'Scene_Map' && $gameMap.mapId() === target && !SceneManager.isSceneChanging() &&
        !$gamePlayer.isTransferring();
    }, ARRIVE_TIMEOUT_MS);
    var at = arrived && entry.x === undefined ? placePlayer() : [$gamePlayer.x, $gamePlayer.y];
    await wait(SETTLE_MS);
    var result = await profiled('map-' + target, function () { return measure(MEASURE_MS); });
    var record = {
      n: index + 1, id: target, region: entry.region, name: entry.name, effects: entry.effects,
      arrived: arrived, at: at
    };
    Object.keys(result).forEach(function (k) { record[k] = result[k]; });
    record.filters = filters();
    record.text = TEXT_MS > 0 ? await profiled('map-' + target + '-text', measureText) : null;
    record.autopilot = { presses: autopilot.presses, battles: autopilot.battles, gameOvers: autopilot.gameOvers };
    record.mem = memory();
    record.prep = mapPreparation();
    record.state = { scene: sceneName(), map: $gameMap.mapId(),
      message: $gameMessage.isBusy(), event: $gameMap.isEventRunning(), pictures: $gameScreen._pictures.filter(Boolean).length };
    record.errors = errors.slice(0, 3);
    record.errorCount = errors.length;
    log('tour', record);
    return record;
  }

  async function run() {
    log('tour', 'starting: ' + tour.length + ' maps, settle ' + SETTLE_MS / 1000 + ' s, measure ' + MEASURE_MS / 1000 + ' s');
    DataManager.setupNewGame();
    var results = [];
    for (var i = 0; i < tour.length; i++) {
      try { results.push(await visit(tour[i], i)); }
      catch (error) { log('tour', { n: i + 1, id: tour[i].id, failed: String(error && error.stack || error).slice(0, 300) }); }
    }
    log('tour-summary', '   id  region           fps   p50   p95   max  drawMs draws  msg  textFps rssMB  name  (tickMs = JS per frame)');
    results.forEach(function (r) {
      function pad(v, w) { v = v === null || v === undefined ? '-' : String(v); return (v + '                    ').slice(0, w); }
      log('tour-summary', pad(r.id, 5) + ' ' + pad(r.region, 15) + ' ' + pad(r.fps, 5) + ' ' + pad(r.ft[0], 5) + ' ' +
        pad(r.ft[1], 5) + ' ' + pad(r.ft[2], 5) + ' ' + pad(r.drawMs, 6) + ' ' + pad(r.draws, 5) + ' ' +
        pad(r.messageShare, 4) + ' ' + pad(r.text && r.text.fps, 7) + ' ' +
        pad(r.mem.rss, 6) + ' ' + r.name + ' tickMs=' + r.tickMs + '/' + (r.text && r.text.tickMs) +
        (r.state.map !== r.id ? ' (ended on map ' + r.state.map + ')' : '') +
        (r.errorCount ? ' errors=' + r.errorCount : ''));
    });
    log('tour', 'autopilot: ' + JSON.stringify(autopilot));
    log('tour', 'done');
    if (root.NativeHost && NativeHost.runtime) NativeHost.runtime.quit();
  }

  var started = false;
  var timer = setInterval(function () {
    if (started || !root.SceneManager || !SceneManager._scene) return;
    if (SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
    started = true;
    clearInterval(timer);
    run();
  }, 1000);
})();
