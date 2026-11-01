'use strict';
// Look Outside MZ fixture adapter. Loaded only by run-device.sh, never the play launcher.
(function(){
  var env=function(k){return NativeHost.runtime.env(k);}, dir=env('GAME_BENCH_DIR');
  if(!dir)return;
  PMJS.phases.on('afterPlugins','research.lookoutside-bench',function(){
    var timers=__pmjsBuiltinRequire('timers'), metrics=PMJSGameMetrics.create(dir,env('GAME_BENCH_PROFILE')==='1');
    var mode=env('GAME_BENCH_MODE')||'measure', seconds=Number(env('GAME_BENCH_SECONDS')||15);
    var state='title',stage=0,pending=false,entered=performance.now(),mapId=0,route=null,positions=null;
    var labels=['standing','walking','menu','items'],oldInput={},pulses=0,lastScene='',selectedMode=false,freeSince=0,walkAttempts=0,nextDiagnostic=0,retainedStart=null;
    function active(scene){return scene&&scene.isStarted()&&scene.isActive()&&
      (scene.constructor.name!=='Scene_Map'||(globalThis.$dataMap&&scene._mapLoaded));}
    function free(){return !$gameMessage.isBusy()&&!$gameMap.isEventRunning()&&$gamePlayer.canMove();}
    function restore(){Object.keys(oldInput).forEach(function(k){Input[k]=oldInput[k];});}
    function fail(e){metrics.write({type:'failure',error:String(e&&e.stack||e)});restore();metrics.close();timers.clearInterval(poll);SceneManager.exit();}
    function done(){restore();metrics.write({type:'complete',mode:mode,phases:['seed','title','retained-probe'].includes(mode)?0:labels.length});metrics.close();timers.clearInterval(poll);SceneManager.exit();}
    function playerState(){return {x:$gamePlayer.x,y:$gamePlayer.y,realX:$gamePlayer._realX,realY:$gamePlayer._realY,
      moving:$gamePlayer.isMoving(),canMove:$gamePlayer.canMove(),eventBusy:$gameMap.isEventRunning(),messageBusy:$gameMessage.isBusy(),
      message:$gameMessage.isBusy()?($gameMessage._texts||[]).join(' ').slice(0,160):null};}
    function retention(){var r=PMJS.pixi5&&PMJS.pixi5.retained||PMJS.pixi4&&PMJS.pixi4.retained;
      return r&&r.stats?JSON.parse(JSON.stringify(r.stats)):null;}
    function capability(){return {type:'retained-capability',engine:Utils.RPGMAKER_NAME,pixi:PIXI.VERSION,
      renderer:PMJS.pixi5?'pixi5':'other',registered:PMJS.optimizations.ids().includes('render.retained-encoding'),
      pixi4Api:!!(PMJS.pixi4&&PMJS.pixi4.retained),pixi5Api:!!(PMJS.pixi5&&PMJS.pixi5.retained),
      statsAvailable:!!(retention()&&typeof retention().frames==='number')};}
    function next(){
      if(stage>=labels.length){SceneManager.pop();state='return';return;}
      state='transition';entered=performance.now();
      if(labels[stage]==='menu')SceneManager.push(Scene_Menu);
      if(labels[stage]==='items')SceneManager._scene.commandItem();
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
        if(key==='ok'&&(pretitle||(['new-game','loading','loaded','warmup'].includes(state)&&globalThis.$gameMessage&&$gameMessage.isBusy())))
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
        if(['new-game','loaded'].includes(state)&&(n!=='Scene_Map'||!active(s)||!free()||$gamePlayer.isMoving()))freeSince=0;
        if(n!==lastScene){metrics.write({type:'scene',scene:n,state:state});lastScene=n;}
        if(state==='loaded'&&n==='Scene_Map'&&now-entered>10000&&now>nextDiagnostic){
          nextDiagnostic=now+5000;metrics.write({type:'load-readiness',player:playerState()});
        }
        if(now-entered>180000&&state!=='measuring')throw Error('Fixture navigation timed out: '+state+'/'+n);
        if(state==='title'&&n==='Scene_Title'&&active(s)&&!SceneManager.isSceneChanging()){
          metrics.write(capability());
          if(mode==='retained-probe'){done();return;}
          if(mode==='title'){done();return;}
          if(mode==='seed'){s.commandNewGame();state='new-game';entered=now;}
          else{
            var seed=12345;Math.random=function(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
            SceneManager.push(Scene_Load);state='loading';entered=now;
          }
        }else if(state==='loading'&&n==='Scene_Load'&&active(s)&&!SceneManager.isSceneChanging()){
          s.executeLoad(1);state='loaded';entered=now;
        }else if(state==='new-game'&&!selectedMode&&$gameMap.mapId()===5&&SceneManager.Scene_WdItems&&
          s instanceof SceneManager.Scene_WdItems&&active(s)&&s._wdItemWindow.isOpenAndActive()){
          var pool=$gameParty.items().filter(function(item){return item.meta.WD_Items&&
            (item.meta.WD_Items.includes(String($gameVariables.value(69)))||item.meta.WD_Items.includes(String($gameVariables.value(68))));});
          var index=pool.findIndex(function(item){return item.id===498&&item.name==='Survivor Mode';});
          if(index<0||pool.length!==s._wdItemWindow.maxItems())throw Error('Unexpected difficulty selector contents');
          selectedMode=true;metrics.write({type:'difficulty',itemId:498,name:'Survivor Mode'});
          s._wdItemWindow.select(index);s._wdItemWindow.processOk();
        }else if(state==='new-game'&&n==='Scene_Map'&&active(s)&&$gameMap.mapId()!==5&&free()&&!$gamePlayer.isMoving()&&now-entered>5000){
          if(!freeSince)freeSince=now;if(now-freeSince<3000)return;
          pending=true;restore();$gameSystem.onBeforeSave();await DataManager.saveGame(1);
          if(!DataManager.savefileExists(1))throw Error('MZ fixture save missing after successful save');
          metrics.write({type:'fixture',map:$gameMap.mapId(),x:$gamePlayer.x,y:$gamePlayer.y,party:$gameParty.members().length});done();
        }else if(state==='loaded'&&n==='Scene_Map'&&active(s)&&!SceneManager.isSceneChanging()&&free()&&!$gamePlayer.isMoving()){
          if(!freeSince)freeSince=now;if(now-freeSince<15000)return;
          mapId=$gameMap.mapId();route=chooseRoute();metrics.write({type:'route',map:mapId,route:route,player:playerState()});next();
        }else if(state==='transition'&&active(s)&&!SceneManager.isSceneChanging()&&
          n===(stage===2?'Scene_Menu':stage===3?'Scene_Item':'Scene_Map')){state='warmup';entered=now;}
        else if(state==='warmup'&&n==='Scene_Map'&&!free()){entered=now;}
        else if(state==='warmup'&&now-entered>=5000){
          restore();Input.clear();
          pending=true;positions={minX:$gamePlayer.x,maxX:$gamePlayer.x,minY:$gamePlayer.y,maxY:$gamePlayer.y};
          retainedStart=retention();await metrics.start(labels[stage]);entered=performance.now();state='measuring';pending=false;
        }else if(state==='measuring'){
          if(n!==(stage===2?'Scene_Menu':stage===3?'Scene_Item':'Scene_Map')||$gameMap.mapId()!==mapId)
            throw Error('Fixture changed scene or map');
          if(stage<2&&!free())throw Error('Player control interrupted during measurement: '+JSON.stringify(playerState()));
          positions.minX=Math.min(positions.minX,$gamePlayer.x);positions.maxX=Math.max(positions.maxX,$gamePlayer.x);
          positions.minY=Math.min(positions.minY,$gamePlayer.y);positions.maxY=Math.max(positions.maxY,$gamePlayer.y);
          if(stage===1&&!$gamePlayer.isMoving()&&free()){
            walkAttempts++;$gamePlayer.moveStraight($gamePlayer.x===route.x&&$gamePlayer.y===route.y?route.d:10-route.d);
          }
          if(now-entered>=seconds*1000){
            var retainedDelta=retention();if(retainedDelta)Object.keys(retainedDelta).forEach(function(k){retainedDelta[k]-=(retainedStart||{})[k]||0;});
            pending=true;await metrics.stop({positions:positions,player:playerState(),walkAttempts:walkAttempts,retained:retainedDelta});
            if(stage===1&&positions.minX===positions.maxX&&positions.minY===positions.maxY)throw Error('Walking fixture did not move: '+JSON.stringify(playerState()));
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
