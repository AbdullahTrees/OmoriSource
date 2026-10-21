'use strict';
// Differential checks against the user's local vanilla methods. No game data is copied into this file.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const production = process.argv.includes('--production');
const productionSource = fs.readFileSync(path.join(root, 'pmjs/js/pmjs-plugins/olivia/horror-effects.js'), 'utf8');
function extract(file, marker, end = '\n};') {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const position = source.indexOf(marker), start = source.indexOf('function', position);
  if (position < 0 || start < 0) throw new Error('missing reviewed method '+marker);
  return source.slice(start, source.indexOf(end, start)+end.length).replace(/;$/, '');
}
const methods = {
  update: extract('project/js/plugins/Olivia_HorrorEffects.js', 'Sprite.prototype.update ='),
  synchronize: extract('project/js/plugins/Olivia_HorrorEffects.js', 'Sprite.prototype.synchronizeHorrorFiltersWithSource ='),
  dispatcher: extract('project/js/plugins/Olivia_HorrorEffects.js', 'Sprite.prototype.updateHorrorEffects ='),
  children: extract('project/js/plugins/GTP_OmoriFixes.js', 'Olivia.HorrorEffects.___Sprite_update___ =', '\n\t}'),
  base: extract('project/js/rpg_sprites.js', 'Sprite_Base.prototype.update ='),
  visibility: extract('project/js/rpg_sprites.js', 'Sprite_Base.prototype.updateVisibility ='),
  animations: extract('project/js/rpg_sprites.js', 'Sprite_Base.prototype.updateAnimationSprites =')
};
for (const [key, method] of [['noise','Noise'],['glitch','Glitch'],['tv','TV']])
  methods[key] = extract('project/js/plugins/Olivia_HorrorEffects.js', 'Sprite.prototype.updateHorror'+method+' =');
methods.effects = fs.readFileSync(path.join(root, 'pmjs/js/pmjs-plugins/olivia/horror-effects.js'), 'utf8')
  .match(/var guarded = (function\(\) \{[\s\S]*?\n        \});/)[1];
const experiment = fs.readFileSync(path.join(__dirname, 'logic-experiments.js'), 'utf8');
function fixture(mode) {
  const context = vm.createContext({ __pmjsBuiltinRequire: require, console: { log() {} } });
  vm.runInContext(`
    var actions = [], randomCalls = 0, callback;
    Math.random = function() { randomCalls++; return 0.25; };
    function Sprite() { this.children=[]; this._horrorFilters={}; this._horrorFiltersSource=null; }
    function Sprite_Base() { Sprite.call(this); this._animationSprites=[]; this._hiding=false; this.visible=true; }
    Sprite_Base.prototype=Object.create(Sprite.prototype);
    var Olivia={HorrorEffects:{___Sprite_update___:(${methods.children})}};
    Sprite.prototype.update=(${methods.update});
    Sprite.prototype.synchronizeHorrorFiltersWithSource=(${methods.synchronize});
    Sprite.prototype.updateHorrorNoise=(${methods.noise});
    Sprite.prototype.updateHorrorGlitch=(${methods.glitch});
    Sprite.prototype.updateHorrorTV=(${methods.tv});
    Sprite.prototype.updateHorrorGlitchEffect=function(filter) { actions.push('glitch'); return filter; };
    Sprite.prototype.updateHorrorEffects=(function(knownNoise,knownGlitch,knownTV) {
      var original=(${methods.dispatcher});
      function hasActiveHorrorFilter(sprite) { var f=sprite._horrorFilters; return !!(f&&(f.noiseFilter||f.glitchFilter||f.tvFilter)); }
      return (${methods.effects});
    })(Sprite.prototype.updateHorrorNoise,Sprite.prototype.updateHorrorGlitch,Sprite.prototype.updateHorrorTV);
    Sprite_Base.prototype.update=(${methods.base});
    Sprite_Base.prototype.updateVisibility=(${methods.visibility});
    Sprite_Base.prototype.updateAnimationSprites=(${methods.animations});
    var PMJS={optimizations:{reportFallback:function(){actions.push('fallback');}}};
    var SceneManager={_scene:{constructor:{name:'Scene_OmoriTitleScreen'}}};
    var NativeHost={runtime:{env:function(){return 'baseline';}}};
    function setInterval(fn){callback=fn;return 1;} function clearInterval(){}
  `, context);
  if (production) {
    vm.runInContext(`
      Sprite.prototype.updateHorrorEffects=(${methods.dispatcher});
      PMJS.optimizations.isEnabled=function(){return true;};
      PMJS.optimizations.refuse=function(id,message){throw new Error(id+': '+message);};
      PMJS.plugins={registerOptimization:function(){},onLoaded:function(name,owner,callback){callback();}};
      PMJS.phases={on:function(phase,owner,callback){callback();}};
    `,context);
    vm.runInContext(productionSource, context);
    assert.ok(context.Sprite.prototype.update._pmjsOliviaPredecessor, 'real production fingerprints must activate');
    if (mode === 'baseline') vm.runInContext('Sprite.prototype.update=Sprite.prototype.update._pmjsOliviaPredecessor;',context);
  } else {
    vm.runInContext(experiment, context);
    vm.runInContext('callback();', context);
    assert.ok(context.__omoriLogicExperiments, 'reviewed sources must activate');
    context.__omoriLogicExperiments.setMode(mode);
  }
  return context;
}
const scenarios = {
  idle: `var sprite=new Sprite_Base(); sprite._hiding=true;`,
  child: `var sprite=new Sprite_Base(); sprite.children.push({update:function(){actions.push('child');}});`,
  appendedChild: `var sprite=new Sprite_Base(); sprite.children.push({update:function(){actions.push('first');sprite.children.push({update:function(){actions.push('appended');}});}});`,
  childEnablesNoise: `var sprite=new Sprite_Base(); sprite.children.push({update:function(){sprite._horrorFilters.noiseFilter={animated:true};}});`,
  childChangesDelegate: `var sprite=new Sprite_Base(); sprite.children.push({update:function(){sprite.updateHorrorNoise=function(){actions.push('custom-noise');};}});`,
  childChangesSynchronization: `var sprite=new Sprite_Base(); sprite.children.push({update:function(){sprite.synchronizeHorrorFiltersWithSource=function(){actions.push('late-child-sync');};}});`,
  lateDispatcher: `var sprite=new Sprite_Base(); sprite.updateHorrorEffects=function(){actions.push('custom-effects');return 42;};`,
  active: `var sprite=new Sprite_Base(); sprite._horrorFilters={noiseFilter:{animated:true},tvFilter:{animated:true,time:3,aniSpeed:2},glitchFilter:{}};`,
  source: `var sprite=new Sprite_Base(); sprite._horrorFilters.tvFilter={animated:true,time:3,aniSpeed:2}; sprite._horrorFiltersSource={_horrorFilters:{tvFilter:{needUpdate:false}}};`,
  lateSynchronization: `var sprite=new Sprite_Base(); sprite.synchronizeHorrorFiltersWithSource=function(){actions.push('custom-sync');};`,
  lateChildrenAlias: `var sprite=new Sprite_Base(); Olivia.HorrorEffects.___Sprite_update___=function(){actions.push('custom-children');};`,
  customVisibility: `var sprite=new Sprite_Base(); sprite.updateVisibility=function(){actions.push('custom-visible');};`,
  animation: `var sprite=new Sprite_Base(); sprite._animationSprites.push({isPlaying:function(){actions.push('playing');return false;},remove:function(){actions.push('removed');}}); Array.prototype.clone=function(){return this.slice();};`
};
let checks = 0;
for (const [name, setup] of Object.entries(scenarios)) {
  let reference;
  for (const mode of production ? ['baseline','fused'] : ['baseline','horror','base','both']) {
    const context = fixture(mode);
    vm.runInContext(setup+`; sprite.update(); var observed=JSON.stringify({actions:actions,filters:sprite._horrorFilters,
      visible:sprite.visible,randomCalls:randomCalls,animations:sprite._animationSprites.length,children:sprite.children.length});`, context);
    if (mode === 'baseline') reference = context.observed;
    else { assert.equal(context.observed, reference, name+' / '+mode); checks++; }
  }
}
console.log(JSON.stringify({ production: production, scenarios: Object.keys(scenarios).length, differentialChecks: checks, status: 'passed' }));
