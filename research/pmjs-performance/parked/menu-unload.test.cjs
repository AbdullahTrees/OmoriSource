'use strict';
// Behavioural test for launcher/perf/menu-unload.js.
//
// The fake Window reproduces Window.initialize/_createAllParts: every window owns seven bitmap
// parts plus contents. The test proves windows created while a menu scene is built are recorded
// once, their owned canvases are released when the menu returns to the map, ImageManager bitmaps
// and the shared SceneManager background are never touched, a non-map close releases nothing,
// map creation drops a stale session, and both off switches work.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = fs.readFileSync(path.join(__dirname, 'menu-unload.js'), 'utf8');

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

function load(options) {
  options = options || {};
  const context = { console };
  vm.createContext(context);
  vm.runInContext(String.raw`
    var calls = { releases: 0, now: 1000, nextSceneMap: true, returns: 'created', windows: 0 };
    function makeCanvas(width, height) {
      return {
        _width: width, _height: height,
        get width() { return this._width; },
        set width(value) {
          if (this._width > 0) calls.releases++;
          this._width = value;
        },
        get height() { return this._height; },
        set height(value) { this._height = value; }
      };
    }
    function makeBitmap(width, height, url) {
      return { _url: url || '', _canvas: makeCanvas(width, height) };
    }
    calls.makeCanvas = makeCanvas;
    calls.makeBitmap = makeBitmap;
    function Window() { this.initialize.apply(this, arguments); }
    Window.prototype.initialize = function () {
      calls.windows++;
      this.contents = makeBitmap(300, 100);
      this._windowBackSprite = { bitmap: makeBitmap(320, 120) };
      this._windowFrameSprite = { bitmap: makeBitmap(320, 120) };
      this._windowCursorSprite = { bitmap: makeBitmap(100, 30) };
      this._windowContentsSprite = { bitmap: this.contents };
      this._downArrowSprite = { bitmap: makeBitmap(20, 10) };
      this._upArrowSprite = { bitmap: makeBitmap(20, 10) };
      this._windowArrowSprites = [this._downArrowSprite, this._upArrowSprite];
      this._windowPauseSignSprite = { bitmap: makeBitmap(24, 24) };
    };
    function Scene_Menu() {}
    Scene_Menu.prototype.create = function () {
      this.window = new Window();
      return calls.returns;
    };
    Scene_Menu.prototype.terminate = function () { return 'terminated'; };
    function Scene_OmoMenuBase() {}
    Scene_OmoMenuBase.prototype.create = function () { this.window = new Window(); return calls.returns; };
    function Scene_Map() {}
    Scene_Map.prototype.create = function () { this.mapWindow = new Window(); return 'map-created'; };
    var shared = makeBitmap(640, 480);
    var SceneManager = { isNextScene: function (cls) { return cls === Scene_Map && calls.nextSceneMap; },
      backgroundBitmap: function () { return shared; } };
    globalThis.Window = Window;
    globalThis.Scene_Menu = Scene_Menu;
    globalThis.Scene_OmoMenuBase = Scene_OmoMenuBase;
    globalThis.Scene_Map = Scene_Map;
    globalThis.SceneManager = SceneManager;
    globalThis.performance = { now: function () { return calls.now += 2; } };
    globalThis.calls = calls;
    globalThis.shared = shared;
  `, context);
  if (options.disableItem) context.process = { env: { OMORI_PERF_DISABLE: options.disableItem } };
  if (options.noWindow) vm.runInContext('globalThis.Window = undefined;', context);
  vm.runInContext(MODULE, context);
  return context;
}

// --- record on create, release on the way back to the map -------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuUnload;
  context.OmoriPerfMenuUnload.installForTest();
  eq(state.installed, true, 'installs with the scene and window hooks present');

  const menu = new context.Scene_Menu();
  eq(menu.create(), 'created', 'the original create return value passes through');
  eq([context.calls.windows, state.windows], [1, 0], 'the menu window is recorded but not released');
  menu.terminate();
  eq([state.windows, state.bitmaps, context.calls.releases], [1, 7, 7],
    'returning to the map releases the seven per-window bitmaps once');
  ok(state.releaseMs > 0, 'the release time is recorded');
  ok(state.bytes > 0, 'the released byte estimate is recorded');
  eq(context.shared._canvas.width, 640, 'the shared background snapshot is never released');
}

// --- a non-map close keeps the session ------------------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuUnload;
  context.OmoriPerfMenuUnload.installForTest();
  const menu = new context.Scene_Menu();
  menu.create();
  context.calls.nextSceneMap = false;
  menu.terminate();
  eq([state.windows, context.calls.releases], [0, 0], 'a non-map close releases nothing');
  const options = new context.Scene_OmoMenuBase();
  options.create();
  context.calls.nextSceneMap = true;
  menu.terminate();
  eq([state.windows, state.bitmaps], [2, 14], 'the final map close releases both session windows');
}

// --- ImageManager bitmaps and shared window parts -------------------------------------------
{
  const context = load();
  context.OmoriPerfMenuUnload.installForTest();
  const menu = new context.Scene_Menu();
  menu.create();
  menu.window._windowBackSprite.bitmap = context.calls.makeBitmap(64, 64, 'img/pictures/x.png');
  const sharedPart = context.calls.makeBitmap(50, 50);
  menu.window._windowFrameSprite.bitmap = sharedPart;
  menu.window._windowCursorSprite.bitmap = sharedPart;
  menu.terminate();
  eq(menu.window._windowBackSprite.bitmap._canvas.width, 64, 'ImageManager bitmaps are never released');
  eq(sharedPart._canvas.width, 0, 'a bitmap shared by two window parts is released');
}

// --- map creation drops a stale session -----------------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuUnload;
  context.OmoriPerfMenuUnload.installForTest();
  const menu = new context.Scene_Menu();
  menu.create();
  const map = new context.Scene_Map();
  map.create();
  eq(context.calls.releases, 0, 'map creation releases nothing by itself');
  const mapWindow = map.mapWindow;
  const before = context.calls.releases;
  menu.terminate();
  eq(state.windows, 0, 'a map-created session drops the stale menu windows un-released');
  eq(context.calls.releases, before, 'map windows created later are not released');
  eq(mapWindow._windowBackSprite.bitmap._canvas.width, 320, 'the map window canvas stays valid');
}

// --- runtime and environment off switches ----------------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuUnload;
  context.OmoriPerfMenuUnload.installForTest();
  state.enabled = false;
  const menu = new context.Scene_Menu();
  menu.create();
  menu.terminate();
  eq([state.windows, context.calls.releases], [0, 0], 'enabled=false releases nothing');
}
{
  const context = load({ disableItem: 'menuUnload' });
  context.OmoriPerfMenuUnload.installForTest();
  eq(context.OmoriPerf.menuUnload.disabled, true, 'OMORI_PERF_DISABLE=menuUnload disables it');
  const menu = new context.Scene_Menu();
  menu.create();
  menu.terminate();
  eq(context.calls.releases, 0, 'the disabled module releases nothing');
}

// --- missing class refusal -------------------------------------------------------------------
{
  const context = load({ noWindow: true });
  context.OmoriPerfMenuUnload.installForTest();
  eq(context.OmoriPerf.menuUnload.installed, false, 'a missing Window class refuses installation');
  ok(/missing/.test(String(context.OmoriPerf.menuUnload.refused)), 'the refusal reason is recorded');
}

console.log(checks + ' checks, ' + failures + ' failure' + (failures === 1 ? '' : 's'));
process.exit(failures ? 1 : 0);
