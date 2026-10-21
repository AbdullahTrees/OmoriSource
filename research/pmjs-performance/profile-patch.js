// Frame-phase profiler for PMJS experiments (test only, loaded with --patch).
// Per frame: tick = MV logic + scene command building, render = presentation sync,
// native = native renderFrame CPU time (upload+draw+memory), swap+idle = the rest
// (SDL swap, scheduling). Also streams native renderer counters as 5 s deltas.
(function () {
  var wait = setInterval(function () {
    if (typeof globalThis.__pmjsTick !== 'function' ||
        typeof globalThis.__pmjsRender !== 'function') return;
    clearInterval(wait);
    install();
  }, 20);

  function num(value) { return typeof value === 'number' ? value : 0; }
  function now() { return performance.now(); }
  function mb(bytes) { return (num(bytes) / 1048576).toFixed(1); }

  function memoryLine() {
    var parts = [];
    try {
      var hostProcess = globalThis.__pmjsBuiltinRequire
        ? globalThis.__pmjsBuiltinRequire('node:process') : null;
      if (hostProcess && typeof hostProcess.memoryUsage === 'function') {
        var usage = hostProcess.memoryUsage();
        parts.push('rss ' + mb(usage.rss) + ' heap ' + mb(usage.heapUsed) + '/' +
          mb(usage.heapTotal) + ' ext ' + mb(usage.external) + ' ab ' + mb(usage.arrayBuffers));
      }
    } catch (_) {}
    try {
      var native = globalThis.NativeHost;
      var images = native.images && native.images.memory ? native.images.memory(0) : null;
      if (images) {
        parts.push('images gpu ' + mb(images.gpuBytes) + '/' + mb(images.peakGpuBytes) +
          ' cpu ' + mb(images.cpuBytes) + ' meta ' + mb(images.tileMetadataBytes) +
          ' warm ' + mb(images.warmBytes) + ' pinned ' + mb(images.pinnedBytes) +
          ' count ' + num(images.liveCount));
      }
      var render = native.render && native.render.stats ? native.render.stats() : null;
      if (render) parts.push('targets ' + mb(render.rendererTargetBytes) +
        ' targetCache ' + mb(render.rendererTargetCacheBytes));
      var canvas = native.canvas && native.canvas.memory ? native.canvas.memory() : null;
      if (canvas) parts.push('canvas ' + mb(canvas.gpuBytes !== undefined ? canvas.gpuBytes :
        canvas.bytes !== undefined ? canvas.bytes : canvas.totalBytes));
      var audio = native.media && native.media.audioStats ? native.media.audioStats() : null;
      if (audio) parts.push('audio pcm ' + mb(audio.livePcmBytes) + ' cache ' + mb(audio.cacheBytes));
      var alloc = native.runtime && native.runtime.allocatorStats
        ? native.runtime.allocatorStats() : null;
      if (alloc) parts.push('malloc ' + mb(alloc.allocatedArenaBytes) + '/' +
        mb(alloc.mappedBytes) + ' mapped');
    } catch (_) {}
    return parts.length ? ' | ' + parts.join(', ') : '';
  }

  function install() {
    var tick = globalThis.__pmjsTick;
    var render = globalThis.__pmjsRender;
    var frameStart = 0;
    var afterPresent = 0;
    var acc = blank();
    var snap = null;

    function blank() {
      return { frames: 0, tick: 0, render: 0, work: 0, swap: 0,
        upload: 0, draw: 0, memory: 0, costSamples: 0,
        sceneUpdate: 0, sceneRender: 0, startedAt: now() };
    }

    // Split the MV tick into SceneManager.updateScene and renderScene time.
    try {
      var sceneUpdate = SceneManager.updateScene;
      var sceneRender = SceneManager.renderScene;
      SceneManager.updateScene = function () {
        var start = now();
        try { return sceneUpdate.apply(this, arguments); }
        finally { acc.sceneUpdate += now() - start; }
      };
      SceneManager.renderScene = function () {
        var start = now();
        try { return sceneRender.apply(this, arguments); }
        finally { acc.sceneRender += now() - start; }
      };
    } catch (_) {}

    function stats() {
      try {
        return globalThis.NativeHost && NativeHost.render && NativeHost.render.stats
          ? NativeHost.render.stats() : null;
      } catch (_) { return null; }
    }

    var counters = ['drawCalls', 'commands', 'spriteDrawCalls', 'tileDrawCalls',
      'filterDrawCalls', 'identityFilterShaderDrawCalls', 'filterTargetAcquires',
      'filterTargetReuses', 'bufferUploads', 'filterIntermediateCacheHits',
      'constantBlackGroupsSkipped', 'screenFillDrawCalls', 'tilingSpriteDrawCalls',
      'framebufferCopies', 'filterTargetClears', 'rendererTargetCreates',
      'rendererTargetDestroys'];

    globalThis.__pmjsTick = function (nowMs) {
      var start = now();
      if (afterPresent) acc.swap += start - afterPresent;
      frameStart = start;
      var result = tick.call(this, nowMs);
      return Promise.resolve(result).then(function (value) {
        acc.tick += now() - start;
        return value;
      });
    };
    globalThis.__pmjsRender = function (nowMs) {
      var start = now();
      try { return render.call(this, nowMs); }
      finally { acc.render += now() - start; }
    };
    // Log the last custom filter plan each report: pass count and target sizes
    // show what a filter chain costs before the native draw even starts.
    try {
      var nativeRenderApi = globalThis.NativeHost && globalThis.NativeHost.render;
      if (nativeRenderApi && typeof nativeRenderApi.createFilterPlan === 'function') {
        var createPlan = nativeRenderApi.createFilterPlan;
        var lastPlanLog = 0;
        nativeRenderApi.createFilterPlan = function (plan) {
          var at = now();
          if (at - lastPlanLog > 2000) {
            lastPlanLog = at;
            console.log('[plan] passes=' + (plan.passes ? plan.passes.length : -1) +
              ' resolutions=' + JSON.stringify(plan.resolutions || []) +
              ' frame=' + JSON.stringify(plan.frame || []));
          }
          return createPlan.call(this, plan);
        };
      }
    } catch (_) {}

    // stats() hands back one cached object that the renderer mutates in place,
    // so keep a copy of the numbers or every delta compares an object to itself.
    function snapshotStats(s) {
      var copy = { values: {}, filterApplications: null };
      for (var i = 0; i < counters.length; i++) copy.values[counters[i]] = num(s[counters[i]]);
      if (s.filterApplications) {
        copy.filterApplications = [];
        for (var f = 0; f < s.filterApplications.length; f++)
          copy.filterApplications.push(num(s.filterApplications[f]));
      }
      return copy;
    }

    globalThis.__pmjsAfterPresent = function () {
      var at = now();
      if (frameStart) {
        acc.frames++;
        acc.work += at - frameStart;
        frameStart = 0;
      }
      afterPresent = at;
      var s = stats();
      if (s) {
        var costs = s.frameCosts || {};
        acc.upload += num(costs.uploadMs);
        acc.draw += num(costs.drawMs);
        acc.memory += num(costs.memoryMs);
        acc.costSamples++;
      }
    };

    try {
      var probe = globalThis.NativeHost && NativeHost.render && NativeHost.render.stats
        ? NativeHost.render.stats() : null;
      console.log('[stats] ' + (probe ? 'ok frames=' + probe.frames + ' draws=' + probe.drawCalls
        : 'unavailable') + (probe ? ' keys=' + Object.keys(probe).join(',') : ''));
    } catch (error) {
      console.log('[stats] error ' + (error && error.message || error));
    }

    setInterval(function () {
      var elapsed = now() - acc.startedAt;
      var frames = acc.frames;
      if (!frames) return;
      var samples = Math.max(1, acc.costSamples);
      var line = '[prof] fps ' + (frames * 1000 / elapsed).toFixed(1) +
        ' frames ' + frames +
        ' | per frame: work ' + (acc.work / frames).toFixed(1) +
        ' (tick ' + (acc.tick / frames).toFixed(1) +
        ' = update ' + (acc.sceneUpdate / frames).toFixed(1) +
        ' + sceneRender ' + (acc.sceneRender / frames).toFixed(1) +
        ', render ' + (acc.render / frames).toFixed(1) +
        ', native ' + ((acc.upload + acc.draw + acc.memory) / samples).toFixed(1) +
        ' = up ' + (acc.upload / samples).toFixed(1) +
        '+draw ' + (acc.draw / samples).toFixed(1) +
        '+mem ' + (acc.memory / samples).toFixed(1) + ')' +
        ', swap+idle ' + (acc.swap / frames).toFixed(1) + ' ms';
      line += memoryLine();
      var s = stats();
      if (s) {
        if (!snap) snap = snapshotStats(s);
        var parts = [];
        for (var i = 0; i < counters.length; i++) {
          var key = counters[i];
          var delta = num(s[key]) - snap.values[key];
          if (delta) parts.push(key + ' +' + delta);
        }
        if (s.filterApplications && snap.filterApplications) {
          for (var f = 0; f < s.filterApplications.length; f++) {
            var d = num(s.filterApplications[f]) - snap.filterApplications[f];
            if (d) parts.push('filter[' + f + '] +' + d);
          }
        }
        if (parts.length) line += ' | ' + parts.join(' ');
        snap = snapshotStats(s);
      }
      console.log(line);
      acc = blank();
    }, 5000);

    if (globalThis.NativeHost && NativeHost.runtime && NativeHost.runtime.env &&
        NativeHost.runtime.env('PMJS_ABLATE') === '1') startAblation();
  }

  function collectFilters(root) {
    var found = [];
    var seen = new Set();
    function walk(node, path, depth) {
      if (!node || depth > 6 || seen.has(node)) return;
      seen.add(node);
      var filters = node.filters;
      if (filters && filters.length) {
        for (var i = 0; i < filters.length; i++) {
          found.push({ object: node, path: path, index: i,
            filter: filters[i],
            name: filters[i] && filters[i].constructor ? filters[i].constructor.name : '?',
            passes: filters[i] && filters[i].passes ? filters[i].passes.length : 0,
            enabled: filters[i] ? filters[i].enabled : undefined });
        }
      }
      var children = node.children || [];
      for (var c = 0; c < children.length; c++) {
        var child = children[c];
        walk(child, path + '/' + (child && child.constructor ? child.constructor.name : '?'), depth + 1);
      }
    }
    walk(root, root && root.constructor ? root.constructor.name : 'scene', 0);
    return found;
  }

  function startAblation() {
    var armed = false;
    var timer = setInterval(function () {
      var scene = globalThis.SceneManager && SceneManager._scene;
      if (armed || !scene || scene.constructor.name !== 'Scene_Map') return;
      armed = true;
      clearInterval(timer);
      setTimeout(function () { runAblation(scene); }, 40000);
    }, 1000);
  }

  function describeFilter(filter) {
    var summary = {};
    try {
      var source = String(filter.fragmentSrc || '');
      var hash = 0;
      for (var c = 0; c < source.length; c++) hash = (hash * 31 + source.charCodeAt(c)) | 0;
      if (source) summary.frag = source.length + ':' + (hash >>> 0).toString(16);
      if (filter.resolution !== undefined) summary.res = filter.resolution;
      if (filter.padding !== undefined) summary.pad = filter.padding;
      ['blur', 'blurX', 'blurY', 'strength', 'passes', 'quality', 'alpha', 'enabled'].forEach(function (name) {
        if (filter[name] !== undefined && typeof filter[name] !== 'object') summary[name] = filter[name];
      });
      if (filter.blurXFilter && typeof filter.blurXFilter.blur === 'number') {
        summary.blurX = filter.blurXFilter.blur;
        summary.qualityX = filter.blurXFilter.quality;
      }
      if (filter.blurYFilter && typeof filter.blurYFilter.blur === 'number') {
        summary.blurY = filter.blurYFilter.blur;
        summary.qualityY = filter.blurYFilter.quality;
      }
    } catch (_) {}
    try {
      var uniforms = filter.uniforms || {};
      var keys = Object.keys(uniforms);
      for (var i = 0; i < keys.length && i < 6; i++) {
        var value = uniforms[keys[i]];
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
          summary[keys[i]] = value;
        else if (value && typeof value.length === 'number')
          summary[keys[i]] = '[' + Array.prototype.slice.call(value, 0, 4).join(',') + ']';
      }
    } catch (_) {}
    return JSON.stringify(summary);
  }

  function runAblation(scene) {
    var enabled = collectFilters(scene).filter(function (entry) { return entry.enabled !== false; });
    console.log('[ablate] inventory=' + enabled.length + ' ' + JSON.stringify(enabled.map(function (entry) {
      return entry.path + ' #' + entry.index + ' ' + entry.name + ' ' + describeFilter(entry.filter);
    })));
    var hosts = [];
    var seen = new Set();
    for (var i = 0; i < enabled.length; i++) {
      if (seen.has(enabled[i].object)) continue;
      seen.add(enabled[i].object);
      hosts.push(enabled[i].object);
    }
    var originals = hosts.map(function (object) {
      return { object: object, filters: object.filters };
    });
    function restore() {
      originals.forEach(function (saved) { saved.object.filters = saved.filters; });
    }
    var hostPath = new Map();
    enabled.forEach(function (entry) {
      if (!hostPath.has(entry.object)) hostPath.set(entry.object, entry.path);
    });
    var mode = 'single';
    try {
      mode = (globalThis.NativeHost.runtime.env('PMJS_ABLATE_MODE') || 'single');
    } catch (_) {}
    var phases = [{ label: 'baseline' }];
    if (mode === 'only') {
      enabled.forEach(function (entry) {
        phases.push({ label: 'keep only ' + entry.path + ' #' + entry.index + ' ' + entry.name,
          only: entry });
      });
    } else if (mode === 'groups') {
      var spriteset = hosts.filter(function (object) {
        return String(hostPath.get(object) || '').indexOf('Spriteset_Map') >= 0;
      });
      var others = hosts.filter(function (object) { return spriteset.indexOf(object) < 0; });
      phases.push({ label: 'remove all Spriteset_Map filters', targets: spriteset });
      phases.push({ label: 'remove Tone+Alpha only', targets: others });
    } else {
      enabled.forEach(function (entry) {
        phases.push({ label: 'remove ' + entry.path + ' #' + entry.index + ' ' + entry.name,
          remove: entry });
      });
    }
    phases.push({ label: 'all filters off', all: true });
    phases.push({ label: 'restored' });
    var index = 0;
    function next() {
      if (index >= phases.length) { restore(); return; }
      var phase = phases[index++];
      restore();
      if (phase.all) {
        originals.forEach(function (saved) { saved.object.filters = []; });
      } else if (phase.targets) {
        phase.targets.forEach(function (object) { object.filters = []; });
      } else if (phase.only) {
        var onlyHost = phase.only.object;
        onlyHost.filters = (onlyHost.filters || []).slice(phase.only.index, phase.only.index + 1);
      } else if (phase.remove) {
        var removeHost = phase.remove.object;
        var removeList = (removeHost.filters || []).slice();
        removeList.splice(phase.remove.index, 1);
        removeHost.filters = removeList;
      }
      console.log('[ablate] phase ' + index + '/' + phases.length + ': ' + phase.label);
      setTimeout(next, 10000);
    }
    next();
  }
})();
