'use strict';
// Differential test for launcher/perf/scene-fastpaths.js.
//
// The module's production install pins the reviewed game sources; for the behavioural tests the
// wrappers are installed with pins accepted (`installForTest(true)`) against fake classes that carry
// minimal copies of the reviewed bodies. Every check runs the same starting state through the wrapper
// and through the unwrapped original and compares the observable state. A separate check recomputes
// every pin from the real game files, so a renamed/moved method or a typo in a constant fails loudly.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const MODULE = fs.readFileSync(path.join(__dirname, 'scene-fastpaths.js'), 'utf8');
const GAME = path.resolve(__dirname, '../../project/js');

let checks = 0, failures = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('ok   ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + detail : ''));
}
function eq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), label,
    'actual ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected));
}

// ---------------------------------------------------------------------------------------------
// Pin recomputation from the reviewed files.
// ---------------------------------------------------------------------------------------------

function source(rel) {
  return fs.readFileSync(path.join(GAME, rel), 'utf8').replace(/\r\n/g, '\n');
}

// Balanced-brace slice; skips comments and string literals (the reviewed bodies contain both).
function balanced(text, from) {
  const start = text.indexOf('{', from);
  let depth = 0, mode = null, quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode === 'string') {
      if (c === '\\') { i++; continue; }
      if (c === quote) { mode = null; quote = null; }
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'") { mode = 'string'; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces at ' + from);
}

function extractedFunction(rel, marker) {
  const text = source(rel);
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('missing ' + marker + ' in ' + rel);
  const start = text.indexOf('function', at);
  const end = text.indexOf('{', start);
  const body = balanced(text, start);
  return text.slice(start, end + body.length);
}

function extractedStatic(rel, marker) {
  const text = source(rel);
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('missing ' + marker + ' in ' + rel);
  const start = at + 'static '.length;
  const end = text.indexOf('{', start);
  const body = balanced(text, start);
  return text.slice(start, end + body.length);
}

function digestText(text, kind, name) {
  let fn;
  if (kind === 'static') {
    fn = vm.runInNewContext('(class C { static ' + text + ' })')[name];
  } else {
    fn = vm.runInNewContext('(' + text + ')');
  }
  if (fn.toString() !== text) throw new Error('toString does not round-trip ' + name);
  return crypto.createHash('sha256').update(fn.toString().replace(/\r\n/g, '\n')).digest('hex');
}

const PINNED = [
  ['Window_NumberInput.update', 'rpg_windows.js', 'Window_NumberInput.prototype.update = function', 'assigned'],
  ['Window_MapName.update', 'plugins/Olivia_MapDisplayNameCore.js', 'Window_MapName.prototype.update = function', 'assigned'],
  ['Window_OmoriMapQTESmash.update', 'plugins/Omori Map QTE.js', 'Window_OmoriMapQTESmash.prototype.update = function', 'assigned'],
  ['Window_OmoriStopTheArrow.update', 'plugins/Omori Map QTE.js', 'Window_OmoriStopTheArrow.prototype.update = function', 'assigned'],
  ['Window_OmoriHitTheMark.update', 'plugins/Omori Map QTE.js', 'Window_OmoriHitTheMark.prototype.update = function', 'assigned'],
  ['Window_SkipCutscene.update', 'plugins/Olivia_SkipCutscene.js', 'Window_SkipCutscene.prototype.update = function', 'assigned'],
  ['Window_Base.update', 'plugins/TDS Text Effects.js', 'Window_Base.prototype.update = function', 'assigned'],
  ['Game_Map.updateVehicles', 'plugins/YEP_CoreEngine.js', 'Game_Map.prototype.updateVehicles = function', 'assigned'],
  ['Game_Vehicle.update', 'rpg_objects.js', 'Game_Vehicle.prototype.update = function', 'assigned'],
  ['Scene_Map.updateDestination', 'rpg_scenes.js', 'Scene_Map.prototype.updateDestination = function', 'assigned'],
  ['SceneManager.updateOverlayFix', 'plugins/GTP_OmoriFixes.js', 'static updateOverlayFix()', 'static'],
  ['SceneManager.updateWebAudio', 'plugins/GTP_OmoriFixes.js', 'static updateWebAudio()', 'static']
];

// ---------------------------------------------------------------------------------------------
// Fake game used by the behavioural checks.
// ---------------------------------------------------------------------------------------------

const FIXTURE = String.raw`
var logs = [];
var PMJS = { phases: { on: function (phase, id, cb) { PMJS.install = cb; } } };
var $gameSystem = { windowTone: function () { return [0, 0, 0, 0]; } };
var $gameMap = {
  isNameDisplayEnabled: function () { return true; },
  canvasToMapX: function (x) { return x; },
  canvasToMapY: function (y) { return y; }
};
var $gameTemp = {
  _destinationX: null, _destinationY: null,
  _canSkipCutscene: false, _skippingCutscene: false,
  isDestinationValid: function () { return this._destinationX !== null; },
  clearDestination: function () { this._destinationX = null; this._destinationY = null; this.clearCalls = (this.clearCalls || 0) + 1; },
  setDestination: function (x, y) { this._destinationX = x; this._destinationY = y; }
};
var $gamePlayer = { canMove: function () { return true; } };
var TouchInput = {
  _triggered: false, _pressed: false, x: 4, y: 4,
  isTriggered: function () { return this._triggered; },
  isPressed: function () { return this._pressed; }
};

// --- Window chain ---------------------------------------------------------------------------
function Window_Base() { this.initialize.apply(this, arguments); }
Window_Base.prototype.initialize = function () {
  this.openness = 0; this.opacity = 255; this._opening = false; this._closing = false;
  this.active = false; this.visible = true; this.children = [];
  this._windowContentsSprite = { alpha: 1 };
  this._animationCount = 0;
  this._tone = { r: 0, g: 0, b: 0, gray: 0 };
  this._dimmerSprite = { opacity: 0, visible: false };
  this._letterEffectsActive = false;
};
Object.defineProperty(Window_Base.prototype, 'contentsOpacity', {
  get: function () { return this._windowContentsSprite.alpha * 255; },
  set: function (v) { this._windowContentsSprite.alpha = Math.max(0, Math.min(255, v)) / 255; },
  configurable: true
});
Window_Base.prototype.isOpen = function () { return this.openness === 255; };
Window_Base.prototype.open = function () { if (this.openness < 255) this._opening = true; this._closing = false; };
Window_Base.prototype.close = function () { if (this.openness > 0) this._closing = true; this._opening = false; };
Window_Base.prototype.update = function () {
  if (this.active) this._animationCount++;
  for (var i = 0; i < this.children.length; i++) if (this.children[i].update) this.children[i].update();
  var tone = $gameSystem.windowTone();
  this._tone = { r: tone[0], g: tone[1], b: tone[2], gray: tone[3] };   // updateTone
  if (this._opening) { this.openness = Math.min(255, this.openness + 32); if (this.openness === 255) this._opening = false; }
  if (this._closing) { this.openness = Math.max(0, this.openness - 32); if (this.openness === 0) this._closing = false; }
  if (this._dimmerSprite) this._dimmerSprite.opacity = this.openness;
  if (this._letterEffectsActive) this._letterTicks = (this._letterTicks || 0) + 1;
};

function Window_Selectable() { this.initialize.apply(this, arguments); }
Window_Selectable.prototype = Object.create(Window_Base.prototype);
Window_Selectable.prototype.initialize = function () {
  Window_Base.prototype.initialize.call(this);
  this._stayCount = 0; this._index = -1; this._customCursorRectSprite = null;
};
Window_Selectable.prototype.isOpenAndActive = function () { return this.isOpen() && this.active; };
Window_Selectable.prototype.maxTopRow = function () { return 0; };
Window_Selectable.prototype.updateArrows = function () { this._arrows = this.maxTopRow() > 0; };
Window_Selectable.prototype.processCursorMove = function () { if (this.isOpenAndActive()) this._cursorMoves = (this._cursorMoves || 0) + 1; };
Window_Selectable.prototype.processHandling = function () { if (this.isOpenAndActive()) this._handlings = (this._handlings || 0) + 1; };
Window_Selectable.prototype.processWheel = function () { if (this.isOpenAndActive()) this._wheels = (this._wheels || 0) + 1; };
Window_Selectable.prototype.processTouch = function () { if (this.isOpenAndActive()) this._touches = (this._touches || 0) + 1; };
Window_Selectable.prototype.updateCustomCursorRectSpriteVisibility = function () {
  if (this._customCursorRectSprite) this._customCursorRectSprite.visible = this.openness === 255 && this.active;
};
Window_Selectable.prototype.update = function () {
  Window_Base.prototype.update.call(this);
  this.updateArrows();
  this.processCursorMove();
  this.processHandling();
  this.processWheel();
  this.processTouch();
  this._stayCount++;
  this.updateCustomCursorRectSpriteVisibility();
};
Window_Selectable.prototype.select = function (index) { this._index = index; this._stayCount = 0; };
Window_Selectable.prototype.activate = function () { this.active = true; };
Window_Selectable.prototype.deactivate = function () { this.active = false; this.select(this._index); };

function Sprite_Button() { this.visible = false; this._touching = false; this._frame = { width: 48, height: 48 }; }
Sprite_Button.prototype.update = function () { this.updateFrame(); this.processTouch(); };
Sprite_Button.prototype.updateFrame = function () { this._frame = { width: 48, height: 48 }; };
Sprite_Button.prototype.processTouch = function () { if (this.visible) this._touchProcessed = (this._touchProcessed || 0) + 1; else this._touching = false; };
Sprite_Button.prototype.snapshot = function () { return { visible: this.visible, frame: this._frame }; };

function Window_NumberInput() { this.initialize.apply(this, arguments); }
Window_NumberInput.prototype = Object.create(Window_Selectable.prototype);
Window_NumberInput.prototype.initialize = function () {
  Window_Selectable.prototype.initialize.call(this);
  this._buttons = []; this._number = 0; this._digitChanges = 0;
  for (var i = 0; i < 3; i++) { var b = new Sprite_Button(); this._buttons.push(b); this.children.push(b); }
};
Window_NumberInput.prototype.update = function () {
  Window_Selectable.prototype.update.call(this);
  this.processDigitChange();
};
Window_NumberInput.prototype.processDigitChange = function () { if (this.isOpenAndActive()) this._digitChanges++; };

function Window_MapName() { this.initialize.apply(this, arguments); }
Window_MapName.prototype = Object.create(Window_Base.prototype);
Window_MapName.prototype.initialize = function () {
  Window_Base.prototype.initialize.call(this);
  this.opacity = 0; this.contentsOpacity = 0; this._showCount = 0; this._step = 'Fade Out';
};
Window_MapName.prototype.update = function () {
  Window_Base.prototype.update.call(this);
  if (this.isOpen() && this._showCount > 0 && $gameMap.isNameDisplayEnabled()) this.updateStep();
  else this.updateFadeOut();
};
Window_MapName.prototype.updateStep = function () {
  this._showCount--;
  if (this._showCount <= 0) { this._showCount = 30; this._step = 'Fade Out'; }
};
Window_MapName.prototype.updateFadeOut = function () {
  this.contentsOpacity = Math.max(0, this.contentsOpacity - 16);
  this.opacity = Math.max(0, this.opacity - 16);
};

function makeQte(kind) {
  function C() { this.initialize.apply(this, arguments); }
  C.prototype = Object.create(Window_Base.prototype);
  C.prototype.initialize = function () {
    Window_Base.prototype.initialize.call(this);
    this._openness = 0; this._bar = { scaleY: 0, y: 0 }; this._ticks = 0;
  };
  Object.defineProperty(C.prototype, 'openness', {
    get: function () { return this._openness; },
    set: function (v) {
      this._openness = Math.max(0, Math.min(255, v));
      if (this._bar) { this._bar.scaleY = this._openness / 255; this._bar.y = 5 + (this.height || 50) / 2 * (1 - this._openness / 255); }
    },
    configurable: true
  });
  C.prototype.isOpen = function () { return this._openness === 255; };
  if (kind === 'smash') {
    C.prototype.update = function () {
      Window_Base.prototype.update.call(this);
      if (!this.isOpen() || !this.active) return;
      this._ticks++;
    };
  } else if (kind === 'stop') {
    C.prototype.update = function () {
      Window_Base.prototype.update.call(this);
      if (this.active && this.isOpen()) this._ticks++;
    };
  } else {
    C.prototype.update = function () {
      Window_Base.prototype.update.call(this);
      if (this._stop || !this.active) return;
      this._ticks++; this._pointer.x = 0; this._pointer.visible = true;
    };
  }
  return C;
}
var Window_OmoriMapQTESmash = makeQte('smash');
var Window_OmoriStopTheArrow = makeQte('stop');
var Window_OmoriHitTheMark = makeQte('mark');

function Window_SkipCutscene() { this.initialize.apply(this, arguments); }
Window_SkipCutscene.prototype = Object.create(Window_Base.prototype);
Window_SkipCutscene.prototype.initialize = function () {
  Window_Base.prototype.initialize.call(this);
  this.opacity = 0; this.contentsOpacity = 0;
  this._gaugeSpriteRate = { opacity: 1, _frame: { width: 0, height: 10 } };
  this._gaugeSpriteBack = { opacity: 1 };
  this.children.push(this._gaugeSpriteRate, this._gaugeSpriteBack);
};
Window_SkipCutscene.prototype.update = function () {
  Window_Base.prototype.update.call(this);
  this.updateOpacity();
  if (this._gaugeSpriteRate) this.updateGaugeSprites();
};
Window_SkipCutscene.prototype.updateOpacity = function () {
  var change = ($gameTemp._canSkipCutscene && SceneManager._scene._skipCutsceneDuration) ? 24 : -24;
  this.contentsOpacity += change;
};
Window_SkipCutscene.prototype.updateGaugeSprites = function () {
  this._gaugeSpriteRate.opacity = this.contentsOpacity;
  this._gaugeSpriteBack.opacity = this.contentsOpacity;
  var rate = $gameTemp._skippingCutscene ? 1 : (SceneManager._scene._skipCutsceneDuration / 180);
  this._gaugeSpriteRate._frame = { width: rate * 100, height: 10 };
};

// --- Vehicles -------------------------------------------------------------------------------
function Game_Vehicle(o) {
  o = o || {};
  this._mapId = o.mapId === undefined ? 0 : o.mapId;
  this._driving = !!o.driving; this._moveRouteForcing = !!o.forcing;
  this._altitude = o.altitude || 0;
  this._stopCount = o.stop === undefined ? 5 : o.stop;
  this._animationCount = o.anim || 0;
  this._pattern = o.pattern === undefined ? 1 : o.pattern;
  this._stepAnime = false; this._walkAnime = false; this._type = o.type || 'boat';
  this._x = o.x || 1; this._y = o.y || 1;
  this._moving = !!o.moving; this._jumping = !!o.jumping;
  this.updateCalls = 0;
  if (o.override) this.update = function () { this.overrideCalls = (this.overrideCalls || 0) + 1; };
}
Game_Vehicle.prototype.pattern = function () { return this._pattern < 3 ? this._pattern : 1; };
Game_Vehicle.prototype.isOriginalPattern = function () { return this.pattern() === 1; };
Game_Vehicle.prototype.isMoving = function () { return this._moving; };
Game_Vehicle.prototype.isJumping = function () { return this._jumping; };
Game_Vehicle.prototype.animationWait = function () { return 15; };
Game_Vehicle.prototype.update = function () {
  this.updateCalls++;
  if (this._moving || this._jumping) this._x++;
  else this._stopCount++;
  if (this._moving && this._walkAnime) this._animationCount += 1.5;
  else if (this._stepAnime || !this.isOriginalPattern()) this._animationCount++;
  if (this._animationCount >= this.animationWait()) {
    this._pattern = this._stepAnime ? (this._pattern + 1) % 4 : 1;
    this._animationCount = 0;
  }
  if (this._type === 'airship' && !this._driving && this._altitude > 0) this._altitude--;
};

function Game_Map(vehicles) { this._vehicles = vehicles; this._mapId = 92; }
Game_Map.prototype.mapId = function () { return this._mapId; };
Game_Map.prototype.updateVehicles = function () {
  var group = this._vehicles, length = group.length;
  for (var i = 0; i < length; i++) { var v = group[i]; if (v) v.update(); }
};

// --- Scene / canvas / audio -----------------------------------------------------------------
function Scene_Map() { this._touchCount = 0; this._active = true; this._canMove = true; }
Scene_Map.prototype.isActive = function () { return this._active; };
Scene_Map.prototype.isMapTouchOk = function () { return this.isActive() && this._canMove; };
Scene_Map.prototype.processMapTouch = function () {
  if (TouchInput.isTriggered() || this._touchCount > 0) {
    if (TouchInput.isPressed()) {
      if (this._touchCount === 0 || this._touchCount >= 15) {
        $gameTemp.setDestination($gameMap.canvasToMapX(TouchInput.x), $gameMap.canvasToMapY(TouchInput.y));
      }
      this._touchCount++;
    } else {
      this._touchCount = 0;
    }
  }
};
Scene_Map.prototype.updateDestination = function () {
  if (this.isMapTouchOk()) this.processMapTouch();
  else { $gameTemp.clearDestination(); this._touchCount = 0; }
};

var Graphics = { frameCount: 0, _overlayFix: null };
function fakeCanvas() {
  var canvas = { clears: 0, width: 640, height: 480 };
  canvas.getContext = function () { return { clearRect: function () { canvas.clears++; } }; };
  return canvas;
}
function SceneManager() {}
SceneManager._scene = { _skipCutsceneDuration: 0 };
SceneManager._focused = true;
SceneManager.isFocus = function () { return this._focused; };
SceneManager.updateOverlayFix = function () {
  if (Graphics._overlayFix && Graphics.frameCount % 2 === 0) {
    Graphics._overlayFix.getContext('2d').clearRect(0, 0, 640, 480);
  }
};
var WebAudio = {
  _masterVolume: 1,
  _context: { state: 'running', resume: function () { this.resumeCalls = (this.resumeCalls || 0) + 1; this.state = 'running'; }, suspend: function () { this.suspendCalls = (this.suspendCalls || 0) + 1; this.state = 'suspended'; } },
  _masterGainNode: { gain: { value: 1, setValueAtTime: function (v) { this.value = v; this.calls = (this.calls || 0) + 1; } } },
  setMasterVolume: function (v) {
    this._masterVolume = v;
    if (this._masterGainNode) this._masterGainNode.gain.setValueAtTime(v, this._context.currentTime || 0);
  }
};
SceneManager.updateWebAudio = function () {
  if (this.isFocus()) {
    if (WebAudio._context.state === 'suspended') { WebAudio._context.resume(); }
    WebAudio.setMasterVolume(Math.min(WebAudio._masterVolume + 0.05, 1));
  } else {
    WebAudio.setMasterVolume(Math.max(WebAudio._masterVolume - 0.05, 0));
    if (WebAudio._masterVolume <= 0 && WebAudio._context.state !== 'suspended') WebAudio._context.suspend();
  }
};

// --- Originals captured before the module wraps them ----------------------------------------
var ORIGINAL = {
  Window_NumberInput: Window_NumberInput.prototype.update,
  Window_MapName: Window_MapName.prototype.update,
  Window_OmoriMapQTESmash: Window_OmoriMapQTESmash.prototype.update,
  Window_OmoriStopTheArrow: Window_OmoriStopTheArrow.prototype.update,
  Window_OmoriHitTheMark: Window_OmoriHitTheMark.prototype.update,
  Window_SkipCutscene: Window_SkipCutscene.prototype.update,
  GameMapUpdateVehicles: Game_Map.prototype.updateVehicles,
  GameVehicleUpdate: Game_Vehicle.prototype.update,
  updateDestination: Scene_Map.prototype.updateDestination,
  updateOverlayFix: SceneManager.updateOverlayFix,
  updateWebAudio: SceneManager.updateWebAudio
};

// --- Helpers --------------------------------------------------------------------------------
function snapWindow(w) {
  var visibleTone = (w.openness > 0 || w.opacity > 0 || w.contentsOpacity > 0) ? w._tone : null;
  return JSON.stringify({
    openness: w.openness, opacity: w.opacity, contentsOpacity: w.contentsOpacity,
    active: !!w.active, visible: !!w.visible,
    dimmer: w._dimmerSprite ? w._dimmerSprite.opacity : null,
    tone: visibleTone,
    buttons: w._buttons ? w._buttons.map(function (b) { return b.snapshot(); }) : null,
    bar: w._bar ? { scaleY: w._bar.scaleY, y: w._bar.y } : null,
    pointer: w._pointer ? { visible: w._pointer.visible, x: w._pointer.x } : null,
    ticks: w._ticks, digitChanges: w._digitChanges,
    gauge: w._gaugeSpriteRate ? { op: w._gaugeSpriteRate.opacity, fw: w._gaugeSpriteRate._frame.width } : null,
    children: w.children.map(function (c) { return c && c.snapshot ? c.snapshot() : null; })
  });
}
function reset(id) { OmoriPerf[id].skipped = 0; OmoriPerf[id].full = 0; }
function windowCase(make, originalName, label) {
  var fast = make(), slow = make();
  fast._omoriSceneFastpathSeen = true;
  reset('idleWindows');
  fast.update();
  ORIGINAL[originalName].call(slow);
  return {
    label: label, skipped: OmoriPerf.idleWindows.skipped, full: OmoriPerf.idleWindows.full,
    same: snapWindow(fast) === snapWindow(slow),
    fast: snapWindow(fast), slow: snapWindow(slow)
  };
}
function numberInput(o) {
  var w = new Window_NumberInput();
  if (o.openness !== undefined) w.openness = o.openness;
  w.active = !!o.active; w._opening = !!o.opening; w._closing = !!o.closing;
  if (o.buttonsVisible) w._buttons[0].visible = true;
  return w;
}
function mapName(o) {
  var w = new Window_MapName();
  if (o.openness !== undefined) w.openness = o.openness;
  w._showCount = o.showCount || 0;
  w.contentsOpacity = o.contents || 0; w.opacity = o.opacity === undefined ? 0 : o.opacity;
  return w;
}
function qte(C, o) {
  var w = new C();
  w.openness = o.openness || 0;
  w.active = !!o.active; w._opening = !!o.opening; w._closing = !!o.closing;
  w._pointer = { visible: false, x: 10 };
  return w;
}
function skipCutscene(o) {
  var w = new Window_SkipCutscene();
  $gameTemp._canSkipCutscene = !!o.canSkip;
  $gameTemp._skippingCutscene = !!o.skipping;
  SceneManager._scene._skipCutsceneDuration = o.duration || 0;
  w.contentsOpacity = o.contents || 0;
  w._gaugeSpriteRate.opacity = o.gauge === undefined ? 0 : o.gauge;
  w._gaugeSpriteBack.opacity = o.gauge === undefined ? 0 : o.gauge;
  return w;
}
function reloadRun(resetGame) { if (resetGame) { /* state is per-case */ } }

var T = {};
T.windowCases = function () {
  var out = [];
  out.push(windowCase(function () { return numberInput({}); }, 'Window_NumberInput', 'number input closed/inactive'));
  out.push(windowCase(function () { return numberInput({ openness: 255, active: true }); }, 'Window_NumberInput', 'number input open+active'));
  out.push(windowCase(function () { return numberInput({ openness: 32, opening: true }); }, 'Window_NumberInput', 'number input opening'));
  out.push(windowCase(function () { return numberInput({ openness: 32, closing: true }); }, 'Window_NumberInput', 'number input closing'));
  out.push(windowCase(function () { var w = numberInput({}); w._buttons[0].visible = true; return w; }, 'Window_NumberInput', 'number input closed, touch button visible'));
  out.push(windowCase(function () { return mapName({}); }, 'Window_MapName', 'map name quiet'));
  out.push(windowCase(function () { return mapName({ openness: 255, showCount: 20, contents: 255, opacity: 255 }); }, 'Window_MapName', 'map name showing'));
  out.push(windowCase(function () { return mapName({ contents: 64, opacity: 64 }); }, 'Window_MapName', 'map name fading out'));
  out.push(windowCase(function () { return qte(Window_OmoriMapQTESmash, {}); }, 'Window_OmoriMapQTESmash', 'smash closed/inactive'));
  out.push(windowCase(function () { return qte(Window_OmoriMapQTESmash, { openness: 255, active: true }); }, 'Window_OmoriMapQTESmash', 'smash open+active'));
  out.push(windowCase(function () { return qte(Window_OmoriMapQTESmash, { openness: 32, opening: true }); }, 'Window_OmoriMapQTESmash', 'smash opening'));
  out.push(windowCase(function () { return qte(Window_OmoriStopTheArrow, {}); }, 'Window_OmoriStopTheArrow', 'arrow closed/inactive'));
  out.push(windowCase(function () { return qte(Window_OmoriStopTheArrow, { openness: 255, active: true }); }, 'Window_OmoriStopTheArrow', 'arrow open+active'));
  out.push(windowCase(function () { return qte(Window_OmoriHitTheMark, {}); }, 'Window_OmoriHitTheMark', 'mark closed/inactive'));
  out.push(windowCase(function () { return qte(Window_OmoriHitTheMark, { openness: 255, active: true }); }, 'Window_OmoriHitTheMark', 'mark open+active'));
  out.push(windowCase(function () { return skipCutscene({}); }, 'Window_SkipCutscene', 'skip prompt idle'));
  out.push(windowCase(function () { return skipCutscene({ canSkip: true, contents: 24, gauge: 24 }); }, 'Window_SkipCutscene', 'skip prompt can skip'));
  out.push(windowCase(function () { return skipCutscene({ duration: 60 }); }, 'Window_SkipCutscene', 'skip prompt duration nonzero'));
  out.push(windowCase(function () { return skipCutscene({ skipping: true }); }, 'Window_SkipCutscene', 'skip prompt while skipping'));
  return out;
};
T.firstUpdate = function () {
  var w = numberInput({});
  reset('idleWindows');
  w.update();
  return { skipped: OmoriPerf.idleWindows.skipped, full: OmoriPerf.idleWindows.full, seen: w._omoriSceneFastpathSeen === true };
};
T.vehicleCase = function (o) {
  var v = new Game_Vehicle(o);
  var before = { x: v._x, y: v._y, altitude: v._altitude, pattern: v.pattern(), stopPositive: v._stopCount > 0 };
  var map = new Game_Map([v]);
  reset('parkedVehicles');
  map.updateVehicles();
  var after = { x: v._x, y: v._y, altitude: v._altitude, pattern: v.pattern(), stopPositive: v._stopCount > 0 };
  return { label: o.label, skipped: OmoriPerf.parkedVehicles.skipped, full: OmoriPerf.parkedVehicles.full,
    updateCalls: v.updateCalls, overrideCalls: v.overrideCalls || 0, before: before, after: after };
};
T.vehicleCases = function () {
  return [
    T.vehicleCase({ label: 'parked off-map', mapId: 0 }),
    T.vehicleCase({ label: 'on this map', mapId: 92 }),
    T.vehicleCase({ label: 'driving', mapId: 0, driving: true }),
    T.vehicleCase({ label: 'move route', mapId: 0, forcing: true }),
    T.vehicleCase({ label: 'airship altitude', mapId: 0, altitude: 10, type: 'airship' }),
    T.vehicleCase({ label: 'moving', mapId: 0, moving: true }),
    T.vehicleCase({ label: 'jumping', mapId: 0, jumping: true }),
    T.vehicleCase({ label: 'non-original pattern', mapId: 0, pattern: 2 }),
    T.vehicleCase({ label: 'animation due', mapId: 0, anim: 15 }),
    T.vehicleCase({ label: 'zero stop count', mapId: 0, stop: 0 }),
    T.vehicleCase({ label: 'instance override', mapId: 0, override: true })
  ];
};
T.vehicleMixed = function () {
  var a = new Game_Vehicle({ mapId: 0 });
  var b = new Game_Vehicle({ mapId: 92 });
  var c = new Game_Vehicle({ mapId: 0, driving: true });
  var d = new Game_Vehicle({ mapId: 0 });
  var map = new Game_Map([a, b, c, d]);
  reset('parkedVehicles');
  map.updateVehicles();
  return { skipped: OmoriPerf.parkedVehicles.skipped, full: OmoriPerf.parkedVehicles.full,
    calls: [a.updateCalls, b.updateCalls, c.updateCalls, d.updateCalls] };
};
T.destinationCase = function (o) {
  var scene = new Scene_Map();
  scene._active = o.active === undefined ? true : o.active;
  scene._canMove = o.canMove === undefined ? true : o.canMove;
  scene._touchCount = o.touchCount || 0;
  TouchInput._triggered = !!o.triggered; TouchInput._pressed = !!o.pressed;
  $gameTemp._destinationX = o.dest === undefined ? null : o.dest;
  $gameTemp._destinationY = o.dest === undefined ? null : o.dest;
  $gameTemp.clearCalls = 0;
  reset('destinationEarlyOut');
  scene.updateDestination();
  return { label: o.label, skipped: OmoriPerf.destinationEarlyOut.skipped, full: OmoriPerf.destinationEarlyOut.full,
    dest: $gameTemp._destinationX, touchCount: scene._touchCount };
};
T.destinationCases = function () {
  return [
    T.destinationCase({ label: 'no touch, no destination (can move)' }),
    T.destinationCase({ label: 'no touch, no destination (cannot move)', canMove: false }),
    T.destinationCase({ label: 'valid destination, cannot move', dest: 5, canMove: false }),
    T.destinationCase({ label: 'valid destination, can move', dest: 5 }),
    T.destinationCase({ label: 'touch triggered', triggered: true, pressed: true }),
    T.destinationCase({ label: 'touch pressed only', pressed: true }),
    T.destinationCase({ label: 'touch count active', touchCount: 3, pressed: true })
  ];
};
T.overlayCases = function () {
  var out = [];
  Graphics._overlayFix = fakeCanvas(); Graphics.frameCount = 0;
  reset('overlayFixClear');
  SceneManager.updateOverlayFix();
  out.push({ label: 'first clear skipped', skipped: OmoriPerf.overlayFixClear.skipped, full: OmoriPerf.overlayFixClear.full, clears: Graphics._overlayFix.clears });
  Graphics.frameCount = 1;
  SceneManager.updateOverlayFix();
  out.push({ label: 'odd frame skipped', skipped: OmoriPerf.overlayFixClear.skipped, full: OmoriPerf.overlayFixClear.full, clears: Graphics._overlayFix.clears });
  OmoriPerf.overlayFixClear.forceOriginal = true;
  Graphics.frameCount = 0;
  SceneManager.updateOverlayFix();
  out.push({ label: 'forceOriginal clears', skipped: OmoriPerf.overlayFixClear.skipped, full: OmoriPerf.overlayFixClear.full, clears: Graphics._overlayFix.clears });
  OmoriPerf.overlayFixClear.forceOriginal = false;
  var replacement = fakeCanvas();
  Graphics._overlayFix = replacement;
  reset('overlayFixClear');
  Graphics.frameCount = 0;
  SceneManager.updateOverlayFix();
  out.push({ label: 'replacement canvas falls back', skipped: OmoriPerf.overlayFixClear.skipped, full: OmoriPerf.overlayFixClear.full, clears: replacement.clears });
  Graphics._overlayFix = null;
  reset('overlayFixClear');
  SceneManager.updateOverlayFix();
  out.push({ label: 'no canvas falls back', skipped: OmoriPerf.overlayFixClear.skipped, full: OmoriPerf.overlayFixClear.full, clears: 0 });
  return out;
};
T.audioCase = function (o) {
  SceneManager._focused = o.focus === undefined ? true : o.focus;
  WebAudio._masterVolume = o.volume;
  WebAudio._context.state = o.state || 'running';
  WebAudio._context.resumeCalls = 0; WebAudio._context.suspendCalls = 0;
  if (o.stubGain) WebAudio._masterGainNode = { gain: { setValueAtTime: function () {} } };
  else WebAudio._masterGainNode = { gain: { value: o.gain === undefined ? 1 : o.gain, setValueAtTime: function (v) { this.value = v; this.calls = (this.calls || 0) + 1; } } };
  reset('masterVolumeIdle');
  SceneManager.updateWebAudio();
  return { label: o.label, skipped: OmoriPerf.masterVolumeIdle.skipped, full: OmoriPerf.masterVolumeIdle.full,
    volume: WebAudio._masterVolume, gainCalls: WebAudio._masterGainNode && WebAudio._masterGainNode.gain.calls || 0,
    gainValue: WebAudio._masterGainNode && WebAudio._masterGainNode.gain.value,
    resumeCalls: WebAudio._context.resumeCalls, suspendCalls: WebAudio._context.suspendCalls };
};
T.audioCases = function () {
  return [
    T.audioCase({ label: 'focused, 1, running', volume: 1 }),
    T.audioCase({ label: 'focused, 0.5', volume: 0.5 }),
    T.audioCase({ label: 'focused, gain fading', volume: 1, gain: 0.4 }),
    T.audioCase({ label: 'focused, suspended', volume: 1, state: 'suspended' }),
    T.audioCase({ label: 'unfocused, 1', volume: 1, focus: false }),
    T.audioCase({ label: 'unfocused, 0', volume: 0, focus: false }),
    T.audioCase({ label: 'PMJS gain stub', volume: 1, stubGain: true })
  ];
};
T.refuse = function () {
  OmoriPerfSceneFastpaths.installForTest(false);
  var result = {};
  ['idleWindows', 'parkedVehicles', 'destinationEarlyOut', 'overlayFixClear', 'masterVolumeIdle'].forEach(function (id) {
    result[id] = { refused: OmoriPerf[id].refused, installed: OmoriPerf[id].installed };
  });
  result.unwrapped = {
    number: Window_NumberInput.prototype.update === ORIGINAL.Window_NumberInput,
    vehicles: Game_Map.prototype.updateVehicles === ORIGINAL.GameMapUpdateVehicles,
    destination: Scene_Map.prototype.updateDestination === ORIGINAL.updateDestination,
    overlay: SceneManager.updateOverlayFix === ORIGINAL.updateOverlayFix,
    audio: SceneManager.updateWebAudio === ORIGINAL.updateWebAudio
  };
  return result;
};
`;

function loadFixture() {
  const logs = [];
  const ctx = { console: { log: (...a) => logs.push(a.join(' ')) }, __pmjsBuiltinRequire: require };
  vm.createContext(ctx);
  vm.runInContext(FIXTURE, ctx);
  vm.runInContext(MODULE, ctx);
  vm.runInContext('OmoriPerfSceneFastpaths.installForTest(true)', ctx);
  return { ctx, logs };
}

function main() {
  const { ctx, logs } = loadFixture();

  console.log('== pins (recomputed from project/js) ==');
  for (const [name, file, marker, kind] of PINNED) {
    let actual;
    try {
      const text = kind === 'static' ? extractedStatic(file, marker) : extractedFunction(file, marker);
      actual = digestText(text, kind, name.split('.').pop());
    } catch (e) { actual = 'error: ' + e.message; }
    const pinned = ctx.OmoriPerfSceneFastpaths.pins[name];
    ok(actual === pinned, name + ' pin', 'computed ' + actual + ' pinned ' + pinned);
  }

  console.log('\n== idleWindows ==');
  for (const c of ctx.T.windowCases()) {
    const expectSkip = /closed\/inactive|quiet|idle|closed, touch/.test(c.label) && !/visible/.test(c.label);
    ok(c.same, c.label + ': wrapper state == original state', c.fast + '\n     ' + c.slow);
    if (expectSkip) eq([c.skipped, c.full], [1, 0], c.label + ': took the fast path');
    else eq([c.skipped, c.full], [0, 1], c.label + ': fell back to original');
  }
  {
    const f = ctx.T.firstUpdate();
    eq(f, { skipped: 0, full: 1, seen: true }, 'first update is always full');
  }

  console.log('\n== parkedVehicles ==');
  for (const c of ctx.T.vehicleCases()) {
    const expectSkip = c.label === 'parked off-map';
    if (expectSkip) {
      eq([c.skipped, c.full, c.updateCalls], [1, 0, 0], c.label + ': parked vehicle not updated');
      eq(c.before.stopPositive, c.after.stopPositive, c.label + ': stop-count sign unchanged');
      eq([c.before.x, c.before.y, c.before.altitude, c.before.pattern],
        [c.after.x, c.after.y, c.after.altitude, c.after.pattern], c.label + ': position/pattern unchanged');
    } else {
      eq(c.skipped, 0, c.label + ': not skipped');
      if (c.label === 'instance override') {
        eq([c.updateCalls, c.overrideCalls], [0, 1], c.label + ': instance override called');
      } else {
        eq(c.updateCalls, 1, c.label + ': update called once');
      }
      if (c.before.x !== c.after.x || c.before.altitude !== c.after.altitude || c.before.pattern !== c.after.pattern) {
        ok(true, c.label + ': update had an observable effect (correctly kept)');
      }
    }
  }
  eq(ctx.T.vehicleMixed(), { skipped: 2, full: 2, calls: [0, 1, 1, 0] },
    'mixed convoy: only off-map parked vehicles skipped');

  console.log('\n== destinationEarlyOut ==');
  for (const c of ctx.T.destinationCases()) {
    const expectSkip = /no touch, no destination/.test(c.label);
    if (expectSkip) eq([c.skipped, c.full], [1, 0], c.label + ': early out');
    else eq([c.skipped, c.full], [0, 1], c.label + ': vanilla path');
  }
  eq(ctx.T.destinationCases().map(c => [c.dest, c.touchCount]),
    [[null, 0], [null, 0], [null, 0], [5, 0], [4, 1], [null, 0], [null, 4]],
    'destination/touch state matches vanilla results');

  console.log('\n== overlayFixClear ==');
  eq(ctx.T.overlayCases(), [
    { label: 'first clear skipped', skipped: 1, full: 0, clears: 0 },
    { label: 'odd frame skipped', skipped: 2, full: 0, clears: 0 },
    { label: 'forceOriginal clears', skipped: 2, full: 1, clears: 1 },
    { label: 'replacement canvas falls back', skipped: 0, full: 1, clears: 1 },
    { label: 'no canvas falls back', skipped: 0, full: 1, clears: 0 }
  ], 'overlay clear fast path, opt-out and fallbacks');

  console.log('\n== masterVolumeIdle ==');
  eq(ctx.T.audioCases(), [
    { label: 'focused, 1, running', skipped: 1, full: 0, volume: 1, gainCalls: 0, gainValue: 1, resumeCalls: 0, suspendCalls: 0 },
    { label: 'focused, 0.5', skipped: 0, full: 1, volume: 0.55, gainCalls: 1, gainValue: 0.55, resumeCalls: 0, suspendCalls: 0 },
    { label: 'focused, gain fading', skipped: 0, full: 1, volume: 1, gainCalls: 1, gainValue: 1, resumeCalls: 0, suspendCalls: 0 },
    { label: 'focused, suspended', skipped: 0, full: 1, volume: 1, gainCalls: 1, gainValue: 1, resumeCalls: 1, suspendCalls: 0 },
    { label: 'unfocused, 1', skipped: 0, full: 1, volume: 0.95, gainCalls: 1, gainValue: 0.95, resumeCalls: 0, suspendCalls: 0 },
    { label: 'unfocused, 0', skipped: 0, full: 1, volume: 0, gainCalls: 1, gainValue: 0, resumeCalls: 0, suspendCalls: 1 },
    { label: 'PMJS gain stub', skipped: 1, full: 0, volume: 1, gainCalls: 0, gainValue: undefined, resumeCalls: 0, suspendCalls: 0 }
  ], 'master volume fast path and fallbacks');

  console.log('\n== pin refusal (production install against fake sources) ==');
  const fresh = { console: { log() {} }, __pmjsBuiltinRequire: require };
  vm.createContext(fresh);
  vm.runInContext(FIXTURE, fresh);
  vm.runInContext(MODULE, fresh);
  const refused = vm.runInContext('T.refuse()', fresh);
  for (const id of ['idleWindows', 'parkedVehicles', 'destinationEarlyOut', 'overlayFixClear', 'masterVolumeIdle']) {
    ok(refused[id].refused && !refused[id].installed, id + ' refused and not installed');
  }
  ok(Object.values(refused.unwrapped).every(Boolean), 'nothing was wrapped after a pin refusal');

  console.log('\nmodule log lines: ' + (logs.length ? '\n  ' + logs.join('\n  ') : '(none)'));
  console.log('\n' + checks + ' checks, ' + failures + ' failure' + (failures === 1 ? '' : 's'));
  process.exit(failures ? 1 : 0);
}

main();
