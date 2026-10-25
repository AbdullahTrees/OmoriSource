// Menu background blur for OMORI on slow hardware. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=menuBackground`
// turns it off; `OmoriPerf.menuBackground.enabled = false` does it at runtime.
//
// GTP_OmoriFixes gives the pause menu and its sub-scenes a static screenshot of the map as
// their background, then blurs that sprite with a PIXI BlurFilter whose padding is set to 0.
// On PMJS the zero padding no longer matches the renderer's built-in BlurFilter contract, so
// the runtime generates, compiles and links the authored BlurX/BlurY GLSL programs on the
// first menu draw: 149 ms of the 645 ms first menu open on the RG40XX-H. The background is a
// still image that never changes after the snapshot, and the game already has a native blur
// for that bitmap -- Bitmap.blur(), the two additive box passes GTP applies to the background
// of every non-menu scene -- so the filter is per-frame work for an image that is already
// final.
//
// This module blurs the snapshot once with Bitmap.blur() and removes the BlurFilter from the
// background sprite before it is drawn. The menu background then uses the same native blur as
// the other scene backgrounds. The bitmap is blurred at most once per snapshot however many
// menu scenes share it, and a sprite carrying any other filter is left untouched.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { menuBackground: { installed: false, enabled: true, disabled: false,
    blurred: 0, filtersRemoved: 0, kept: 0, blurMs: 0, blurMaxMs: 0, errors: [], refused: null } };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.menuBackground = stats.menuBackground;

  var installed = false;
  var blurred = typeof WeakSet === 'function' ? new WeakSet() : null;

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.menuBackground.refused = reason;
    console.log('[omori-perf] menu background blur refused: ' + reason);
  }

  function backgroundBitmap() {
    try {
      if (typeof SceneManager !== 'undefined' &&
          typeof SceneManager.backgroundBitmap === 'function') {
        return SceneManager.backgroundBitmap() || null;
      }
    } catch (error) {
      // A missing background is handled like a scene without a snapshot: the sprite draws
      // nothing, so the filter can go without blurring anything.
    }
    return null;
  }

  function blurOnce(bitmap, item) {
    if (blurred && blurred.has(bitmap)) return true;
    if (typeof bitmap.blur !== 'function') {
      item.errors.push('blur:no Bitmap.blur');
      return false;
    }
    var started = performance.now();
    try {
      bitmap.blur();
    } catch (error) {
      // A partially blurred bitmap with the filter also removed would be worse than the
      // authored filter, so a failed blur keeps the sprite as it was.
      item.errors.push('blur:' + String(error && error.message || error));
      return false;
    }
    var elapsed = performance.now() - started;
    item.blurred++;
    item.blurMs += elapsed;
    if (elapsed > item.blurMaxMs) item.blurMaxMs = elapsed;
    if (blurred) blurred.add(bitmap);
    return true;
  }

  function afterCreate(scene) {
    var item = stats.menuBackground;
    if (!item.enabled || item.disabled) return;
    var sprite = scene && scene._backgroundSprite;
    if (!sprite) return;
    var filters = sprite.filters;
    // Only GTP's own background filter: the single BlurFilter it assigns as sprite.blur.
    // Any other filter (or filter stack) is not ours to remove and the bitmap is not touched.
    if (!filters || filters.length !== 1 || filters[0] !== sprite.blur) {
      item.kept++;
      return;
    }
    var bitmap = backgroundBitmap();
    if (bitmap && !blurOnce(bitmap, item)) return;
    sprite.filters = null;
    sprite.blur = null;
    item.filtersRemoved++;
  }

  function wrap(original) {
    return function () {
      var result = original.apply(this, arguments);
      try { afterCreate(this); } catch (error) {
        stats.menuBackground.errors.push('wrap:' + String(error && error.message || error));
      }
      return result;
    };
  }

  function install() {
    if (installed) return;
    if (wasDisabled('menuBackground')) {
      stats.menuBackground.disabled = true;
      console.log('[omori-perf] menu background blur disabled');
      return;
    }
    if (typeof Scene_Menu !== 'function' || typeof Scene_OmoMenuBase !== 'function' ||
        !Scene_Menu.prototype || !Scene_OmoMenuBase.prototype ||
        typeof Scene_Menu.prototype.createBackground !== 'function' ||
        typeof Scene_OmoMenuBase.prototype.createBackground !== 'function') {
      refuse('menu scene createBackground missing');
      return;
    }
    installed = true;
    Scene_Menu.prototype.createBackground = wrap(Scene_Menu.prototype.createBackground);
    Scene_OmoMenuBase.prototype.createBackground =
      wrap(Scene_OmoMenuBase.prototype.createBackground);
    stats.menuBackground.installed = true;
    console.log('[omori-perf] menu background blur installed');
  }

  root.OmoriPerfMenuBackground = { stats: stats, installForTest: install };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.menu-background', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
