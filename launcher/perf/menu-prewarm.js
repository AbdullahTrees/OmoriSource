// Menu prewarm for OMORI on slow hardware. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=menuPrewarm` turns it
// off; `OmoriPerf.menuPrewarm.enabled = false` does it at runtime.
//
// The first menu open in a session costs ~0.65-0.78 s because the scene transition, window
// construction and first render share one tick and pay the one-time GLSL compile/link for the
// menu blur and window programs, V8 compilation of the menu path and the first glyph layouts.
//
// This builds the menu and options scene graphs once at the first map start, before the player
// can open the menu, then renders them to an offscreen render texture (same native submit and
// filters; no screen pixels change) and destroys the throwaway scenes.
//
// The earlier version called start()/update() on the throwaway menu. That let the player's live
// input run menu commands at map load and corrupt events/config, so this version is deliberately
// inert: no start(), no update(), every created window is deactivated immediately, and the
// render is deferred until ImageManager.isReady() (or a bounded frame cap) so the menu atlases,
// not just the code paths, are warm. SceneManager._nextScene and the scene stack are never
// touched; the throwaway scenes never enter the live scene tree.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { menuPrewarm: {
    installed: false, enabled: true, disabled: false,
    attempted: false, completed: false, ready: false, usedPlaceholder: false,
    renderMenu: false, renderOptions: false, framesWaited: 0,
    menuMs: 0, optionsMs: 0, renderMs: 0, totalMs: 0,
    errors: [], refused: null
  } };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.menuPrewarm = stats.menuPrewarm;

  // At most two seconds of map frames (60 Hz) before rendering regardless of image readiness.
  var MAX_WAIT_FRAMES = 120;
  var installed = false, fired = false, pending = false;
  var menu = null, options = null, savedBackground = null, startedAt = 0;

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

  function deactivate(win) {
    try { if (win && typeof win.deactivate === 'function') win.deactivate(); }
    catch (error) { /* a throwaway window with no handlers */ }
  }

  function renderOffscreen(scene) {
    if (!scene || !root.PIXI || !PIXI.RenderTexture || !Graphics._renderer ||
        typeof Graphics._renderer.render !== 'function') return false;
    var texture = null;
    try {
      texture = PIXI.RenderTexture.create(Graphics.width, Graphics.height);
      Graphics._renderer.render(scene, texture);
      return true;
    } catch (error) {
      stats.menuPrewarm.errors.push('render:' + String(error && error.message || error));
      return false;
    } finally {
      if (texture) try { texture.destroy(true); } catch (error) { /* renderer owns it */ }
    }
  }

  function disposeScene(scene) {
    if (!scene) return;
    // No texture flags: these window sprites reference shared windowskin/font textures.
    try { scene.destroy({ children: true }); }
    catch (error) { stats.menuPrewarm.errors.push('dispose:' + String(error && error.message || error)); }
  }

  function finish() {
    pending = false;
    disposeScene(options);
    disposeScene(menu);
    options = null;
    menu = null;
    SceneManager._backgroundBitmap = savedBackground;
    savedBackground = null;
    stats.menuPrewarm.completed = true;
    stats.menuPrewarm.totalMs = Math.round(performance.now() - startedAt);
    console.log('[omori-perf] menu prewarm ' + stats.menuPrewarm.totalMs + ' ms' +
      ' ready=' + stats.menuPrewarm.ready + ' frames=' + stats.menuPrewarm.framesWaited +
      ' render=' + stats.menuPrewarm.renderMenu + '/' + stats.menuPrewarm.renderOptions +
      (stats.menuPrewarm.errors.length ? ' errors=' + stats.menuPrewarm.errors.join(';') : ''));
  }

  function tryFinish() {
    if (!pending) return;
    stats.menuPrewarm.framesWaited++;
    var ready = true;
    try { if (root.ImageManager && typeof ImageManager.isReady === 'function') ready = !!ImageManager.isReady(); }
    catch (error) { ready = true; }
    if (!ready && stats.menuPrewarm.framesWaited < MAX_WAIT_FRAMES) return;
    stats.menuPrewarm.ready = ready;
    var renderStarted = performance.now();
    stats.menuPrewarm.renderMenu = renderOffscreen(menu);
    if (options) stats.menuPrewarm.renderOptions = renderOffscreen(options);
    stats.menuPrewarm.renderMs = Math.round(performance.now() - renderStarted);
    finish();
  }

  function startPrewarm() {
    stats.menuPrewarm.attempted = true;
    startedAt = performance.now();
    savedBackground = SceneManager._backgroundBitmap;
    if (!savedBackground) {
      SceneManager._backgroundBitmap = new Bitmap(Graphics.width, Graphics.height);
      stats.menuPrewarm.usedPlaceholder = true;
    }
    try {
      var menuStarted = performance.now();
      menu = new Scene_Menu();
      menu.create();
      deactivate(menu._commandWindow);
      deactivate(menu._statusWindow);
      stats.menuPrewarm.menuMs = Math.round(performance.now() - menuStarted);
    } catch (error) {
      stats.menuPrewarm.errors.push('menu:' + String(error && error.message || error));
    }
    if (typeof Scene_OmoMenuOptions === 'function' && menu) {
      try {
        var optionsStarted = performance.now();
        options = new Scene_OmoMenuOptions();
        options.setCommandWindow(menu._commandWindow);
        options.setStatusWindow(menu._statusWindow);
        options.create();
        var windows = options.optionWindows ? options.optionWindows() : [];
        for (var i = 0; i < windows.length; i++) deactivate(windows[i]);
        deactivate(options._optionCategoriesWindow);
        deactivate(options._commandWindow);
        stats.menuPrewarm.optionsMs = Math.round(performance.now() - optionsStarted);
      } catch (error) {
        stats.menuPrewarm.errors.push('options:' + String(error && error.message || error));
        options = null;
      }
    }
    pending = true;
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
    var update = Scene_Map.prototype.update;
    if (typeof start !== 'function' || typeof update !== 'function') {
      refuse('Scene_Map lifecycle methods missing');
      return;
    }
    Scene_Map.prototype.start = function () {
      var result = start.apply(this, arguments);
      if (!fired && active()) {
        fired = true;
        try { startPrewarm(); } catch (error) {
          stats.menuPrewarm.errors.push('start:' + String(error && error.message || error));
          pending = false;
        }
      }
      return result;
    };
    Scene_Map.prototype.update = function () {
      var result = update.apply(this, arguments);
      if (pending) {
        try { tryFinish(); } catch (error) {
          stats.menuPrewarm.errors.push('update:' + String(error && error.message || error));
          finish();
        }
      }
      return result;
    };
    stats.menuPrewarm.installed = true;
    console.log('[omori-perf] menu prewarm installed');
  }

  root.OmoriPerfMenuPrewarm = { stats: stats, installForTest: install };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.menu-prewarm', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
