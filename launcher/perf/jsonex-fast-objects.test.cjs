'use strict';
// Tests for launcher/perf/jsonex-fast-objects.js (jsonexFastObjects item).
//
// Strategy: two vm contexts carry the REAL JsonEx sliced out of project/js/rpg_core.js; one stays
// vanilla, the other has the patch installed (which also validates the module's pins). The same
// deterministic object graphs are built in both. Saves must be byte-identical, loaded graphs
// isomorphic (constructor, key order, values, sharing, cycles), and the patched side must leave
// objects in V8 fast-property mode where vanilla does not (proving the test has teeth).
//
// Run: node --test jsonex-fast-objects.test.cjs

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const v8 = require('node:v8');

v8.setFlagsFromString('--allow-natives-syntax');

const CORE = fs.readFileSync(path.join(__dirname, '..', '..', 'project', 'js', 'rpg_core.js'), 'utf8');
const PATCH = fs.readFileSync(path.join(__dirname, 'jsonex-fast-objects.js'), 'utf8');
const JSONEX = (() => {
  const a = CORE.indexOf('function JsonEx');
  const b = CORE.indexOf('JsonEx._resetPrototype');
  return CORE.slice(a, CORE.indexOf('\n};', b) + 3);
})();

// Game-like classes and a seeded graph builder, evaluated inside each context.
const WORLD = `
function Game_Map() { this.initialize(); }
Game_Map.prototype.initialize = function () {
  this._mapId = 92; this._events = []; this._displayX = 0.5; this._filterConArr = new Map([[1, 2]]);
};
function Game_Event(id) { this.initialize(id); }
Game_Event.prototype.initialize = function (id) {
  this._eventId = id; this._x = id % 7; this._y = -0; this._realX = NaN; this._through = false;
  this._characterName = 'ev' + id; this._moveRoute = { list: [{ code: 0, parameters: [] }], repeat: true };
  this._interpreter = null; this._pageIndex = -1; this._tags = [[1, 2], [], [3]];
};
Game_Event.prototype.update = function () {
  this._x = (this._x + 1) % 50; return this._x + this._pageIndex + this._eventId;
};
function Game_Interpreter() { this._list = [{ code: 101, parameters: ['a', 0, 0, 2] }]; this._index = 0; this._event = null; }
function build(seed, count) {
  var s = seed;
  function rand() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  var map = new Game_Map();
  var shared = { shared: true, list: [1, 2, 3] };
  for (var i = 0; i < count; i++) {
    var e = new Game_Event(i);
    if (rand() < 0.3) e._interpreter = new Game_Interpreter();
    if (e._interpreter && rand() < 0.5) e._interpreter._event = e;      // cycle
    if (rand() < 0.4) e._shared = shared;                                // sharing
    if (rand() < 0.2) { e._sparse = []; e._sparse[3] = 'x'; }            // holes
    if (rand() < 0.2) e._undef = undefined;
    if (rand() < 0.2) e._date = new Date(1700000000000 + i);
    if (rand() < 0.2) e._nested = { deeper: { arr: [[i], { k: [i, { z: i }] }] } };
    if (rand() < 0.1) e._self = e;                                       // self cycle
    map._events.push(e);
  }
  map._events.push(null);
  map._first = map._events[0];
  return { map: map, system: { _saveCount: seed, _arr: map._events } };
}
this.build = build;
this.fast = function (o) { return %HasFastProperties(o); };
`;

function makeContext({ patched, envOverrides = {}, mutateCore } = {}) {
  const ctx = { console: { log: () => {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(JSONEX + '\nthis.JsonEx = JsonEx;', ctx);
  if (mutateCore) mutateCore(ctx);
  vm.runInContext(WORLD, ctx);
  if (patched) {
    ctx.__pmjsBuiltinRequire = require;
    ctx.NativeHost = { runtime: { env: name => envOverrides[name] } };
    ctx.PMJS = { phases: { on: (phase, id, fn) => fn() } };
    vm.runInContext(PATCH, ctx);
  }
  return ctx;
}

// Structural isomorphism across contexts: constructor names, key order, primitives, sharing.
function assertIsomorphic(a, b, pairs = new Map(), where = 'root') {
  if (a === null || typeof a !== 'object') {
    if (typeof a === 'number' && typeof b === 'number') {
      assert.ok(Object.is(a, b), where + ': ' + a + ' vs ' + b);
    } else {
      assert.strictEqual(typeof a, typeof b, where);
      if (typeof a !== 'function') assert.strictEqual(a, b, where);
    }
    return;
  }
  assert.ok(b && typeof b === 'object', where + ': object vs ' + b);
  if (pairs.has(a)) { assert.strictEqual(pairs.get(a), b, where + ': sharing differs'); return; }
  pairs.set(a, b);
  assert.strictEqual(Object.prototype.toString.call(a), Object.prototype.toString.call(b), where);
  assert.strictEqual(a.constructor && a.constructor.name, b.constructor && b.constructor.name, where);
  assert.deepStrictEqual(Object.keys(a), Object.keys(b), where + ' keys');
  if (Array.isArray(a)) assert.strictEqual(a.length, b.length, where + ' length');
  if (a instanceof Object.getPrototypeOf(Object.getPrototypeOf(new Map())).constructor) return;
  for (const key of Object.keys(a)) assertIsomorphic(a[key], b[key], pairs, where + '.' + key);
}

test('saves are byte-identical to vanilla over many seeded graphs', () => {
  const vanilla = makeContext({ patched: false });
  const patched = makeContext({ patched: true });
  assert.strictEqual(patched.OmoriPerf.jsonexFastObjects.installed, true, 'pins accepted');
  for (let seed = 1; seed <= 150; seed++) {
    const count = 1 + (seed % 40);
    const expected = vanilla.JsonEx.stringify(vanilla.build(seed, count));
    const actual = patched.JsonEx.stringify(patched.build(seed, count));
    assert.strictEqual(actual, expected, 'seed ' + seed);
  }
  assert.strictEqual(patched.OmoriPerf.jsonexFastObjects.stringified, 150);
});

test('saving leaves the live graph untouched and fast; vanilla does not', () => {
  const vanilla = makeContext({ patched: false });
  const patched = makeContext({ patched: true });
  const v = vanilla.build(7, 30);
  const p = patched.build(7, 30);
  const reference = patched.build(7, 30);
  vanilla.JsonEx.stringify(v);
  patched.JsonEx.stringify(p);
  assertIsomorphic(p, reference);
  for (const e of p.map._events) {
    if (!e) continue;
    assert.ok(!('@c' in e) && !('@' in e), 'no metadata left on live objects');
    assert.strictEqual(patched.fast(e), true, 'patched live event stays fast');
  }
  assert.strictEqual(vanilla.fast(v.map._events[3]), false, 'vanilla save makes events slow');
});

test('loads are isomorphic to vanilla loads and come back fast', () => {
  const vanilla = makeContext({ patched: false });
  const patched = makeContext({ patched: true });
  for (let seed = 1; seed <= 60; seed++) {
    const json = vanilla.JsonEx.stringify(vanilla.build(seed, 1 + (seed % 25)));
    const expected = vanilla.JsonEx.parse(json);
    const actual = patched.JsonEx.parse(json);
    assertIsomorphic(expected, actual);
    for (const e of actual.map._events) if (e) assert.strictEqual(patched.fast(e), true, 'seed ' + seed);
    // Cycles and sharing still resolve to the decoded objects, not to the pre-rebuild graph.
    const withInterpreter = actual.map._events.find(e => e && e._interpreter && e._interpreter._event);
    if (withInterpreter) assert.strictEqual(withInterpreter._interpreter._event, withInterpreter);
    assert.strictEqual(actual.system._arr, actual.map._events);
  }
  const json = vanilla.JsonEx.stringify(vanilla.build(3, 10));
  assert.strictEqual(vanilla.fast(vanilla.JsonEx.parse(json).map._events[1]), false,
    'vanilla load returns slow events');
});

test('objects with many fields (real Game_Event has ~120) also load fast', () => {
  const vanilla = makeContext({ patched: false });
  const patched = makeContext({ patched: true });
  const make = c => vm.runInContext(`(function () {
    function Big() {}
    this.Big = Big;
    var list = [];
    for (var n = 0; n < 5; n++) {
      var big = new Big();
      for (var i = 0; i < 120; i++) big['_field' + i] = i % 3 ? i : { nested: i };
      list.push(big);
    }
    return { list: list };
  })()`, c);
  const json = vanilla.JsonEx.stringify(make(vanilla));
  make(patched);
  const loaded = patched.JsonEx.parse(json);
  assertIsomorphic(vanilla.JsonEx.parse(json), loaded);
  for (const big of loaded.list) assert.strictEqual(patched.fast(big), true, '120-field object is fast');
});

test('makeDeepCopy (stringify + parse) neither slows the source nor the copy', () => {
  const vanilla = makeContext({ patched: false });
  const patched = makeContext({ patched: true });
  const source = patched.build(11, 12);
  const copy = patched.JsonEx.makeDeepCopy(source);
  // A JSON round trip is lossy (-0, NaN, Date) in vanilla too: compare with vanilla's copy.
  assertIsomorphic(vanilla.JsonEx.makeDeepCopy(vanilla.build(11, 12)), copy);
  assert.notStrictEqual(copy.map, source.map);
  assert.strictEqual(patched.fast(source.map._events[2]), true);
  assert.strictEqual(patched.fast(copy.map._events[2]), true);
});

test('OMORI_PERF_DISABLE leaves vanilla JsonEx in place', () => {
  const ctx = makeContext({ patched: true, envOverrides: { OMORI_PERF_DISABLE: 'other,jsonexFastObjects' } });
  assert.strictEqual(ctx.OmoriPerf.jsonexFastObjects.installed, false);
  const events = ctx.build(2, 5);
  ctx.JsonEx.stringify(events);
  assert.strictEqual(ctx.fast(events.map._events[1]), false, 'vanilla behaviour');
});

test('a changed JsonEx refuses the install', () => {
  const ctx = makeContext({ patched: true, mutateCore(c) {
    vm.runInContext('JsonEx._encode = function (value) { return value; };', c);
  } });
  assert.strictEqual(ctx.OmoriPerf.jsonexFastObjects.installed, false);
  assert.strictEqual(ctx.OmoriPerf.jsonexFastObjects.refused, '_encode');
});

test('api.enabled = false switches back to vanilla at runtime', () => {
  const ctx = makeContext({ patched: true });
  ctx.OmoriPerf.enabled = false;
  const events = ctx.build(4, 5);
  ctx.JsonEx.stringify(events);
  assert.strictEqual(ctx.fast(events.map._events[1]), false);
  assert.strictEqual(ctx.OmoriPerf.jsonexFastObjects.stringified, 0);
});
