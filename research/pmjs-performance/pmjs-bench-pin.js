// Benchmark patch for PMJS tests (not part of OmoriSource): logs rendered FPS every 5 s and,
// unless PMJS_BENCH_AUTOPLAY=0, drops a new game into White Space (map 87). After the map
// intro it parks the player at the transfer point with no input held, so frames from two
// different builds render the same world position and can be compared pixel for pixel.
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

    if (typeof process !== 'undefined' && process.env.PMJS_BENCH_AUTOPLAY === '0') return;
    var timer = setInterval(function () {
        if (!window.SceneManager || !SceneManager._scene || SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
        clearInterval(timer);
        console.log('[bench] new game -> White Space (map 87)');
        DataManager.setupNewGame();
        $gamePlayer.reserveTransfer(87, 28, 27, 2, 0);
        SceneManager.goto(Scene_Map);
        setTimeout(function () {
            console.log('[bench] pinning player at 28,27');
            var state = Input._currentState;
            state.left = state.right = state.up = state.down = false;
            $gamePlayer.setPosition(28, 27);
            $gamePlayer.setDirection(2);
        }, 70000);
    }, 1000);
})();
