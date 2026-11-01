'use strict';
// Look Outside MZ fixture adapter. Loaded only by run-device.sh, never the play launcher.
(function(){
  var env=function(k){return NativeHost.runtime.env(k);}, dir=env('GAME_BENCH_DIR');
  if(!dir)return;
  PMJS.phases.on('afterPlugins','research.lookoutside-bench',function(){
    var timers=__pmjsBuiltinRequire('timers'), metrics=PMJSGameMetrics.create(dir,env('GAME_BENCH_PROFILE')==='1');
    var mode=env('GAME_BENCH_MODE')||'measure', seconds=Number(env('GAME_BENCH_SECONDS')||15);
    var state='title',stage=0,pending=false,entered=performance.now(),mapId=0,route=null,positions=null;
    var labels=['standing','walking','menu','items'],oldInput={},pulses=0,lastScene='';
    function active(scene){return scene&&SceneManager._sceneStarted&&scene.isActive()&&
      (scene.constructor.name!=='Scene_Map'||(globalThis.$dataMap&&scene._mapLoaded));}
    function free(){return !$gameMessage.isBusy()&&!$gameMap.isEventRunning()&&$gamePlayer.canMove();}
    function restore(){Object.keys(oldInput).forEach(function(k){Input[k]=oldInput[k];});}
    function fail(e){metrics.write({type:'failure',error:String(e&&e.stack||e)});restore();metrics.close();timers.clearInterval(poll);SceneManager.exit();}
    function done(){restore();metrics.write({type:'complete',mode:mode,phases:mode==='seed'||mode==='title'?0:labels.length});metrics.close();timers.clearInterval(poll);SceneManager.exit();}
    function next(){
      if(stage>=labels.length){SceneManager.pop();state='return';return;}
      state='transition';entered=performance.now();
      if(labels[stage]==='menu')SceneManager.push(Scene_Menu);
      if(labels[stage]==='items')SceneManager.push(Scene_Item);
    }
    function chooseRoute(){
      var x=$gamePlayer.x,y=$gamePlayer.y;
      for(var d of [8,6,4,2]){
        var nx=$gameMap.roundXWithDirection(x,d),ny=$gameMap.roundYWithDirection(y,d);
        if($gamePlayer.canPass(x,y,d)&&$gamePlayer.canPass(nx,ny,10-d)&&!$gameMap.eventsXy(nx,ny).length)
          return {x:x,y:y,nx:nx,ny:ny,d:d};
      }
      throw Error('No safe adjacent walking fixture tile at '+x+','+y);
    }
    ['isPressed','isTriggered','isRepeated','isLongPressed'].forEach(function(k){
      oldInput[k]=Input[k];Input[k]=function(key){
        var s=SceneManager._scene,pretitle=s&&s.constructor.name==='Scene_PretitleMap';
        if(key==='ok'&&(pretitle||(mode==='seed'&&globalThis.$gameMessage&&$gameMessage.isBusy())))
          return k!=='isLongPressed'&&pulses%12<2;
        return oldInput[k].apply(this,arguments);
      };
    });
    metrics.write({type:'session',game:'Look Outside',engine:Utils.RPGMAKER_NAME,version:Utils.RPGMAKER_VERSION,
      mode:mode,profile:env('GAME_BENCH_PROFILE')==='1',nativePhaseStats:false,disabled:env('PMJS_DISABLE_OPT')||''});
    async function advance(){
      if(pending)return;pulses++;
      try{
        var s=SceneManager._scene,n=s&&s.constructor.name,now=performance.now();
        if(n!==lastScene){metrics.write({type:'scene',scene:n,state:state});lastScene=n;}
        if(now-entered>180000&&state!=='measuring')throw Error('Fixture navigation timed out: '+state+'/'+n);
        if(state==='title'&&n==='Scene_Title'&&active(s)&&!SceneManager.isSceneChanging()){
          if(mode==='title'){done();return;}
          if(mode==='seed'){s.commandNewGame();state='new-game';entered=now;}
          else{
            restore();pending=true;await DataManager.loadGame(1);$gameSystem.onAfterLoad();
            var seed=12345;Math.random=function(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
            SceneManager.goto(Scene_Map);state='loaded';entered=performance.now();pending=false;
          }
        }else if(state==='new-game'&&n==='Scene_Map'&&active(s)&&$gameMap.mapId()!==5&&free()&&now-entered>5000){
          pending=true;restore();$gameSystem.onBeforeSave();await DataManager.saveGame(1);
          if(!DataManager.savefileExists(1))throw Error('MZ fixture save missing after successful save');
          metrics.write({type:'fixture',map:$gameMap.mapId(),x:$gamePlayer.x,y:$gamePlayer.y,party:$gameParty.members().length});done();
        }else if(state==='loaded'&&n==='Scene_Map'&&active(s)&&!SceneManager.isSceneChanging()&&free()){
          mapId=$gameMap.mapId();route=chooseRoute();metrics.write({type:'route',map:mapId,route:route});next();
        }else if(state==='transition'&&active(s)&&!SceneManager.isSceneChanging()&&
          n===(stage===2?'Scene_Menu':stage===3?'Scene_Item':'Scene_Map')){state='warmup';entered=now;}
        else if(state==='warmup'&&now-entered>=5000){
          pending=true;positions={minX:$gamePlayer.x,maxX:$gamePlayer.x,minY:$gamePlayer.y,maxY:$gamePlayer.y};
          await metrics.start(labels[stage]);entered=performance.now();state='measuring';pending=false;
        }else if(state==='measuring'){
          if(n!==(stage===2?'Scene_Menu':stage===3?'Scene_Item':'Scene_Map')||$gameMap.mapId()!==mapId)
            throw Error('Fixture changed scene or map');
          positions.minX=Math.min(positions.minX,$gamePlayer.x);positions.maxX=Math.max(positions.maxX,$gamePlayer.x);
          positions.minY=Math.min(positions.minY,$gamePlayer.y);positions.maxY=Math.max(positions.maxY,$gamePlayer.y);
          if(stage===1&&!$gamePlayer.isMoving()&&free())$gamePlayer.moveStraight(
            $gamePlayer.x===route.x&&$gamePlayer.y===route.y?route.d:10-route.d);
          if(now-entered>=seconds*1000){
            pending=true;await metrics.stop({positions:positions});
            if(stage===1&&positions.minX===positions.maxX&&positions.minY===positions.maxY)throw Error('Walking fixture did not move');
            stage++;pending=false;next();
          }
        }else if(state==='return'&&n==='Scene_Menu'&&active(s)&&!SceneManager.isSceneChanging()){
          SceneManager.pop();state='return-map';entered=now;
        }else if(state==='return-map'&&n==='Scene_Map'&&active(s)&&!SceneManager.isSceneChanging())done();
      }catch(error){pending=false;fail(error);}
    }
    var poll=timers.setInterval(advance,25);
  });
})();
