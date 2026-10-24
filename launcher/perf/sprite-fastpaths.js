// Sprite update fast paths for OMORI. Game files stay byte-identical.
//
// Runtime-patch module; install shape matches launcher/omori-performance.js (PMJS
// `afterPlugins`, or window load under NW.js). `OMORI_PERF_DISABLE=hiddenLeafSkip,horrorFastPath`
// turns individual items off; `OmoriPerf.hiddenLeafSkip` / `OmoriPerf.horrorFastPath` expose
// `installed`, `enabled`, `taken` and `fallback` counters for A/B runs and tests.
//
// Two independent items, each installed only if all of its pinned methods match the
// composition reviewed for OMORI 1.6.1 + the shipped plugins + the PMJS Olivia guard:
//
// hiddenLeafSkip -- YED_Tiled allocates 256 `Sprite_Base` priority tiles per Tiled map and
//   hides nearly all of them (`YED_Tiled.js:490-507`). Tilemap.update calls update() on every
//   one, every step. For such a sprite the whole vanilla chain is a no-op except one assignment:
//     Sprite_Base.update                  (rpg_sprites.js:24)
//       Sprite.prototype.update           (Olivia_HorrorEffects.js:981 = sync -> children -> effects)
//         synchronizeHorrorFiltersWithSource  no-op without `_horrorFiltersSource`
//         Olivia.HorrorEffects.___Sprite_update___  (GTP_OmoriFixes.js:1136) iterates `children`; empty
//         updateHorrorEffects             (Olivia dispatcher / PMJS guard) no-op without the three filters
//       updateVisibility()                sets `visible = !_hiding`, already false
//       updateAnimationSprites()          no-op on an empty `_animationSprites`
//   The skip reproduces the one write (`visible = !this._hiding`) and nothing else. A tile that
//   gets used goes through YED's `sprite.show()` (which sets `_hiding = false`), so the preconditions
//   fail and the full chain resumes on the next step, before the frame is drawn.
//
// horrorFastPath -- Olivia installs `Sprite.prototype.update` as sync -> delegate -> updateHorrorEffects
//   on every sprite (and GTP replaces the delegate with a children loop, so every container level
//   repeats it). With no `_horrorFiltersSource` the sync body does nothing; with none of the three
//   filters present every horror leaf is a no-op and the PMJS adapter's guard returns immediately.
//   The fast path re-issues GTP's live-iterating children loop unchanged, then calls the effects
//   dispatcher only if a child activated a filter or replaced a delegate during the traversal.
//
// Pins are SHA-256 of Function.prototype.toString (CRLF normalised to LF) of each method as
// composed after all plugins loaded:
//   Sprite.prototype.update (Olivia)             afc0c175fbd5adfb4ffc57345ca0aea27ec1338fe74789c2c3599dca1c001594
//   Sprite_Base.prototype.update                 fd9d2f86de93fece0c102aac5e1bb5aec263509403dc05be6d099db79a97f263
//   Sprite_Base.prototype.updateVisibility       2c3e4c95bd9c9c047755085370a835ac99d5eee56c5a30e10512d80f95efa1c7
//   Sprite_Base.prototype.updateAnimationSprites 30575574c798ac1d0086edb495a72ab561e65d4ae6090978004e1ed1a426a2fd
//   Olivia.HorrorEffects.___Sprite_update___     ed434d771eafc138202664abed6f2c0f86e3142910c285bf9ca7efdbabf4d4ef
//   Sprite.prototype.synchronizeHorrorFiltersWithSource e97a11a96fdaba2f99bfc3e769ab7dd15f7d9c152062c59a2654576da596b7ea
//   Sprite.prototype.updateHorrorEffects         5a2e127a3a66d10dbac9ea5a08ce2f600c8c51737d8e60141b8e3fab61f4b66f (Olivia)
//                                                9260befd5b45556ad2fa3d618ba31a782c7b84396828aad1f27a2839d2f270fe (PMJS guard)
//   updateHorrorNoise / Glitch / TV              5886848c86d64f40d6342cd985179c8d0f328e8d4231011f044ebcd3b8c2d686 /
//                                                1dfffbc540671e82481f9d99431290422c72a8c1b036a25c68e52708457b406c /
//                                                f5469ca6d318fe389e00824aa5daf6f698f3e4a300b21a79372910c5434f2254
//                                                (or the PMJS leaf guard 8f734831109ec0f2a9cf63d2a55070e7b674bc065846738a0647cfd5753c5b70)
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  // Counter objects double as the test/AB hook: setting `.enabled = false` makes the installed
  // wrapper call the original chain again without a reload.
  var api = root.OmoriPerf = root.OmoriPerf || {};
  var leafStats = api.hiddenLeafSkip = api.hiddenLeafSkip || {};
  var horrorStats = api.horrorFastPath = api.horrorFastPath || {};
  leafStats.installed = !!leafStats.installed;
  horrorStats.installed = !!horrorStats.installed;
  leafStats.taken = 0; leafStats.fallback = 0;
  horrorStats.taken = 0; horrorStats.fallback = 0;
  if (leafStats.enabled === undefined) leafStats.enabled = true;
  if (horrorStats.enabled === undefined) horrorStats.enabled = true;

  var PINS = {
    spriteUpdate: ['afc0c175fbd5adfb4ffc57345ca0aea27ec1338fe74789c2c3599dca1c001594'],
    spriteBaseUpdate: ['fd9d2f86de93fece0c102aac5e1bb5aec263509403dc05be6d099db79a97f263'],
    updateVisibility: ['2c3e4c95bd9c9c047755085370a835ac99d5eee56c5a30e10512d80f95efa1c7'],
    updateAnimationSprites: ['30575574c798ac1d0086edb495a72ab561e65d4ae6090978004e1ed1a426a2fd'],
    childrenLoop: ['ed434d771eafc138202664abed6f2c0f86e3142910c285bf9ca7efdbabf4d4ef'],
    synchronize: ['e97a11a96fdaba2f99bfc3e769ab7dd15f7d9c152062c59a2654576da596b7ea'],
    updateHorrorEffects: [
      '5a2e127a3a66d10dbac9ea5a08ce2f600c8c51737d8e60141b8e3fab61f4b66f', // Olivia_HorrorEffects.js:1051
      '9260befd5b45556ad2fa3d618ba31a782c7b84396828aad1f27a2839d2f270fe'  // PMJS dispatcher guard
    ],
    updateHorrorNoise: [
      '5886848c86d64f40d6342cd985179c8d0f328e8d4231011f044ebcd3b8c2d686', // Olivia_HorrorEffects.js:1088
      '8f734831109ec0f2a9cf63d2a55070e7b674bc065846738a0647cfd5753c5b70'  // PMJS leaf guard
    ],
    updateHorrorGlitch: [
      '1dfffbc540671e82481f9d99431290422c72a8c1b036a25c68e52708457b406c', // Olivia_HorrorEffects.js:1129
      '8f734831109ec0f2a9cf63d2a55070e7b674bc065846738a0647cfd5753c5b70'
    ],
    updateHorrorTV: [
      'f5469ca6d318fe389e00824aa5daf6f698f3e4a300b21a79372910c5434f2254', // Olivia_HorrorEffects.js:1243
      '8f734831109ec0f2a9cf63d2a55070e7b674bc065846738a0647cfd5753c5b70'
    ]
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

  // The exact set the vanilla chain inspects. A missing `_horrorFilters` would throw inside the
  // Olivia dispatcher, so it is a fallback rather than "empty".
  function hasHorrorFilters(sprite) {
    var filters = sprite._horrorFilters;
    return !filters || !!(filters.noiseFilter || filters.glitchFilter || filters.tvFilter);
  }

  function logRefusal(item, method) {
    console.log('[omori-perf] ' + item + ' refused: ' + method);
  }

  function install() {
    if (leafStats.installed && horrorStats.installed) return;
    if (typeof Sprite !== 'function' || typeof Sprite_Base !== 'function' || !root.Olivia ||
        !Olivia.HorrorEffects) {
      console.log('[omori-perf] sprite-fastpaths unavailable: core globals missing');
      return;
    }
    var disabled = String(env('OMORI_PERF_DISABLE') || '').split(',');
    function switchedOff(item) {
      return disabled.some(function (name) { return name.trim() === item; });
    }

    var spriteProto = Sprite.prototype, baseProto = Sprite_Base.prototype;
    var oliviaUpdate = spriteProto.update;
    var baseUpdate = baseProto.update;
    var updateVisibility = baseProto.updateVisibility;
    var updateAnimationSprites = baseProto.updateAnimationSprites;
    var childrenLoop = Olivia.HorrorEffects.___Sprite_update___;
    var synchronize = spriteProto.synchronizeHorrorFiltersWithSource;
    var updateEffects = spriteProto.updateHorrorEffects;
    var updateNoise = spriteProto.updateHorrorNoise;
    var updateGlitch = spriteProto.updateHorrorGlitch;
    var updateTV = spriteProto.updateHorrorTV;

    // The horror pins are shared by both items. `Sprite_Base.update` bypasses the Olivia wrapper
    // entirely, so it needs the sync/children/effects pins too.
    function horrorPinsOk() {
      if (!pinned('synchronize', synchronize)) return 'Sprite.prototype.synchronizeHorrorFiltersWithSource';
      if (!pinned('updateHorrorEffects', updateEffects)) return 'Sprite.prototype.updateHorrorEffects';
      if (!pinned('updateHorrorNoise', updateNoise)) return 'Sprite.prototype.updateHorrorNoise';
      if (!pinned('updateHorrorGlitch', updateGlitch)) return 'Sprite.prototype.updateHorrorGlitch';
      if (!pinned('updateHorrorTV', updateTV)) return 'Sprite.prototype.updateHorrorTV';
      if (!pinned('childrenLoop', childrenLoop)) return 'Olivia.HorrorEffects.___Sprite_update___';
      return null;
    }

    var fastSpriteUpdate = null;
    var knownSpriteUpdate = function (fn) {
      return fn === oliviaUpdate || (fastSpriteUpdate !== null && fn === fastSpriteUpdate);
    };

    // ---- item 2: horrorFastPath -------------------------------------------------------------
    if (!horrorStats.installed) {
      var horrorRefusal = switchedOff('horrorFastPath') ? 'disabled by OMORI_PERF_DISABLE'
        : !pinned('spriteUpdate', oliviaUpdate) ? 'Sprite.prototype.update' : horrorPinsOk();
      if (horrorRefusal) {
        logRefusal('horrorFastPath', horrorRefusal);
      } else {
        fastSpriteUpdate = function () {
          if (!horrorStats.enabled || this._horrorFiltersSource || hasHorrorFilters(this) ||
              this.updateHorrorEffects !== updateEffects ||
              this.synchronizeHorrorFiltersWithSource !== synchronize ||
              this.updateHorrorNoise !== updateNoise || this.updateHorrorGlitch !== updateGlitch ||
              this.updateHorrorTV !== updateTV ||
              Olivia.HorrorEffects.___Sprite_update___ !== childrenLoop) {
            horrorStats.fallback++;
            return oliviaUpdate.apply(this, arguments);
          }
          horrorStats.taken++;
          // GTP_OmoriFixes' delegate: live iterator over `children`, exactly as shipped.
          for (var child of this.children) {
            if (child.update) child.update();
          }
          // A child may have activated a filter or replaced a delegate mid-traversal; vanilla
          // calls the (then current) dispatcher after the loop, so do the same.
          if (this._horrorFiltersSource || hasHorrorFilters(this) ||
              this.updateHorrorEffects !== updateEffects) {
            this.updateHorrorEffects();
          }
        };
        spriteProto.update = fastSpriteUpdate;
        horrorStats.installed = true;
        console.log('[omori-perf] horrorFastPath installed');
      }
    }

    // ---- item 1: hiddenLeafSkip -------------------------------------------------------------
    if (!leafStats.installed) {
      var leafRefusal = switchedOff('hiddenLeafSkip') ? 'disabled by OMORI_PERF_DISABLE'
        : !pinned('spriteUpdate', oliviaUpdate) ? 'Sprite.prototype.update'
        : !pinned('spriteBaseUpdate', baseUpdate) ? 'Sprite_Base.prototype.update'
        : !pinned('updateVisibility', updateVisibility) ? 'Sprite_Base.prototype.updateVisibility'
        : !pinned('updateAnimationSprites', updateAnimationSprites) ? 'Sprite_Base.prototype.updateAnimationSprites'
        : horrorPinsOk();
      if (leafRefusal) {
        logRefusal('hiddenLeafSkip', leafRefusal);
      } else {
        baseProto.update = function () {
          if (!leafStats.enabled || this._hiding !== true || this.visible !== false ||
              !this.children || this.children.length !== 0 ||
              !this._animationSprites || this._animationSprites.length !== 0 ||
              this._horrorFiltersSource || hasHorrorFilters(this) ||
              this.updateVisibility !== updateVisibility ||
              this.updateAnimationSprites !== updateAnimationSprites ||
              this.synchronizeHorrorFiltersWithSource !== synchronize ||
              this.updateHorrorEffects !== updateEffects ||
              this.updateHorrorNoise !== updateNoise || this.updateHorrorGlitch !== updateGlitch ||
              this.updateHorrorTV !== updateTV ||
              Olivia.HorrorEffects.___Sprite_update___ !== childrenLoop ||
              !knownSpriteUpdate(spriteProto.update)) {
            leafStats.fallback++;
            return baseUpdate.apply(this, arguments);
          }
          // The only state the vanilla chain writes for such a sprite.
          leafStats.taken++;
          this.visible = !this._hiding;
        };
        leafStats.installed = true;
        console.log('[omori-perf] hiddenLeafSkip installed');
      }
    }
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.sprite-fastpaths', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
