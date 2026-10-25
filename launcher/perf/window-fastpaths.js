// Window construction fast paths for OMORI on slow hardware. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=windowParts` turns it
// off; `OmoriPerf.windowParts.enabled = false` does it at runtime.
//
// Every Window_Base is built with three full _refreshAllParts passes:
//   1. the windowskin load listener fires while the window is still 0x0;
//   2. move() sets the real width/height and refreshes at the final size;
//   3. updatePadding() assigns `padding = standardPadding()`, and the padding setter refreshes
//      even when the value is unchanged (the default 18 was already written by initialize).
// Pass 1 builds bitmaps that are never presented; pass 3 rebuilds the same back/frame/cursor
// bitmaps as pass 2 when the window's standard padding is 18, and when it is not, the pass 2
// layout used the wrong padding. The menu opens construct 10-15 windows, so the duplicate work
// is paid inside the single menu-open tick.
//
// Fixes, all pixel-preserving:
//   * skip the windowskin-load refresh while the window has no size (the later move() pass builds
//     the parts with the loaded skin);
//   * seed _padding with standardPadding() immediately before the move() that runs inside
//     Window_Base.initialize, so the move refresh lays out with the final padding;
//   * make the padding setter a no-op when the value is unchanged, so updatePadding() does not
//     repeat that move refresh.
// The move refresh itself is untouched, and a real padding change still refreshes as before.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { windowParts: { installed: false, enabled: true, disabled: false,
    paddingSkips: 0, skinSkips: 0, preseeds: 0, refused: null } };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.windowParts = stats.windowParts;

  var installed = false;

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.windowParts.refused = reason;
    console.log('[omori-perf] window parts refused: ' + reason);
  }

  function install() {
    if (installed) return;
    if (wasDisabled('windowParts')) {
      stats.windowParts.disabled = true;
      console.log('[omori-perf] window parts disabled');
      return;
    }
    var padding, initialize, move, skin;
    try {
      padding = Object.getOwnPropertyDescriptor(Window.prototype, 'padding');
      initialize = Window_Base.prototype.initialize;
      move = Window.prototype.move;
      skin = Window.prototype._onWindowskinLoad;
    } catch (error) {
      refuse(String((error && error.message) || error));
      return;
    }
    if (!padding || typeof padding.set !== 'function' ||
        typeof initialize !== 'function' || typeof move !== 'function' || typeof skin !== 'function') {
      refuse('window initialization methods missing');
      return;
    }
    installed = true;

    function active() {
      return stats.windowParts.enabled && !stats.windowParts.disabled;
    }

    Object.defineProperty(Window.prototype, 'padding', {
      get: padding.get,
      set: function (value) {
        if (active() && this._padding === value) {
          stats.windowParts.paddingSkips++;
          return;
        }
        return padding.set.call(this, value);
      },
      configurable: true
    });

    Window.prototype._onWindowskinLoad = function () {
      if (active() && (this._width <= 0 || this._height <= 0)) {
        stats.windowParts.skinSkips++;
        return;
      }
      return skin.apply(this, arguments);
    };

    Window_Base.prototype.initialize = function () {
      this._omoriWindowInit = true;
      try {
        return initialize.apply(this, arguments);
      } finally {
        this._omoriWindowInit = false;
      }
    };

    Window_Base.prototype.move = function () {
      if (active() && this._omoriWindowInit) {
        var value = null;
        try { value = this.standardPadding(); } catch (error) { value = null; }
        if (typeof value === 'number') {
          this._padding = value;
          stats.windowParts.preseeds++;
        }
      }
      return move.apply(this, arguments);
    };

    stats.windowParts.installed = true;
    console.log('[omori-perf] window parts fast paths installed');
  }

  root.OmoriPerfWindowFastpaths = { stats: stats, installForTest: install };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.window-fastpaths', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
