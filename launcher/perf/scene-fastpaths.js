// Scene and window fast paths for OMORI on slow hardware. Game files stay byte-identical.
//
// Loaded like launcher/omori-performance.js (PMJS: `--patch launcher/perf/scene-fastpaths.js`, installs
// on the afterPlugins phase; NW.js: `OMORI_PERF_SCENE=1` evaluates it before main.js, installs on load).
// Every item is independent and refuses to install unless the methods it relies on still match the
// reviewed sources (SHA-256 of Function.prototype.toString, LF normalised). `OMORI_PERF_DISABLE=<item>,…`
// turns items off; `OmoriPerf.<item>.enabled = false` does it at runtime. Counters `skipped` (fast path
// taken) and `full` (original called) are in `OmoriPerf.<item>`.
//
// 1. idleWindows: six map windows are fully updated while closed and invisible: Window_NumberInput,
//    Window_MapName, the three map QTE windows and Window_SkipCutscene. Their update bodies (plus the
//    Window_Base/TDS/Selectable chain they call) only touch state that is visible or input-driven when
//    the window is open/active. When the exact quiescent state below holds, the update is a visual
//    no-op, so the wrapper returns before the original. Any state that can make the original act
//    (opening, closing, active, a show count, a visible skip prompt) fails the guard, and each instance
//    is always updated in full once before it can be skipped.
// 2. parkedVehicles: YEP_CoreEngine updates all three Game_Vehicles every step. OMORI never puts a
//    vehicle on a map ($dataSystem.*.startMapId = 0), so all three are transparent and off-map. A
//    vehicle is skipped only while it is off the current map, not driving, not following a move route,
//    stopped, on its original pattern and at altitude 0 -- the state in which Game_CharacterBase.update
//    would only advance _stopCount/_animationCount behind an invisible sprite. Any other state (or an
//    instance override of update) takes the full path.
// 3. destinationEarlyOut: Scene_Map.updateDestination evaluates the touch/canMove chain every frame.
//    With no touch and no valid destination both vanilla branches are no-ops, so the method returns.
// 4. overlayFixClear: GTP_OmoriFixes clears a full-screen 2D canvas every other frame. Nothing in
//    project/js ever draws into Graphics._overlayFix (only creation and this clear), so its pixels are
//    always transparent and clearing cannot change the composite. The DOM element is kept (pointer
//    hit-testing depends on it); an external overlay that draws into it can set
//    OmoriPerf.overlayFixClear.forceOriginal = true.
// 5. masterVolumeIdle: SceneManager.updateWebAudio calls WebAudio.setMasterVolume every focused frame,
//    which re-writes 1 into a gain that is already 1. When focused, the context is running and the
//    value/gain are already 1 the call changes no sample and no state; below 1 (fade-in, options) or
//    while suspended, the vanilla path runs.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && root.NativeHost.runtime && typeof root.NativeHost.runtime.env === 'function') {
      return root.NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  // Pins: SHA-256 of Function.prototype.toString of the method as composed after all plugins loaded,
  // with CRLF normalised to LF. Computed from the reviewed files (see the report for the extractor).
  var PIN = {
    // idleWindows
    'Window_NumberInput.update': '5c50742fc91828c9dd9e9a156682b39d5581167500ca10c967a83c01176a6017',
    'Window_MapName.update': 'da0d93df984132c12a09e09c354c40ddd79e113203546ad1aca551289ee67154',
    'Window_OmoriMapQTESmash.update': 'eca91f64e9b4ada393c5a3abbcee93f78db476a108d3bce7490515a7652acd2b',
    'Window_OmoriStopTheArrow.update': 'be3f7ba12df2ca8d0c11de8117b5f31db1aa49c7daf19bfd31a581b336ca9262',
    'Window_OmoriHitTheMark.update': '0a2512c5ab5de2294d37728c154e7355bb76cf7af277aa71ce111e9ab377c078',
    'Window_SkipCutscene.update': '0a02267b979b9ddc55b04a1399997a6c2b1ea5be03383433ba6c40a1c906ac63',
    'Window_Base.update': '23ceafe11f9ffe0816b0e0837893efe6a0ed62ac03bf1e606a4d3afb7edd725f',
    // parkedVehicles
    'Game_Map.updateVehicles': '8aea01dbfea5603da23e14840dcf170ff9020bf40f804708ff2949c1980dbb50',
    'Game_Vehicle.update': 'd1da23a8f77ef3e5c64f96353d8aad0a4ba02f2020c3afd669951de2ba126a3e',
    // destinationEarlyOut
    'Scene_Map.updateDestination': 'ff09d228c0894af0fd8d4b39079a921fa27a2da058c649f737ae5204cc31eb03',
    // overlayFixClear
    'SceneManager.updateOverlayFix': 'e48dc1ff4a6f71b264651c592add23f1775102a0eb2de57beddc82bd7f9f848c',
    // masterVolumeIdle
    'SceneManager.updateWebAudio': 'fe946917736dc2a2ced88dee30038cbf81e0cf62f64c1a76720ab5f190e803fd'
  };

  var ITEMS = ['idleWindows', 'parkedVehicles', 'destinationEarlyOut', 'overlayFixClear', 'masterVolumeIdle'];
  var stats = {};
  ITEMS.forEach(function (id) {
    stats[id] = { installed: false, enabled: true, disabled: false, skipped: 0, full: 0, refused: null };
  });
  root.OmoriPerf = root.OmoriPerf || {};
  ITEMS.forEach(function (id) { root.OmoriPerf[id] = stats[id]; });

  var installed = false;
  var acceptPins = false;

  function digest(fn) {
    if (typeof fn !== 'function') return '';
    var crypto = null;
    try {
      if (typeof root.__pmjsBuiltinRequire === 'function') crypto = root.__pmjsBuiltinRequire('crypto');
      else if (typeof require === 'function') crypto = require('crypto');
    } catch (e) {
      return '';
    }
    if (!crypto) return '';
    return crypto.createHash('sha256')
      .update(Function.prototype.toString.call(fn).replace(/\r\n/g, '\n')).digest('hex');
  }

  function refused(item, method) {
    stats[item].refused = method;
    console.log('[omori-perf] ' + item + ' refused: ' + method);
  }

  function pinOk(method, fn) {
    return acceptPins || (typeof fn === 'function' && digest(fn) === PIN[method]);
  }

  function allPins(checks) {
    for (var i = 0; i < checks.length; i++) {
      if (!pinOk(checks[i][0], checks[i][1])) return checks[i][0];
    }
    return null;
  }

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  // Run a guard defensively: any unexpected shape takes the full path.
  function quiescent(guard, self) {
    try { return guard(self) === true; } catch (e) { return false; }
  }

  function flagOff(id) {
    return stats[id].disabled || !stats[id].enabled;
  }

  function wrapWindow(cls, guard, original, itemStats) {
    cls.prototype.update = function () {
      if (this._omoriSceneFastpathSeen && !flagOff('idleWindows') && quiescent(guard, this)) {
        itemStats.skipped++;
        return;
      }
      itemStats.full++;
      var result = original.apply(this, arguments);
      this._omoriSceneFastpathSeen = true;
      return result;
    };
  }

  function numberInputIdle(w) {
    if (!(w.openness === 0 && !w._opening && !w._closing && !w.active && !w._letterEffectsActive)) return false;
    // On touch devices the number buttons stay visible after a keyboard close and vanilla keeps
    // processing their taps while the window is closed; don't take that path away.
    if (w._buttons) {
      for (var i = 0; i < w._buttons.length; i++) if (w._buttons[i] && w._buttons[i].visible) return false;
    }
    return true;
  }

  function mapNameIdle(w) {
    return w._showCount === 0 && w.contentsOpacity === 0 && w.opacity === 0 &&
      !w.active && !w._opening && !w._closing && !w._letterEffectsActive;
  }

  function qteIdle(w) {
    return w.openness === 0 && !w._opening && !w._closing && !w.active && !w._letterEffectsActive;
  }

  function skipCutsceneIdle(w) {
    var scene = root.SceneManager && root.SceneManager._scene;
    return !!root.$gameTemp && !root.$gameTemp._canSkipCutscene && !root.$gameTemp._skippingCutscene &&
      !!scene && scene._skipCutsceneDuration === 0 &&
      !!(w._gaugeSpriteRate && w._gaugeSpriteBack &&
         w._gaugeSpriteRate.opacity === 0 && w._gaugeSpriteBack.opacity === 0 &&
         w.contentsOpacity === 0 && !w.active && !w._opening && !w._closing && !w._letterEffectsActive);
  }

  function installIdleWindows() {
    if (stats.idleWindows.installed) return;
    if (typeof Window_NumberInput !== 'function' || typeof Window_MapName !== 'function' ||
        typeof Window_OmoriMapQTESmash !== 'function' || typeof Window_OmoriStopTheArrow !== 'function' ||
        typeof Window_OmoriHitTheMark !== 'function' || typeof Window_SkipCutscene !== 'function' ||
        typeof Window_Base !== 'function') {
      refused('idleWindows', 'window classes');
      return;
    }
    var specs = [
      [Window_NumberInput, 'Window_NumberInput.update', numberInputIdle],
      [Window_MapName, 'Window_MapName.update', mapNameIdle],
      [Window_OmoriMapQTESmash, 'Window_OmoriMapQTESmash.update', qteIdle],
      [Window_OmoriStopTheArrow, 'Window_OmoriStopTheArrow.update', qteIdle],
      [Window_OmoriHitTheMark, 'Window_OmoriHitTheMark.update', qteIdle],
      [Window_SkipCutscene, 'Window_SkipCutscene.update', skipCutsceneIdle]
    ];
    var checks = [[ 'Window_Base.update', Window_Base.prototype.update ]];
    var originals = [];
    for (var i = 0; i < specs.length; i++) {
      originals.push(specs[i][0].prototype.update);
      checks.push([specs[i][1], specs[i][0].prototype.update]);
    }
    var bad = allPins(checks);
    if (bad) { refused('idleWindows', bad); return; }
    for (var j = 0; j < specs.length; j++) {
      wrapWindow(specs[j][0], specs[j][2], originals[j], stats.idleWindows);
    }
    stats.idleWindows.installed = true;
  }

  function parked(vehicle, mapId, vehicleUpdate) {
    if (vehicle.update !== vehicleUpdate) return false;
    if (typeof vehicle._mapId !== 'number' || vehicle._mapId === mapId) return false;
    if (vehicle._driving || vehicle._moveRouteForcing) return false;
    if (vehicle._altitude !== 0) return false;
    // Game_CharacterBase.update only runs updateStop (increment) and updateAnimation. With a positive
    // stop count every reader only tests > 0; with the animation count below animationWait the pattern
    // is untouched. Everything else (position, jump, move route) needs one of the flags above.
    if (!(vehicle._stopCount > 0)) return false;
    if (typeof vehicle.isMoving !== 'function' || vehicle.isMoving()) return false;
    if (typeof vehicle.isJumping !== 'function' || vehicle.isJumping()) return false;
    if (typeof vehicle.isOriginalPattern !== 'function' || !vehicle.isOriginalPattern()) return false;
    if (typeof vehicle.animationWait !== 'function') return false;
    return vehicle._animationCount < vehicle.animationWait();
  }

  function installParkedVehicles() {
    if (stats.parkedVehicles.installed) return;
    if (typeof Game_Map !== 'function' || typeof Game_Vehicle !== 'function') {
      refused('parkedVehicles', 'Game_Map/Game_Vehicle');
      return;
    }
    var updateVehicles = Game_Map.prototype.updateVehicles;
    var vehicleUpdate = Game_Vehicle.prototype.update;
    var bad = allPins([['Game_Map.updateVehicles', updateVehicles], ['Game_Vehicle.update', vehicleUpdate]]);
    if (bad) { refused('parkedVehicles', bad); return; }
    Game_Map.prototype.updateVehicles = function () {
      var s = stats.parkedVehicles;
      var group = this._vehicles;
      if (flagOff('parkedVehicles') || !group || typeof group.length !== 'number') {
        s.full++;
        return updateVehicles.apply(this, arguments);
      }
      var mapId = typeof this.mapId === 'function' ? this.mapId() : null;
      if (typeof mapId !== 'number') {
        s.full++;
        return updateVehicles.apply(this, arguments);
      }
      var length = group.length;
      for (var i = 0; i < length; i++) {
        var vehicle = group[i];
        if (!vehicle) continue;
        if (quiescent(function (v) { return parked(v, mapId, vehicleUpdate); }, vehicle)) {
          s.skipped++;
        } else {
          s.full++;
          vehicle.update();
        }
      }
    };
    stats.parkedVehicles.installed = true;
  }

  function installDestinationEarlyOut() {
    if (stats.destinationEarlyOut.installed) return;
    if (typeof Scene_Map !== 'function') {
      refused('destinationEarlyOut', 'Scene_Map');
      return;
    }
    var original = Scene_Map.prototype.updateDestination;
    var bad = allPins([['Scene_Map.updateDestination', original]]);
    if (bad) { refused('destinationEarlyOut', bad); return; }
    Scene_Map.prototype.updateDestination = function () {
      var s = stats.destinationEarlyOut;
      if (!flagOff('destinationEarlyOut') && this._touchCount === 0 && quiescent(function () {
        return !root.TouchInput.isTriggered() && !root.TouchInput.isPressed() &&
          !root.$gameTemp.isDestinationValid();
      }, null)) {
        s.skipped++;
        return;
      }
      s.full++;
      return original.apply(this, arguments);
    };
    stats.destinationEarlyOut.installed = true;
  }

  function installOverlayFixClear() {
    if (stats.overlayFixClear.installed) return;
    if (typeof SceneManager !== 'function' || !SceneManager.updateOverlayFix) {
      refused('overlayFixClear', 'SceneManager.updateOverlayFix');
      return;
    }
    var original = SceneManager.updateOverlayFix;
    var bad = allPins([['SceneManager.updateOverlayFix', original]]);
    if (bad) { refused('overlayFixClear', bad); return; }
    var monitored = null;
    SceneManager.updateOverlayFix = function () {
      var s = stats.overlayFixClear;
      var canvas = root.Graphics && root.Graphics._overlayFix;
      if (!flagOff('overlayFixClear') && !s.forceOriginal && canvas) {
        if (!monitored) monitored = canvas;
        if (canvas === monitored) { s.skipped++; return; }
      }
      s.full++;
      return original.apply(this, arguments);
    };
    stats.overlayFixClear.installed = true;
  }

  function volumeIsStable(audio) {
    if (audio._masterVolume !== 1) return false;
    var context = audio._context;
    if (!context || context.state !== 'running') return false;
    var node = audio._masterGainNode;
    if (!node || !node.gain) return true;
    var value = node.gain.value;
    // PMJS's native backend replaces the gain node with a stub whose setValueAtTime does nothing:
    // setMasterVolume then only stores the value, and it is already 1.
    if (typeof value !== 'number') return true;
    // Real Web Audio: a value below 1 means a fade/automation is in flight. Vanilla's setValueAtTime(1)
    // would cancel it, so take the vanilla path until the gain is back at 1.
    return value === 1;
  }

  function installMasterVolumeIdle() {
    if (stats.masterVolumeIdle.installed) return;
    if (typeof SceneManager !== 'function' || !SceneManager.updateWebAudio) {
      refused('masterVolumeIdle', 'SceneManager.updateWebAudio');
      return;
    }
    var original = SceneManager.updateWebAudio;
    var bad = allPins([['SceneManager.updateWebAudio', original]]);
    if (bad) { refused('masterVolumeIdle', bad); return; }
    SceneManager.updateWebAudio = function () {
      var s = stats.masterVolumeIdle;
      if (!flagOff('masterVolumeIdle') && typeof this.isFocus === 'function' &&
          quiescent(function (scene) { return scene.isFocus() === true; }, this) &&
          root.WebAudio && quiescent(function () { return volumeIsStable(root.WebAudio); }, null)) {
        s.skipped++;
        return;
      }
      s.full++;
      return original.apply(this, arguments);
    };
    stats.masterVolumeIdle.installed = true;
  }

  function install(withTestPins) {
    if (installed) return;
    installed = true;
    acceptPins = withTestPins === true;
    ITEMS.forEach(function (id) {
      if (wasDisabled(id)) { stats[id].disabled = true; return; }
      try {
        if (id === 'idleWindows') installIdleWindows();
        else if (id === 'parkedVehicles') installParkedVehicles();
        else if (id === 'destinationEarlyOut') installDestinationEarlyOut();
        else if (id === 'overlayFixClear') installOverlayFixClear();
        else if (id === 'masterVolumeIdle') installMasterVolumeIdle();
      } catch (e) {
        refused(id, String((e && e.message) || e));
      }
    });
  }

  // Test/diagnostic surface. The automatic install below always verifies pins.
  root.OmoriPerfSceneFastpaths = {
    pins: PIN,
    guards: {
      numberInputIdle: numberInputIdle,
      mapNameIdle: mapNameIdle,
      qteIdle: qteIdle,
      skipCutsceneIdle: skipCutsceneIdle,
      parked: parked,
      volumeIsStable: volumeIsStable
    },
    digest: digest,
    installForTest: function (acceptPinsForTest) { install(acceptPinsForTest === true); }
  };

  if (root.PMJS && root.PMJS.phases && typeof root.PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.scene-fastpaths', function () { install(false); });
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', function () { install(false); });
  }
})();
