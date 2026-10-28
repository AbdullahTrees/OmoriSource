'use strict';
// Tests for launcher/perf/screen-position-cache.js (screenPosCache item).
//
// Strategy (same as event-state-cache.test.cjs): the fake game environment carries the REAL
// composed method sources, sliced out of the project files — fuku_testpack's screenX/Y (wholesale
// replacement), then YEP_EventSpriteOffset's wrap on top (capture + override), exactly the
// plugins.js load order (fuku index 10, YEP index 68). Installing the patch there also validates
// the module's pin digests — a wrong digest would refuse the install and these tests would fail.
// Cached values are compared after every operation against the composed originals snapshotted
// before install.
//
// The cache is only live inside a Spriteset_Map.update pass (that is where Sprite_Character.update,
// updatePosition and the culling helper run), so tests do their reads inside `spriteset._work`,
// which the fixture's update method calls the way the real spriteset calls its sprites.
//
// Run: node --test screen-position-cache.test.cjs

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
function methodTEval(file, anchor) {
  return new vm.Script('(' + methodT(file, anchor) + ')', { filename: file }).runInThisContext();
}

const g = globalThis;
function clearGlobals() {
  ['PMJS', '__pmjsBuiltinRequire', 'OmoriPerf', 'Game_CharacterBase', 'Game_Map',
    'Spriteset_Map', 'Yanfly', '$gameMap', '$dataMap'].forEach(function (k) { delete g[k]; });
}

function loadModule() {
  const modPath = require.resolve('./screen-position-cache.js');
  if (require.cache[modPath]) delete require.cache[modPath];
  const capture = { phase: null, id: null, fn: null };
  g.PMJS = { phases: { on: function (phase, id, fn) { capture.phase = phase; capture.id = id; capture.fn = fn; } } };
  g.__pmjsBuiltinRequire = function (name) { return require(name); };
  require('./screen-position-cache.js');
  assert.strictEqual(capture.phase, 'afterPlugins');
  assert.strictEqual(capture.id, 'omori.perf.screen-position-cache');
  return capture;
}

function makeEnv() {
  clearGlobals();
  g.Yanfly = { EvSpOf: {} };
  g.$dataMap = { width: 20, height: 15 };

  function Game_CharacterBase() {}
  g.Game_CharacterBase = Game_CharacterBase;

  function Game_Map() {}
  g.Game_Map = Game_Map;

  function Spriteset_Map() {}
  Spriteset_Map.prototype.update = function () {
    this.updates = (this.updates || 0) + 1;
    if (this._work) this._work(this);
  };
  g.Spriteset_Map = Spriteset_Map;

  vm.runInThisContext(
    "Game_CharacterBase.prototype.scrolledX = " + methodT('rpg_objects.js', 'Game_CharacterBase.prototype.scrolledX = function') + ";\n" +
    "Game_CharacterBase.prototype.scrolledY = " + methodT('rpg_objects.js', 'Game_CharacterBase.prototype.scrolledY = function') + ";\n" +
    "Game_CharacterBase.prototype.shiftY = " + methodT('rpg_objects.js', 'Game_CharacterBase.prototype.shiftY = function') + ";\n" +
    "Game_CharacterBase.prototype.jumpHeight = " + methodT('rpg_objects.js', 'Game_CharacterBase.prototype.jumpHeight = function') + ";\n" +
    "Game_CharacterBase.prototype.isObjectCharacter = " + methodT('rpg_objects.js', 'Game_CharacterBase.prototype.isObjectCharacter = function') + ";\n" +
    "Game_Map.prototype.tileWidth = " + methodT('rpg_objects.js', 'Game_Map.prototype.tileWidth = function') + ";\n" +
    "Game_Map.prototype.tileHeight = " + methodT('rpg_objects.js', 'Game_Map.prototype.tileHeight = function') + ";\n" +
    "Game_Map.prototype.adjustX = " + methodT('rpg_objects.js', 'Game_Map.prototype.adjustX = function') + ";\n" +
    "Game_Map.prototype.adjustY = " + methodT('rpg_objects.js', 'Game_Map.prototype.adjustY = function') + ";\n",
    { filename: 'fixture-game-geom.js' }
  );
  Game_Map.prototype.isLoopHorizontal = function () { return false; };
  Game_Map.prototype.isLoopVertical = function () { return false; };

  // fuku_testpack replaces screenX/Y wholesale (plugins.js index 10)...
  Game_CharacterBase.prototype.screenX = methodTEval('plugins/fuku_testpack.js', 'Game_CharacterBase.prototype.screenX = function');
  Game_CharacterBase.prototype.screenY = methodTEval('plugins/fuku_testpack.js', 'Game_CharacterBase.prototype.screenY = function');
  // ...then YEP_EventSpriteOffset captures and wraps them (index 68).
  g.Yanfly.EvSpOf.Game_CharacterBase_screenX = Game_CharacterBase.prototype.screenX;
  g.Yanfly.EvSpOf.Game_CharacterBase_screenY = Game_CharacterBase.prototype.screenY;
  Game_CharacterBase.prototype.screenX = methodTEval('plugins/YEP_EventSpriteOffset.js', 'Game_CharacterBase.prototype.screenX = function');
  Game_CharacterBase.prototype.screenY = methodTEval('plugins/YEP_EventSpriteOffset.js', 'Game_CharacterBase.prototype.screenY = function');
  Game_CharacterBase.prototype.initSpriteOffsets = methodTEval('plugins/YEP_EventSpriteOffset.js', 'Game_CharacterBase.prototype.initSpriteOffsets = function');
  Game_CharacterBase.prototype.spriteOffsetX = methodTEval('plugins/YEP_EventSpriteOffset.js', 'Game_CharacterBase.prototype.spriteOffsetX = function');
  Game_CharacterBase.prototype.spriteOffsetY = methodTEval('plugins/YEP_EventSpriteOffset.js', 'Game_CharacterBase.prototype.spriteOffsetY = function');

  const map = Object.create(Game_Map.prototype);
  map._displayX = 0;
  map._displayY = 0;
  g.$gameMap = map;
  return g;
}

function makeChar(x, y, opts) {
  opts = opts || {};
  const ch = Object.create(Game_CharacterBase.prototype);
  ch._realX = x;
  ch._realY = y;
  ch._jumpPeak = 0;
  ch._jumpCount = 0;
  ch._isObjectCharacter = !!opts.objectCharacter;
  ch._spriteOffsetX = opts.offsetX || 0;
  ch._spriteOffsetY = opts.offsetY || 0;
  return ch;
}

function installOk() {
  const capture = loadModule();
  capture.fn();
  const item = g.OmoriPerf && g.OmoriPerf.screenPosCache;
  assert.ok(item, 'counter entry exists');
  assert.strictEqual(item.refused, null, 'pins accepted');
  assert.strictEqual(item.installed, true);
  return item;
}

test('install replaces screenX/Y and keeps stamps out of saves', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  const vanillaY = g.Game_CharacterBase.prototype.screenY;
  const item = installOk();
  assert.notStrictEqual(g.Game_CharacterBase.prototype.screenX, vanillaX);
  assert.notStrictEqual(g.Game_CharacterBase.prototype.screenY, vanillaY);
  const spriteset = new g.Spriteset_Map();
  const ch = makeChar(3, 4);
  spriteset._work = function () { ch.screenX(); ch.screenY(); };
  spriteset.update();
  for (const name of ['_omoriSxGen', '_omoriSx', '_omoriSyGen', '_omoriSy']) {
    const d = Object.getOwnPropertyDescriptor(ch, name);
    assert.ok(d, name + ' exists');
    assert.strictEqual(d.enumerable, false, name + ' hidden from JsonEx');
  }
  assert.ok(item.evaluated >= 2 && item.fast >= 0);
});

test('wrong digest refuses the install', function () {
  makeEnv();
  g.Game_CharacterBase.prototype.screenX = function () { return 0; };
  const replacedX = g.Game_CharacterBase.prototype.screenX;
  const replacedY = g.Game_CharacterBase.prototype.screenY;
  const capture = loadModule();
  capture.fn();
  assert.strictEqual(g.OmoriPerf.screenPosCache.refused, 'screenX');
  assert.strictEqual(g.OmoriPerf.screenPosCache.installed, false);
  assert.strictEqual(g.Game_CharacterBase.prototype.screenX, replacedX, 'untouched on refusal');
  assert.strictEqual(g.Game_CharacterBase.prototype.screenY, replacedY, 'screenY wrap not installed');
});

test('OMORI_PERF_DISABLE=screenPosCache installs nothing', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  const saved = process.env.OMORI_PERF_DISABLE;
  process.env.OMORI_PERF_DISABLE = 'screenPosCache';
  try {
    const capture = loadModule();
    capture.fn();
  } finally {
    if (saved === undefined) delete process.env.OMORI_PERF_DISABLE;
    else process.env.OMORI_PERF_DISABLE = saved;
  }
  assert.strictEqual(g.OmoriPerf.screenPosCache.refused, 'disabled by OMORI_PERF_DISABLE');
  assert.strictEqual(g.Game_CharacterBase.prototype.screenX, vanillaX);
});

test('same pass: repeats hit the cache and match the composed value', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  const vanillaY = g.Game_CharacterBase.prototype.screenY;
  const item = installOk();
  const spriteset = new g.Spriteset_Map();
  const ch = makeChar(3, 4, { offsetX: 7, offsetY: -3 });
  spriteset._work = function () {
    assert.strictEqual(ch.screenX(), vanillaX.call(ch), 'first X');
    assert.strictEqual(ch.screenY(), vanillaY.call(ch), 'first Y');
    assert.strictEqual(ch.screenX(), vanillaX.call(ch), 'second X');
    assert.strictEqual(ch.screenY(), vanillaY.call(ch), 'second Y');
  };
  spriteset.update();
  assert.strictEqual(item.evaluated, 2, 'one evaluation per coordinate');
  assert.strictEqual(item.fast, 2, 'two cache hits');
});

test('outside a pass every call is live (movement is observed)', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  const vanillaY = g.Game_CharacterBase.prototype.screenY;
  const item = installOk();
  const ch = makeChar(3, 4);
  const beforeX = ch.screenX(), beforeY = ch.screenY();
  ch._realX = 10; ch._realY = 12;
  assert.notStrictEqual(ch.screenX(), beforeX, 'moved X observed');
  assert.notStrictEqual(ch.screenY(), beforeY, 'moved Y observed');
  assert.strictEqual(ch.screenX(), vanillaX.call(ch));
  assert.strictEqual(ch.screenY(), vanillaY.call(ch));
  assert.strictEqual(item.fast, 0, 'nothing cached outside a pass');
  assert.strictEqual(ch._omoriSx, undefined, 'no stamp written outside a pass');
});

test('a new pass sees movement and camera scroll', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  const vanillaY = g.Game_CharacterBase.prototype.screenY;
  const item = installOk();
  const spriteset = new g.Spriteset_Map();
  const ch = makeChar(3, 4);
  spriteset._work = function () {
    assert.strictEqual(ch.screenX(), vanillaX.call(ch), 'pass X');
    assert.strictEqual(ch.screenY(), vanillaY.call(ch), 'pass Y');
  };
  spriteset.update();
  ch._realX = 30;
  g.$gameMap._displayX = 2;
  g.$gameMap._displayY = 1;
  spriteset.update();
  assert.ok(item.evaluated >= 4, 'each pass evaluated');
});

test('nested pass invalidates earlier stamps (still exact)', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  installOk();
  const outer = new g.Spriteset_Map(), inner = new g.Spriteset_Map();
  const ch = makeChar(3, 4);
  const seen = [];
  outer._work = function () {
    seen.push(ch.screenX());               // stamped under the outer generation
    inner.update();                        // nested pass bumps the generation
    seen.push(ch.screenX());               // must recompute, then the repeat must hit
    seen.push(ch.screenX());
  };
  outer.update();
  assert.deepStrictEqual(seen, [vanillaX.call(ch), vanillaX.call(ch), vanillaX.call(ch)],
    'values unchanged across the nest');
  assert.strictEqual(inner.updates, 1);
});

test('perf.enabled=false answers with the composed method and writes no stamps', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  const vanillaY = g.Game_CharacterBase.prototype.screenY;
  const item = installOk();
  const spriteset = new g.Spriteset_Map();
  const ch = makeChar(3, 4);
  spriteset._work = function () {
    g.OmoriPerf.enabled = false;
    assert.strictEqual(ch.screenX(), vanillaX.call(ch));
    assert.strictEqual(ch.screenY(), vanillaY.call(ch));
    ch._realX = 10;
    assert.strictEqual(ch.screenX(), vanillaX.call(ch), 'live while disabled');
    assert.strictEqual(ch._omoriSx, undefined, 'no stamp while disabled');
    g.OmoriPerf.enabled = true;
    assert.strictEqual(ch.screenX(), vanillaX.call(ch), 'back on the cache path');
  };
  spriteset.update();
  assert.ok(item.evaluated >= 3, 'disabled calls counted as evaluated');
});

test('fuzz: random ops stay identical to the composed methods', function () {
  makeEnv();
  const vanillaX = g.Game_CharacterBase.prototype.screenX;
  const vanillaY = g.Game_CharacterBase.prototype.screenY;
  installOk();
  let seed = 42;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  const spritesets = [new g.Spriteset_Map(), new g.Spriteset_Map()];
  const chars = [makeChar(1, 1), makeChar(5, 7, { offsetX: 3 }), makeChar(0, 0, { objectCharacter: true })];
  let ch = chars[0];
  for (let step = 0; step < 500; step++) {
    const op = rnd();
    ch = chars[Math.floor(rnd() * chars.length) % chars.length];
    const check = function () {
      assert.strictEqual(ch.screenX(), vanillaX.call(ch), 'fuzz X step ' + step);
      assert.strictEqual(ch.screenY(), vanillaY.call(ch), 'fuzz Y step ' + step);
    };
    if (op < 0.25) spritesets[Math.floor(rnd() * 2) % 2].update();
    else if (op < 0.45) {
      const ss = spritesets[Math.floor(rnd() * 2) % 2];
      ss._work = check;
      ss.update();
      ss._work = null;
    } else if (op < 0.6) { ch._realX += 1; ch._realY += 0.5; }
    else if (op < 0.65) { g.$gameMap._displayX += 0.25; }
    else if (op < 0.7) { ch._spriteOffsetX = Math.floor(rnd() * 5); }
    else if (op < 0.75) { ch._jumpCount = 2; ch._jumpPeak = 4; }
    else if (op < 0.8) { ch._jumpCount = 0; ch._jumpPeak = 0; }
    else if (op < 0.85) g.OmoriPerf.enabled = rnd() < 0.5;
    else check();
  }
  g.OmoriPerf.enabled = true;
  assert.strictEqual(ch.screenX(), vanillaX.call(ch), 'post-fuzz X');
  assert.strictEqual(ch.screenY(), vanillaY.call(ch), 'post-fuzz Y');
});
