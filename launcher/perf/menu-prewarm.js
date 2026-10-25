// Menu prewarm for OMORI on slow hardware. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=menuPrewarm` turns it
// off; `OmoriPerf.menuPrewarm.enabled = false` does it at runtime.
//
// The first menu open in a session costs ~0.65-0.75 s because the entire scene transition,
// window construction and first render happen in one tick, and that first tick also pays the
// one-time GLSL compile/link for the menu background blur and window programs, V8 compilation
// of the menu path and the first freetype glyph layouts. A measured open/close before the real
// one cuts the following open from ~780 ms to ~170 ms.
//
// This module builds the same scene graph once at the first map start -- before the player can
// see or open the menu -- renders it to an offscreen render texture (same native submit, same
// filters, no screen pixels change), then destroys the throwaway scene. The menu and options
// images it requests stay in ImageManager; the compressed cache state is what the real open
// reuses. It runs once per session, synchronously inside Scene_Map.start, so the cost lands on
// the map's loading/black frame instead of on the first menu open.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { menuPrewarm: { installed: false, enabled: true, disabled: false,
    prewarmed: false, menuMs: 0, optionsMs: 0, totalMs: 0, errors: [], refused: null } };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.menuPrewarm = stats.menuPrewarm;

  var installed = false, fired = false;

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.menuPrewarm.refused = reason;
    console.log('[omori-perf] menu prewarm refused: ' + reason);
  }

  function active() {
    return stats.menuPrewarm.enabled && !stats.menuPrewarm.disabled;
  }

  function renderOffscreen(scene) {
    if (!root.PIXI || !PIXI.RenderTexture || !Graphics._renderer ||
        typeof Graphics._renderer.render !== 'function') return false;
    var texture = PIXI.RenderTexture.create(Graphics.width, Graphics.height);
    try {
      Graphics._renderer.render(scene, texture);
      return true;
    } finally {
      try { texture.destroy(true); } catch (error) { /* renderer owns it */ }
    }
  }

  function disposeScene(scene) {
    if (!scene) return;
    try { scene.destroy({ children: true, texture: true, baseTexture: false }); }
    catch (error) { stats.menuPrewarm.errors.push('dispose:' + String(error && error.message || error)); }
  }

  function prewarm() {
    var started = performance.now();
    var savedBackground = SceneManager._backgroundBitmap;
    var menu = null, options = null;
    try {
      if (!savedBackground) SceneManager._backgroundBitmap = new Bitmap(1, 1);
      menu = new Scene_Menu();
      var menuStarted = performance.now();
      menu.create();
      try { menu.start(); } catch (error) { stats.menuPrewarm.errors.push('menuStart:' + String(error && error.message || error)); }
      try { menu.update(); } catch (error) { /* the render warms the rest */ }
      renderOffscreen(menu);
      stats.menuPrewarm.menuMs = Math.round(performance.now() - menuStarted);

      if (typeof Scene_OmoMenuOptions === 'function' && menu._commandWindow) {
        var optionsStarted = performance.now();
        try {
          options = new Scene_OmoMenuOptions();
          options.setCommandWindow(menu._commandWindow);
          options.setStatusWindow(menu._statusWindow);
          options.create();
          try { options.start(); } catch (error) { stats.menuPrewarm.errors.push('optionsStart:' + String(error && error.message || error)); }
          try { options.update(); } catch (error) { /* render warms the rest */ }
          renderOffscreen(options);
        } catch (error) {
          stats.menuPrewarm.errors.push('options:' + String(error && error.message || error));
        }
        stats.menuPrewarm.optionsMs = Math.round(performance.now() - optionsStarted);
      }
    } catch (error) {
      stats.menuPrewarm.errors.push('menu:' + String(error && error.message || error));
    } finally {
      disposeScene(options);
      disposeScene(menu);
      SceneManager._backgroundBitmap = savedBackground;
      stats.menuPrewarm.totalMs = Math.round(performance.now() - started);
      stats.menuPrewarm.prewarmed = true;
      console.log('[omori-perf] menu prewarm ' + stats.menuPrewarm.totalMs + ' ms' +
        (stats.menuPrewarm.errors.length ? ' errors=' + stats.menuPrewarm.errors.join(';') : ''));
    }
  }

  function install() {
    if (installed) return;
    if (wasDisabled('menuPrewarm')) {
      stats.menuPrewarm.disabled = true;
      console.log('[omori-perf] menu prewarm disabled');
      return;
    }
    if (typeof Scene_Map !== 'function' || typeof Scene_Menu !== 'function' ||
        typeof Bitmap !== 'function' || typeof SceneManager === 'undefined') {
      refuse('menu scene classes missing');
      return;
    }
    installed = true;
    var start = Scene_Map.prototype.start;
    if (typeof start !== 'function') {
      refuse('Scene_Map.start missing');
      return;
    }
    Scene_Map.prototype.start = function () {
      var result = start.apply(this, arguments);
      if (!fired && active()) {
        fired = true;
        try { prewarm(); } catch (error) {
          stats.menuPrewarm.errors.push('outer:' + String(error && error.message || error));
        }
      }
      return result;
    };
    stats.menuPrewarm.installed = true;
    console.log('[omori-perf] menu prewarm installed');
  }

  root.OmoriPerfMenuPrewarm = { stats: stats, installForTest: install, prewarmForTest: prewarm };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.menu-prewarm', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
