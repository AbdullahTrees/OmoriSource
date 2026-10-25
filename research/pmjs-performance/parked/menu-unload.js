// Menu session unload for OMORI on PMJS. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=menuUnload` turns it
// off; `OmoriPerf.menuUnload.enabled = false` does it at runtime.
//
// Every pause-menu open builds a fresh scene: each window creates up to seven per-window 2D
// canvases (back, frame, cursor, contents, arrows, pause sign) and the options scene adds its
// own windows. MV's refresh methods replace those bitmaps without destroying the old ones, and
// Scene_Base.terminate is empty, so a closed menu session's canvases are only released when V8
// finalizes the garbage. Rapid open/close cycles outrun that finalization: the 2026-10-25 crash
// session opened menu and options nine times in twenty seconds, native canvas/GPU memory climbed
// with each scene, system memory fell to 95 MB available and the port watchdog killed PMJS.
//
// A forced full collection costs ~670 ms on this device and recovers only ~13 MB, so this module
// unloads the session directly. It records the windows created while a menu scene is being
// built, and when the menu returns to the map it releases their owned bitmap canvases (the
// scene tree itself is already empty at terminate in this game). Only bitmaps created by the
// game (no image URL) and not the shared SceneManager background snapshot are touched; the
// windows are unreachable after the close, so no live drawing can refer to them. The release is
// a set of native frees, not a garbage collection.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { menuUnload: { installed: false, enabled: true, disabled: false,
    windows: 0, bitmaps: 0, bytes: 0, releaseMs: 0, releaseMaxMs: 0, errors: [], refused: null } };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.menuUnload = stats.menuUnload;

  // Window._createAllParts and the _refresh* methods allocate these bitmaps per window.
  var WINDOW_SPRITES = ['_windowBackSprite', '_windowFrameSprite', '_windowCursorSprite',
    '_windowContentsSprite', '_downArrowSprite', '_upArrowSprite', '_windowPauseSignSprite'];
  var installed = false;
  var sessionWindows = [];
  var menuSession = false;

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.menuUnload.refused = reason;
    console.log('[omori-perf] menu session unload refused: ' + reason);
  }

  function sharedBackground() {
    try {
      if (typeof SceneManager !== 'undefined' && typeof SceneManager.backgroundBitmap === 'function') {
        return SceneManager.backgroundBitmap() || null;
      }
    } catch (error) { /* treated as no shared background */ }
    return null;
  }

  function releaseBitmap(bitmap, background, seen, item) {
    if (!bitmap || !bitmap._canvas) return;
    if (bitmap._url) return;
    if (bitmap === background) return;
    if (seen.indexOf(bitmap) >= 0) return;
    seen.push(bitmap);
    try {
      var canvas = bitmap._canvas;
      var width = Number(canvas.width) || 0, height = Number(canvas.height) || 0;
      item.bytes += width * height * 4;
      // PMJS's CanvasElement width setter releases the native canvas and its uploaded image;
      // every reference to this bitmap belongs to the closed window.
      canvas.width = 0;
      item.bitmaps++;
    } catch (error) {
      item.errors.push('bitmap:' + String(error && error.message || error));
    }
  }

  function releaseWindow(window, background, seen, item) {
    if (!window) return;
    releaseBitmap(window.contents, background, seen, item);
    for (var i = 0; i < WINDOW_SPRITES.length; i++) {
      var sprite = window[WINDOW_SPRITES[i]];
      if (sprite) releaseBitmap(sprite.bitmap, background, seen, item);
    }
    var arrows = window._windowArrowSprites;
    if (arrows && typeof arrows.length === 'number') {
      for (var index = 0; index < arrows.length; index++) {
        if (arrows[index]) releaseBitmap(arrows[index].bitmap, background, seen, item);
      }
    }
    if (window._tempCanvas) {
      try { window._tempCanvas.width = 0; item.bitmaps++; }
      catch (error) { item.errors.push('canvas:' + String(error && error.message || error)); }
    }
  }

  function unloadSession() {
    var item = stats.menuUnload;
    if (!item.enabled || item.disabled) return;
    var background = sharedBackground();
    var seen = [];
    var started = performance.now();
    while (sessionWindows.length) {
      releaseWindow(sessionWindows.pop(), background, seen, item);
      item.windows++;
    }
    menuSession = false;
    var elapsed = performance.now() - started;
    item.releaseMs += elapsed;
    if (elapsed > item.releaseMaxMs) item.releaseMaxMs = elapsed;
  }

  function trackWindow(window) {
    if (menuSession && window && window._windowBackSprite) sessionWindows.push(window);
  }

  function wrapCreate(original) {
    return function () {
      // Set before the original body runs: the scene builds its windows during create.
      menuSession = true;
      return original.apply(this, arguments);
    };
  }

  function wrapTerminate(original) {
    return function () {
      var result = original.apply(this, arguments);
      try {
        // A menu scene opened for options also terminates a menu; only the return to the map
        // ends the session.
        if (SceneManager.isNextScene(Scene_Map)) unloadSession();
      } catch (error) {
        stats.menuUnload.errors.push('unload:' + String(error && error.message || error));
      }
      return result;
    };
  }

  function install() {
    if (installed) return;
    if (wasDisabled('menuUnload')) {
      stats.menuUnload.disabled = true;
      console.log('[omori-perf] menu session unload disabled');
      return;
    }
    var menu = typeof Scene_Menu === 'function' ? Scene_Menu.prototype : null;
    var base = typeof Scene_OmoMenuBase === 'function' ? Scene_OmoMenuBase.prototype : null;
    var map = typeof Scene_Map === 'function' ? Scene_Map.prototype : null;
    var windowProto = typeof Window === 'function' ? Window.prototype : null;
    if (!menu || !base || !map || !windowProto ||
        typeof menu.create !== 'function' || typeof base.create !== 'function' ||
        typeof menu.terminate !== 'function' || typeof map.create !== 'function' ||
        typeof windowProto.initialize !== 'function' ||
        typeof SceneManager === 'undefined' || typeof SceneManager.isNextScene !== 'function') {
      refuse('Scene_Menu/Scene_OmoMenuBase/Scene_Map/Window hooks missing');
      return;
    }
    installed = true;
    menu.create = wrapCreate(menu.create);
    base.create = wrapCreate(base.create);
    menu.terminate = wrapTerminate(menu.terminate);
    var initialize = windowProto.initialize;
    windowProto.initialize = function () {
      var result = initialize.apply(this, arguments);
      try { trackWindow(this); } catch (error) {
        stats.menuUnload.errors.push('track:' + String(error && error.message || error));
      }
      return result;
    };
    // A session that ends somewhere other than the map drops its windows here, so no map window
    // created later can be recorded and released.
    var mapCreate = map.create;
    map.create = function () {
      menuSession = false;
      sessionWindows.length = 0;
      return mapCreate.apply(this, arguments);
    };
    stats.menuUnload.installed = true;
    console.log('[omori-perf] menu session unload installed');
  }

  root.OmoriPerfMenuUnload = { stats: stats, installForTest: install, unloadForTest: unloadSession };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.menu-unload', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
