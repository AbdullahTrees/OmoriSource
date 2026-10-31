'use strict';
(function() {
  function summarize(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function(a,b) { return a-b; });
    var sum = sorted.reduce(function(a,b) { return a+b; },0);
    return { frames: values.length, fps: values.length*1000/sum, meanMs: sum/values.length,
      p50: sorted[Math.ceil(sorted.length*0.5)-1], p95: sorted[Math.ceil(sorted.length*0.95)-1],
      p99: sorted[Math.ceil(sorted.length*0.99)-1], max: sorted[sorted.length-1],
      hitches100ms: values.filter(function(v) { return v>=100; }).length };
  }
  globalThis.PMJSBenchSummary = summarize;
  var env = function(key) { return NativeHost.runtime.env(key); };
  var dir = env('ISAT_BENCH_DIR');
  if (!dir) return;
  var fs = __pmjsBuiltinRequire('fs'), timers = __pmjsBuiltinRequire('timers');
  var inspector = null, profile = env('ISAT_BENCH_PROFILE') === '1';
  var mode = env('ISAT_BENCH_MODE') || 'run';
  var sampleMs = Number(env('ISAT_BENCH_SECONDS') || 15)*1000;
  var warmMs = Number(env('ISAT_BENCH_WARMUP') || 5)*1000;
  var stepCount = 0, rendered = 0, phase = null, values = [], last = 0;
  var cursor = -1, pending = false, state = 'title', entered = 0, stepsAtStart = 0;
  var positions = null, walkSteps = 0, snapshot = null, originalInputs = {};
  var scenes = (env('ISAT_BENCH_SCENES') || 'standing,walking,menu,battle').split(',');
  fs.mkdirSync(dir,{recursive:true});
  function write(value) {
    fs.appendFileSync(dir+'/results.jsonl',JSON.stringify(value)+'\n');
    console.log('[isat-bench] '+JSON.stringify(value));
  }
  function post(method,params) {
    return new Promise(function(resolve,reject) {
      inspector.post(method,params||{},function(error,result) { if(error) reject(error); else resolve(result); });
    });
  }
  function counters() {
    var retained = PMJS.pixi4 && PMJS.pixi4.retained;
    return retained ? JSON.parse(JSON.stringify(retained.stats)) : null;
  }
  function hardware() {
    function read(file) { try { return fs.readFileSync(file,'utf8').trim(); } catch(_) { return ''; } }
    var available=/MemAvailable:\s+(\d+)/.exec(read('/proc/meminfo'));
    var rss=/VmRSS:\s+(\d+)/.exec(read('/proc/self/status'));
    return { temperatureMilliC:Number(read('/sys/class/thermal/thermal_zone0/temp')),
      cpuKHz:Number(read('/sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq')),
      availableKiB:available && Number(available[1]),rssKiB:rss && Number(rss[1]) };
  }
  function fail(error) {
    write({type:'failure',error:String(error && error.stack || error)});
    timers.clearInterval(poll);
    SceneManager.exit();
  }
  function restoreInputs() {
    Object.keys(originalInputs).forEach(function(key) { Input[key]=originalInputs[key]; });
  }
  function startMeasure() {
    pending=true;
    Promise.resolve().then(async function() {
      if(profile) {
        if(!inspector) { inspector=new (__pmjsBuiltinRequire('inspector').Session)(); inspector.connect(); }
        await post('Profiler.enable'); await post('Profiler.setSamplingInterval',{interval:1000});
        await post('Profiler.start');
      }
      values=[]; last=0; entered=performance.now(); stepsAtStart=stepCount;
      snapshot=counters(); positions={minX:$gamePlayer.x,maxX:$gamePlayer.x,minY:$gamePlayer.y,maxY:$gamePlayer.y};
      state='measure'; pending=false;
      write({type:'phase-start',phase:phase,time:Date.now(),scene:SceneManager._scene.constructor.name,
        map:$gameMap.mapId(),retained:snapshot});
    }).catch(fail);
  }
  function endMeasure() {
    var ended=performance.now();state='ending';pending=true;
    var summary=summarize(values), after=counters(), delta={};
    if(after) Object.keys(after).forEach(function(k) { delta[k]=after[k]-(snapshot[k]||0); });
    Promise.resolve().then(async function() {
      if(profile) {
        var result=await post('Profiler.stop');
        fs.writeFileSync(dir+'/'+phase+'.cpuprofile',JSON.stringify(result.profile));
      }
      write({type:'phase',phase:phase,time:Date.now(),startTime:Date.now()-(ended-entered),
        scene:SceneManager._scene.constructor.name,map:$gameMap.mapId(),frame:summary,
        logicSteps:stepCount-stepsAtStart,logicHz:(stepCount-stepsAtStart)*1000/(ended-entered),
        positions:positions,retained:delta,worldState:PMJS.pixi4 && PMJS.pixi4.retained && PMJS.pixi4.retained.usesWorldState,
        sourceQualification:PMJS.isatSourceQualification,hardware:hardware(),
        mapTransforms:PMJS.isatMapTransforms && PMJS.isatMapTransforms.diagnostics(SceneManager._scene)});
      pending=false;nextPhase();
    }).catch(fail);
  }
  function nextPhase() {
    cursor++;phase=scenes[cursor];state='transition';entered=performance.now();
    if(!phase) {
      write({type:'complete',mode:mode,phases:scenes.length});
      if(inspector) inspector.disconnect();timers.clearInterval(poll);SceneManager.exit();return;
    }
    if(phase==='menu') SceneManager.push(Scene_Menu);
    if(phase==='battle') { SceneManager.pop();state='battle-return'; }
  }
  function expectedScene() { return phase==='menu' ? 'Scene_Menu' : phase==='battle' ? 'Scene_Battle' : 'Scene_Map'; }
  function active(scene) {
    return scene && SceneManager._sceneStarted && scene.isActive() &&
      (scene.constructor.name!=='Scene_Map' || (globalThis.$dataMap && scene._mapLoaded));
  }
  function advance() {
    if(pending) return;
    try {
      var now=performance.now(), scene=SceneManager._scene, name=scene && scene.constructor.name;
      if(state==='title' && name==='Scene_Title' && active(scene) && !SceneManager.isSceneChanging()) {
        if(mode!=='seed') restoreInputs();pending=true;
        if(mode==='seed') { state='seed-meadow';pending=false;scene.commandNewGame(); }
        else Promise.resolve(DataManager.loadGame(1)).then(function(ok) {
          if(!ok) throw Error('Copied benchmark fixture could not be loaded');
          var seed=12345;
          Math.random=function() { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; };
          $gameSystem.onAfterLoad();SceneManager.goto(Scene_Map);state='loaded';pending=false;
        }).catch(fail);
      } else if(state==='seed-meadow' && name==='Scene_Map' && active(scene) && $gameMap.mapId()===2 &&
          !$gameMap.isEventRunning() && !$gameMessage.isBusy() && $gamePlayer.canMove()) {
        $gamePlayer.reserveTransfer(30,19,47,2,0);state='seed-village';entered=now;
      } else if(state==='seed-village' && name==='Scene_Map' && active(scene) && $gameMap.mapId()===30 &&
          !$gameMap.isEventRunning() && !$gameMessage.isBusy() && now-entered>3000) {
        pending=true;
        $gameSystem.onBeforeSave();
        Promise.resolve(DataManager.saveGame(1)).then(function(ok) {
          if(!ok) throw Error('Benchmark fixture save failed');
          write({type:'fixture',map:30,x:$gamePlayer.x,y:$gamePlayer.y,party:$gameParty.members().length});
          write({type:'complete',mode:'seed'});timers.clearInterval(poll);SceneManager.exit();
        }).catch(fail);
      } else if(state==='loaded' && name==='Scene_Map' && active(scene) && $gameMap.mapId()===30 &&
          !SceneManager.isSceneChanging() && !$gameMessage.isBusy()) {
        // Save-derived scene fixture: stay clear of the bottom exit's 3-tile hitbox.
        $gamePlayer.locate(19,37);
        restoreInputs();nextPhase();
      } else if(state==='battle-return' && name==='Scene_Map' && active(scene) && !SceneManager.isSceneChanging()) {
        BattleManager.setup(3,false,false);SceneManager.push(Scene_Battle);state='transition';entered=now;
      } else if(state==='transition' && name===expectedScene() && active(scene) && !SceneManager.isSceneChanging()) {
        state='warmup';entered=now;
      }
      else if(state==='warmup' && now-entered>=warmMs) startMeasure();
      else if(state==='measure') {
        if(name!==expectedScene() || (phase!=='battle' && $gameMap.mapId()!==30))
          throw Error('Unexpected benchmark scene/map: '+name+' map='+$gameMap.mapId());
        positions.minX=Math.min(positions.minX,$gamePlayer.x);positions.maxX=Math.max(positions.maxX,$gamePlayer.x);
        positions.minY=Math.min(positions.minY,$gamePlayer.y);positions.maxY=Math.max(positions.maxY,$gamePlayer.y);
        if(phase==='walking' && !$gamePlayer.isMoving() && $gamePlayer.canMove()) {
          // Two passable road tiles at y=37, well inside the village.
          $gamePlayer.moveStraight($gamePlayer.x<=19 ? 6 : 4);
        }
        if(now-entered>=sampleMs) endMeasure();
      }
    } catch(error) { fail(error); }
  }
  var poll;
  PMJS.phases.on('afterPlugins','research.isat-benchmark',function() {
    var updateScene=SceneManager.updateScene;
    SceneManager.updateScene=function() { stepCount++;return updateScene.apply(this,arguments); };
    var afterPresent=globalThis.__pmjsAfterPresent;
    globalThis.__pmjsAfterPresent=function() {
      if(afterPresent) afterPresent.apply(this,arguments);
      rendered++;
      if(state==='measure') { var now=performance.now();if(last) values.push(now-last);last=now; }
    };
    ['isPressed','isTriggered','isRepeated','isLongPressed'].forEach(function(method) {
      var original=Input[method];originalInputs[method]=original;
      Input[method]=function(key) {
        var scene=SceneManager._scene,pretitle=scene && scene.constructor.name==='Scene_PretitleMap';
        if(key==='ok' && ((state==='title' && pretitle) || (mode==='seed' && $gameMessage && $gameMessage.isBusy())))
          return method!=='isLongPressed' && rendered%8<2;
        return original.apply(this,arguments);
      };
    });
    write({type:'session',mode:mode,profile:profile,disabled:env('PMJS_DISABLE_OPT')||'',verify:env('PMJS_RETAINED_VERIFY')||'',
      sourceQualification:PMJS.isatSourceQualification,updateMainWrapped:!!SceneManager.updateMain._pmjsTimingWrapped});
    poll=timers.setInterval(advance,25);
  });
})();
