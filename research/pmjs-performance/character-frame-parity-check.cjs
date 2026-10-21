'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const production = process.argv.includes('--production');
function extract(file, marker, end = '\n};') {
  const source = fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
  const position = source.indexOf(marker), start = source.indexOf('function',position);
  if (position < 0) throw new Error('missing method '+marker);
  return source.slice(start,source.indexOf(end,start)+end.length).replace(/;$/,'');
}
const names = ['characterBlockX','characterBlockY','characterPatternX','characterPatternY','patternWidth','patternHeight'];
const methods = {};
for (const name of names) {
  methods[name] = extract('project/js/plugins/Custom_Character_Rectangles.js','Sprite_Character.prototype.'+name+' =');
  methods['stock_'+name] = extract('project/js/rpg_sprites.js','Sprite_Character.prototype.'+name+' =');
}
methods.frame = extract('project/js/plugins/Omori BASE.js','Sprite_Character.prototype.updateCharacterFrame =');
methods.inner = extract('pmjs/js/pmjs-mv/character-presentation.js','Sprite_Character.prototype.updateCharacterFrame =','\n  };');
methods.stockFrame = extract('project/js/rpg_sprites.js','Sprite_Character.prototype.updateCharacterFrame =');
methods.emf = extract('project/js/plugins/ExtraMovementFrames.js','Sprite_Character.prototype.patternWidth =','\n\t};');
methods.isEmf = extract('project/js/plugins/ExtraMovementFrames.js','Game_CharacterBase.prototype.isEmfCharacter =','\n\t};');
let source = fs.readFileSync(production ? path.join(root,'launcher/pmjs/character-frames.js')
  : path.join(__dirname,'character-frame-experiment.js'),'utf8');
if (production) source = source.replace('        var width = bitmap.width /',
  '        globalThis.__frameHits = (globalThis.__frameHits || 0)+1; var width = bitmap.width /');
function fixture(enabled) {
  const c = vm.createContext({__pmjsBuiltinRequire:require,console:{log(){}}});
  vm.runInContext(`
    var actions=[], callback;
    function Game_CharacterBase(){this._customFrameX=this._customFrameY=this._customFrameWidth=this._customFrameHeight=null;this._singleFrame=false;this._isEmfCharacter=false;this._characterIndex=3;this._pattern=1;this._direction=2;}
    Game_CharacterBase.prototype.isSingleFrame=function() { return this._singleFrame; };
    Game_CharacterBase.prototype.isEmfCharacter=(${methods.isEmf});
    Game_CharacterBase.prototype.emfCharacterState=function(){return {frameNum:5};};
    Game_CharacterBase.prototype.characterIndex=function(){return this._characterIndex;};
    Game_CharacterBase.prototype.pattern=function(){actions.push('pattern');return this._pattern;};
    Game_CharacterBase.prototype.direction=function(){return this._direction;};
    function Sprite_Character(){this._character=new Game_CharacterBase();this.bitmap={width:576,height:384};this._isBigCharacter=false;this._tileId=0;this._bushDepth=0;this._frame={};
      this._upperBody={setFrame:function(){actions.push(['upper',...arguments]);}};this._lowerBody={setFrame:function(){actions.push(['lower',...arguments]);}};}
    Sprite_Character.prototype.setFrame=function(x,y,width,height){this._frame={x,y,width,height};actions.push(['frame',x,y,width,height]);};
    Sprite_Character.prototype.updateHalfBodySprites=function(){actions.push('half-body');if(this.changeBush)this._bushDepth=12;};
    var $gameMap={tileWidth:function(){return 48;},tileHeight:function(){return 48;}};
    var _TDS_={CustomCharacterRectangles:{},OmoriBASE:{}},ModernAlgebra={EMF:{}};
    var presentation={dimensions:function(){return null;}},spriteMethods={updateCharacterFrame:(${methods.stockFrame})};
    ModernAlgebra.EMF.SpriteCharacter_patternWidth=(${methods.stock_patternWidth});
  `,c);
  for (const name of names) vm.runInContext(`
    _TDS_.CustomCharacterRectangles.Sprite_Character_${name}=(${name==='patternWidth'?methods.emf:methods['stock_'+name]});
    Sprite_Character.prototype.${name}=(${methods[name]});`,c);
  vm.runInContext(`_TDS_.OmoriBASE.Sprite_Character_updateCharacterFrame=(${methods.inner});
    Sprite_Character.prototype.updateCharacterFrame=(${methods.frame});
    var SceneManager={_scene:{constructor:{name:'Scene_OmoriTitleScreen'}}};
    function setInterval(fn){callback=fn;return 1;}function clearInterval(){}`,c);
  if (production) {
    vm.runInContext(`var PMJS={plugins:{registerOptimization:function(){},onLoaded:function(name,owner,fn){fn();}},
      phases:{on:function(phase,owner,fn){fn();}},optimizations:{isEnabled:function(){return true;},refuse:function(id,why){throw new Error(why);}}};`,c);
    vm.runInContext(source,c);
    assert.ok(c.Sprite_Character.prototype.updateCharacterFrame._pmjsCharacterFramePredecessor,'production fingerprints must activate');
    if (!enabled) vm.runInContext('Sprite_Character.prototype.updateCharacterFrame=Sprite_Character.prototype.updateCharacterFrame._pmjsCharacterFramePredecessor;',c);
  } else {
    vm.runInContext(source,c);vm.runInContext('callback();',c);
    assert.ok(c.__omoriFrameExperiment,'reviewed sources must activate');
    c.__omoriFrameExperiment.setEnabled(enabled);
  }
  return c;
}
const cases = [];
for (const big of [false,true]) for (const direction of [2,4,6,8]) for (const pattern of [0,1,2]) for (const bush of [0,12])
  cases.push(`sprite._isBigCharacter=${big};sprite._character._direction=${direction};sprite._character._pattern=${pattern};sprite._bushDepth=${bush};`);
cases.push('sprite._character._customFrameX=2;','sprite._character._customFrameY=3;',
  'sprite._character._customFrameWidth=16;sprite._character._customFrameHeight=24;',
  'sprite._character._singleFrame=true;','sprite._character._isEmfCharacter=true;',
  'sprite.bitmap.width=0;sprite.bitmap.height=0;','sprite._tileId=32;',
  'sprite.patternWidth=function(){return 20;};','sprite.changeBush=true;',
  '_TDS_.CustomCharacterRectangles.Sprite_Character_characterBlockX=function(){return 8;};',
  'sprite._character.isSingleFrame=function(){actions.push("single-hook");return false;};',
  'sprite._character.pattern=function(){this._customFrameY=3;return 2;};',
  'sprite._character.characterIndex=function(){this._customFrameX=2;return 3;};');
for (const name of names) cases.push('_TDS_.CustomCharacterRectangles.Sprite_Character_'+name+'=function(){return 3;};');
cases.push('_TDS_.CustomCharacterRectangles=Object.assign({},_TDS_.CustomCharacterRectangles,{Sprite_Character_patternWidth:function(){return 19;}});',
  'ModernAlgebra.EMF=Object.assign({},ModernAlgebra.EMF,{SpriteCharacter_patternWidth:function(){return 19;}});');
let fast = 0;
for (const setup of cases) {
  let reference;
  for (const enabled of [false,true]) {
    const c = fixture(enabled);
    vm.runInContext('var sprite=new Sprite_Character();'+setup+'sprite.updateCharacterFrame();var observed=JSON.stringify({actions:actions,frame:sprite._frame});',c);
    if (!enabled) reference = c.observed;
    else { assert.equal(c.observed,reference,setup); fast += production ? c.__frameHits || 0 : c.__omoriFrameExperiment.snapshot().hits; }
  }
}
console.log(JSON.stringify({production:production,scenarios:cases.length,fastPathCases:fast,status:'passed'}));
