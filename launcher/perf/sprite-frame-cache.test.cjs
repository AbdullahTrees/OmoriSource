'use strict';
// Tests for launcher/perf/sprite-frame-cache.js (frameCache item).
//
// Strategy (same as screen-position-cache.test.cjs): the fake game environment carries the REAL
// composed method sources, sliced out of the project files in plugins.js order — YEP_CoreEngine's
// updateHalfBodySprites wrap (Yanfly.Core capture), ExtraMovementFrames' patternWidth wrap
// (ModernAlgebra.EMF capture), Custom_Character_Rectangles' replacements of the six pattern/block
// helpers (_TDS_.CustomCharacterRectangles captures, patternWidth chaining through EMF), and Omori
// BASE's updateCharacterFrame wrap (_TDS_.OmoriBASE capture). Installing the patch there also
// validates the module's pin digests — a wrong digest refuses the install and these tests would
// fail.
//
// The cache is only correct if a skip is value-identical to a body run, so every test drives a
// twin pair built from the same state record: the wrapped updateFrame on one, the composed original
// snapshotted before install on the other, and compares full sprite state (frame + half-body
// sprites) after every operation.
//
// Run: node --test sprite-frame-cache.test.cjs

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
  ['PMJS', '__pmjsBuiltinRequire', 'OmoriPerf', 'Sprite', 'Sprite_Character', '$gameMap', '_TDS_',
    'Yanfly', 'ModernAlgebra']
    .forEach(function (k) { delete g[k]; });
}

function loadModule() {
  const modPath = require.resolve('./sprite-frame-cache.js');
  if (require.cache[modPath]) delete require.cache[modPath];
  const capture = { phase: null, id: null, fn: null };
  g.PMJS = { phases: { on: function (phase, id, fn) { capture.phase = phase; capture.id = id; capture.fn = fn; } } };
  g.__pmjsBuiltinRequire = function (name) { return require(name); };
  require('./sprite-frame-cache.js');
  assert.strictEqual(capture.phase, 'afterPlugins');
  assert.strictEqual(capture.id, 'omori.perf.sprite-frame-cache');
  return capture;
}

function makeEnv() {
  clearGlobals();

  // Minimal Sprite stand-in with rpg_core's clone-on-set colour API (setBlendColor/setColorTone
  // replace the arrays on every real change — the module's identity stamps rely on that).
  function Sprite() {
    this.bitmap = null;
    this._frame = null;
    this._blendColor = [0, 0, 0, 0];
    this._colorTone = [0, 0, 0, 0];
    this.anchor = { x: 0.5, y: 1 };
    this.opacity = 255;
    this.blendMode = 0;
    this.visible = true;
    this.children = [];
  }
  Sprite.prototype.setFrame = function (x, y, w, h) {
    this._setFrameCalls = (this._setFrameCalls || 0) + 1;
    this._frame = { x: x, y: y, width: w, height: h };
  };
  Sprite.prototype.addChild = function (child) { this.children.push(child); };
  Sprite.prototype.getBlendColor = function () { return this._blendColor.slice(); };
  Sprite.prototype.setBlendColor = function (color) { this._blendColor = color.slice(); };
  Sprite.prototype.getColorTone = function () { return this._colorTone.slice(); };
  Sprite.prototype.setColorTone = function (tone) { this._colorTone = tone.slice(); };
  g.Sprite = Sprite;

  function Sprite_Character() {
    Sprite.call(this);
    this._character = null;
    this._tileId = 0;
    this._characterIndex = 0;
    this._isBigCharacter = false;
    this._bushDepth = 0;
  }
  Sprite_Character.prototype = Object.create(Sprite.prototype);
  Sprite_Character.prototype.constructor = Sprite_Character;
  g.Sprite_Character = Sprite_Character;

  const p = Sprite_Character.prototype;
  const vanilla = name => methodTEval('rpg_sprites.js', 'Sprite_Character.prototype.' + name + ' = function');
  p.updateFrame = vanilla('updateFrame');                       // nobody wraps these
  p.updateTileFrame = vanilla('updateTileFrame');
  p.createHalfBodySprites = vanilla('createHalfBodySprites');
  p.updateHalfBodySprites = vanilla('updateHalfBodySprites');   // YEP_CoreEngine (plugins.js 7) wraps
  g.Yanfly = { Core: { Sprite_Character_updateHalfBodySprites: p.updateHalfBodySprites } };
  p.updateHalfBodySprites = methodTEval('plugins/YEP_CoreEngine.js', 'Sprite_Character.prototype.updateHalfBodySprites = function');
  p.characterBlockX = vanilla('characterBlockX');               // Custom_Character_Rectangles (59)
  p.characterBlockY = vanilla('characterBlockY');               // replaces these six wholesale;
  p.characterPatternX = vanilla('characterPatternX');           // nothing else wraps them, so its
  p.characterPatternY = vanilla('characterPatternY');           // captures are the vanilla literals
  p.patternWidth = vanilla('patternWidth');
  p.patternHeight = vanilla('patternHeight');
  // ExtraMovementFrames (55) wraps patternWidth first...
  g.ModernAlgebra = { EMF: { SpriteCharacter_patternWidth: p.patternWidth } };
  p.patternWidth = methodTEval('plugins/ExtraMovementFrames.js', 'Sprite_Character.prototype.patternWidth = function');
  // ...then Custom_Character_Rectangles replaces it (capture chains through EMF to vanilla).
  g._TDS_ = { CustomCharacterRectangles: {
    Sprite_Character_characterBlockX: p.characterBlockX,
    Sprite_Character_characterBlockY: p.characterBlockY,
    Sprite_Character_characterPatternX: p.characterPatternX,
    Sprite_Character_characterPatternY: p.characterPatternY,
    Sprite_Character_patternWidth: p.patternWidth,
    Sprite_Character_patternHeight: p.patternHeight
  }, OmoriBASE: {} };
  const custom = name => methodTEval('plugins/Custom_Character_Rectangles.js', 'Sprite_Character.prototype.' + name + ' = function');
  p.characterBlockX = custom('characterBlockX');
  p.characterBlockY = custom('characterBlockY');
  p.characterPatternX = custom('characterPatternX');
  p.characterPatternY = custom('characterPatternY');
  p.patternWidth = custom('patternWidth');
  p.patternHeight = custom('patternHeight');
  // Omori BASE (111) captures the vanilla updateCharacterFrame, then wraps it.
  g._TDS_.OmoriBASE.Sprite_Character_updateCharacterFrame = vanilla('updateCharacterFrame');
  p.updateCharacterFrame = methodTEval('plugins/Omori BASE.js', 'Sprite_Character.prototype.updateCharacterFrame = function');

  const map = { _tileWidth: 48, _tileHeight: 48,
    tileWidth: function () { return this._tileWidth; },
    tileHeight: function () { return this._tileHeight; } };
  g.$gameMap = map;
  return g;
}

function makeChar(opts) {
  opts = opts || {};
  return {
    _pattern: opts.pattern !== undefined ? opts.pattern : 1,
    _direction: opts.direction !== undefined ? opts.direction : 2,
    _characterIndex: opts.characterIndex !== undefined ? opts.characterIndex : 0,
    _single: !!opts.single,
    _customFrameX: opts.customX !== undefined ? opts.customX : null,
    _customFrameY: opts.customY !== undefined ? opts.customY : null,
    _customFrameWidth: opts.customW !== undefined ? opts.customW : null,
    _customFrameHeight: opts.customH !== undefined ? opts.customH : null,
    _isEmfCharacter: !!opts.emf,
    _emfState: { frameNum: opts.frameNum !== undefined ? opts.frameNum : 3 },
    pattern: function () { return this._pattern; },
    direction: function () { return this._direction; },
    characterIndex: function () { return this._characterIndex; },
    isSingleFrame: function () { return this._single; },
    isEmfCharacter: function () { return this._isEmfCharacter; },
    emfCharacterState: function () { return this._emfState; }
  };
}

// A twin is everything updateFrame can observe on one sprite. Both twins of a pair are built from
// the same record and mutated identically; only the updateFrame implementation differs.
function makeTwin(opts) {
  opts = opts || {};
  const sprite = new g.Sprite_Character();
  sprite._character = makeChar(opts);
  sprite._tileId = opts.tileId || 0;
  sprite._characterIndex = sprite._character._characterIndex;
  sprite._isBigCharacter = !!opts.big;
  sprite._bushDepth = opts.bush || 0;
  sprite.bitmap = opts.bitmap === undefined ? { width: 144, height: 256 } : opts.bitmap;
  if (opts.blend) sprite._blendColor = opts.blend.slice();
  if (opts.tone) sprite._colorTone = opts.tone.slice();
  return { sprite: sprite, char: sprite._character };
}

function serialize(sp) {
  const half = s => s ? { visible: s.visible, y: s.y, bitmap: s.bitmap, frame: s._frame,
    blend: s._blendColor, tone: s._colorTone, blendMode: s.blendMode } : null;
  return { frame: sp._frame, upper: half(sp._upperBody), lower: half(sp._lowerBody) };
}

function installOk() {
  const capture = loadModule();
  capture.fn();
  const item = g.OmoriPerf && g.OmoriPerf.frameCache;
  assert.ok(item, 'counter entry exists');
  assert.strictEqual(item.refused, null, 'pins accepted');
  assert.strictEqual(item.installed, true);
  return item;
}

// One differential step: wrapped on A, snapshotted original on B. Returns 1 when the body ran
// (miss), 0 when the cache served it (hit).
function step(item, orig, A, B, label) {
  const before = item.evaluated;
  A.sprite.updateFrame();
  orig.call(B.sprite);
  assert.deepStrictEqual(serialize(A.sprite), serialize(B.sprite), label);
  return item.evaluated - before;
}

test('install wraps updateFrame and keeps stamps out of saves', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  const item = installOk();
  assert.notStrictEqual(g.Sprite_Character.prototype.updateFrame, orig);
  const A = makeTwin(), B = makeTwin();
  step(item, orig, A, B, 'first run');
  for (const name of ['_omoriFfBm', '_omoriFfBw', '_omoriFfBh', '_omoriFfIb', '_omoriFfT',
    '_omoriFfP', '_omoriFfD', '_omoriFfS', '_omoriFfCi', '_omoriFfFx', '_omoriFfFy',
    '_omoriFfFw', '_omoriFfFh', '_omoriFfE', '_omoriFfEf', '_omoriFfBd', '_omoriFfBl',
    '_omoriFfCt', '_omoriFfBmo', '_omoriFfTw', '_omoriFfTh']) {
    const d = Object.getOwnPropertyDescriptor(A.sprite, name);
    assert.ok(d, name + ' exists');
    assert.strictEqual(d.enumerable, false, name + ' hidden from JsonEx');
  }
  assert.ok(item.evaluated >= 1);
});

test('wrong digest refuses the install', function () {
  makeEnv();
  g.Sprite_Character.prototype.updateTileFrame = function () {};
  const replaced = g.Sprite_Character.prototype.updateTileFrame;
  const orig = g.Sprite_Character.prototype.updateFrame;
  const capture = loadModule();
  capture.fn();
  assert.strictEqual(g.OmoriPerf.frameCache.refused, 'updateTileFrame');
  assert.strictEqual(g.OmoriPerf.frameCache.installed, false);
  assert.strictEqual(g.Sprite_Character.prototype.updateFrame, orig, 'untouched on refusal');
  assert.strictEqual(g.Sprite_Character.prototype.updateTileFrame, replaced);
});

test('OMORI_PERF_DISABLE=frameCache installs nothing', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  const saved = process.env.OMORI_PERF_DISABLE;
  process.env.OMORI_PERF_DISABLE = 'frameCache';
  try {
    const capture = loadModule();
    capture.fn();
  } finally {
    if (saved === undefined) delete process.env.OMORI_PERF_DISABLE;
    else process.env.OMORI_PERF_DISABLE = saved;
  }
  assert.strictEqual(g.OmoriPerf.frameCache.refused, 'disabled by OMORI_PERF_DISABLE');
  assert.strictEqual(g.Sprite_Character.prototype.updateFrame, orig);
});

test('unchanged state is a hit and the body does not run', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  const item = installOk();
  const A = makeTwin(), B = makeTwin();
  assert.strictEqual(step(item, orig, A, B, 'prime'), 1, 'first call evaluates');
  const calls = A.sprite._setFrameCalls;
  assert.strictEqual(step(item, orig, A, B, 'repeat'), 0, 'second call hits');
  assert.strictEqual(A.sprite._setFrameCalls, calls, 'body skipped on a hit');
});

test('every stamped input invalidates the cache', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  const item = installOk();
  // Mutators take the twin pair and apply the SAME new value to both (shared state like the map
  // must change once, random draws must draw once — the two twins may only differ in which
  // updateFrame implementation runs them).
  const mutators = {
    'bitmap identity': (A, B) => { for (const t of [A, B]) t.sprite.bitmap = { width: 144, height: 256 }; },
    'bitmap dimensions': (A, B) => { for (const t of [A, B]) { t.sprite.bitmap.width /= 2; t.sprite.bitmap.height /= 2; } },
    'isBigCharacter': (A, B) => { for (const t of [A, B]) t.sprite._isBigCharacter = !t.sprite._isBigCharacter; },
    'tileId': (A, B) => { for (const t of [A, B]) t.sprite._tileId = t.sprite._tileId ? 0 : 2816; },
    'pattern': (A, B) => { for (const t of [A, B]) t.char._pattern = (t.char._pattern + 1) % 3; },
    'direction': (A, B) => { for (const t of [A, B]) t.char._direction = t.char._direction === 2 ? 8 : 2; },
    'isSingleFrame': (A, B) => { for (const t of [A, B]) t.char._single = !t.char._single; },
    'characterIndex': (A, B) => { for (const t of [A, B]) { t.char._characterIndex = (t.char._characterIndex + 1) % 8; t.sprite._characterIndex = t.char._characterIndex; } },
    'bushDepth': (A, B) => { for (const t of [A, B]) t.sprite._bushDepth = t.sprite._bushDepth ? 0 : 6; },
    'blendColor': (A, B) => { for (const t of [A, B]) t.sprite.setBlendColor([1, 2, 3, 4]); },
    'colorTone': (A, B) => { for (const t of [A, B]) t.sprite.setColorTone([1, 2, 3, 4]); },
    'blendMode': (A, B) => { for (const t of [A, B]) t.sprite.blendMode = t.sprite.blendMode ? 0 : 3; },
    'customFrameX': (A, B) => { for (const t of [A, B]) t.char._customFrameX = t.char._customFrameX === null ? 5 : null; },
    'customFrameY': (A, B) => { for (const t of [A, B]) t.char._customFrameY = t.char._customFrameY === null ? 2 : null; },
    'customFrameWidth': (A, B) => { for (const t of [A, B]) t.char._customFrameWidth = t.char._customFrameWidth === null ? 24 : null; },
    'customFrameHeight': (A, B) => { for (const t of [A, B]) t.char._customFrameHeight = t.char._customFrameHeight === null ? 48 : null; },
    'emfCharacter': (A, B) => { for (const t of [A, B]) t.char._isEmfCharacter = !t.char._isEmfCharacter; },
    'emfFrameNum': (A, B) => { for (const t of [A, B]) t.char._emfState.frameNum = t.char._emfState.frameNum === 3 ? 6 : 3; },
    'tileWidth': () => { g.$gameMap._tileWidth = g.$gameMap._tileWidth === 48 ? 64 : 48; },
    'tileHeight': () => { g.$gameMap._tileHeight = g.$gameMap._tileHeight === 48 ? 64 : 48; }
  };
  for (const name of Object.keys(mutators)) {
    const base = name === 'emfFrameNum' ? { emf: true } : {};   // frameNum only matters on EMF chars
    const A = makeTwin(base), B = makeTwin(base);
    step(item, orig, A, B, name + ': prime');
    assert.strictEqual(step(item, orig, A, B, name + ': hit before'), 0, name + ': stable before');
    mutators[name](A, B);
    assert.strictEqual(step(item, orig, A, B, name + ': after'), 1, name + ' must invalidate');
    assert.strictEqual(step(item, orig, A, B, name + ': re-hit'), 0, name + ': stable after');
  }
});

test('two sprites cache independently', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  const item = installOk();
  const A1 = makeTwin(), B1 = makeTwin();
  const A2 = makeTwin(), B2 = makeTwin();
  step(item, orig, A1, B1, 'A prime');
  step(item, orig, A2, B2, 'B prime');
  A1.char._pattern = 0; B1.char._pattern = 0;
  assert.strictEqual(step(item, orig, A1, B1, 'A miss'), 1, 'A reruns on its own change');
  assert.strictEqual(step(item, orig, A2, B2, 'B hit'), 0, 'B still hits');
});

test('perf.enabled=false runs the body and writes no stamps', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  const item = installOk();
  const A = makeTwin(), B = makeTwin();
  step(item, orig, A, B, 'prime');
  g.OmoriPerf.enabled = false;
  const calls = A.sprite._setFrameCalls;
  assert.strictEqual(step(item, orig, A, B, 'disabled'), 1, 'counted as evaluated while disabled');
  assert.strictEqual(A.sprite._setFrameCalls, calls + 1, 'body ran while disabled');
  const fresh = makeTwin();
  fresh.sprite.updateFrame();
  assert.strictEqual(fresh.sprite._omoriFfBm, undefined, 'no stamp while disabled');
  g.OmoriPerf.enabled = true;
  assert.strictEqual(step(item, orig, A, B, 'back on'), 0, 'stamps still valid');
});

test('null character keeps vanilla behaviour', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  installOk();
  const A = makeTwin(), B = makeTwin();
  A.sprite._character = null;
  B.sprite._character = null;
  assert.throws(() => A.sprite.updateFrame(), TypeError);
  assert.throws(() => orig.call(B.sprite), TypeError);
});

test('fuzz: random op sequences end identical to the composed original', function () {
  makeEnv();
  const orig = g.Sprite_Character.prototype.updateFrame;
  const item = installOk();
  let seed = 42;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  const pairs = [{ A: makeTwin(), B: makeTwin() }, { A: makeTwin({ big: true }), B: makeTwin({ big: true }) },
    { A: makeTwin({ emf: true, frameNum: 4, customX: 3, customY: 1, customW: 24, customH: 48 }),
      B: makeTwin({ emf: true, frameNum: 4, customX: 3, customY: 1, customW: 24, customH: 48 }) }];
  const both = fn => (A, B) => { fn(A); fn(B); };
  const ops = [
    [0.24, both(t => {})],                                             // plain update
    [0.09, both(t => { t.sprite.bitmap = { width: 144, height: 256 }; })], // sheet swap
    [0.05, both(t => { t.sprite.bitmap.width /= 2; t.sprite.bitmap.height /= 2; })], // async load / resize
    [0.09, both(t => { t.char._pattern = (t.char._pattern + 1) % 3; })],
    [0.07, (A, B) => { const v = [2, 4, 6, 8][Math.floor(rnd() * 4)]; for (const t of [A, B]) t.char._direction = v; }],
    [0.04, both(t => { t.char._single = !t.char._single; })],
    [0.04, (A, B) => { const v = Math.floor(rnd() * 8); for (const t of [A, B]) { t.char._characterIndex = v; t.sprite._characterIndex = v; } }],
    [0.07, (A, B) => { const v = [0, 4, 8][Math.floor(rnd() * 3)]; for (const t of [A, B]) t.sprite._bushDepth = v; }],
    [0.05, (A, B) => { const v = [0, 100, 2816][Math.floor(rnd() * 3)]; for (const t of [A, B]) t.sprite._tileId = v; }],
    [0.04, both(t => { t.sprite._isBigCharacter = !t.sprite._isBigCharacter; })],
    [0.04, (A, B) => { const v = [Math.floor(rnd() * 5), 0, 0, 0]; for (const t of [A, B]) t.sprite.setBlendColor(v); }],
    [0.03, (A, B) => { const v = [0, Math.floor(rnd() * 5), 0, 0]; for (const t of [A, B]) t.sprite.setColorTone(v); }],
    [0.03, (A, B) => { const v = Math.floor(rnd() * 4); for (const t of [A, B]) t.sprite.blendMode = v; }],
    [0.03, (A, B) => { const v = rnd() < 0.5 ? null : Math.floor(rnd() * 8); for (const t of [A, B]) t.char._customFrameX = v; }],
    [0.03, (A, B) => { const v = rnd() < 0.5 ? null : Math.floor(rnd() * 8); for (const t of [A, B]) t.char._customFrameY = v; }],
    [0.03, (A, B) => { const v = rnd() < 0.5 ? null : Math.floor(rnd() * 32); for (const t of [A, B]) t.char._customFrameWidth = v; }],
    [0.03, (A, B) => { const v = rnd() < 0.5 ? null : Math.floor(rnd() * 32); for (const t of [A, B]) t.char._customFrameHeight = v; }],
    [0.03, both(t => { t.char._isEmfCharacter = !t.char._isEmfCharacter; })],
    [0.03, (A, B) => { const v = 1 + Math.floor(rnd() * 8); for (const t of [A, B]) t.char._emfState.frameNum = v; }],
    [0.02, () => { g.$gameMap._tileWidth = 32 + Math.floor(rnd() * 4) * 8; }],
    [0.03, () => { g.OmoriPerf.enabled = rnd() < 0.5; }],
    [0.04, (A, B) => { const v = { pattern: A.char._pattern, direction: A.char._direction,   // page refresh
      characterIndex: A.char._characterIndex, single: A.char._single,
      customX: A.char._customFrameX, customY: A.char._customFrameY,
      customW: A.char._customFrameWidth, customH: A.char._customFrameHeight,
      emf: A.char._isEmfCharacter, frameNum: A.char._emfState.frameNum };
      for (const t of [A, B]) { const fresh = makeChar(v); t.sprite._character = fresh; t.char = fresh; } }]
  ];
  for (let stepN = 0; stepN < 400; stepN++) {
    const pair = pairs[Math.floor(rnd() * pairs.length) % pairs.length];
    const r = rnd();
    let acc = 0, op = ops[0][1];
    for (const [w, fn] of ops) { acc += w; if (r <= acc) { op = fn; break; } }
    op(pair.A, pair.B);
    step(item, orig, pair.A, pair.B, 'fuzz step ' + stepN);
  }
  g.OmoriPerf.enabled = true;
});
