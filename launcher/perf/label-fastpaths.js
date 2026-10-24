// Mini-label construction fast path for OMORI. Game files stay byte-identical.
//
// Runtime-patch module; install shape matches launcher/omori-performance.js (PMJS
// `afterPlugins`, or window load under NW.js). `OMORI_PERF_DISABLE=miniLabelLazy` turns the
// item off; `OmoriPerf.miniLabelLazy` exposes `installed`, `enabled`, `taken`, `fallback`,
// `absent` and `checks` counters for A/B runs and tests.
//
// miniLabelLazy -- YEP_EventMiniLabel's Sprite_Character.setupMiniLabel constructs a
//   Window_EventMiniLabel for every character sprite (and every YED reflection sprite) as
//   soon as GTP's stagger delay reaches it, then throws the window away if its page has no
//   label (YEP_EventMiniLabel.js:514-524). On a large map that is hundreds of window objects
//   plus their text metrics on entry, and GT_OmoriFixes' stagger is what spreads that cost
//   over the first seconds of a map. A page without a mini-label comment can never show a
//   label: the empty window is not added to the spriteset, and only windows that are in the
//   spriteset get update() calls (Spriteset_Base.update -> Sprite.prototype.update -> GTP's
//   children loop), so its updatePage() never re-reads a later page. This fast path keeps a
//   per-sprite "absent" flag instead of the empty window and skips the construction.
//
//   The stagger bookkeeping is reproduced exactly, because it is observable: the delay is
//   initialised from the sprite's index and counted down on every setupMiniLabel call. If a
//   page changes during the delay, vanilla constructs the window with the page that is
//   current when the delay ends; the fast path checks the same page at the same moment.
//   Once a window exists (a page had a label), every call delegates, so page changes,
//   removals and later labels behave exactly as vanilla. A sprite whose construction moment
//   saw no label is marked absent permanently -- the same observable outcome as vanilla's
//   unparented empty window, which can never be updated into a label later.
//
// Pins are SHA-256 of Function.prototype.toString (CRLF normalised to LF) of each method as
// composed after all plugins loaded:
//   Sprite_Character.prototype.setupMiniLabel   be2ba889d49dfa50e82f510ade4a906548a5c6cbb45b7660a239fbe750682005
//     (GTP_OmoriFixes.js stagger wrapper around the YEP method)
//   Window_EventMiniLabel.prototype.gatherDisplayData  5e70c813568af68a2c1acd36156f62b7298ba7169a1ae871dd211f14ee2ec8b1
//   Window_EventMiniLabel.prototype.extractNotedata    0adafe72de12bb09833662668ee33a54a77afba2cff3463b491182175a407e87
//     (the page/comment grammar the lazy check mirrors)
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
  var stats = api.miniLabelLazy = api.miniLabelLazy || {};
  stats.installed = !!stats.installed;
  stats.taken = 0;
  stats.fallback = 0;
  stats.absent = 0;
  stats.checks = 0;
  if (stats.enabled === undefined) stats.enabled = true;

  var PINS = {
    setupMiniLabel: ['be2ba889d49dfa50e82f510ade4a906548a5c6cbb45b7660a239fbe750682005'],
    gatherDisplayData: ['5e70c813568af68a2c1acd36156f62b7298ba7169a1ae871dd211f14ee2ec8b1'],
    extractNotedata: ['0adafe72de12bb09833662668ee33a54a77afba2cff3463b491182175a407e87']
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

  function logRefusal(item, method) {
    console.log('[omori-perf] ' + item + ' refused: ' + method);
  }

  var MINI_LABEL_TAG = /<(?:MINI WINDOW|MINI LABEL):[ ](.*)>/i;

  // The one question vanilla's construction answers: would the current page produce
  // non-empty label text? Mirrors Window_EventMiniLabel.setCharacter/gatherDisplayData/
  // extractNotedata: only events gather, a missing page has no text, comment commands
  // 108/408 are concatenated and split by line, and the last <Mini Label: ...> line wins.
  function currentPageHasLabel(character) {
    if (!character || !character._eventId) return false;
    if (typeof character.page !== 'function' || typeof character.list !== 'function') return true;
    if (!character.page()) return false;
    var list = character.list();
    if (!list) return false;
    var comment = '';
    for (var i = 0; i < list.length; i++) {
      var command = list[i];
      if (!command || (command.code !== 108 && command.code !== 408)) continue;
      comment += String(command.parameters && command.parameters[0] !== undefined ?
        command.parameters[0] : '') + '\n';
    }
    if (comment === '') return false;
    var lines = comment.split(/[\r\n]+/);
    var text = '';
    for (var line = 0; line < lines.length; line++) {
      var match = MINI_LABEL_TAG.exec(lines[line]);
      if (match) text = match[1];
    }
    return text !== '';
  }

  function install() {
    if (stats.installed) return;
    if (typeof Sprite_Character !== 'function' || typeof Window_EventMiniLabel !== 'function') {
      console.log('[omori-perf] miniLabelLazy unavailable: core globals missing');
      return;
    }
    var disabled = String(env('OMORI_PERF_DISABLE') || '').split(',');
    var switchedOff = disabled.some(function (name) {
      return name.trim() === 'miniLabelLazy';
    });
    if (switchedOff) {
      logRefusal('miniLabelLazy', 'disabled by OMORI_PERF_DISABLE');
      return;
    }

    var composed = Sprite_Character.prototype.setupMiniLabel;
    var gather = Window_EventMiniLabel.prototype.gatherDisplayData;
    var extract = Window_EventMiniLabel.prototype.extractNotedata;
    if (!pinned('setupMiniLabel', composed)) {
      logRefusal('miniLabelLazy', 'Sprite_Character.prototype.setupMiniLabel');
      return;
    }
    if (!pinned('gatherDisplayData', gather) || !pinned('extractNotedata', extract)) {
      logRefusal('miniLabelLazy', 'Window_EventMiniLabel.prototype.gatherDisplayData/extractNotedata');
      return;
    }

    Sprite_Character.prototype.setupMiniLabel = function () {
      if (!stats.enabled) {
        stats.fallback++;
        return composed.apply(this, arguments);
      }
      // GTP_OmoriFixes' stagger, reproduced. The delay must run for label-less sprites too,
      // so a page change during the delay is handled on the same step as vanilla.
      if (!!this.parent && typeof this._labelDelay === 'undefined') {
        this._labelDelay = this.parent.getChildIndex(this);
      }
      if (this._labelDelay > 0) {
        this._labelDelay--;
        stats.taken++;
        return;
      }
      // A window that exists is vanilla's from here on (page changes, removals, text).
      if (this._miniLabel) {
        stats.fallback++;
        return composed.apply(this, arguments);
      }
      if (this._omoriMiniLabelAbsent) {
        stats.taken++;
        return;
      }
      if (!this._character) {
        stats.fallback++;
        return composed.apply(this, arguments);
      }
      stats.checks++;
      if (currentPageHasLabel(this._character)) {
        stats.fallback++;
        return composed.apply(this, arguments);
      }
      // Vanilla would build an empty, never-parented window here; remember that instead.
      this._omoriMiniLabelAbsent = true;
      stats.absent++;
      stats.taken++;
    };
    stats.installed = true;
    console.log('[omori-perf] miniLabelLazy installed');
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.label-fastpaths', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
