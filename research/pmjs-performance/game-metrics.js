'use strict';
// Guest-side common collector. No navigation or activation until create() is called.
(function() {
  function summarize(values) {
    if (!values.length) return null;
    var sorted=values.slice().sort(function(a,b){return a-b;});
    var sum=sorted.reduce(function(a,b){return a+b;},0), n=values.length;
    return {frames:n,fps:n*1000/sum,meanMs:sum/n,p50:sorted[Math.ceil(n*.5)-1],
      p95:sorted[Math.ceil(n*.95)-1],p99:sorted[Math.ceil(n*.99)-1],max:sorted[n-1],
      hitches100ms:values.filter(function(x){return x>=100;}).length};
  }
  function create(dir,profile) {
    var fs=__pmjsBuiltinRequire('fs'), session=null, active=false;
    var values=[], last=0, steps=0, startSteps=0, startMs=0, startWall=0, phase='';
    fs.mkdirSync(dir,{recursive:true});
    function write(row) {
      fs.appendFileSync(dir+'/results.jsonl',JSON.stringify(row)+'\n');
      console.log('[game-bench] '+JSON.stringify(row));
    }
    function post(method,params) {
      return new Promise(function(resolve,reject){session.post(method,params||{},function(e,r){e?reject(e):resolve(r);});});
    }
    function hardware() {
      function read(file){try{return fs.readFileSync(file,'utf8');}catch(_){return '';}}
      var available=/MemAvailable:\s+(\d+)/.exec(read('/proc/meminfo'));
      var rss=/VmRSS:\s+(\d+)/.exec(read('/proc/self/status'));
      return {temperatureMilliC:Number(read('/sys/class/thermal/thermal_zone0/temp')),
        cpuKHz:Number(read('/sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq')),
        availableKiB:available&&Number(available[1]),rssKiB:rss&&Number(rss[1])};
    }
    var update=SceneManager.updateScene;
    SceneManager.updateScene=function(){steps++;return update.apply(this,arguments);};
    var present=globalThis.__pmjsAfterPresent;
    globalThis.__pmjsAfterPresent=function(){
      if(present)present.apply(this,arguments);
      if(active){var now=performance.now();if(last)values.push(now-last);last=now;}
    };
    return {
      write:write,
      start:async function(label){
        if(active)throw Error('Measurement already active');
        if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid profile label');
        if(profile){
          if(!session){session=new (__pmjsBuiltinRequire('inspector').Session)();session.connect();}
          await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');
        }
        phase=label;values=[];last=0;startSteps=steps;startMs=performance.now();startWall=Date.now();active=true;
        write({type:'phase-start',phase:phase,time:startWall,scene:SceneManager._scene.constructor.name,map:$gameMap.mapId()});
      },
      stop:async function(extra){
        if(!active)throw Error('No active measurement');
        var endMs=performance.now(),endWall=Date.now(),count=steps-startSteps;active=false;
        var frame=summarize(values);
        if(!frame)throw Error('No presented frame intervals');
        if(profile){var result=await post('Profiler.stop');fs.writeFileSync(dir+'/'+phase+'.cpuprofile',JSON.stringify(result.profile));}
        var row=Object.assign({type:'phase',phase:phase,startTime:startWall,time:endWall,
          scene:SceneManager._scene.constructor.name,map:$gameMap.mapId(),frame:frame,
          logicSteps:count,logicHz:count*1000/(endMs-startMs),profile:profile,hardware:hardware()},extra||{});
        write(row);
        fs.appendFileSync(dir+'/fps.jsonl',JSON.stringify({t:endWall/1000,scene:row.scene,map:row.map,
          name:($dataMapInfos[row.map]||{}).name||row.scene,sub:phase,secs:frame.frames/frame.fps,
          frames:frame.frames,fps:frame.fps,logic:row.logicHz,p50:frame.p50,p95:frame.p95,
          max:frame.max,hitch:frame.hitches100ms})+'\n');
        return row;
      },
      close:function(){active=false;if(session)session.disconnect();}
    };
  }
  globalThis.PMJSGameMetrics={summarize:summarize,create:create};
})();
