// Menu window refresh guard for OMORI on slow hardware. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=menuParts` turns it
// off; `OmoriPerf.menuParts.enabled = false` does it at runtime.
//
// The options scene builds four full option windows (GENERAL, AUDIO, CONTROLS, SYSTEM) and shows
// one. Opening and closing the scene tweens `height` on all four for 15 frames; every height
// write calls Window._refreshAllParts, which allocates fresh back/frame bitmaps and blits the
// window skin and borders again. The three invisible windows rebuild ~1.5 MB of native surfaces
// per frame for pixels that are never drawn -- about 93 MB across one show+hide, and the largest
// measured cost of the options-open transition.
//
// A hidden window's back/frame bitmaps are never drawn, so their rebuild is deferred: while the
// window has no parent or is invisible, _refreshAllParts records that the parts are stale and
// returns. The category window's callUpdateHelp is the one place that makes an option window
// visible; immediately after its original body, each newly visible window with stale parts is
// refreshed once at its current size. The visible window (the one whose height is being
// animated) always refreshes exactly as before, so the open/close animation is unchanged.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { menuParts: { installed: false, enabled: true, disabled: false,
    skipped: 0, full: 0, refreshed: 0, contentsDeferred: 0, contentsRefreshed: 0,
    refused: null } };
  var installed = false;

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.menuParts.refused = reason;
    console.log('[omori-perf] menu window refresh guard refused: ' + reason);
  }

  function install() {
    if (installed) return;
    if (wasDisabled('menuParts')) {
      stats.menuParts.disabled = true;
      console.log('[omori-perf] menu window refresh guard disabled');
      return;
    }
    var classes;
    try {
      if (typeof Window_OmoMenuOptionsGeneral !== 'function' ||
          typeof Window_OmoMenuOptionsAudio !== 'function' ||
          typeof Window_OmoMenuOptionsControls !== 'function' ||
          typeof Window_OmoMenuOptionsSystem !== 'function' ||
          typeof Window_OmoMenuOptionsCategory !== 'function') {
        refuse('option window classes missing');
        return;
      }
      classes = [Window_OmoMenuOptionsGeneral, Window_OmoMenuOptionsAudio,
        Window_OmoMenuOptionsControls, Window_OmoMenuOptionsSystem];
      for (var c = 0; c < classes.length; c++) {
        if (typeof classes[c].prototype._refreshAllParts !== 'function') {
          refuse('_refreshAllParts missing on ' + (classes[c].name || 'option window'));
          return;
        }
      }
      if (typeof Window_OmoMenuOptionsCategory.prototype.callUpdateHelp !== 'function') {
        refuse('category callUpdateHelp missing');
        return;
      }
    } catch (error) {
      refuse(String((error && error.message) || error));
      return;
    }
    installed = true;

    function deferred(win) {
      if (!stats.menuParts.enabled || stats.menuParts.disabled) return false;
      if (!win.visible || !win.parent) {
        win._omoriMenuPartsDirty = true;
        stats.menuParts.skipped++;
        return true;
      }
      return false;
    }

    classes.forEach(function (cls) {
      var proto = cls.prototype;
      var original = proto._refreshAllParts;
      proto._refreshAllParts = function () {
        if (deferred(this)) return;
        this._omoriMenuPartsDirty = false;
        stats.menuParts.full++;
        return original.apply(this, arguments);
      };
      // The option list's text, key prompts and volume bars are drawn by refresh() in the
      // constructor although only one of the four windows is visible. Drawing a hidden window's
      // contents is invisible work; defer it until callUpdateHelp makes that window visible.
      var refresh = proto.refresh;
      if (typeof refresh === 'function') {
        proto.refresh = function () {
          if (stats.menuParts.enabled && !stats.menuParts.disabled &&
              (!this.visible || !this.parent)) {
            this._omoriMenuContentDirty = true;
            stats.menuParts.contentsDeferred++;
            return;
          }
          this._omoriMenuContentDirty = false;
          return refresh.apply(this, arguments);
        };
      }
    });

    var callUpdateHelp = Window_OmoMenuOptionsCategory.prototype.callUpdateHelp;
    Window_OmoMenuOptionsCategory.prototype.callUpdateHelp = function () {
      var result = callUpdateHelp.apply(this, arguments);
      var windows = this._optionWindows || [];
      for (var i = 0; i < windows.length; i++) {
        var win = windows[i];
        if (!win || !win.visible || !win.parent) continue;
        if (win._omoriMenuPartsDirty) {
          win._omoriMenuPartsDirty = false;
          stats.menuParts.refreshed++;
          win._refreshAllParts();
        }
        if (win._omoriMenuContentDirty) {
          win._omoriMenuContentDirty = false;
          stats.menuParts.contentsRefreshed++;
          win.refresh();
        }
      }
      return result;
    };

    stats.menuParts.installed = true;
    root.OmoriPerf = root.OmoriPerf || {};
    root.OmoriPerf.menuParts = stats.menuParts;
    console.log('[omori-perf] menu window refresh guard installed');
  }

  root.OmoriPerfMenuFastpaths = { stats: stats, installForTest: install };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.menu-fastpaths', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
