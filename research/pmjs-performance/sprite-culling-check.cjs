// Decision checks for launcher/omori-performance.js against stub MV classes.
// node research/pmjs-performance/sprite-culling-check.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../../launcher/omori-performance.js'), 'utf8');
const listeners = [];
const context = {
  console, process: { env: {} },
  window: { addEventListener: (name, fn) => listeners.push(fn) },
  Graphics: { width: 640, height: 480 },
  $gameScreen: { zoomScale: () => 1 },
  SceneManager: { _windowShakeDuration: 0 }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`
  function Game_Event(x, y) { this.x = x; this.y = y; this._animationId = 0; this._balloonId = 0; this.reflections = []; this.endCalls = 0; }
  Game_Event.prototype.screenX = function () { return this.x; };
  Game_Event.prototype.screenY = function () { return this.y; };
  Game_Event.prototype.animationId = function () { return this._animationId; };
  Game_Event.prototype.balloonId = function () { return this._balloonId; };
  function Sprite_Character(character) { this._character = character; this._frame = { width: 32, height: 32 };
    this.scale = { x: 1, y: 1 }; this.visible = true; this.full = 0; this.animationUpdates = 0; this._animating = false;
    this.x = 0; this.y = 0; this.positionUpdates = 0; }
  Sprite_Character.prototype.update = function () { this.full++; this.updateAnimation(); this.updatePosition(); };
  Sprite_Character.prototype.updatePosition = function () { this.positionUpdates++; this.x = this._character.screenX(); this.y = this._character.screenY(); };
  Sprite_Character.prototype.updateVisibility = function () { this.visible = true; };
  Sprite_Character.prototype.updateAnimation = function () { this.animationUpdates++; if (!this._animating) this._character.endCalls++; };
  Sprite_Character.prototype.isAnimationPlaying = function () { return this._animating; };
  Sprite_Character.prototype.isBalloonPlaying = function () { return false; };
  function Sprite_CharacterReflect(character) { Sprite_Character.call(this, character); this.visible = false; }
  Sprite_CharacterReflect.prototype = Object.create(Sprite_Character.prototype);
  Sprite_CharacterReflect.prototype.constructor = Sprite_CharacterReflect;
  Sprite_CharacterReflect.prototype.update = function () {
    Sprite_Character.prototype.update.call(this); this.visible = this._character.reflections.length > 0; };
  function Spriteset_Map() { this.scale = { x: 1, y: 1 }; this._characterSprites = []; }
  Spriteset_Map.prototype.createCharacters = function () {};
  Spriteset_Map.prototype.update = function () { this._characterSprites.forEach(function (s) { s.update(); }); };
`, context);
vm.runInContext(source, context);
listeners.forEach(fn => fn());
const { Game_Event, Sprite_Character, Sprite_CharacterReflect, Spriteset_Map, OmoriPerformance } = context;
assert.equal(OmoriPerformance.installed, true);

const spriteset = new Spriteset_Map();
const far = new Sprite_Character(new Game_Event(2000, 2000));
const near = new Sprite_Character(new Game_Event(300, 200));
const reflection = new Sprite_CharacterReflect(new Game_Event(300, 200));
spriteset._characterSprites.push(far, near, reflection);
spriteset.createCharacters();
const step = () => spriteset.update();

step();
assert.deepEqual([far.full, near.full, reflection.full], [1, 1, 1], 'every sprite gets a first full update');
step(); step();
assert.equal(far.full, 1, 'idle off-screen sprite is skipped');
assert.equal(far.animationUpdates, 3, 'skipped sprite still runs updateAnimation');
assert.equal(far._character.endCalls, 3, 'animation/balloon playing flags are still cleared');
assert.equal(near.full, 3, 'on-screen sprite always updates');
far._character.x = 3000; far._character.y = 3000; step();
assert.equal(far.full, 1, 'a teleported off-screen sprite is still skipped');
assert.deepEqual([far.x, far.y], [3000, 3000], 'a skipped sprite still tracks the character position');
assert.equal(reflection.full, 1, 'invisible reflection without reflections is skipped');

far._character._animationId = 5; step();
assert.equal(far.full, 2, 'requested animation forces a full update');
far._character._animationId = 0; far._animating = true; step();
assert.equal(far.full, 3, 'playing animation forces a full update');
far._animating = false;

far.update();
assert.equal(far.full, 4, 'direct update() outside the spriteset runs in full');

far._labelDelay = 2; step(); step();
assert.equal(far.full, 4, 'pending label countdown is emulated while skipped');
assert.equal(far._labelDelay, 0);
step();
assert.equal(far.full, 5, 'label due: full update creates it');
far._miniLabel = { parent: null, _text: '' }; step();
assert.equal(far.full, 5, 'empty detached label allows skipping');
far._miniLabel._text = 'Hi'; step();
assert.equal(far.full, 6, 'label with text forces a full update');
far._miniLabel = { parent: {}, _text: 'Hi' }; step();
assert.equal(far.full, 7, 'attached label forces a full update');
delete far._miniLabel; delete far._labelDelay;

reflection._character.reflections = [{}]; step();
assert.equal(reflection.full, 2, 'reflection with a surface updates fully');
assert.equal(reflection.visible, true);
reflection._character.reflections = []; step(); step();
assert.equal(reflection.full, 3, 'first step after leaving the surface hides it, then it is skipped');

context.$gameScreen.zoomScale = () => 2; step();
assert.equal(far.full, 8, 'zoomed view disables off-screen skipping');
console.log('sprite culling decisions: all checks passed', JSON.stringify(OmoriPerformance));
