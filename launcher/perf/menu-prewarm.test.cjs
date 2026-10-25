'use strict';
// Behavioural test for launcher/perf/menu-prewarm.js (the inert, deferred render version).
//
// The throwaway scenes are fakes. The test proves that start()/update() are never called on
// them (the live-input hazard), every created window is deactivated, the render waits for
// ImageManager.isReady() (with a bounded cap), and both scenes are disposed with the previous
// background bitmap restored.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = fs.readFileSync(path.join(__dirname, 'menu-prewarm.js'), 'utf8');

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
  const context = { console, performance: { now: (function (t) { return function () { return t += 3; }; })(0) } };
  vm.createContext(context);
  vm.runInContext(String.raw`
    var calls = { starts: 0, updates: 0, renders: [], disposed: [], forbidden: 0,
      deactivated: 0, textureDestroyed: 0, ready: true, bitmapArgs: null };
    function WindowFake() {}
    WindowFake.prototype.deactivate = function () { calls.deactivated++; };
    function Scene_Map() {}
    Scene_Map.prototype.start = function () { calls.starts++; };
    Scene_Map.prototype.update = function () { calls.updates++; };
    function Scene_Menu() { this.tag = 'menu'; }
    Scene_Menu.prototype.create = function () {
      calls.menuCreate = (calls.menuCreate || 0) + 1;
      this._commandWindow = new WindowFake();
      this._statusWindow = new WindowFake();
    };
    Scene_Menu.prototype.start = function () { calls.forbidden++; };
    Scene_Menu.prototype.update = function () { calls.forbidden++; };
    Scene_Menu.prototype.destroy = function () { calls.disposed.push('menu'); };
    function Scene_OmoMenuOptions() { this.tag = 'options'; }
    Scene_OmoMenuOptions.prototype.setCommandWindow = function () {};
    Scene_OmoMenuOptions.prototype.setStatusWindow = function () {};
    Scene_OmoMenuOptions.prototype.optionWindows = function () {
      return [new WindowFake(), new WindowFake(), new WindowFake(), new WindowFake()];
    };
    Scene_OmoMenuOptions.prototype.create = function () {
      calls.optionsCreate = (calls.optionsCreate || 0) + 1;
      this._optionCategoriesWindow = new WindowFake();
      this._commandWindow = new WindowFake();
    };
    Scene_OmoMenuOptions.prototype.start = function () { calls.forbidden++; };
    Scene_OmoMenuOptions.prototype.update = function () { calls.forbidden++; };
    Scene_OmoMenuOptions.prototype.destroy = function () { calls.disposed.push('options'); };
    function Bitmap(width, height) { calls.bitmapArgs = [width, height]; }
    var SceneManager = { _backgroundBitmap: 'saved' };
    var Graphics = { width: 640, height: 480, _renderer: { render: function (scene) { calls.renders.push(scene.tag); } } };
    var PIXI = { RenderTexture: { create: function () { return { destroy: function () { calls.textureDestroyed++; } }; } } };
    var ImageManager = { isReady: function () { return calls.ready; } };
    globalThis.Scene_Map = Scene_Map;
    globalThis.Scene_Menu = Scene_Menu;
    globalThis.Scene_OmoMenuOptions = Scene_OmoMenuOptions;
    globalThis.Bitmap = Bitmap;
    globalThis.SceneManager = SceneManager;
    globalThis.Graphics = Graphics;
    globalThis.PIXI = PIXI;
    globalThis.ImageManager = ImageManager;
    globalThis.calls = calls;
  `, context);
  context.process = { env: {} };
  // Existing behavior checks explicitly opt into this experimental module.
  if (options.optIn !== null) context.process.env.OMORI_PERF_MENU_PREWARM = options.optIn || '1';
  if (options.disableItem) context.process.env.OMORI_PERF_DISABLE = options.disableItem;
  if (options.noMenu) vm.runInContext('globalThis.Scene_Menu = undefined;', context);
  if (options.backgroundNull) vm.runInContext('SceneManager._backgroundBitmap = null;', context);
  vm.runInContext(MODULE, context);
  return context;
}

// A glob-loaded release must not activate an experiment without an explicit opt-in.
for (const optIn of [null, '0']) {
  const context = load({ optIn });
  const start = context.Scene_Map.prototype.start;
  const update = context.Scene_Map.prototype.update;
  context.OmoriPerfMenuPrewarm.installForTest();
  eq(context.OmoriPerf.menuPrewarm.installed, false, 'prewarm is not installed without opt-in');
  ok(context.Scene_Map.prototype.start === start && context.Scene_Map.prototype.update === update,
    'default loading leaves map lifecycle methods untouched');
  context.Scene_Map.prototype.start.call({});
  context.Scene_Map.prototype.update.call({});
  eq(context.calls.menuCreate, undefined, 'default loading allocates no throwaway menu');
  eq(context.calls.renders, [], 'default loading performs no offscreen render');
}

// --- enabled, immediate readiness ------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMenuPrewarm.installForTest();
  eq(context.OmoriPerf.menuPrewarm.installed, true, 'installs with the menu classes present');

  context.Scene_Map.prototype.start.call({});
  eq(context.calls.starts, 1, 'the original Scene_Map.start still runs');
  eq([context.calls.menuCreate, context.calls.optionsCreate], [1, 1],
    'both throwaway scenes are created at the first map start');
  eq(context.calls.renders, [], 'nothing is rendered before the deferred map update');
  ok(context.calls.deactivated >= 6,
    'the command/status, four option windows and category/command windows are deactivated',
    'deactivated ' + context.calls.deactivated);

  context.Scene_Map.prototype.update.call({});
  eq(context.calls.renders, ['menu', 'options'], 'the first ready map update renders both scenes');
  eq(context.calls.disposed.sort(), ['menu', 'options'], 'both throwaway scenes are disposed');
  eq(context.calls.textureDestroyed, 2, 'both offscreen textures are destroyed');
  eq(context.SceneManager._backgroundBitmap, 'saved', 'the previous background bitmap is restored');
  eq([context.OmoriPerf.menuPrewarm.completed, context.OmoriPerf.menuPrewarm.ready,
      context.OmoriPerf.menuPrewarm.framesWaited], [true, true, 1],
    'the prewarm completes on the first ready frame');
  eq([context.OmoriPerf.menuPrewarm.renderMenu, context.OmoriPerf.menuPrewarm.renderOptions],
    [true, true], 'both offscreen renders succeed');
  eq(context.calls.forbidden, 0, 'start()/update() are never called on the throwaway scenes');

  context.Scene_Map.prototype.start.call({});
  context.Scene_Map.prototype.update.call({});
  eq(context.calls.menuCreate, 1, 'a later map start does not prewarm again');
  eq(context.calls.renders.length, 2, 'a later map update does not render again');
}

// --- deferred readiness ----------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMenuPrewarm.installForTest();
  context.calls.ready = false;
  context.Scene_Map.prototype.start.call({});
  for (let i = 0; i < 3; i++) context.Scene_Map.prototype.update.call({});
  eq(context.calls.renders, [], 'the render waits while ImageManager is not ready');
  context.calls.ready = true;
  context.Scene_Map.prototype.update.call({});
  eq(context.calls.renders, ['menu', 'options'], 'the render runs once the images are ready');
  eq([context.OmoriPerf.menuPrewarm.ready, context.OmoriPerf.menuPrewarm.framesWaited], [true, 4],
    'the wait frame count is recorded');
}

// --- bounded cap -----------------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMenuPrewarm.installForTest();
  context.calls.ready = false;
  context.Scene_Map.prototype.start.call({});
  for (let i = 0; i < 120; i++) context.Scene_Map.prototype.update.call({});
  eq(context.calls.renders, ['menu', 'options'], 'a never-ready image set still renders at the cap');
  eq([context.OmoriPerf.menuPrewarm.ready, context.OmoriPerf.menuPrewarm.framesWaited], [false, 120],
    'the cap records that images were never ready');
}

// --- placeholder background ------------------------------------------------------------------
{
  const context = load({ backgroundNull: true });
  context.OmoriPerfMenuPrewarm.installForTest();
  context.Scene_Map.prototype.start.call({});
  eq(context.OmoriPerf.menuPrewarm.usedPlaceholder, true, 'a missing snapshot uses a placeholder');
  eq(context.calls.bitmapArgs, [640, 480], 'the placeholder is full screen');
  context.Scene_Map.prototype.update.call({});
  eq(context.SceneManager._backgroundBitmap, null, 'the null background is restored');
}

// --- runtime off switch ----------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMenuPrewarm.installForTest();
  context.OmoriPerf.menuPrewarm.enabled = false;
  context.Scene_Map.prototype.start.call({});
  eq(context.OmoriPerf.menuPrewarm.attempted, false, 'enabled=false skips the prewarm');
  eq(context.calls.menuCreate, undefined, 'no throwaway scene is created when disabled');
}

// --- environment off switch ------------------------------------------------------------------
{
  const context = load({ disableItem: 'menuPrewarm' });
  context.OmoriPerfMenuPrewarm.installForTest();
  eq(context.OmoriPerf.menuPrewarm.disabled, true, 'OMORI_PERF_DISABLE=menuPrewarm disables the module');
  context.Scene_Map.prototype.start.call({});
  eq(context.OmoriPerf.menuPrewarm.attempted, false, 'the disabled module does not prewarm');
}

// --- missing class refusal -------------------------------------------------------------------
{
  const context = load({ noMenu: true });
  context.OmoriPerfMenuPrewarm.installForTest();
  eq(context.OmoriPerf.menuPrewarm.installed, false, 'a missing menu class refuses installation');
  ok(/missing/.test(String(context.OmoriPerf.menuPrewarm.refused)), 'the refusal reason is recorded');
}

console.log(checks + ' checks, ' + failures + ' failure' + (failures === 1 ? '' : 's'));
process.exit(failures ? 1 : 0);
