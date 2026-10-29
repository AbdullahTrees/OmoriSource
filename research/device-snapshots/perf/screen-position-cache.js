// Runtime performance patch: per-pass cache of Game_CharacterBase.screenX/screenY
// (screenPosCache item). Game files stay byte-identical.
//
// PMJS loads it with `--patch launcher/perf/screen-position-cache.js`; NW.js would load it through
// launcher/compat.js. Disable with OMORI_PERF_DISABLE=screenPosCache; counters on
// `root.OmoriPerf.screenPosCache` (`fast` = cache hits, `evaluated` = composed calls). Every
// cached method is pinned to the SHA-256 of Function.prototype.toString of the method as composed
// after all plugins load (LF-normalized; recorded below). If a pin does not match, the item
// installs nothing and logs `[omori-perf] screenPosCache refused: <method>`.
//
// Why it is behaviour-identical:
//
//   screenPosCache — the composed screenX/screenY (YEP_EventSpriteOffset wrapping fuku_testpack)
//     are pure reads: scrolledX/Y -> $gameMap.adjustX/Y(_realX/_realY), tileWidth/Height, shiftY,
//     jumpHeight, spriteOffsetX/Y. On the map-92 save the profile shows each sprite paying this
//     chain twice per frame — once in the omori-performance offscreen() culling test and again in
//     Sprite_Character.updatePosition (skipEvent and the full path both call it) — at ~1.4 ms of
//     the ~2.2 ms the chain costs per frame across 238 sprites.
//
//     The cache is trusted only inside one Spriteset_Map.update pass. Scene_Map.update runs
//     updateMain (Game_Map.update: all character movement, YEP_EventChasePlayer, GALV_CamControl
//     via Game_Map.updateScroll — the only camera-scroll writer) BEFORE Scene_Base.update ->
//     updateChildren -> Spriteset_Map.update, so every input to screenX/Y is frozen for the whole
//     pass. Within a pass the composed methods must therefore return the same value on every call
//     for a character, and caching them is value-identical. Outside the pass (event logic such as
//     GALV_EventDetectors distance checks) every call goes to the composed method uncached, so
//     mid-updateMain movement keeps vanilla semantics.
//
//     Each character carries hidden stamps `_omoriSxGen/_omoriSx/_omoriSyGen/_omoriSy`
//     (non-enumerable: saves keep vanilla's key set; a restored character simply misses and
//     recomputes). The generation counter only ever increases — it bumps on Spriteset_Map.update
//     entry and is not rewound on exit — so a nested pass (SceneManager.snapForBackground during
//     a transition) invalidates every earlier stamp conservatively rather than risking a stale
//     hit. Game_Vehicle.prototype.screenX/Y are own methods that shadow the wrapped ones and stay
//     vanilla. With `perf.enabled` false the
//     composed functions answer with no stamp writes, so toggling back is seamless.
//
// Pins (sha256 over the LF-normalized Function.prototype.toString source):
//
//   screenX  (YEP_EventSpriteOffset.js:146, wrapping fuku_testpack.js:42)   8517fd4aedfb5e85ba70b6448fe8d5fab8da1a0d66f040b191300a407a7571e7
//   screenY  (YEP_EventSpriteOffset.js:153, wrapping fuku_testpack.js:47)   2bae45de2b216adad1efd63923fd9f4405da46de38c250b6233733386341eca5
//
// The Spriteset_Map.prototype.update wrap is additive (set flag, bump generation, call through)
// and unpinned on purpose: its composition is a launcher-patch stack, not game state, and the wrap
// cannot change what the composed update does.

(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && root.NativeHost.runtime && typeof root.NativeHost.runtime.env === 'function') {
      return root.NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  if (env('OMORI_PERF') === '0') return;

  var disabled = {};
  String(env('OMORI_PERF_DISABLE') || '').split(',').forEach(function (name) {
    if (name) disabled[name.trim()] = true;
  });

  var requireFn = typeof root.__pmjsBuiltinRequire === 'function'
    ? root.__pmjsBuiltinRequire
    : (typeof require === 'function' ? require : null);
  function digest(fn) {
    if (typeof fn !== 'function') return '';
    var src = Function.prototype.toString.call(fn).replace(/\r\n/g, '\n');
    return requireFn('crypto').createHash('sha256').update(src).digest('hex');
  }
  function checkPins(item, pins) {
    for (var i = 0; i < pins.length; i++) {
      if (pins[i].digests.length && pins[i].digests.indexOf(digest(pins[i].fn)) < 0) {
        item.refused = pins[i].name;
        console.log('[omori-perf] screenPosCache refused: ' + pins[i].name +
          ' digest ' + (digest(pins[i].fn) || '(missing)'));
        return false;
      }
    }
    return true;
  }

  function install() {
    if (typeof root.Game_CharacterBase !== 'function' || typeof root.Spriteset_Map !== 'function') return;
    // logic-fastpaths.js assigns root.OmoriPerf at file load and runs its install after this
    // one's (module load order), so the counter entry is created here at install time, not in
    // the file body where a later module would clobber it.
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.screenPosCache) return;
    api.screenPosCache = { installed: false, refused: null, fast: 0, evaluated: 0 };
    var item = api.screenPosCache;
    if (disabled.screenPosCache) {
      item.refused = 'disabled by OMORI_PERF_DISABLE';
      return;
    }

    var Game_CharacterBase = root.Game_CharacterBase;
    if (!checkPins(item, [
      { name: 'screenX', fn: Game_CharacterBase.prototype.screenX,
        digests: ['8517fd4aedfb5e85ba70b6448fe8d5fab8da1a0d66f040b191300a407a7571e7'] },
      { name: 'screenY', fn: Game_CharacterBase.prototype.screenY,
        digests: ['2bae45de2b216adad1efd63923fd9f4405da46de38c250b6233733386341eca5'] }
    ])) return;

    var originalScreenX = Game_CharacterBase.prototype.screenX;
    var originalScreenY = Game_CharacterBase.prototype.screenY;

    // Hidden so JsonEx never sees them: saves keep vanilla's key set.
    function putHidden(obj, name, value) {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && !d.enumerable && d.writable) obj[name] = value;
      else Object.defineProperty(obj, name, {
        value: value, writable: true, enumerable: false, configurable: true
      });
    }

    var passActive = false, passGen = 0;

    var spritesetUpdate = root.Spriteset_Map.prototype.update;
    root.Spriteset_Map.prototype.update = function () {
      // passGen only ever increases: a nested pass (SceneManager.snapForBackground during a
      // transition) invalidates every earlier stamp rather than letting outer-pass reads reuse
      // values from before the nest.
      var outerActive = passActive;
      passActive = true;
      passGen++;
      try { return spritesetUpdate.apply(this, arguments); }
      finally { passActive = outerActive; }
    };

    Game_CharacterBase.prototype.screenX = function () {
      if (api.enabled === false) {
        item.evaluated++;
        return originalScreenX.call(this);
      }
      if (passActive && this._omoriSxGen === passGen) {
        item.fast++;
        return this._omoriSx;
      }
      item.evaluated++;
      var value = originalScreenX.call(this);
      if (passActive) {
        putHidden(this, '_omoriSxGen', passGen);
        putHidden(this, '_omoriSx', value);
      }
      return value;
    };
    Game_CharacterBase.prototype.screenY = function () {
      if (api.enabled === false) {
        item.evaluated++;
        return originalScreenY.call(this);
      }
      if (passActive && this._omoriSyGen === passGen) {
        item.fast++;
        return this._omoriSy;
      }
      item.evaluated++;
      var value = originalScreenY.call(this);
      if (passActive) {
        putHidden(this, '_omoriSyGen', passGen);
        putHidden(this, '_omoriSy', value);
      }
      return value;
    };

    item.installed = true;
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.screen-position-cache', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires.
    window.addEventListener('load', install);
  }
})();
