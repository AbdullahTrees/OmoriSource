// Runtime performance patch: dirty check on Sprite_Character.updateFrame (frameCache item).
// Game files stay byte-identical.
//
// PMJS loads it with `--patch launcher/perf/sprite-frame-cache.js`; NW.js would load it through
// launcher/compat.js. Disable with OMORI_PERF_DISABLE=frameCache; counters on
// `root.OmoriPerf.frameCache` (`fast` = skipped recomputes, `evaluated` = bodies run). Every
// method whose body the check skips through is pinned to the SHA-256 of Function.prototype.toString
// of the method as composed after all plugins load (LF-normalized; recorded below). If a pin does
// not match, the item installs nothing and logs `[omori-perf] frameCache refused: <method>`.
//
// Why it is behaviour-identical:
//
//   updateFrame recomputes the sprite's frame rectangle every frame for every sprite on the full
//   update path (~15 us each on the RG40XX-H, 1.5 ms of the 4.1 ms sprite main chain at the
//   map-92 save): pattern/block math through characterPatternX/Y and characterBlockX/Y, the bush
//   half-body sync in updateHalfBodySprites, and setFrame. The body is a pure function of the
//   sprite's bitmap (identity AND dimensions — a character sheet can finish loading between
//   frames), the tile id, the character's live characterIndex(), pattern() and direction(), the
//   bush depth, Omori BASE's single-frame flag, the sprite's blend colour and colour tone, and the
//   map tile size. None of these are written by the body itself, so when every one of them is
//   unchanged since the last run, re-running the body writes exactly the same frame it already
//   set — the skip is value-identical. When anything changed, the body runs exactly as vanilla.
//
//   The check compares LIVE reads (ch.pattern()/direction()/characterIndex()/isSingleFrame() go
//   through whatever composition the plugins installed) against stamps recorded on the last run —
//   so a slippery-tile or ExtraMovementFrames change of pattern(), a page refresh, a direction
//   turn, a bitmap swap or a tile-size event command all show up as a stamp miss and the body
//   reruns. The one-frame bush-depth lag vanilla has (updateOther writes this._bushDepth after
//   updateFrame has read it) is preserved because the stamp is the sprite's own field as read.
//   Blend colour and colour tone are compared by identity: setBlendColor/setColorTone replace the
//   arrays on every real change (and getBlendColor returns a clone, so no caller can reach the
//   internals).
//
//   Stamps (`_omoriFf*`) are non-enumerable: saves keep vanilla's key set; a restored sprite simply
//   misses once and recomputes. With `perf.enabled` false the body runs uncached and writes no
//   stamps, so toggling back is seamless. The wrapped chain ABOVE updateFrame (Omori BASE's
//   update bobble/input-icon/shadow adds, Liquid_EventIcons, YEP_EventMiniLabel) is untouched and
//   keeps running every frame as in vanilla.
//
// Pins (sha256 over the LF-normalized Function.prototype.toString source):
//
//   updateFrame            (rpg_sprites.js)            f9fa3e9e43adcbeea4ed8a637aa167b3d9a6f19eb9b040005345dce9c8619f91
//   updateTileFrame        (rpg_sprites.js)            37433297b83ed276333dc99a5aec8a20c950ad887a454d018a4cc8ac8140abdc
//   updateCharacterFrame   (Omori BASE.js:4758 wrap)   61f013f3e685102f24712e68f58e322320f9d8eeff9a2829c9f892eca7385b61
//   updateHalfBodySprites  (rpg_sprites.js)            47092631641a26aa9d3d7e9f80e1840b8f0fb9e12e6b2a3a454cb3788a16ff78
//   createHalfBodySprites  (rpg_sprites.js)            3f127fe97cf23fd85ffdb6cc7443ee9273c9b95789c0aea09aee45abc9c6ff71
//   characterBlockX        (rpg_sprites.js)            76d7c5af3b172bb03cb15aedf693673a32e4760c0c7a95a79bc420a5983317d1
//   characterBlockY        (rpg_sprites.js)            20953a88f0212e8821f2ed3cc0e3557ecf2988c1082a7c3dbc6444f89cea6de6
//   characterPatternX      (rpg_sprites.js)            d8367f4faa2dd88f43d512d35c9c2af9873798f219bac91f4589c9d88f1c6b95
//   characterPatternY      (rpg_sprites.js)            d82f8f1ef9c986740a1d6e0aed4c655f17a2847ddfe3305a5737859694d8c59d
//   patternWidth           (rpg_sprites.js)            46d44179ca8be450446e5486f0833d96341cccf2818bc772256de52f0ab5e3f6
//   patternHeight          (rpg_sprites.js)            6bcbe7b8a62bed13e40f7f299222c571593ee561cc9d1b6e484d0a006318d7d3

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
        console.log('[omori-perf] frameCache refused: ' + pins[i].name +
          ' digest ' + (digest(pins[i].fn) || '(missing)'));
        return false;
      }
    }
    return true;
  }

  function install() {
    if (typeof root.Sprite_Character !== 'function' || typeof root.$gameMap === 'undefined') return;
    // Counter entry created at install time, like screen-position-cache.js, so a module that
    // assigns root.OmoriPerf at file load cannot clobber it.
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.frameCache) return;
    api.frameCache = { installed: false, refused: null, fast: 0, evaluated: 0 };
    var item = api.frameCache;
    if (disabled.frameCache) {
      item.refused = 'disabled by OMORI_PERF_DISABLE';
      return;
    }

    var Sprite_Character = root.Sprite_Character;
    var p = Sprite_Character.prototype;
    if (!checkPins(item, [
      { name: 'updateFrame', fn: p.updateFrame,
        digests: ['f9fa3e9e43adcbeea4ed8a637aa167b3d9a6f19eb9b040005345dce9c8619f91'] },
      { name: 'updateTileFrame', fn: p.updateTileFrame,
        digests: ['37433297b83ed276333dc99a5aec8a20c950ad887a454d018a4cc8ac8140abdc'] },
      { name: 'updateCharacterFrame', fn: p.updateCharacterFrame,
        digests: ['61f013f3e685102f24712e68f58e322320f9d8eeff9a2829c9f892eca7385b61'] },
      { name: 'updateHalfBodySprites', fn: p.updateHalfBodySprites,
        digests: ['47092631641a26aa9d3d7e9f80e1840b8f0fb9e12e6b2a3a454cb3788a16ff78'] },
      { name: 'createHalfBodySprites', fn: p.createHalfBodySprites,
        digests: ['3f127fe97cf23fd85ffdb6cc7443ee9273c9b95789c0aea09aee45abc9c6ff71'] },
      { name: 'characterBlockX', fn: p.characterBlockX,
        digests: ['76d7c5af3b172bb03cb15aedf693673a32e4760c0c7a95a79bc420a5983317d1'] },
      { name: 'characterBlockY', fn: p.characterBlockY,
        digests: ['20953a88f0212e8821f2ed3cc0e3557ecf2988c1082a7c3dbc6444f89cea6de6'] },
      { name: 'characterPatternX', fn: p.characterPatternX,
        digests: ['d8367f4faa2dd88f43d512d35c9c2af9873798f219bac91f4589c9d88f1c6b95'] },
      { name: 'characterPatternY', fn: p.characterPatternY,
        digests: ['d82f8f1ef9c986740a1d6e0aed4c655f17a2847ddfe3305a5737859694d8c59d'] },
      { name: 'patternWidth', fn: p.patternWidth,
        digests: ['46d44179ca8be450446e5486f0833d96341cccf2818bc772256de52f0ab5e3f6'] },
      { name: 'patternHeight', fn: p.patternHeight,
        digests: ['6bcbe7b8a62bed13e40f7f299222c571593ee561cc9d1b6e484d0a006318d7d3'] }
    ])) return;

    var originalUpdateFrame = p.updateFrame;

    // Hidden so JsonEx never sees them: saves keep vanilla's key set.
    function putHidden(obj, name, value) {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && !d.enumerable && d.writable) obj[name] = value;
      else Object.defineProperty(obj, name, {
        value: value, writable: true, enumerable: false, configurable: true
      });
    }

    p.updateFrame = function () {
      if (api.enabled === false) {
        item.evaluated++;
        return originalUpdateFrame.call(this);
      }
      var ch = this._character;
      if (!ch) {
        item.evaluated++;
        return originalUpdateFrame.call(this);
      }
      // Live reads through whatever composition the plugins installed: a value change of any
      // kind (slippery pose, EMF state, page refresh, turn) is a stamp miss, never a stale hit.
      var pattern = ch.pattern(), direction = ch.direction(), single = ch.isSingleFrame();
      var charIndex = ch.characterIndex();
      var bm = this.bitmap, bw = bm ? bm.width : -1, bh = bm ? bm.height : -1;
      if (this._omoriFfBm === bm && this._omoriFfBw === bw && this._omoriFfBh === bh &&
          this._omoriFfIb === this._isBigCharacter && this._omoriFfT === this._tileId &&
          this._omoriFfP === pattern && this._omoriFfD === direction && this._omoriFfS === single &&
          this._omoriFfCi === charIndex &&
          this._omoriFfBd === this._bushDepth && this._omoriFfBl === this._blendColor &&
          this._omoriFfCt === this._colorTone &&
          this._omoriFfTw === $gameMap.tileWidth() && this._omoriFfTh === $gameMap.tileHeight()) {
        item.fast++;
        return;
      }
      item.evaluated++;
      var result = originalUpdateFrame.call(this);
      // Stamped after the run: a body that threw leaves no stamps and reruns next time.
      putHidden(this, '_omoriFfBm', bm);
      putHidden(this, '_omoriFfBw', bw);
      putHidden(this, '_omoriFfBh', bh);
      putHidden(this, '_omoriFfIb', this._isBigCharacter);
      putHidden(this, '_omoriFfT', this._tileId);
      putHidden(this, '_omoriFfP', pattern);
      putHidden(this, '_omoriFfD', direction);
      putHidden(this, '_omoriFfS', single);
      putHidden(this, '_omoriFfCi', charIndex);
      putHidden(this, '_omoriFfBd', this._bushDepth);
      putHidden(this, '_omoriFfBl', this._blendColor);
      putHidden(this, '_omoriFfCt', this._colorTone);
      putHidden(this, '_omoriFfTw', $gameMap.tileWidth());
      putHidden(this, '_omoriFfTh', $gameMap.tileHeight());
      return result;
    };

    item.installed = true;
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.sprite-frame-cache', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires.
    window.addEventListener('load', install);
  }
})();
