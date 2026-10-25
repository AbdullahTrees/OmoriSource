'use strict';
// Behavioural test for launcher/perf/menu-prewarm.js.
//
// The menu/options scenes and renderer are fakes that record construction, start, update,
// offscreen render and disposal. The wrapper must prewarm exactly once at the first map start,
// restore SceneManager._backgroundBitmap, and leave both scenes untouched when disabled.
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
  const context = { console, performance: { now: (function (t) { return function () { return t += 4; }; })(0) } };
  vm.createContext(context);
  vm.runInContext(String.raw`
    var calls = { starts: 0, renders: [], disposed: [] };
    function Scene_Map() {}
    Scene_Map.prototype.start = function () { calls.starts++; };
    function Scene_Menu() { this.tag = 'menu'; }
    Scene_Menu.prototype.create = function () { calls.menuCreate = (calls.menuCreate || 0) + 1; this._commandWindow = {}; this._statusWindow = {}; };
    Scene_Menu.prototype.start = function () { calls.menuStart = (calls.menuStart || 0) + 1; };
    Scene_Menu.prototype.update = function () { calls.menuUpdate = (calls.menuUpdate || 0) + 1; };
    Scene_Menu.prototype.destroy = function () { calls.disposed.push('menu'); };
    function Scene_OmoMenuOptions() { this.tag = 'options'; }
    Scene_OmoMenuOptions.prototype.setCommandWindow = function () {};
    Scene_OmoMenuOptions.prototype.setStatusWindow = function () {};
    Scene_OmoMenuOptions.prototype.create = function () { calls.optionsCreate = (calls.optionsCreate || 0) + 1; };
    Scene_OmoMenuOptions.prototype.start = function () { calls.optionsStart = (calls.optionsStart || 0) + 1; };
    Scene_OmoMenuOptions.prototype.update = function () { calls.optionsUpdate = (calls.optionsUpdate || 0) + 1; };
    Scene_OmoMenuOptions.prototype.destroy = function () { calls.disposed.push('options'); };
    function Bitmap() {}
    var SceneManager = { _backgroundBitmap: 'saved' };
    var Graphics = { width: 640, height: 480, _renderer: { render: function (scene, texture) { calls.renders.push(scene.tag); } } };
    var PIXI = { RenderTexture: { create: function () { return { destroy: function () { calls.textureDestroyed = (calls.textureDestroyed || 0) + 1; } }; } } };
    globalThis.Scene_Map = Scene_Map;
    globalThis.Scene_Menu = Scene_Menu;
    globalThis.Scene_OmoMenuOptions = Scene_OmoMenuOptions;
    globalThis.Bitmap = Bitmap;
    globalThis.SceneManager = SceneManager;
    globalThis.Graphics = Graphics;
    globalThis.PIXI = PIXI;
    globalThis.calls = calls;
  `, context);
  if (options.disableItem) context.process = { env: { OMORI_PERF_DISABLE: options.disableItem } };
  if (options.noMenu) vm.runInContext('globalThis.Scene_Menu = undefined;', context);
  vm.runInContext(MODULE, context);
  return context;
}

// --- enabled ---------------------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMenuPrewarm.installForTest();
  eq(context.OmoriPerf.menuPrewarm.installed, true, 'installs with the menu classes present');

  context.Scene_Map.prototype.start.call({});
  eq(context.calls.starts, 1, 'the original Scene_Map.start still runs');
  eq(context.calls.menuCreate, 1, 'the menu scene is constructed once');
  eq([context.calls.menuStart, context.calls.menuUpdate], [1, 1], 'the menu scene is started and updated');
  eq([context.calls.optionsCreate, context.calls.optionsStart, context.calls.optionsUpdate], [1, 1, 1],
    'the options scene is constructed, started and updated');
  eq(context.calls.renders, ['menu', 'options'], 'both scenes are rendered offscreen');
  eq(context.calls.textureDestroyed, 2, 'both offscreen textures are destroyed');
  eq(context.calls.disposed.sort(), ['menu', 'options'], 'both throwaway scenes are disposed');
  eq(context.SceneManager._backgroundBitmap, 'saved', 'the previous background bitmap is restored');
  eq(context.OmoriPerf.menuPrewarm.errors, [], 'no prewarm errors');
  ok(context.OmoriPerf.menuPrewarm.totalMs > 0, 'the prewarm duration is recorded');

  context.Scene_Map.prototype.start.call({});
  eq(context.calls.menuCreate, 1, 'a second map start does not prewarm again');
  eq(context.calls.starts, 2, 'later map starts still run the original start');
}

// --- runtime off switch ----------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMenuPrewarm.installForTest();
  context.OmoriPerf.menuPrewarm.enabled = false;
  context.Scene_Map.prototype.start.call({});
  eq(context.OmoriPerf.menuPrewarm.prewarmed, false, 'enabled=false skips the prewarm');
  eq(context.calls.menuCreate, undefined, 'no menu scene is constructed when disabled');
}

// --- environment off switch ------------------------------------------------------------------
{
  const context = load({ disableItem: 'menuPrewarm' });
  context.OmoriPerfMenuPrewarm.installForTest();
  eq(context.OmoriPerf.menuPrewarm.disabled, true, 'OMORI_PERF_DISABLE=menuPrewarm disables the module');
  context.Scene_Map.prototype.start.call({});
  eq(context.OmoriPerf.menuPrewarm.prewarmed, false, 'the disabled module does not prewarm');
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
