// Frame-rate log for playtesting ports. Game files stay byte-identical.
//
// Writes <OMORI_FPS_DIR>/fps-<session start>.log, one JSON line per window: a window closes after
// 10 s, or earlier when the phase changes. The phase is the scene (Scene_Map, Scene_Sketchbook,
// Scene_Battle, menus...) and, on maps, the map and what is happening there:
//   free   the player can move
//   event  a map event (cutscene, door, NPC) is running
//   msg    a message, choice or number input is open
// Fields: t (session seconds at window end), scene, map, name, sub, x, y, secs, frames, fps,
// logic (game logic steps per second: 60 is full speed; GTP_OmoriFixes runs at most 2 per frame, so
// below 30 fps the game runs in slow motion), p50/p95/max (frame interval ms), hitch (frames over
// 100 ms). research/pmjs-performance/fps-report.py summarises a log per location.
//
// PMJS: the launcher sets OMORI_FPS_DIR and passes `--patch launcher/omori-fps-log.js`.
// NW.js: launcher/compat.js loads it when OMORI_FPS_DIR is set. Unset, it does nothing.
// Cost per frame: one clock read, a histogram increment and a few property reads.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  var pmjs = !!(root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function');
  var nodeRequire = pmjs ? root.__pmjsBuiltinRequire : (typeof require === 'function' ? require : null);

  function env(name) {
    if (pmjs) return NativeHost.runtime.env(name);
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  var DIR = env('OMORI_FPS_DIR');
  if (!DIR || !nodeRequire) return;

  var WINDOW_MS = 10000, FLUSH_MS = 10000, HITCH_MS = 100, BUCKETS = 251;
  var fs = nodeRequire(pmjs ? 'node:fs' : 'fs');
  var start = new Date();
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var file = DIR + '/fps-' + start.getFullYear() + pad(start.getMonth() + 1) + pad(start.getDate()) + '-' +
    pad(start.getHours()) + pad(start.getMinutes()) + pad(start.getSeconds()) + '.log';
  var pending = [], lastFlush = 0;

  function write(value) { pending.push(JSON.stringify(value)); }
  function flush(now) {
    lastFlush = now;
    if (!pending.length) return;
    var text = pending.join('\n') + '\n';
    pending = [];
    try { fs.appendFileSync(file, text); } catch (_) {}
  }

  // Frame intervals in 1 ms buckets; the last bucket holds everything from 250 ms up.
  var histogram = new Uint32Array(BUCKETS);
  var key = null, info = null, windowStart = 0, frames = 0, logic = 0, hitches = 0, maxMs = 0;
  var lastFrame = 0, origin = 0;

  function percentile(fraction) {
    var target = Math.ceil(frames * fraction), seen = 0;
    for (var i = 0; i < BUCKETS; i++) {
      seen += histogram[i];
      if (seen >= target) return i;
    }
    return BUCKETS - 1;
  }

  function closeWindow(now) {
    if (key !== null && frames > 0) {
      var secs = (now - windowStart) / 1000;
      var line = { t: Math.round((now - origin) / 100) / 10, scene: info.scene };
      if (info.map) { line.map = info.map; line.name = info.name; line.sub = info.sub; line.x = info.x; line.y = info.y; }
      line.secs = Math.round(secs * 10) / 10;
      line.frames = frames;
      line.fps = Math.round(frames / secs * 10) / 10;
      line.logic = Math.round(logic / secs * 10) / 10;
      line.p50 = percentile(0.5);
      line.p95 = percentile(0.95);
      line.max = Math.round(maxMs);
      line.hitch = hitches;
      write(line);
    }
    histogram.fill(0);
    frames = 0; logic = 0; hitches = 0; maxMs = 0; windowStart = now;
  }

  function currentPhase() {
    var scene = SceneManager._scene;
    var name = scene ? scene.constructor.name : '-';
    if (name !== 'Scene_Map' || !root.$gameMap || !$gameMap.mapId()) return { key: name, scene: name };
    var id = $gameMap.mapId(), sub = 'free';
    if ($gameMessage.isBusy()) sub = 'msg';
    else if ($gameMap._interpreter.isRunning()) sub = 'event';
    var mapInfo = root.$dataMapInfos && $dataMapInfos[id];
    return { key: id + ':' + sub, scene: name, map: id, sub: sub,
      name: mapInfo ? String(mapInfo.name).replace(/^[\s-]+/, '') : '',
      x: $gamePlayer.x, y: $gamePlayer.y };
  }

  function onFrame() {
    var now = performance.now();
    if (lastFrame) {
      var ms = now - lastFrame;
      histogram[ms < BUCKETS - 1 ? ms | 0 : BUCKETS - 1]++;
      if (ms > maxMs) maxMs = ms;
      if (ms >= HITCH_MS) hitches++;
      frames++;
    }
    lastFrame = now;
    var phase = currentPhase();
    if (phase.key !== key || now - windowStart >= WINDOW_MS) {
      closeWindow(now);
      key = phase.key;
    }
    info = phase;
    if (now - lastFlush >= FLUSH_MS) flush(now);
  }

  function install() {
    if (typeof SceneManager !== 'function' || typeof SceneManager.renderScene !== 'function') return;
    try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) {}
    origin = windowStart = lastFlush = performance.now();
    write({ session: start.toISOString(), runtime: pmjs ? 'pmjs' : 'nwjs',
      spritePatch: !!(root.OmoriPerformance && root.OmoriPerformance.installed) });
    flush(origin);

    // GTP_OmoriFixes' SceneManager.update runs updateMain up to twice, then renderScene once per frame.
    var updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function () {
      logic++;
      return updateMain.apply(this, arguments);
    };
    var renderScene = SceneManager.renderScene;
    SceneManager.renderScene = function () {
      var result = renderScene.apply(this, arguments);
      onFrame();
      return result;
    };
    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      process.on('exit', function () { closeWindow(performance.now()); flush(0); });
    }
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.fps-log', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
