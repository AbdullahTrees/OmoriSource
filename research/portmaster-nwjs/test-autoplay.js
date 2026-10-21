// Device test only (not part of OmoriSource): once the title screen is up, start a new
// game and drop the player into White Space (map 87) so every benchmark run measures the
// same room. After 30 s the player walks left/right to include scrolling.
(function () {
    var timer = setInterval(function () {
        if (!window.SceneManager || !SceneManager._scene || SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
        clearInterval(timer);
        console.info('[autoplay] new game -> White Space (map 87)');
        DataManager.setupNewGame();
        $gamePlayer.reserveTransfer(87, 28, 27, 2, 0);
        SceneManager.goto(Scene_Map);
        setTimeout(function () {
            console.info('[autoplay] walking');
            var dir = 'left';
            setInterval(function () {
                Input._currentState.left = Input._currentState.right = false;
                dir = dir === 'left' ? 'right' : 'left';
                Input._currentState[dir] = true;
            }, 1500);
        }, 30000);
    }, 1000);
})();
