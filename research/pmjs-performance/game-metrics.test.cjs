'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(profile=false){
  let now=100,previous=0;const files=new Map();
  const fakeFs={mkdirSync(){},readFileSync(){return '';},
    appendFileSync(file,s){files.set(file,(files.get(file)||'')+s);},
    writeFileSync(file,s){files.set(file,s);}};
  class Session{
    connect(){}disconnect(){}
    post(method,params,callback){
      if(method==='Profiler.start')now+=1000;
      if(method==='Profiler.stop')now+=500;
      callback(null,method==='Profiler.stop'?{profile:{samples:[]}}:{});
    }
  }
  const context=vm.createContext({performance:{now:()=>now},Date:{now:()=>100000+now},
    console:{log(){}},SceneManager:{_scene:{constructor:{name:'Scene_Map'}},updateScene(){return 7;}},
    __pmjsAfterPresent(){previous++;},$gameMap:{mapId(){return 2;}},$dataMapInfos:[null,null,{name:'room'}],
    __pmjsBuiltinRequire(name){return name==='fs'?fakeFs:{Session};}});
  vm.runInContext(fs.readFileSync(__dirname+'/game-metrics.js','utf8'),context);
  return {context,files,metrics:context.PMJSGameMetrics.create('/test',profile),
    at(x){now=x;},now(){return now;},previous(){return previous;}};
}
test('common collector measures presented intervals, actual logic steps, and legacy FPS output',async()=>{
  const f=fixture();await f.metrics.start('standing');
  for(const n of [110,130,160]){f.at(n);f.context.__pmjsAfterPresent();}
  assert.equal(f.context.SceneManager.updateScene(),7);f.context.SceneManager.updateScene();
  const row=await f.metrics.stop();
  assert.equal(row.frame.frames,2);assert.equal(row.frame.fps,40);assert.equal(row.logicSteps,2);
  assert.equal(f.previous(),3);assert.equal(row.startTime,100100);assert.equal(row.time,100160);
  const fps=JSON.parse(f.files.get('/test/fps.jsonl'));
  assert.equal(fps.name,'room');assert.equal(fps.secs,.05);assert.equal(fps.frames,2);
});
test('profiler startup and shutdown do not inflate the measured FPS window',async()=>{
  const f=fixture(true);await f.metrics.start('menu');assert.equal(f.now(),1100);
  f.at(1110);f.context.__pmjsAfterPresent();f.at(1130);f.context.__pmjsAfterPresent();
  const row=await f.metrics.stop();
  assert.equal(f.now(),1630);assert.equal(row.startTime,101100);assert.equal(row.time,101130);
  assert.equal(row.frame.fps,50);assert.ok(f.files.has('/test/menu.cpuprofile'));
});
