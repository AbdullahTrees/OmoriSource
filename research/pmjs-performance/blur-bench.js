// Microbenchmark the native 640x480 bitmap blur paths available to OMORI on PMJS.
//
// Not part of a release. Loaded like the other perf modules; logs one JSON line:
//   [blur-bench] {...}
// `stock` is Bitmap.prototype.blur (the game's two additive box passes; PMJS substitutes a
// native implementation when its optimization is active), `gauss` is the runtime's native
// two-pass [1,4,6,4,1] Gaussian on the canvas, and `mv` is the native implementation of MV's
// blur through PMJS.web.canvas.blurMv. Timings are milliseconds per call on a fresh bitmap.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function fresh(report) {
    var bitmap = new Bitmap(640, 480);
    bitmap.fillRect(0, 0, 640, 480, 'rgba(40, 90, 160, 1)');
    bitmap.fillRect(100, 80, 200, 160, 'rgba(240, 200, 60, 1)');
    // Realize the deferred canvas: the snapshot bitmap is always realized (the renderer wrote
    // it), and a queued blur on a deferred canvas would not be timed here.
    try {
      if (PMJS.web && PMJS.web.canvas && typeof PMJS.web.canvas.readPixel === 'function') {
        PMJS.web.canvas.readPixel(bitmap._canvas, bitmap._context, 0, 0);
      } else {
        bitmap._context.getImageData(0, 0, 1, 1);
      }
    } catch (error) {
      report.errors.push('realize:' + String(error && error.message || error));
    }
    return bitmap;
  }

  function run() {
    var report = { optEnabled: null, optReason: null, runs: {}, errors: [] };
    try {
      if (root.PMJS && PMJS.optimizations) {
        report.optEnabled = PMJS.optimizations.isEnabled('bitmap.native-blur');
        report.optReason = PMJS.optimizations.reason('bitmap.native-blur');
      }
    } catch (error) {
      report.errors.push('opt:' + String(error && error.message || error));
    }
    function time(name, call) {
      var times = [], result = null;
      for (var i = 0; i < 4; i++) {
        var bitmap = fresh(report);
        var started = performance.now();
        try { result = call(bitmap); } catch (error) {
          report.errors.push(name + ':' + String(error && error.message || error));
          break;
        }
        times.push(Math.round((performance.now() - started) * 10) / 10);
      }
      report.runs[name] = { ms: times, result: result };
    }
    time('stock', function (bitmap) { bitmap.blur(); });
    time('gauss', function (bitmap) {
      PMJS.web.canvas.blur(bitmap._canvas);
      bitmap._setDirty();
    });
    time('mv', function (bitmap) {
      var result = PMJS.web.canvas.blurMv(bitmap._context);
      bitmap._setDirty();
      return result;
    });
    console.log('[blur-bench] ' + JSON.stringify(report));
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'blur-bench', function () { setTimeout(run, 2000); });
  }
})();
