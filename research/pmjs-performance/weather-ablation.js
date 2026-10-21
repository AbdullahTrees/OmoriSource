// Diagnostic only: deliberately hide weather, then stop its update, to measure costs.
// These modes change the picture/simulation and MUST NOT become production optimizations.
(function () {
  'use strict';
  var root = globalThis, mode = 'baseline', original, saved = new WeakMap();
  var updates = 0, skipped = 0;
  function install() {
    original = Weather.prototype.update;
    Weather.prototype.update = function () {
      if (!saved.has(this)) saved.set(this, this.visible);
      if (mode === 'frozen') { skipped++; this.visible = false; return; }
      updates++;
      var result = original.apply(this, arguments);
      this.visible = mode === 'hidden' ? false : saved.get(this);
      return result;
    };
    root.__omoriWeatherAblation = {
      setMode: function (value) {
        if (!['baseline', 'hidden', 'frozen'].includes(value)) throw new Error('unknown weather ablation');
        mode = value;
      },
      snapshot: function () {
        var weather = [];
        (function walk(node) {
          if (!node) return;
          if (node instanceof Weather) weather.push({ type: node.type, power: node.power,
            visible: node.visible, sprites: node._sprites && node._sprites.length,
            children: node.children.length, opacity: node.opacity });
          for (var child of node.children || []) walk(child);
        })(SceneManager._scene);
        return { mode: mode, updates: updates, skipped: skipped, weather: weather };
      }
    };
    console.log('[weather-ablation] installed');
  }
  var timer = setInterval(function () {
    if (!root.SceneManager || !SceneManager._scene || SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
    clearInterval(timer); install();
  }, 50);
})();
