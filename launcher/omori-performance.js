// Runtime performance patch for slow hardware. Game files stay byte-identical.
//
// PMJS loads it with `--patch launcher/omori-performance.js`; NW.js loads it through
// launcher/compat.js when OMORI_PERF_SPRITES=1 (desktops don't need it). OMORI_PERF_SPRITES=0
// disables it under either runtime.
//
// Faraway interiors are single 90x80-tile maps holding every room, with ~165 events. Each event
// has a character sprite plus a YED_Tiled reflection sprite, and all of them ran a full update twice
// per frame although ~95% are off screen or invisible: ~28 ms of a 72 ms frame on the RG40XX-H
// (research/pmjs-performance/house-profile-study.md). Game logic (Game_Event, interpreters,
// movement) is untouched. Only the routine per-step update of sprites that cannot be seen is
// skipped, and the parts of a sprite update that feed back into game state are kept:
//   * sprites with an animation, balloon or event icon requested or playing always update fully;
//   * a skipped sprite still runs updateAnimation, which clears its character's animation, balloon
//     and icon "playing" flags as in vanilla (cutscene waits depend on those flags);
//   * GTP_OmoriFixes' staggered mini-label countdown keeps running, and sprites whose label is shown
//     or due always update fully;
//   * only updates coming from Spriteset_Map.update are skipped; direct sprite.update() calls
//     (YEP_EventMorpher, YEP_EventSpawner) always run in full;
//   * a sprite is updated fully at least once before it can be skipped, and again on the step it
//     comes back into view, before that frame is drawn.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  if (env('OMORI_PERF_SPRITES') === '0') return;

  // Counters for measuring the patch: full updates and the two kinds of skipped update.
  // `enabled` can be cleared at runtime to compare against vanilla behaviour in one session.
  var stats = root.OmoriPerformance = { installed: false, enabled: true, full: 0, offscreen: 0, reflections: 0 };
  // Off-screen margin in pixels, on top of twice the sprite's frame size.
  var MARGIN = 96;
  // True while Spriteset_Map.update runs; plainView when the map is drawn unscaled and unshaken.
  var inSpriteset = false, plainView = false;

  function busy(sprite, character) {
    return character.animationId() > 0 || character.balloonId() > 0 ||
      (typeof character.eventconId === 'function' && character.eventconId() > 0) ||
      sprite.isAnimationPlaying() || sprite.isBalloonPlaying() ||
      (typeof sprite.isEventconPlaying === 'function' && sprite.isEventconPlaying());
  }

  // YEP_EventMiniLabel + GTP_OmoriFixes: a label is created once its countdown (_labelDelay) runs
  // out, and is attached to the spriteset while its text is not empty. After a sprite's first full
  // update it either has its label, a pending countdown, or no label plugin is installed.
  function labelAllowsSkip(sprite) {
    // The lazy-label patch records a page that can never show a label by setting this flag
    // (no window is constructed). That is exactly the state in which vanilla would have an
    // empty unparented window, so the sprite is safe to skip.
    if (sprite._omoriMiniLabelAbsent) return true;
    var label = sprite._miniLabel;
    if (label) return !label.parent && label._text === '';
    if (sprite._labelDelay === undefined) return typeof sprite.setupMiniLabel !== 'function';
    return sprite._labelDelay > 0;
  }

  function skip(sprite) {
    if (!sprite._miniLabel && sprite._labelDelay > 0) sprite._labelDelay--;
    sprite.updateAnimation();
  }

  function offscreen(sprite, character) {
    var frame = sprite._frame, scale = Math.max(Math.abs(sprite.scale.x), Math.abs(sprite.scale.y), 1);
    var m = MARGIN + 2 * Math.max(frame.width, frame.height) * scale;
    var x = character.screenX(), y = character.screenY();
    return x < -m || y < -m || x > Graphics.width + m || y > Graphics.height + m;
  }

  var installTimer = null, installWaits = 0;

  function install() {
    if (stats.installed) {
      if (installTimer) { clearInterval(installTimer); installTimer = null; }
      return;
    }
    if (typeof Sprite_Character !== 'function' || typeof Spriteset_Map !== 'function' ||
        typeof Game_Event !== 'function') {
      // The afterPlugins phase has fired before the core classes in some bootstraps. Retry
      // instead of silently leaving every sprite on the full update path.
      if (!installTimer) {
        console.log('[omori-perf] sprite culling waiting for core classes');
        installTimer = setInterval(install, 100);
      }
      if (++installWaits > 100) {
        clearInterval(installTimer); installTimer = null;
        console.log('[omori-perf] sprite culling unavailable: core classes missing');
      }
      return;
    }
    if (installTimer) { clearInterval(installTimer); installTimer = null; }
    stats.installed = true;
    console.log('[omori-perf] sprite culling installed');

    var spritesetUpdate = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function () {
      var outer = inSpriteset, outerView = plainView;
      inSpriteset = true;
      plainView = this.scale.x === 1 && this.scale.y === 1 && $gameScreen.zoomScale() === 1 &&
        !(SceneManager._windowShakeDuration > 0);
      try { return spritesetUpdate.apply(this, arguments); }
      finally { inSpriteset = outer; plainView = outerView; }
    };

    var characterUpdate = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function () {
      var character = this._character;
      if (stats.enabled && inSpriteset && plainView && this._omoriUpdated && character instanceof Game_Event &&
          !busy(this, character) && labelAllowsSkip(this) && offscreen(this, character)) {
        skip(this);
        stats.offscreen++;
        return;
      }
      this._omoriUpdated = true;
      stats.full++;
      return characterUpdate.apply(this, arguments);
    };

    // YED_Tiled's Sprite_CharacterReflect is module-private: patch its prototype from the first
    // instance. Its update is a full Sprite_Character update followed by
    // `visible = character.reflections.length > 0`; without reflections it stays invisible.
    var createCharacters = Spriteset_Map.prototype.createCharacters;
    var reflectPatched = false;
    Spriteset_Map.prototype.createCharacters = function () {
      var result = createCharacters.apply(this, arguments);
      if (!reflectPatched) {
        var reflect = (this._characterSprites || []).find(function (sprite) {
          return sprite && sprite.constructor && sprite.constructor.name === 'Sprite_CharacterReflect';
        });
        if (reflect) {
          reflectPatched = true;
          var proto = Object.getPrototypeOf(reflect), reflectUpdate = proto.update;
          proto.update = function () {
            var character = this._character;
            if (stats.enabled && inSpriteset && this._omoriUpdated && !this.visible && character &&
                !(character.reflections && character.reflections.length > 0) &&
                !busy(this, character) && labelAllowsSkip(this)) {
              skip(this);
              stats.reflections++;
              return;
            }
            return reflectUpdate.apply(this, arguments);
          };
        }
      }
      return result;
    };
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.performance', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires, and this listener is
    // registered before main.js starts the game from window.onload.
    window.addEventListener('load', install);
  }
})();
