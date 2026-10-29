// Test-only experiment: choose the native renderer's world-transform mode for the game stage.
// Not part of a release. Loaded like the other perf modules; does nothing unless
// OMORI_WORLD_STATE is "pixi" or "local".
//
//   pixi:  call the scene's authored updateTransform methods (exactly what vanilla PIXI would do)
//   local: skip world-transform preparation and let the native renderer compose local transforms
//
// The default PMJS path builds a transform plan and prepares the transforms itself.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  var mode = env('OMORI_WORLD_STATE');
  if (mode !== 'pixi' && mode !== 'local') return;

  function install() {
    if (!root.PMJS || !PMJS.pixi4 || typeof PMJS.pixi4.setStageRenderOptions !== 'function') {
      console.log('[omori-perf] worldState experiment unavailable');
      return;
    }
    var original = SceneManager.renderScene;
    var lastScene = null;
    SceneManager.renderScene = function () {
      var scene = SceneManager._scene;
      if (scene && scene !== lastScene) {
        lastScene = scene;
        PMJS.pixi4.setStageRenderOptions(scene, { worldState: mode });
        console.log('[omori-perf] worldState=' + mode + ' on ' + (scene.constructor && scene.constructor.name));
      }
      return original.apply(this, arguments);
    };
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.worldstate-experiment', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
