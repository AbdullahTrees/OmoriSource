// Cross-platform fixes for OMORI.
//
// NW.js runs this file before any game script (see "inject_js_start" in the
// launcher package.json), so the game's own files stay byte-identical.
// Every fix here only changes behaviour on platforms OMORI never shipped for.

(function () {
    'use strict';

    var fs = require('fs');
    var path = require('path');
    var os = require('os');

    // tools/build.py writes parity.json next to package.json. Builds made from
    // incomplete or modified game files still run, but say so in the log.
    try {
        var parity = JSON.parse(fs.readFileSync(path.join(nw.__dirname, 'parity.json'), 'utf8'));
        if (parity.missing.length || parity.changed.length) {
            console.warn('[compat] game files differ from the reference: ' + parity.missing.length + ' missing, ' +
                parity.changed.length + ' changed. Missing: ' + parity.missing.slice(0, 20).join(', ') +
                ' Changed: ' + parity.changed.slice(0, 20).join(', '));
        }
    } catch (e) {
        // No report (running straight from the repository): nothing to check.
    }

    // OMORI_FPS_LOG=<seconds> logs the rendered frame rate, for measuring ports.
    var fpsSeconds = Number(process.env.OMORI_FPS_LOG);
    if (fpsSeconds > 0) {
        var last = null;
        setInterval(function () {
            if (!window.Graphics || !Graphics._renderer) return;
            var now = performance.now();
            if (last) {
                var scene = SceneManager._scene ? SceneManager._scene.constructor.name : '-';
                var map = window.$gameMap && $gameMap.mapId() ? ' map ' + $gameMap.mapId() : '';
                console.info('[compat] fps ' + ((Graphics.frameCount - last.frames) * 1000 / (now - last.time)).toFixed(1) +
                    ' (' + (Graphics.isWebGL() ? 'webgl' : 'canvas') + ', ' + scene + map + ')');
            }
            last = { time: now, frames: Graphics.frameCount };
        }, fpsSeconds * 1000);
    }

    // OMORI_PERF_SPRITES=1 loads the sprite-update culling patch made for slow handhelds
    // (launcher/omori-performance.js). It installs itself once the game's plugins have loaded.
    if (process.env.OMORI_PERF_SPRITES === '1') {
        (0, eval)(fs.readFileSync(path.join(nw.__dirname, 'launcher', 'omori-performance.js'), 'utf8'));
    }

    if (process.platform !== 'linux') return;

    // Permanent_Manager (GTP_OmoriFixes.js) keeps CUTSCENE.json in %LOCALAPPDATA%,
    // which only Windows sets. Point it at the XDG data folder instead.
    if (!process.env.LOCALAPPDATA) {
        var dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
        // NW.js 0.29 ships Node 9, which has no mkdirSync(..., { recursive: true }).
        (function makeDirs(dir) {
            if (fs.existsSync(dir)) return;
            makeDirs(path.dirname(dir));
            fs.mkdirSync(dir);
        })(dataHome);
        process.env.LOCALAPPDATA = dataHome;
    }

    // OMORI was made on Windows, where file names ignore case. Its data asks for
    // "AMB_FOREST" when the file is "AMB_forest.ogg", "/Languages/" when the folder
    // is "languages", and so on. Linux file names are case-sensitive, so when an
    // exact path is missing we look for one that differs only in case.

    var appRoot = nw.__dirname;
    // Same expression the game uses for its own base folder (StorageManager, GTP_OmoriFixes).
    var gameRoot = path.dirname(process.mainModule.filename);
    var exists = fs.existsSync;
    var readdir = fs.readdirSync;
    var stat = fs.statSync;
    var lowerIndex = null;

    function buildIndex() {
        lowerIndex = new Map();
        (function walk(dir, rel) {
            readdir(dir).forEach(function (name) {
                var childRel = rel ? rel + '/' + name : name;
                if (childRel === 'save') return; // player data changes at runtime
                lowerIndex.set(childRel.toLowerCase(), childRel);
                var child = path.join(dir, name);
                if (stat(child).isDirectory()) walk(child, childRel);
            });
        })(gameRoot, '');
    }

    function fixPath(p) {
        if (typeof p !== 'string' || exists(p)) return p;
        var rel = path.relative(gameRoot, path.resolve(p));
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return p;
        if (!lowerIndex) buildIndex();
        var real = lowerIndex.get(rel.split(path.sep).join('/').toLowerCase());
        if (!real) return p;
        if (process.env.OMORI_COMPAT_DEBUG) console.info('[compat] case fix:', rel, '->', real);
        return path.join(gameRoot, real);
    }

    ['readFile', 'readFileSync', 'existsSync', 'readdirSync', 'stat', 'statSync'].forEach(function (name) {
        var original = fs[name];
        fs[name] = function (p) {
            var args = Array.prototype.slice.call(arguments);
            args[0] = fixPath(p);
            return original.apply(this, args);
        };
    });

    // Browser-side loads (images, audio, video, XHR, fetch) go through URLs
    // relative to the app folder, so the same lookup is applied to those.

    function fixUrl(url) {
        if (typeof url !== 'string') return url;
        var u;
        try { u = new URL(url, document.baseURI); } catch (e) { return url; }
        // Compare protocol/host: URL.origin is "null" for chrome-extension:// in Chromium 65.
        if (u.protocol !== location.protocol || u.host !== location.host) return url;
        var p = path.join(appRoot, decodeURIComponent(u.pathname));
        var fixed = fixPath(p);
        if (fixed === p) return url;
        u.pathname = '/' + path.relative(appRoot, fixed).split(path.sep).map(encodeURIComponent).join('/');
        return u.href;
    }

    function patchSrc(proto) {
        var d = Object.getOwnPropertyDescriptor(proto, 'src');
        Object.defineProperty(proto, 'src', {
            configurable: true,
            enumerable: d.enumerable,
            get: d.get,
            set: function (value) { d.set.call(this, fixUrl(value)); }
        });
    }
    patchSrc(HTMLImageElement.prototype);
    patchSrc(HTMLMediaElement.prototype);

    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        args[1] = fixUrl(url);
        return xhrOpen.apply(this, args);
    };

    var originalFetch = window.fetch;
    window.fetch = function (input) {
        var args = Array.prototype.slice.call(arguments);
        args[0] = fixUrl(input);
        return originalFetch.apply(this, args);
    };
})();
