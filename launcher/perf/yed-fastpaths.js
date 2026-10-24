// YED_Tiled per-frame fast paths for classic (non-Tiled) maps. Game files stay byte-identical.
//
// Runtime-patch module; install shape matches launcher/omori-performance.js (PMJS
// `afterPlugins`, or window load under NW.js). `OMORI_PERF_DISABLE=yedFastPaths` turns it off;
// `OmoriPerf.yedFastPaths` exposes `installed`, `refused`, `reflectionIdle`, `hideEmpty`.
//
// Two YED wrappers run for every character / spriteset update even when the map has no
// reflection surfaces or no Tiled layers:
//
//   Game_CharacterBase.updateReflection (YED_Tiled.js:2139) calls $gameMap.isOnReflection,
//   which computes the character's map position before checking `isTiledMap()` and
//   `_reflection.length`. When `_reflection` is empty (every classic map, and Tiled maps without
//   a reflection surface) the only observable result is `this.reflections = []`. The fast path
//   reproduces that without the position math or a fresh array when the current array is already
//   empty. A non-empty `_reflection` delegates, so positions/entries stay vanilla.
//
//   Spriteset_Map._updateHideOnLevel (YED_Tiled.js:2244) evaluates
//   `$gameMap.currentMapLevel` (a getter that may parse the plugin parameter and read a game
//   variable) and then loops `this._tilemap._layers`. With no layers the loop body never runs,
//   so the call has no effect; the fast path returns before the getter. A map with layers
//   delegates unchanged.
//
// Pins are SHA-256 of Function.prototype.toString (CRLF normalised to LF).
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var api = root.OmoriPerf = root.OmoriPerf || {};
  var stats = api.yedFastPaths = api.yedFastPaths || {};
  stats.installed = !!stats.installed;
  stats.refused = null;
  stats.reflectionIdle = 0;
  stats.hideEmpty = 0;
  var installTimer = null, installWaits = 0;

  var PINS = {
    updateReflection: ['58b6d640f457bba7552a7af7371bddd327142b4089078210f62bb224cb9f2907'],
    updateHideOnLevel: ['51bd8a67e29f953c5ca2607e8f54537e8b050256e5dac2fa1e467c0bed0ce823']
  };

  function digest(fn) {
    if (typeof fn !== 'function') return '';
    var crypto = root.__pmjsBuiltinRequire ? root.__pmjsBuiltinRequire('crypto')
      : (typeof require === 'function' ? require('crypto') : null);
    if (!crypto) return '';
    return crypto.createHash('sha256')
      .update(Function.prototype.toString.call(fn).replace(/\r\n/g, '\n')).digest('hex');
  }

  function pinned(name, fn) {
    return PINS[name].indexOf(digest(fn)) >= 0;
  }

  function refuse(method) {
    stats.refused = method;
    console.log('[omori-perf] yedFastPaths refused: ' + method);
  }

  function install() {
    if (stats.installed) {
      if (installTimer) { clearInterval(installTimer); installTimer = null; }
      return;
    }
    if (typeof root.Game_CharacterBase !== 'function' || typeof root.Spriteset_Map !== 'function' ||
        typeof root.Game_CharacterBase.prototype.updateReflection !== 'function' ||
        typeof root.Spriteset_Map.prototype._updateHideOnLevel !== 'function') {
      // YED's modules can load after the afterPlugins phase; retry rather than silently skip.
      if (!installTimer) {
        console.log('[omori-perf] yedFastPaths waiting for YED methods');
        installTimer = setInterval(install, 100);
      }
      if (++installWaits > 100) {
        clearInterval(installTimer); installTimer = null;
        refuse('YED methods missing');
      }
      return;
    }
    if (installTimer) { clearInterval(installTimer); installTimer = null; }
    var disabled = String(env('OMORI_PERF_DISABLE') || '').split(',');
    if (disabled.some(function (name) { return name.trim() === 'yedFastPaths'; })) {
      refuse('disabled by OMORI_PERF_DISABLE');
      return;
    }
    var reflection = root.Game_CharacterBase.prototype.updateReflection;
    var hide = root.Spriteset_Map.prototype._updateHideOnLevel;
    if (!pinned('updateReflection', reflection)) {
      refuse('Game_CharacterBase.prototype.updateReflection');
      return;
    }
    if (!pinned('updateHideOnLevel', hide)) {
      refuse('Spriteset_Map.prototype._updateHideOnLevel');
      return;
    }

    root.Game_CharacterBase.prototype.updateReflection = function () {
      var surfaces = root.$gameMap && root.$gameMap._reflection;
      if (!surfaces || surfaces.length === 0) {
        // YED's isOnReflection returns false here; keep the same observable empty list without
        // replacing an already-empty array every step.
        if (!this.reflections || this.reflections.length) this.reflections = [];
        stats.reflectionIdle++;
        return;
      }
      return reflection.apply(this, arguments);
    };

    root.Spriteset_Map.prototype._updateHideOnLevel = function () {
      var tilemap = this._tilemap;
      if (!tilemap || !tilemap._layers || tilemap._layers.length === 0) {
        stats.hideEmpty++;
        return;
      }
      return hide.apply(this, arguments);
    };

    stats.installed = true;
    console.log('[omori-perf] yedFastPaths installed');
  }

  if (root.PMJS && root.PMJS.phases && typeof root.PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.perf.yed-fastpaths', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
