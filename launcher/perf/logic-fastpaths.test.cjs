'use strict';
// Tests for launcher/perf/logic-fastpaths.js (task I2).
//
// Strategy: build a fake game environment whose methods are the REAL composed sources, sliced
// out of the project files the same way Function.prototype.toString reads them (assignment
// anchor -> 'function' keyword -> matching close brace). Installing the patch there also
// validates the module's pin digests: if a digest were wrong, install would refuse and these
// tests would fail. Every item's fast path is compared against the composed vanilla method,
// snapshotted before install, over normal cases and edge cases, including the fallback paths.
//
// Run: node --test logic-fastpaths.test.cjs

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', '..', 'project', 'js');
const cache = {};
function read(file) {
  return (cache[file] = cache[file] || fs.readFileSync(path.join(JS, file), 'utf8'));
}
function fnSlice(text, start) {
  const open = text.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = open; j < text.length; j++) {
    const ch = text[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error('unbalanced function slice');
  return text.slice(start, end + 1);
}
function methodT(file, anchor) {
  const text = read(file);
  const a = text.indexOf(anchor);
  if (a < 0) throw new Error('anchor not found: ' + file + ' :: ' + anchor);
  const b = text.indexOf('function', a);
  if (b < 0 || b - a > 300) throw new Error('function keyword not found for ' + anchor);
  return fnSlice(text, b);
}
function gameMapGetter(file, propName) {
  const text = read(file);
  const a = text.indexOf("Object.defineProperty(Game_Map.prototype, '" + propName + "',");
  if (a < 0) throw new Error('getter not found: ' + propName);
  const b = text.indexOf('function get', a);
  if (b < 0) throw new Error('getter has no function get: ' + propName);
  return fnSlice(text, b);
}
function methodTEval(file, anchor) {  // compile a slice standalone (also proves it is valid source)
  return new vm.Script('(' + methodT(file, anchor) + ')', { filename: file }).runInThisContext();
}

// Vanilla Array.prototype.contains (rpg_core.js:126), used by YEP_SlipperyTiles.
Object.defineProperty(Array.prototype, 'contains', {
  enumerable: false,
  value: function (element) { return this.indexOf(element) >= 0; }
});

const g = globalThis;
function clearGlobals() {
  ['PMJS', '__pmjsBuiltinRequire', 'OmoriPerf', 'Game_Map', 'Game_System', 'Game_Event',
    'Game_Interpreter', 'Game_CharacterBase', 'DataManager', 'Yanfly', 'YED_TiledParameters',
    '$gameParty', '$gameSwitches', '$gameVariables', '$dataTilesets', '$dataCommonEvents',
    '$dataMap', '$gameMap', '$gameSystem', '$gameTemp'].forEach(function (k) { delete g[k]; });
}

// Load the patch module fresh and capture its PMJS install hook.
function loadModule() {
  const modPath = require.resolve('./logic-fastpaths.js');
  if (require.cache[modPath]) delete require.cache[modPath];
  const capture = { phase: null, id: null, fn: null };
  g.PMJS = { phases: { on: function (phase, id, fn) { capture.phase = phase; capture.id = id; capture.fn = fn; } } };
  g.__pmjsBuiltinRequire = function (name) { return require(name); };
  require('./logic-fastpaths.js');
  assert.strictEqual(capture.phase, 'afterPlugins');
  assert.strictEqual(capture.id, 'omori.logicFastpaths');
  return capture;
}

// Fake game environment; methods come from real composed sources. Fakes supply the state the
// excerpts read (variables, switches, interpreter, tile placeholder).
function makeEnv() {
  clearGlobals();

  g.DataManager = { _tempTiledData: null };
  g.Yanfly = { Param: { SlipRegion: 10, SlipFrame: 2, SlipSpeed: 5 }, SEL: {} };
  g.YED_TiledParameters = { 'Map Level Variable': '', 'Half-tile movement': 'false' };
  g.$gameVariables = { value: function () { return 0; }, setValue: function () {} };
  g.$gameParty = { _inBattle: false, inBattle: function () { return this._inBattle; } };
  g.$gameSwitches = { _data: [], value: function (switchId) { return !!this._data[switchId]; } };
  g.$gameTemp = { _bypassLoadLocation: true };
  g.$dataTilesets = [null];

  function Game_Map() { this.initialize(); }
  Game_Map.prototype.initialize = function () {
    this._mapId = 0; this._tilesetId = 0; this._currentMapLevel = 0;
    this._events = []; this._interpreter = new Game_Interpreter();
    this._regions = [];
  };
  Game_Map.prototype.mapId = function () { return this._mapId; };
  Game_Map.prototype.isHalfTile = function () { return false; };
  Game_Map.prototype.isSaveEventLocations = function () { return false; };
  g.Game_Map = Game_Map;

  function Game_Interpreter() { this.clear(); }
  Game_Interpreter.prototype.clear = function () { this.list = null; this._setupCount = 0; };
  Game_Interpreter.prototype.setup = function (list) { this.list = list; this._setupCount++; };
  Game_Interpreter.prototype.isRunning = function () { return !!this.list; };
  g.Game_Interpreter = Game_Interpreter;

  function Game_System() {}
  g.Game_System = Game_System;

  function Game_CharacterBase() {}
  g.Game_CharacterBase = Game_CharacterBase;

  function Game_Event() {}
  g.Game_Event = Game_Event;

  vm.runInThisContext(
    // YED_Tiled: map dimensions, region lookup and the accessors isSlippery depends on.
    "Game_Map.prototype.width = " + methodT('plugins/YED_Tiled.js', 'Game_Map.prototype.width = function') + ";\n" +
    "Game_Map.prototype.height = " + methodT('plugins/YED_Tiled.js', 'Game_Map.prototype.height = function') + ";\n" +
    "Game_Map.prototype.regionId = " + methodT('plugins/YED_Tiled.js', 'Game_Map.prototype.regionId = function') + ";\n" +
    "Game_Map.prototype.isTiledMap = " + methodT('plugins/YED_Tiled.js', 'Game_Map.prototype.isTiledMap = function') + ";\n" +
    "Object.defineProperty(Game_Map.prototype, 'tiledData', { get: " +
    gameMapGetter('plugins/YED_Tiled.js', 'tiledData') + ", configurable: true });\n" +
    "Object.defineProperty(Game_Map.prototype, 'currentMapLevel', {\n" +
    "  get: " + gameMapGetter('plugins/YED_Tiled.js', 'currentMapLevel') + ",\n" +
    "  set: function set(value) { this._currentMapLevel = value; },\n" +
    "  configurable: true\n" +
    "});\n" +
    // rpg_objects: terrain/tag territory and event lists.
    "Game_Map.prototype.isValid = " + methodT('rpg_objects.js', 'Game_Map.prototype.isValid = function') + ";\n" +
    "Game_Map.prototype.terrainTag = " + methodT('rpg_objects.js', 'Game_Map.prototype.terrainTag = function') + ";\n" +
    "Game_Map.prototype.tileset = " + methodT('rpg_objects.js', 'Game_Map.prototype.tileset = function') + ";\n" +
    "Game_Map.prototype.tilesetFlags = " + methodT('rpg_objects.js', 'Game_Map.prototype.tilesetFlags = function') + ";\n" +
    "Game_Map.prototype.tileId = " + methodT('rpg_objects.js', 'Game_Map.prototype.tileId = function') + ";\n" +
    "Game_Map.prototype.layeredTiles = " + methodT('rpg_objects.js', 'Game_Map.prototype.layeredTiles = function') + ";\n" +
    "Game_Map.prototype.events = " + methodT('rpg_objects.js', 'Game_Map.prototype.events = function') + ";\n" +
    "Game_Map.prototype.setupAutorunCommonEvent = " + methodT('rpg_objects.js', 'Game_Map.prototype.setupAutorunCommonEvent = function') + ";\n" +
    "Game_Map.prototype.isAnyEventStarting = " + methodT('rpg_objects.js', 'Game_Map.prototype.isAnyEventStarting = function') + ";\n" +
    "Game_Map.prototype.isSlippery = " + methodT('plugins/YEP_SlipperyTiles.js', 'Game_Map.prototype.isSlippery = function') + ";\n",
    { filename: 'fixture-game-map.js' }
  );

  // rpg_objects.js:8617 (OMORI's composed isStarting: reads the _starting flag only).
  Object.setPrototypeOf(Game_Event.prototype, Game_CharacterBase.prototype);  // as MV does
  Game_Event.prototype.isStarting = methodTEval('rpg_objects.js', 'Game_Event.prototype.isStarting = function');
  Game_Event.prototype.eventId = function () { return this._eventId; };
  Game_Event.prototype.direction = function () { return this._direction; };
  Object.defineProperty(Game_Event.prototype, 'x', { get: function () { return this._x; }, configurable: true });
  Object.defineProperty(Game_Event.prototype, 'y', { get: function () { return this._y; }, configurable: true });
  Game_Event.prototype.event = function () { return { saveEventLocation: true, note: '' }; };
  Game_Event.prototype.locate = function (x, y) { this._x = x; this._y = y; };
  Game_CharacterBase.prototype.setDirection = function (d) { this._direction = d; };
  Game_CharacterBase.prototype.direction = function () { return this._direction; };

  vm.runInThisContext(
    // YEP_SaveEventLocations composed methods and the wrappers that reach saveEventLocation.
    "Game_System.prototype.initSavedEventLocations = function() { this._savedEventLocations = {}; };\n" +
    "Game_System.prototype.savedEventLocations = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_System.prototype.savedEventLocations = function') + ";\n" +
    "Game_System.prototype.isSavedEventLocation = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_System.prototype.isSavedEventLocation = function') + ";\n" +
    "Game_System.prototype.getSavedEventX = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_System.prototype.getSavedEventX = function') + ";\n" +
    "Game_System.prototype.getSavedEventY = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_System.prototype.getSavedEventY = function') + ";\n" +
    "Game_System.prototype.getSavedEventDir = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_System.prototype.getSavedEventDir = function') + ";\n" +
    "Game_System.prototype.saveEventLocation = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_System.prototype.saveEventLocation = function') + ";\n" +
    "Game_CharacterBase.prototype.saveLocation = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_CharacterBase.prototype.saveLocation = function') + ";\n" +
    "Game_Event.prototype.saveLocation = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_Event.prototype.saveLocation = function') + ";\n" +
    "Game_Event.prototype.isSaveLocation = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_Event.prototype.isSaveLocation = function') + ";\n" +
    "Yanfly.SEL.Game_Event_updateMove = Game_Event.prototype.updateMove;\n" +
    "Game_Event.prototype.updateMove = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_Event.prototype.updateMove = function') + ";\n" +
    "Yanfly.SEL.Game_CharacterBase_setDirection = Game_CharacterBase.prototype.setDirection;\n" +
    "Game_CharacterBase.prototype.setDirection = " + methodT('plugins/YEP_SaveEventLocations.js', 'Game_CharacterBase.prototype.setDirection = function') + ";\n",
    { filename: 'fixture-save-event-locations.js' }
  );

  return g;
}

// A Tiled-style map: region layer sets region 10 on two cells.
function setupMap(env, opts) {
  opts = opts || {};
  const W = opts.width || 8, H = opts.height || 6;
  const regions0 = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    regions0[y * W + x] = (x === 2 && y === 1) ? 10 : (x === 3 && y === 2) ? 10 : 0;
  }
  env.DataManager._tempTiledData = { width: W, height: H };
  env.$dataMap = { data: new Array(W * H * 4).fill(0), width: W, height: H, events: [null] };
  env.$dataTilesets = [
    null,
    { name: 'default', flags: [0, 0], slippery: [4] },
    { name: 'other', flags: [0, 0], slippery: [9] }
  ];
  const map = new env.Game_Map();
  map._mapId = opts.mapId || 92;
  map._tilesetId = opts.tilesetId || 1;
  map._regions = [regions0, opts.level1 !== undefined ? opts.level1 : regions0.slice()];
  env.$gameMap = map;
  env.$gameSystem = new env.Game_System();
  return map;
}

test('slipperyCache: answers identical to vanilla over a cell sweep, then cached', function () {
  const env = makeEnv();
  const map = setupMap(env);
  const vanillaIs = env.Game_Map.prototype.isSlippery;
  const cells = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) cells.push([x, y]);
  cells.push([-1, 0], [8, 3], [3, 99], [0, -4]);   // out-of-bounds corners
  const ref = cells.map(function (c) { return vanillaIs.call(map, c[0], c[1]); });

  loadModule().fn();
  const stats = env.OmoriPerf.slipperyCache;
  assert.strictEqual(stats.installed, true, 'slipperyCache installs');

  // First pass: every answer equals vanilla (in-bounds region-10 true, others false).
  for (let i = 0; i < cells.length; i++) {
    assert.strictEqual(map.isSlippery(cells[i][0], cells[i][1]), ref[i],
      'cell ' + JSON.stringify(cells[i]));
  }
  assert.ok(stats.vanilla > 0, 'first pass filled the cache via vanilla calls');
  const seenVanilla = stats.vanilla;

  // Second pass: same answers, all served from the cache.
  for (let i = 0; i < cells.length; i++) {
    assert.strictEqual(map.isSlippery(cells[i][0], cells[i][1]), ref[i]);
  }
  assert.strictEqual(stats.vanilla, seenVanilla, 'revisits must not re-call vanilla');
  assert.ok(stats.fast > 0, 'fast counter works');

  // Spot arithmetic: region-10 at (2,1)/(3,2) true; neighbours false.
  assert.strictEqual(map.isSlippery(2, 1), true);
  assert.strictEqual(map.isSlippery(3, 2), true);
  assert.strictEqual(map.isSlippery(0, 0), false);
  assert.strictEqual(map.isSlippery(8, 0), false);   // out of bounds: vanilla isValid false
});

test('slipperyCache: inBattle short-circuits without cache or vanilla calls', function () {
  const env = makeEnv();
  const map = setupMap(env);
  loadModule().fn();
  map.isSlippery(2, 1); map.isSlippery(4, 4);
  const stats = env.OmoriPerf.slipperyCache;
  const fast = stats.fast, vanilla = stats.vanilla;

  env.$gameParty._inBattle = true;
  for (const c of [[2, 1], [0, 0], [9, 9], [-1, -1]]) {
    assert.strictEqual(map.isSlippery(c[0], c[1]), false);
  }
  assert.strictEqual(stats.fast, fast + 4, 'battle answers are served immediately');
  assert.strictEqual(stats.vanilla, vanilla, 'no vanilla calls while in battle');
  env.$gameParty._inBattle = false;
  assert.strictEqual(map.isSlippery(2, 1), true, 'cache intact after battle');
  assert.strictEqual(map.isSlippery(4, 4), false);
});

test('slipperyCache: every key change invalidates and answers stay vanilla-identical', function () {
  const env = makeEnv();
  const map = setupMap(env);
  const vanillaIs = env.Game_Map.prototype.isSlippery;
  loadModule().fn();
  const probe = [[1, 1], [2, 1], [3, 2], [5, 4], [7, 5], [-2, 1]];
  const answersFor = function () {
    return probe.map(function (c) { return String(map.isSlippery(c[0], c[1])); });
  };
  const refFor = function () {
    return probe.map(function (c) { return String(vanillaIs.call(map, c[0], c[1])); });
  };

  map._currentMapLevel = 1;                                   // different region map per level
  assert.deepStrictEqual(answersFor(), refFor(), 'level 1');
  map._currentMapLevel = 0;
  assert.deepStrictEqual(answersFor(), refFor(), 'back to level 0');

  map._mapId = 152;
  assert.deepStrictEqual(answersFor(), refFor(), 'map id change');

  map._tilesetId = 2;                                         // different tileset: different slippery list
  assert.deepStrictEqual(answersFor(), refFor(), 'tileset change');

  env.$dataMap = { data: new Array(400).fill(0), width: 8, height: 6, events: [null] };
  assert.deepStrictEqual(answersFor(), refFor(), 'dataMap replaced');

  map._regions = [map._regions[0].slice(), map._regions[1]];
  assert.deepStrictEqual(answersFor(), refFor(), 'regions root identity change');

  env.Yanfly.Param.SlipRegion = 0;
  assert.deepStrictEqual(answersFor(), refFor(), 'SlipRegion 0 (feature off)');
  env.Yanfly.Param.SlipRegion = 7;
  assert.deepStrictEqual(answersFor(), refFor(), 'SlipRegion 7');
  env.Yanfly.Param.SlipRegion = 10;
  assert.deepStrictEqual(answersFor(), refFor(), 'SlipRegion 10 again');

  // Replacing tiledData (map re-setup with changed dimensions) re-computes via vanilla.
  map._regions = [[], []];
  env.DataManager._tempTiledData = { width: 4, height: 4 };   // map._regions level arrays are empty
  const got = (function () {
    try { return String(map.isSlippery(2, 1)); } catch (e) { return 'THROW'; }
  })();
  const want = (function () {
    try { return String(vanillaIs.call(map, 2, 1)); } catch (e) { return 'THROW'; }
  })();
  assert.strictEqual(got, want, 're-setup with shrunk regions: identical result or identical failure');
});

test('slipperyCache: level from a game variable (live getter); fractional coords fall back', function () {
  const env = makeEnv();
  const map = setupMap(env, { level1: null });                // level 1 has no region map
  env.YED_TiledParameters['Map Level Variable'] = '12';
  let fakeVar = 0;
  env.$gameVariables.value = function () { return fakeVar; };
  const vanillaIs = env.Game_Map.prototype.isSlippery;
  loadModule().fn();
  const stats = env.OmoriPerf.slipperyCache;

  assert.strictEqual(map.isSlippery(2, 1), vanillaIs.call(map, 2, 1), 'level resolved from variable 0 -> _currentMapLevel');
  fakeVar = 1;
  const refErr = (function () { try { vanillaIs.call(map, 2, 1); return 'none'; } catch (e) { return String(e.message); } })();
  const gotErr = (function () { try { map.isSlippery(2, 1); return 'none'; } catch (e) { return String(e.message); } })();
  assert.ok(/Cannot read/.test(refErr) && /Cannot read/.test(gotErr),
    'missing region level fails identically: ' + refErr + ' / ' + gotErr);
  fakeVar = 0;
  assert.strictEqual(map.isSlippery(2, 1), true, 'back on level 0 the cache rehydrates correctly');

  const before = stats.vanilla;
  assert.strictEqual(map.isSlippery(2.5, 1), vanillaIs.call(map, 2.5, 1), 'fractional x');
  assert.strictEqual(map.isSlippery(2, 1.25), vanillaIs.call(map, 2, 1.25), 'fractional y');
  assert.strictEqual(stats.vanilla, before + 2, 'fractional coordinates are vanilla calls');
});

test('slipperyCache: refuses when a pinned method source differs', function () {
  const env = makeEnv();
  setupMap(env);
  const hook = loadModule();
  const orig = env.Game_Map.prototype.isSlippery;
  const wrapped = function (mx, my) { return orig.call(this, mx, my); };  // a plugin re-wraps it
  env.Game_Map.prototype.isSlippery = wrapped;
  hook.fn();
  const stats = env.OmoriPerf.slipperyCache;
  assert.strictEqual(stats.installed, false, 'refused');
  assert.strictEqual(stats.refused, 'isSlippery');
  assert.strictEqual(env.Game_Map.prototype.isSlippery, wrapped, 'prototype untouched by the patch');
  assert.strictEqual(env.OmoriPerf.autorunCandidates.installed, true, 'other items still install');
});

test('slipperyCache: regionId pin protects the dependency chain', function () {
  const env = makeEnv();
  setupMap(env);
  const hook = loadModule();
  const composed = env.Game_Map.prototype.regionId;
  env.Game_Map.prototype.regionId = function (x, y) { return composed.call(this, x, y) + 1; };
  hook.fn();
  assert.strictEqual(env.OmoriPerf.slipperyCache.installed, false, 'refused');
  assert.strictEqual(env.OmoriPerf.slipperyCache.refused, 'regionId');
});

test('slipperyCache: OMORI_PERF_DISABLE keeps the vanilla method installed', function () {
  process.env.OMORI_PERF_DISABLE = 'slipperyCache';
  try {
    makeEnv();
    setupMap(globalThis);
    const before = globalThis.Game_Map.prototype.isSlippery;
    loadModule().fn();
    assert.strictEqual(globalThis.OmoriPerf.slipperyCache.installed, false, 'not installed under env switch');
    assert.strictEqual(globalThis.OmoriPerf.slipperyCache.refused, null, 'not a pin refusal');
    assert.strictEqual(globalThis.Game_Map.prototype.isSlippery, before, 'vanilla method kept');
    assert.strictEqual(globalThis.OmoriPerf.autorunCandidates.installed, true, 'other items install');
  } finally {
    delete process.env.OMORI_PERF_DISABLE;
  }
});

test('slipperyCache: perf.enabled=false at runtime routes everything through vanilla', function () {
  const env = makeEnv();
  const map = setupMap(env);
  const vanillaIs = env.Game_Map.prototype.isSlippery;
  loadModule().fn();
  const stats = env.OmoriPerf.slipperyCache;
  env.OmoriPerf.enabled = false;
  for (const c of [[2, 1], [0, 0]]) {
    assert.strictEqual(map.isSlippery(c[0], c[1]), vanillaIs.call(map, c[0], c[1]), 'vanilla route ' + c);
  }
  assert.ok(stats.vanilla > 0, 'vanilla counter recorded');
  env.OmoriPerf.enabled = true;
  assert.strictEqual(map.isSlippery(2, 1), true, 're-enabled serves from cache');
});

test('autorunCandidates: same first autorun event as vanilla across switch permutations', function () {
  const env = makeEnv();
  const map = setupMap(env);
  env.$dataCommonEvents = [
    null,
    { trigger: 2, switchId: 0, list: [] },
    { trigger: 1, switchId: 11, list: [2], name: 'e2' },
    null,
    { trigger: 0, switchId: 0, list: [] },
    { trigger: 1, switchId: 22, list: [5], name: 'e5' },
    null,
    { trigger: 1, switchId: 33, list: [7], name: 'e7' }
  ];
  const vanillaSetup = env.Game_Map.prototype.setupAutorunCommonEvent;
  loadModule().fn();
  const stats = env.OmoriPerf.autorunCandidates;
  assert.strictEqual(stats.installed, true, 'installed');

  const apply = function (switches) {
    env.$gameSwitches._data = env.$dataCommonEvents.map(function () { return false; });
    (switches || []).forEach(function (s) { env.$gameSwitches._data[s] = true; });
  };
  const runFast = function () {
    map._interpreter.clear();
    return map.setupAutorunCommonEvent() ? map._interpreter.list : null;
  };
  const runVanilla = function () {
    const shadow = { _interpreter: new env.Game_Interpreter() };
    shadow.events = env.Game_Map.prototype.events;         // unused by this method (only setupAutorun)
    shadow.setupAutorunCommonEvent = vanillaSetup;
    return shadow.setupAutorunCommonEvent() ? shadow._interpreter.list : null;
  };

  for (const sc of [[], [11], [22], [33], [11, 22], [22, 11], [11, 22, 33], [99], [7, 22]]) {
    apply(sc);
    assert.strictEqual(
      JSON.stringify(runFast()) === 'null' ? 'none' : JSON.stringify(runFast()),
      JSON.stringify(runVanilla()) === 'null' ? 'none' : JSON.stringify(runVanilla()),
      'scenario ' + JSON.stringify(sc));
  }
  assert.ok(stats.fast > 0, 'fast counter');
  assert.strictEqual(stats.vanilla, 0, 'no vanilla calls');

  // Switch check stays live: turning a key on/off changes the outcome after the cache is warm.
  apply([22]);
  map._interpreter.clear();
  assert.strictEqual(map.setupAutorunCommonEvent(), true, 'switch on -> runs');
  assert.deepStrictEqual(map._interpreter.list, [5], 'setup got event 5 list');
  apply([]);
  map._interpreter.clear();
  assert.strictEqual(map.setupAutorunCommonEvent(), false, 'switch off -> nothing runs');
  assert.strictEqual(map._interpreter._setupCount, 0, 'no interpreter setup without an active autorun');
});

test('autorunCandidates: rebuilds when $dataCommonEvents is replaced or undefined', function () {
  const env = makeEnv();
  const map = setupMap(env);
  env.$dataCommonEvents = [
    null,
    { trigger: 1, switchId: 11, list: [1], name: 'first' },
    { trigger: 2, switchId: 0, list: [] },
    { trigger: 1, switchId: 55, list: [3], name: 'third' }
  ];
  const vanillaSetup = env.Game_Map.prototype.setupAutorunCommonEvent;
  loadModule().fn();

  const apply = function (switches) {
    env.$gameSwitches._data = env.$dataCommonEvents.map(function () { return false; });
    (switches || []).forEach(function (s) { env.$gameSwitches._data[s] = true; });
  };
  apply([55]);
  map._interpreter.clear();
  assert.strictEqual(map.setupAutorunCommonEvent(), true, 'first database autorun');
  assert.deepStrictEqual(map._interpreter.list, [3], 'list from index 3');

  env.$dataCommonEvents = [                                     // new game / save load: new array
    null,
    { trigger: 1, switchId: 77, list: [100], name: 'replaced' },
    null
  ];
  apply([77]);
  map._interpreter.clear();
  assert.strictEqual(map.setupAutorunCommonEvent(), true, 'new database autorun found');
  assert.deepStrictEqual(map._interpreter.list, [100], 'rebuilt candidate list used');

  env.$dataCommonEvents = [
    null,
    { trigger: 9, switchId: 77, list: [200], name: 'noted' },
    null
  ];
  apply([77]);
  map._interpreter.clear();
  assert.strictEqual(map.setupAutorunCommonEvent(), false, 'same size, no trigger-1 entries: false');
  assert.strictEqual(map._interpreter._setupCount, 0, 'nothing was set up');

  env.$dataCommonEvents = undefined;                      // vanilla throws: fast path must too
  const refMessage = (function () {
    try { vanillaSetup.call(map); return 'no-throw'; } catch (e) { return 'throw:' + e.message; }
  })();
  const gotMessage = (function () {
    map._interpreter.clear();
    try { map.setupAutorunCommonEvent(); return 'no-throw'; } catch (e) { return 'throw:' + e.message; }
  })();
  assert.ok(refMessage.indexOf('throw:') === 0, 'vanilla throws on undefined database (' + refMessage + ')');
  assert.ok(gotMessage.indexOf('throw:') === 0, 'fast path preserves the throw (' + gotMessage + ')');
});

test('autorunCandidates: multiple autoruns switched on resolve to the first index', function () {
  const env = makeEnv();
  const map = setupMap(env);
  env.$dataCommonEvents = [
    null,
    { trigger: 1, switchId: 11, list: [1], name: 'first' },
    null,
    { trigger: 1, switchId: 22, list: [3], name: 'third' }
  ];
  loadModule().fn();
  env.$gameSwitches._data = [];
  env.$gameSwitches._data[11] = true;
  env.$gameSwitches._data[22] = true;
  map._interpreter.clear();
  const won = map.setupAutorunCommonEvent();
  assert.strictEqual(won, true, 'one autorun wins per call');
  assert.strictEqual(map._interpreter._setupCount, 1, 'exactly one interpreter setup');
  assert.deepStrictEqual(map._interpreter.list, [1], 'the LOWEST INDEX event wins, like vanilla');
});

test('autorunCandidates: refuses when the composed source differs', function () {
  const env = makeEnv();
  setupMap(env);
  env.$dataCommonEvents = [null, { trigger: 1, switchId: 11, list: [1] }];
  const hook = loadModule();
  const composed = env.Game_Map.prototype.setupAutorunCommonEvent;
  env.Game_Map.prototype.setupAutorunCommonEvent = function () { return composed.call(this); };
  hook.fn();
  assert.strictEqual(env.OmoriPerf.autorunCandidates.installed, false, 'refused');
  assert.strictEqual(env.OmoriPerf.autorunCandidates.refused, 'setupAutorunCommonEvent');
});

test('autorunCandidates: OMORI_PERF_DISABLE keeps vanilla; runtime enabled=false falls back', function () {
  process.env.OMORI_PERF_DISABLE = 'autorunCandidates';
  try {
    const env = makeEnv();
    const map = setupMap(env);
    env.$dataCommonEvents = [null, { trigger: 1, switchId: 11, list: [1] }];
    const before = env.Game_Map.prototype.setupAutorunCommonEvent;
    loadModule().fn();
    assert.strictEqual(globalThis.OmoriPerf.autorunCandidates.installed, false, 'not installed');
    assert.strictEqual(globalThis.Game_Map.prototype.setupAutorunCommonEvent, before, 'vanilla kept');
  } finally {
    delete process.env.OMORI_PERF_DISABLE;
  }
  const env2 = makeEnv();
  const map2 = setupMap(env2);
  env2.$dataCommonEvents = [null, { trigger: 1, switchId: 11, list: [1] }];
  loadModule().fn();
  env2.OmoriPerf.enabled = false;
  env2.$gameSwitches._data = [];
  env2.$gameSwitches._data[11] = true;
  map2._interpreter.clear();
  assert.strictEqual(map2.setupAutorunCommonEvent(), true, 'still works from the vanilla route');
  assert.ok(env2.OmoriPerf.autorunCandidates.vanilla > 0, 'vanilla counter recorded while disabled');
});

test('saveLocationAlloc: stored table identical to the vanilla writer across a schedule', function () {
  const env = makeEnv();
  setupMap(env);
  const vanillaSave = env.Game_System.prototype.saveEventLocation;
  loadModule().fn();
  const stats = env.OmoriPerf.saveLocationAlloc;
  assert.strictEqual(stats.installed, true, 'installed');

  const saveVanilla = function (system, mapId, eventId, x, y, dir) {
    vanillaSave.call(system, mapId, {
      eventId: function () { return eventId; },
      x: x, y: y,
      direction: function () { return dir; }
    });
  };
  const saveFast = function (system, mapId, eventId, x, y, dir) {
    system.saveEventLocation(mapId, {
      eventId: function () { return eventId; },
      x: x, y: y,
      direction: function () { return dir; }
    });
  };
  const shadow = Object.create(env.Game_System.prototype);
  shadow._savedEventLocations = undefined;
  const mirror = function (system) {
    return system._savedEventLocations === undefined
      ? { __undefined: true }
      : JSON.parse(JSON.stringify(system._savedEventLocations));
  };

  const schedule = [
    [92, 17, 5, 6, 2], [92, 17, 6, 6, 2], [92, 3, 9, 9, 8], [152, 17, 1, 1, 2],
    [92, 17, 7, 6, 6], [92, 3, 9, 9, 6], [152, 17, 1, 2, 2]
  ];
  for (const s of schedule) {
    saveVanilla(shadow, s[0], s[1], s[2], s[3], s[4]);
    saveFast(env.$gameSystem, s[0], s[1], s[2], s[3], s[4]);
    assert.deepStrictEqual(mirror(shadow), mirror(env.$gameSystem),
      'table identical after ' + JSON.stringify(s));
  }
  assert.ok(stats.fast > 0, 'fast counter');
  assert.strictEqual(stats.vanilla, 0, 'no vanilla calls');

  // Key strings: exactly "mapId,eventId" with no "[object" oddities and no leftovers.
  const keys = Object.keys(env.$gameSystem._savedEventLocations).sort();
  assert.deepStrictEqual(keys, ['152,17', '92,17', '92,3'], 'key strings');

  // A save/load round trip preserves exactly the same stored values (JsonEx reads by index).
  const back = JSON.parse(JSON.stringify(env.$gameSystem));
  assert.deepStrictEqual(mirror(env.$gameSystem), mirror(back), 'JSON round trip');

  // Stored values read back through the plugin's own getters.
  assert.strictEqual(env.$gameSystem.getSavedEventX(92, 17), shadow.getSavedEventX !== undefined ? 7 : 7, 'x readable');
  assert.strictEqual(env.$gameSystem.getSavedEventDir(92, 17), shadow.getSavedEventDir !== undefined ? 6 : 6, 'dir readable');

  // Undefined-init route (first call on a fresh system).
  const fastInit = new env.Game_System();
  fastInit._savedEventLocations = undefined;
  saveFast(fastInit, 92, 17, 1, 1, 2);
  const plainInit = Object.create(env.Game_System.prototype);
  plainInit._savedEventLocations = undefined;
  saveVanilla(plainInit, 92, 17, 1, 1, 2);
  assert.deepStrictEqual(mirror(fastInit), mirror(plainInit), 'identical initialisation path');

  // Weird event: same exception surface (vanilla reads eventId() first; so does the fast path).
  const refThrew = (function () {
    try { saveVanilla(shadow, 92, undefined, 0, 0, 2); return 'no-throw'; } catch (e) { return 'throw'; }
  })();
  const gotThrew = (function () {
    try { saveFast(env.$gameSystem, 92, undefined, 0, 0, 2); return 'no-throw'; } catch (e) { return 'throw'; }
  })();
  assert.strictEqual(refThrew, gotThrew, 'undefined event behaves identically');
});

test('saveLocationAlloc: Game_Event.saveLocation routes through the patched system method', function () {
  const env = makeEnv();
  setupMap(env);
  loadModule().fn();
  const stats = env.OmoriPerf.saveLocationAlloc;
  const ev = new env.Game_Event();
  ev._eventId = 17; ev._x = 4; ev._y = 5; ev._direction = 2;
  ev.saveLocation();
  assert.strictEqual(stats.fast, 1, 'patched method called once');
  assert.deepStrictEqual(env.$gameSystem._savedEventLocations['92,17'], [4, 5, 2], 'stored under the right key');

  // An event that does not save its location: the gate short-circuits exactly like vanilla.
  env.Game_Event.prototype.isSaveLocation = function () { return false; };
  const evOff = new env.Game_Event();
  evOff._eventId = 19; evOff._x = 0; evOff._y = 0; evOff._direction = 2;
  evOff.saveLocation();
  assert.strictEqual(stats.fast, 1, 'gated by isSaveLocation');
  env.Game_Event.prototype.isSaveLocation = function () { return true; };

  // setDirection (the other caller) routes through saveLocation too.
  const ev2 = new env.Game_Event();
  ev2._eventId = 31; ev2._x = 8; ev2._y = 8; ev2._direction = 0;
  ev2.setDirection(6);
  assert.strictEqual(stats.fast, 2, 'setDirection -> saveLocation -> patched system method');
  assert.deepStrictEqual(env.$gameSystem._savedEventLocations['92,31'], [8, 8, 6], 'turn stored');
});

test('saveLocationAlloc: refuses when the composed source differs', function () {
  const env = makeEnv();
  setupMap(env);
  const hook = loadModule();
  const composed = env.Game_System.prototype.saveEventLocation;
  env.Game_System.prototype.saveEventLocation = function (mapId, event) {
    return composed.call(this, mapId, event);
  };
  hook.fn();
  assert.strictEqual(env.OmoriPerf.saveLocationAlloc.installed, false, 'refused');
  assert.strictEqual(env.OmoriPerf.saveLocationAlloc.refused, 'saveEventLocation');
});

test('eventsStartingNoAlloc: same truth value and evaluation order as events().some', function () {
  const env = makeEnv();
  const map = setupMap(env);
  const vanillaIs = env.Game_Map.prototype.isAnyEventStarting;
  loadModule().fn();
  const stats = env.OmoriPerf.eventsStartingNoAlloc;
  assert.strictEqual(stats.installed, true, 'installed');

  const mk = function (id, starting) {
    const e = new env.Game_Event();
    e._eventId = id; e._starting = starting;
    return e;
  };
  const run = function (flags) {
    map._events = flags.map(function (f, i) { return f === null ? null : mk(i, f); });
    return map.isAnyEventStarting();
  };
  const runRef = function (flags) {
    const shadow = {};
    shadow._events = flags.map(function (f, i) { return f === null ? null : mk(i, f); });
    shadow.events = env.Game_Map.prototype.events;
    shadow.isAnyEventStarting = vanillaIs;
    return shadow.isAnyEventStarting();
  };
  for (const flags of [
    [], [null], [false, false, false], [true], [false, true], [false, false, true],
    [false, null, true], [null, null, true], [false, true, true], [true, false, false]
  ]) {
    assert.strictEqual(run(flags), runRef(flags), 'scenario ' + JSON.stringify(flags));
  }
  assert.ok(stats.fast > 0, 'fast counter');
  assert.strictEqual(stats.vanilla, 0, 'no vanilla calls');

  // Evaluation order probes: every earlier event is consulted before the first true.
  const probe = [];
  map._events = [false, false, false, true].map(function (f, i) {
    const e = mk(i, f);
    Object.defineProperty(e, 'isStarting', {
      value: function () { probe.push(this._eventId); return this._starting === true; }
    });
    return e;
  });
  assert.strictEqual(map.isAnyEventStarting(), true);
  assert.deepStrictEqual(probe, [0, 1, 2, 3], 'probe order matches events().some');

  // Holes: same answers as filter drops them.
  map._events = [];
  map._events[2] = mk(2, true);
  map._events[4] = mk(4, false);
  assert.strictEqual(map.isAnyEventStarting(), true);
  map._events = new Array(4);                       // all holes
  assert.strictEqual(map.isAnyEventStarting(), false);
  assert.strictEqual(runRef.call && vanillaIs.call((function () {
    const shadow = {}; shadow._events = new Array(4); shadow.events = env.Game_Map.prototype.events;
    return shadow;
  })()), false, 'hole evaluation identical in vanilla');
});

test('eventsStartingNoAlloc: refuses when events() or isAnyEventStarting differ', function () {
  const env = makeEnv();
  setupMap(env);
  const hook = loadModule();
  const composed = env.Game_Map.prototype.events;
  env.Game_Map.prototype.events = function () {          // e.g. another plugin re-wraps events()
    return composed.call(this);
  };
  hook.fn();
  assert.strictEqual(env.OmoriPerf.eventsStartingNoAlloc.installed, false, 'refused');
  assert.strictEqual(env.OmoriPerf.eventsStartingNoAlloc.refused, 'events');
});

test('eventsStartingNoAlloc: OMORI_PERF_DISABLE keeps vanilla; runtime switch falls back', function () {
  process.env.OMORI_PERF_DISABLE = 'eventsStartingNoAlloc';
  try {
    const env = makeEnv();
    const map = setupMap(env);
    const before = env.Game_Map.prototype.isAnyEventStarting;
    loadModule().fn();
    assert.strictEqual(globalThis.OmoriPerf.eventsStartingNoAlloc.installed, false, 'not installed');
    assert.strictEqual(globalThis.Game_Map.prototype.isAnyEventStarting, before, 'vanilla kept');
    assert.strictEqual(globalThis.Game_Map.prototype.events, env.Game_Map.prototype.events, 'events() untouched');
  } finally {
    delete process.env.OMORI_PERF_DISABLE;
  }

  const env2 = makeEnv();
  const map2 = setupMap(env2);
  loadModule().fn();
  map2._events = [null];
  env2.OmoriPerf.enabled = false;
  map2.isAnyEventStarting();
  assert.ok(env2.OmoriPerf.eventsStartingNoAlloc.vanilla > 0, 'vanilla counter while runtime-disabled');
});

test('eventsStartingNoAlloc: events() itself is untouched (fresh-array consumers rely on it)', function () {
  const env = makeEnv();
  const map = setupMap(env);
  const hook = loadModule();
  const eventsBefore = env.Game_Map.prototype.events;
  hook.fn();
  assert.strictEqual(env.Game_Map.prototype.events, eventsBefore, 'events() not replaced');
  map._events = [];
  assert.deepStrictEqual(map.events(), [], 'events() still returns a fresh array');
});
