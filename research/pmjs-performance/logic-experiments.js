// Test-only OMORI runtime experiments. Game files are never rewritten.
(function() {
  'use strict';
  var root = globalThis, require = root.__pmjsBuiltinRequire;
  var expected = {
  "update": [
    "afc0c175fbd5adfb4ffc57345ca0aea27ec1338fe74789c2c3599dca1c001594"
  ],
  "synchronize": [
    "e97a11a96fdaba2f99bfc3e769ab7dd15f7d9c152062c59a2654576da596b7ea"
  ],
  "children": [
    "ed434d771eafc138202664abed6f2c0f86e3142910c285bf9ca7efdbabf4d4ef"
  ],
  "base": [
    "fd9d2f86de93fece0c102aac5e1bb5aec263509403dc05be6d099db79a97f263"
  ],
  "visibility": [
    "2c3e4c95bd9c9c047755085370a835ac99d5eee56c5a30e10512d80f95efa1c7"
  ],
  "animations": [
    "30575574c798ac1d0086edb495a72ab561e65d4ae6090978004e1ed1a426a2fd"
  ],
  "noise": [
    "5886848c86d64f40d6342cd985179c8d0f328e8d4231011f044ebcd3b8c2d686"
  ],
  "glitch": [
    "1dfffbc540671e82481f9d99431290422c72a8c1b036a25c68e52708457b406c"
  ],
  "tv": [
    "f5469ca6d318fe389e00824aa5daf6f698f3e4a300b21a79372910c5434f2254"
  ],
  "effects": [
    "9260befd5b45556ad2fa3d618ba31a782c7b84396828aad1f27a2839d2f270fe"
  ]
}; // Filled with reviewed LF-normalized source fingerprints by the host audit.
  function digest(fn) {
    return typeof fn === 'function' ? require('node:crypto').createHash('sha256')
      .update(Function.prototype.toString.call(fn).replace(/\r\n/g, '\n')).digest('hex') : '';
  }
  function install() {
    var sprite = Sprite.prototype, base = Sprite_Base.prototype;
    var original = sprite.update, synchronize = sprite.synchronizeHorrorFiltersWithSource;
    var children = Olivia.HorrorEffects.___Sprite_update___;
    var effects = sprite.updateHorrorEffects;
    var noise = sprite.updateHorrorNoise, glitch = sprite.updateHorrorGlitch, tv = sprite.updateHorrorTV;
    var originalBase = base.update, visibility = base.updateVisibility, animations = base.updateAnimationSprites;
    var checks = { update: original, synchronize: synchronize, children: children,
      effects: effects, noise: noise, glitch: glitch, tv: tv,
      base: originalBase, visibility: visibility, animations: animations };
    var failures = Object.keys(checks).filter(function(key) { return !(expected[key] || []).includes(digest(checks[key])); });
    if (failures.length) {
      console.log('[logic-experiment] refused '+JSON.stringify(failures.map(function(key) { return [key, digest(checks[key])]; })));
      return;
    }
    var mode = NativeHost.runtime.env('OMORI_LOGIC_MODE') || 'baseline';
    var stats = { horrorSkipped: 0, baseSkipped: 0 };
    function empty(sprite) {
      var filters = sprite._horrorFilters;
      return !filters || !(filters.noiseFilter || filters.glitchFilter || filters.tvFilter);
    }
    function methods(sprite) {
      return sprite.synchronizeHorrorFiltersWithSource === synchronize &&
        sprite.updateHorrorEffects === effects && sprite.updateHorrorNoise === noise &&
        sprite.updateHorrorGlitch === glitch && sprite.updateHorrorTV === tv &&
        Olivia.HorrorEffects.___Sprite_update___ === children;
    }
    function fastUpdate() {
      if ((mode !== 'horror' && mode !== 'both') || !methods(this) ||
          this._horrorFiltersSource || !empty(this)) return original.apply(this, arguments);
      stats.horrorSkipped++;
      // Preserve the reviewed alias's live iterator semantics, including appended children.
      for (var child of this.children) if (child.update) child.update();
      // A child can activate an effect or replace a delegate during the traversal.
      if (!methods(this) || !empty(this)) this.updateHorrorEffects();
    }
    sprite.update = fastUpdate;
    base.update = function() {
      if ((mode === 'base' || mode === 'both') && sprite.update === fastUpdate &&
          this.updateVisibility === visibility && this.updateAnimationSprites === animations &&
          this.children.length === 0 && this._animationSprites.length === 0 &&
          !this._horrorFiltersSource && empty(this) && methods(this)) {
        stats.baseSkipped++;
        this.visible = !this._hiding;
        return;
      }
      return originalBase.apply(this, arguments);
    };
    root.__omoriLogicExperiments = {
      setMode: function(value) {
        if (!['baseline', 'horror', 'base', 'both'].includes(value)) throw new Error('unknown experiment mode');
        mode = value;
      },
      snapshot: function() { return { mode: mode, horrorSkipped: stats.horrorSkipped, baseSkipped: stats.baseSkipped }; }
    };
    console.log('[logic-experiment] installed '+JSON.stringify(root.__omoriLogicExperiments.snapshot()));
  }
  var timer = setInterval(function() {
    if (!root.SceneManager || !SceneManager._scene || SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
    clearInterval(timer);
    try { install(); } catch (error) { console.log('[logic-experiment] failed '+String(error.stack || error)); }
  }, 50);
})();
