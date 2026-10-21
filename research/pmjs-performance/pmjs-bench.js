// Benchmark patch for PMJS tests (not part of OmoriSource): logs rendered FPS every 5 s and,
// unless PMJS_BENCH_AUTOPLAY=0, drops a new game into White Space (map 87) and walks after 30 s.
(function () {
    var last = null;
    setInterval(function () {
        if (!window.Graphics || !Graphics._renderer) return;
        var now = performance.now();
        if (last && Graphics.frameCount >= last.frames) {
            var scene = SceneManager._scene ? SceneManager._scene.constructor.name : '-';
            var map = window.$gameMap && $gameMap.mapId() ? ' map ' + $gameMap.mapId() : '';
            console.log('[bench] fps ' + ((Graphics.frameCount - last.frames) * 1000 / (now - last.time)).toFixed(1) +
                ' (' + (Graphics.isWebGL() ? 'webgl' : 'canvas') + ', ' + scene + map + ')');
        }
        last = { time: now, frames: Graphics.frameCount };
    }, 5000);

    // PMJS gives guest code its own process.env; real variables come through NativeHost.
    var env = function (name) {
      if (globalThis.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') return NativeHost.runtime.env(name);
      return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
    };
    if (env('PMJS_BENCH_AUTOPLAY') === '0') return;
    var timer = setInterval(function () {
        if (!window.SceneManager || !SceneManager._scene || SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
        clearInterval(timer);
        console.log('[bench] new game -> White Space (map 87)');
        DataManager.setupNewGame();
        $gamePlayer.reserveTransfer(87, 28, 27, 2, 0);
        SceneManager.goto(Scene_Map);
        setTimeout(function () {
            console.log('[bench] walking');
            var dir = 'left';
            setInterval(function () {
                Input._currentState.left = Input._currentState.right = false;
                dir = dir === 'left' ? 'right' : 'left';
                Input._currentState[dir] = true;
            }, 1500);
        }, 30000);
    }, 1000);
})();
