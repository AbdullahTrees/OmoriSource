// Tile-geometry fast paths for OMORI on PMJS. Game files stay byte-identical.
//
// Runtime-patch module; install shape matches launcher/omori-performance.js (PMJS
// `afterPlugins`, or window load under NW.js). `OMORI_PERF_DISABLE=halfTileConstant` turns the
// item off; `OmoriPerf.halfTileConstant` exposes `installed`, `refused`, `half`, `digest`.
//
// halfTileConstant -- YED_Tiled.js:2008 `Game_Map.prototype.isHalfTile` reads the static plugin
//   parameter YED_TiledParameters["Half-tile movement"] and lowercases it on every call. The map
//   geometry methods (tileWidth, tileHeight, width, height) each call it, and the movement and
//   collision chains call those methods several thousand times per frame on a busy map (the
//   device census counted 5,679 isHalfTile calls and 1,945 width / 1,274 height / 1,905 tileset
//   calls in one frame on map 92). The parameter is fixed at plugin load; no game file or plugin
//   writes YED_TiledParameters. The fast path evaluates the expression once at install and returns
//   that boolean. It refuses unless the source is the reviewed one and the plugin parameter object
//   exists, so a different YED build keeps the vanilla method.
//
// Only the boolean evaluation is hoisted. Every geometry method itself, including YED's overrides
// and the live `tiledData` getter, stays untouched.
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
  var stats = api.halfTileConstant = api.halfTileConstant || {};
  stats.installed = !!stats.installed;
  stats.refused = null;
  stats.half = null;

  function digest(fn) {
    if (typeof fn !== 'function') return '';
    var crypto = root.__pmjsBuiltinRequire ? root.__pmjsBuiltinRequire('crypto')
      : (typeof require === 'function' ? require('crypto') : null);
    if (!crypto) return '';
    return crypto.createHash('sha256')
      .update(Function.prototype.toString.call(fn).replace(/\r\n/g, '\n')).digest('hex');
  }

  // SHA-256 of the LF-normalized Function.prototype.toString of YED_Tiled.js:2008.
  var PIN = 'd70c76e7841074447fc5ccd4295d0e2a5fb2a71d8a7bdb1860b15ab93fe5ac0b';

  function refuse(method) {
    stats.refused = method;
    console.log('[omori-perf] halfTileConstant refused: ' + method);
  }

  function install() {
    if (stats.installed) return;
    if (typeof root.Game_Map !== 'function' || !root.Game_Map.prototype ||
        typeof root.Game_Map.prototype.isHalfTile !== 'function') {
      refuse('Game_Map.prototype.isHalfTile');
      return;
    }
    var disabled = String(env('OMORI_PERF_DISABLE') || '').split(',');
    if (disabled.some(function (name) { return name.trim() === 'halfTileConstant'; })) {
      refuse('disabled by OMORI_PERF_DISABLE');
      return;
    }
    var original = root.Game_Map.prototype.isHalfTile;
    stats.digest = digest(original);
    if (stats.digest !== PIN) {
      refuse('Game_Map.prototype.isHalfTile source ' + stats.digest);
      return;
    }
    // Evaluate the reviewed expression once, through the plugin's own closure. The parameter
    // object need not be a global.
    var half;
    try {
      half = original.call(root.$gameMap || {});
    } catch (error) {
      refuse('Game_Map.prototype.isHalfTile threw: ' + error.message);
      return;
    }
    if (typeof half !== 'boolean') {
      refuse('Game_Map.prototype.isHalfTile returned ' + typeof half);
      return;
    }
    root.Game_Map.prototype.isHalfTile = function () { return half; };
    stats.half = half;
    stats.installed = true;
    console.log('[omori-perf] halfTileConstant installed (' + half + ')');
  }

  if (root.PMJS && root.PMJS.phases && typeof root.PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.perf.tile-fastpaths', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
