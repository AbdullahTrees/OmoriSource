// Message window fast paths for OMORI on slow hardware. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=messageSettings`
// turns it off; `OmoriPerf.messageSettings.enabled = false` does it at runtime.
//
// YEP_MessageCore.adjustWindowSettings runs at the start of every message and on every page.
// It assigns windowWidth()/min(windowHeight(), boxHeight) to width/height unconditionally, and
// every assignment changes nothing in map mode (the message window is 608x112 for four lines)
// but calls Window._refreshAllParts: a new ~600x104 back bitmap, a new ~608x112 frame bitmap,
// a full windowskin blit and tile loop, plus cursor/arrow/contents rebuilds. It then calls
// createContents for a fresh contents bitmap. A two-page named message pays that at least twice
// per page although the size and contents size never changed.
//
// This wrapper reproduces the same final width, height and x, but assigns width/height only when
// the value differs, so the full back/frame/cursor rebuild is skipped on a page whose size did
// not change. createContents() is still called every time: besides allocating the bitmap it
// resets the font face/size and text colour, and skipping it left the next page drawn with a
// stale (fully transparent) colour state while the typewriter advanced normally. When a face,
// name box or line count really changes the size, the original assignments still happen.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  // SHA-256 of Function.prototype.toString of Window_Message.adjustWindowSettings as composed by
  // YEP_MessageCore.js (LF normalised), from the same game copy used for the device run.
  var PIN = {
    'Window_Message.adjustWindowSettings':
      'cd29da521e6905dafe38cbbb7dd6eb42d12bacfe6bda0f7e9151874d651261f1'
  };

  var stats = { messageSettings: { installed: false, enabled: true, disabled: false,
    skipped: 0, resized: 0, contentsRecreated: 0, full: 0, refused: null } };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.messageSettings = stats.messageSettings;

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

  function pinOk(method, fn) {
    return acceptPins || (typeof fn === 'function' && digest(fn) === PIN[method]);
  }

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.messageSettings.refused = reason;
    console.log('[omori-perf] message settings refused: ' + reason);
  }

  function install(withTestPins) {
    if (installed) return;
    installed = true;
    acceptPins = withTestPins === true;
    if (wasDisabled('messageSettings')) {
      stats.messageSettings.disabled = true;
      console.log('[omori-perf] message settings disabled');
      return;
    }
    var proto = root.Window_Message && Window_Message.prototype;
    var original = proto && proto.adjustWindowSettings;
    if (typeof proto === 'undefined' || typeof original !== 'function') {
      refuse('Window_Message.adjustWindowSettings missing');
      return;
    }
    if (!pinOk('Window_Message.adjustWindowSettings', original)) {
      refuse('Window_Message.adjustWindowSettings does not match the reviewed source');
      return;
    }
    proto.adjustWindowSettings = function () {
      var item = stats.messageSettings;
      if (!item.enabled || item.disabled) {
        item.full++;
        return original.apply(this, arguments);
      }
      var width = this.windowWidth();
      var height = Math.min(this.windowHeight(), Graphics.boxHeight);
      if (Math.abs(Graphics.boxHeight - height) < this.lineHeight()) height = Graphics.boxHeight;
      var resized = this.width !== width || this.height !== height;
      if (this.width !== width) this.width = width;
      if (this.height !== height) this.height = height;
      // Always recreate. Stock createContents also resets the font face/size and text colour;
      // skipping it left a page drawn with the previous page's font/colour state, which showed
      // as fully transparent text while the typewriter advanced normally.
      this.createContents();
      item.contentsRecreated++;
      this.x = (Graphics.boxWidth - this.width) / 2;
      if (resized) item.resized++;
      else item.skipped++;
    };
    stats.messageSettings.installed = true;
    console.log('[omori-perf] message settings guard installed');
  }

  root.OmoriPerfMessageFastpaths = {
    pin: PIN,
    stats: stats,
    installForTest: function (acceptPinsForTest) { install(acceptPinsForTest === true); }
  };

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.message-fastpaths', function () { install(false); });
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', function () { install(false); });
  }
})();
