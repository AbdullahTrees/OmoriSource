// One-session device check for launcher/omori-performance.js (PMJS --patch, after that patch).
//
// After the title screen it starts a new game and, for each map in PERF_CHECK_MAPS (default
// "14:45:44,78:45:44,111:15:25,87:27:27", the positions of earlier tours), transfers there, settles PERF_CHECK_SETTLE seconds (8) and measures
// PERF_CHECK_MEASURE seconds (10) per phase in the order on, off, on (OmoriPerformance.enabled).
// On the first map it also runs "Show Balloon (wait)" and "Show Animation (wait)" on the farthest
// event with the patch on and off and logs the logic steps each wait took: equal counts mean
// cutscene timing is unchanged. With PERF_CHECK_SHOTS=<dir> it saves the displayed framebuffer page
// (640x480 BGRA; convert with omori-handover/tools/fb2png.py) per map with the patch on and off, and on
// the first map before and after a camera jump to the farthest event, where skipped sprites re-enter
// the view. Logs "[perf-check] {json}" lines, then quits.
(function () {
  'use strict';
  var root = globalThis;
  function env(name) { return NativeHost.runtime.env(name); }
  var MAPS = String(env('PERF_CHECK_MAPS') || '14:45:44,78:45:44,111:15:25,87:27:27').split(',')
    .map(function (entry) { return entry.split(':').map(Number); });
  var SETTLE_MS = (Number(env('PERF_CHECK_SETTLE')) || 8) * 1000;
  var MEASURE_MS = (Number(env('PERF_CHECK_MEASURE')) || 10) * 1000;
  // PERF_CHECK_PHASES: sprite patch state per phase (default on,off,on); PERF_CHECK_EXTRAS=0 skips the
  // cutscene and camera-jump checks.
  var PHASES = String(env('PERF_CHECK_PHASES') || 'on,off,on').split(',').map(function (p) { return p.trim() !== 'off'; });
  var EXTRAS = env('PERF_CHECK_EXTRAS') !== '0';
  function log(value) { console.log('[perf-check] ' + JSON.stringify(value)); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  async function until(test, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) { if (test()) return true; await wait(100); }
    return false;
  }
  function round(n) { return Math.round(n * 10) / 10; }
  async function frames(count) {
    var target = Graphics.frameCount + count;
    await until(function () { return Graphics.frameCount >= target; }, 5000);
  }

  // The framebuffer page currently scanned out, from the panning offset (two 640x480 pages).
  var SHOTS = env('PERF_CHECK_SHOTS');
  function capture(name) {
    if (!SHOTS) return null;
    try {
      var fs = __pmjsBuiltinRequire('node:fs'), Buffer = __pmjsBuiltinRequire('node:buffer').Buffer;
      var pan = fs.readFileSync('/sys/class/graphics/fb0/pan', 'utf8').trim().split(',').map(Number);
      var size = 640 * 480 * 4, page = Buffer.alloc(size), fd = fs.openSync('/dev/fb0', 'r');
      try { fs.readSync(fd, page, 0, size, Math.round((pan[1] || 0) / 480) * size); } finally { fs.closeSync(fd); }
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(SHOTS + '/' + name + '.raw', page);
      return name;
    } catch (error) { return name + ': ' + error.message; }
  }

  var tickMs = 0, ticks = 0, steps = 0, watch = null;
  function probes() {
    if (root.__perfCheckProbes) return;
    root.__perfCheckProbes = true;
    var tick = root.__pmjsTick;
    root.__pmjsTick = function () {
      var t = performance.now();
      try { return tick.apply(this, arguments); } finally { tickMs += performance.now() - t; ticks++; }
    };
    var mapUpdate = Game_Map.prototype.update;
    Game_Map.prototype.update = function () {
      steps++;
      var result = mapUpdate.apply(this, arguments);
      // Record the exact logic step a timed command list finished on (polling would quantize it).
      if (watch && !watch.done && !this._interpreter.isRunning()) watch.done = steps;
      return result;
    };
  }

  async function measure(enabled) {
    root.OmoriPerformance.enabled = enabled;
    await wait(1000);
    var perf = root.OmoriPerformance, f0 = Graphics.frameCount, t0 = performance.now();
    var tick0 = tickMs, ticks0 = ticks, full0 = perf.full, off0 = perf.offscreen, refl0 = perf.reflections;
    await wait(MEASURE_MS);
    var frames = Graphics.frameCount - f0, elapsed = performance.now() - t0;
    return { enabled: enabled, fps: round(frames * 1000 / elapsed),
      tickMs: round((tickMs - tick0) / Math.max(1, ticks - ticks0)),
      perFrame: { full: round((perf.full - full0) / frames), offscreen: round((perf.offscreen - off0) / frames),
        reflections: round((perf.reflections - refl0) / frames) } };
  }

  // Run one command list on the map interpreter and count the logic steps until it finishes.
  async function timedCommand(list) {
    await until(function () { return !$gameMap.isEventRunning() && !$gameMessage.isBusy(); }, 10000);
    watch = { start: steps, done: 0 };
    $gameMap._interpreter.setup(list, 0);
    var finished = await until(function () { return watch.done > 0; }, 20000);
    var result = finished ? watch.done - watch.start : 'timeout';
    watch = null;
    return result;
  }

  function farthestEvent(drawn) {
    return $gameMap.events().filter(function (event) {
      return event && (!drawn || event.characterName() !== '' || event.tileId() > 0);
    }).map(function (event) {
      return { id: event.eventId(), d: Math.abs(event.screenX() - 320) + Math.abs(event.screenY() - 240) };
    }).sort(function (a, b) { return b.d - a.d; })[0];
  }

  // Jump the camera to the farthest event with a graphic: sprites skipped while off screen must be
  // correct on the first frames they are visible.
  async function jumpCheck(id) {
    var home = [$gamePlayer.x, $gamePlayer.y], far = $gameMap.event(farthestEvent(true).id), shots = [];
    for (var enabled of [true, false]) {
      root.OmoriPerformance.enabled = enabled;
      $gamePlayer.locate(home[0], home[1]);
      await wait(2000);
      $gamePlayer.locate(far.x, far.y + 1);
      await frames(1);
      shots.push(capture('map' + id + '-jump1-' + (enabled ? 'on' : 'off')));
      await frames(2);
      shots.push(capture('map' + id + '-jump-' + (enabled ? 'on' : 'off')));
      await wait(1500);
      shots.push(capture('map' + id + '-jump-settled-' + (enabled ? 'on' : 'off')));
    }
    root.OmoriPerformance.enabled = true;
    $gamePlayer.locate(home[0], home[1]);
    await wait(1500);
    return { event: far.eventId(), at: [far.x, far.y + 1], shots: shots };
  }

  async function cutsceneCheck() {
    var far = farthestEvent();
    var animation = $dataAnimations.findIndex(function (a, i) { return i > 0 && a; });
    var balloon = [{ code: 213, indent: 0, parameters: [far.id, 1, true] }, { code: 0, indent: 0, parameters: [] }];
    var show = [{ code: 212, indent: 0, parameters: [far.id, animation, true] }, { code: 0, indent: 0, parameters: [] }];
    var result = { event: far.id, distancePx: far.d, animationId: animation, runs: [] };
    for (var enabled of [true, false, true]) {
      root.OmoriPerformance.enabled = enabled;
      result.runs.push({ enabled: enabled, balloonSteps: await timedCommand(balloon),
        animationSteps: await timedCommand(show) });
    }
    root.OmoriPerformance.enabled = true;
    return result;
  }

  async function run() {
    probes();
    log({ start: MAPS.map(function (m) { return m.join(':'); }), installed: root.OmoriPerformance && root.OmoriPerformance.installed });
    DataManager.setupNewGame();
    for (var i = 0; i < MAPS.length; i++) {
      var id = MAPS[i][0];
      $gamePlayer.reserveTransfer(id, MAPS[i][1] || 0, MAPS[i][2] || 0, 2, 0);
      if (!(SceneManager._scene instanceof Scene_Map)) SceneManager.goto(Scene_Map);
      await until(function () {
        return SceneManager._scene instanceof Scene_Map && $gameMap.mapId() === id && !SceneManager.isSceneChanging();
      }, 60000);
      await wait(SETTLE_MS);
      var record = { map: id, phases: [] };
      for (var enabled of PHASES) {
        record.phases.push(await measure(enabled));
        record.phases[record.phases.length - 1].shot = capture('map' + id + '-' + (enabled ? 'on' : 'off') + '-' + record.phases.length);
      }
      if (EXTRAS) {
        if (i === 0) record.cutscene = await cutsceneCheck();
        record.jump = await jumpCheck(id);
      }
      log(record);
    }
    log({ done: true });
    NativeHost.runtime.quit();
  }

  var started = false;
  var timer = setInterval(function () {
    if (started || !root.SceneManager || !SceneManager._scene) return;
    if (SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
    started = true;
    clearInterval(timer);
    run().catch(function (error) { log({ failed: String(error && error.stack || error).slice(0, 400) }); NativeHost.runtime.quit(); });
  }, 1000);
})();
