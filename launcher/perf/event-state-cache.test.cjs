'use strict';
// Tests for launcher/perf/event-state-cache.js (startingCount item).
//
// Strategy (same as logic-fastpaths.test.cjs): the fake game environment carries the REAL
// composed method sources, sliced out of the project files. Installing the patch there also
// validates the module's pin digests — a wrong digest would refuse the install and these tests
// would fail. The O(1) answer is compared after every operation against the vanilla composed
// `isAnyEventStarting`, snapshotted before install.
//
// Run: node --test event-state-cache.test.cjs

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

// Vanilla Array.prototype.contains (rpg_core.js:126), used by Game_Event.isTriggerIn.
Object.defineProperty(Array.prototype, 'contains', {
  enumerable: false,
  value: function (element) { return this.indexOf(element) >= 0; }
});

const g = globalThis;
function clearGlobals() {
  ['PMJS', '__pmjsBuiltinRequire', 'OmoriPerf', 'Game_Map', 'Game_Event', 'Game_CharacterBase',
    'Game_Interpreter', 'Yanfly', '$gameMap', '$dataMap'].forEach(function (k) { delete g[k]; });
}

function loadModule() {
  const modPath = require.resolve('./event-state-cache.js');
  if (require.cache[modPath]) delete require.cache[modPath];
  const capture = { phase: null, id: null, fn: null };
  g.PMJS = { phases: { on: function (phase, id, fn) { capture.phase = phase; capture.id = id; capture.fn = fn; } } };
  g.__pmjsBuiltinRequire = function (name) { return require(name); };
  require('./event-state-cache.js');
  assert.strictEqual(capture.phase, 'afterPlugins');
  assert.strictEqual(capture.id, 'omori.perf.event-state-cache');
  return capture;
}

function makeEnv() {
  clearGlobals();
  g.Yanfly = { EEA: {} };

  function Game_Map() {}
  g.Game_Map = Game_Map;

  function Game_CharacterBase() {}
  g.Game_CharacterBase = Game_CharacterBase;

  function Game_Event() {}
  Object.setPrototypeOf(Game_Event.prototype, Game_CharacterBase.prototype);  // as MV does
  g.Game_Event = Game_Event;

  vm.runInThisContext(
    "Game_Map.prototype.events = " + methodT('rpg_objects.js', 'Game_Map.prototype.events = function') + ";\n" +
    "Game_Map.prototype.isAnyEventStarting = " + methodT('rpg_objects.js', 'Game_Map.prototype.isAnyEventStarting = function') + ";\n",
    { filename: 'fixture-game-map.js' }
  );
  Game_Event.prototype.isStarting = methodTEval('rpg_objects.js', 'Game_Event.prototype.isStarting = function');
  Game_Event.prototype.clearStartingFlag = methodTEval('rpg_objects.js', 'Game_Event.prototype.clearStartingFlag = function');
  Game_Event.prototype.isTriggerIn = methodTEval('rpg_objects.js', 'Game_Event.prototype.isTriggerIn = function');
  Game_Event.prototype.lock = function () { this._locked = true; };
  Game_Event.prototype.encounterLock = function () { this._encounterLockCalled = true; };
  Game_Event.prototype.isEncounterDirectionLocked = function () { return !!this._encounterLocked; };
  Game_Event.prototype.list = function () { return this._list; };
  // YEP_EventEncounterAid captures the vanilla start and may call it inside its own.
  g.Yanfly.EEA.Game_Event_start = methodTEval('rpg_objects.js', 'Game_Event.prototype.start = function');
  Game_Event.prototype.start = methodTEval('plugins/YEP_EventEncounterAid.js', 'Game_Event.prototype.start = function');
  return g;
}

function makeEvent(id, opts) {
  opts = opts || {};
  const ev = Object.create(Game_Event.prototype);
  ev._eventId = id;
  ev._starting = false;
  ev._trigger = 0;
  ev._list = 'list' in opts ? opts.list : [{}, {}, {}];
  ev._encounterLocked = !!opts.encounterLocked;
  return ev;
}

function makeMap(events) {
  const map = Object.create(Game_Map.prototype);
  map._mapId = 1;
  map._events = events;
  return map;
}

function installOk() {
  const capture = loadModule();
  capture.fn();
  const item = g.OmoriPerf && g.OmoriPerf.startingCount;
  assert.ok(item, 'counter entry exists');
  assert.strictEqual(item.refused, null, 'pins accepted');
  assert.strictEqual(item.installed, true);
  return item;
}

function check(map, vanilla, label) {
  assert.strictEqual(map.isAnyEventStarting(), vanilla.call(map), label);
}

test('install replaces isAnyEventStarting and keeps stamps out of saves', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  const item = installOk();
  assert.notStrictEqual(g.Game_Map.prototype.isAnyEventStarting, vanilla);
  const map = makeMap([null, makeEvent(1)]);
  g.$gameMap = map;
  map.isAnyEventStarting();
  for (const name of ['_startingCount', '_startingEventsRef', '_startingCountLen']) {
    const d = Object.getOwnPropertyDescriptor(map, name);
    assert.ok(d, name + ' exists');
    assert.strictEqual(d.enumerable, false, name + ' hidden from JsonEx');
  }
  assert.ok(item.rescan >= 1 && item.fast >= 0);
});

test('wrong digest refuses the install', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  g.Game_Event.prototype.start = function () { this._starting = true; };
  const capture = loadModule();
  capture.fn();
  assert.strictEqual(g.OmoriPerf.startingCount.refused, 'start');
  assert.strictEqual(g.OmoriPerf.startingCount.installed, false);
  assert.strictEqual(g.Game_Map.prototype.isAnyEventStarting, vanilla, 'untouched on refusal');
});

test('OMORI_PERF_DISABLE=startingCount installs nothing', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  const saved = process.env.OMORI_PERF_DISABLE;
  process.env.OMORI_PERF_DISABLE = 'startingCount';
  try {
    const capture = loadModule();
    capture.fn();
  } finally {
    if (saved === undefined) delete process.env.OMORI_PERF_DISABLE;
    else process.env.OMORI_PERF_DISABLE = saved;
  }
  assert.strictEqual(g.OmoriPerf.startingCount.refused, 'disabled by OMORI_PERF_DISABLE');
  assert.strictEqual(g.Game_Map.prototype.isAnyEventStarting, vanilla);
});

test('start/clear transitions track the count exactly', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  installOk();
  const evs = [null, makeEvent(1), makeEvent(2, { encounterLocked: true }), makeEvent(3, { list: null })];
  const map = makeMap(evs);
  g.$gameMap = map;
  check(map, vanilla, 'fresh');
  evs[1].start();                       // YEP else branch -> captured vanilla start
  check(map, vanilla, 'after start (vanilla branch)');
  evs[2].start();                       // YEP encounter-locked branch writes _starting directly
  check(map, vanilla, 'after start (encounter-locked branch)');
  evs[3].start();                       // empty list: no write either way
  check(map, vanilla, 'after start with no list');
  evs[1].clearStartingFlag();
  check(map, vanilla, 'after clear');
  evs[2].clearStartingFlag();
  check(map, vanilla, 'after both cleared');
  evs[1].start();
  evs[1].start();                       // restart: no second count
  check(map, vanilla, 'after restart');
});

test('restored map (count absent) recounts and stays exact', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  installOk();
  // JsonEx restore: _starting values arrive as plain writes, no wrapped method involved.
  const evs = [null, makeEvent(1), makeEvent(2), makeEvent(3)];
  evs[1]._starting = true;
  evs[3]._starting = true;
  const map = makeMap(evs);
  g.$gameMap = map;
  check(map, vanilla, 'first read after restore');
  evs[1].clearStartingFlag();
  check(map, vanilla, 'one still starting');
  evs[3].clearStartingFlag();
  check(map, vanilla, 'none starting');
  evs[2].start();
  check(map, vanilla, 'one starting again');
});

test('new _events array (map setup) recounts', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  installOk();
  const map = makeMap([null, makeEvent(1)]);
  g.$gameMap = map;
  map._events[1].start();
  check(map, vanilla, 'before setup');
  // Game_Map.setupEvents replaces the array wholesale.
  map._events = [null, makeEvent(1), makeEvent(2)];
  map._events[2]._starting = true;
  check(map, vanilla, 'after setup swap');
  map._events[2].clearStartingFlag();
  check(map, vanilla, 'after swap and clear');
});

test('event started before insertion is picked up', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  installOk();
  const map = makeMap([null, makeEvent(1)]);
  g.$gameMap = map;
  check(map, vanilla, 'primed');
  // YEP_EventSpawner.spawnEvent: construction -> setupPage -> checkEventTriggerAuto may start()
  // the event before `this._events[spawnId] = spawnedEvent` inserts it. The spawned event also
  // keeps its source map's _eventId, so its slot index differs from _eventId.
  const spawned = makeEvent(1, { encounterLocked: true });
  spawned.start();
  check(map, vanilla, 'started but not yet inserted');
  map._events[10] = spawned;
  check(map, vanilla, 'after insertion');
  spawned.clearStartingFlag();
  check(map, vanilla, 'after spawned clears');
});

test('insert with no transition at all is picked up (restoreSpawnedEvents case)', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  installOk();
  const map = makeMap([null, makeEvent(1)]);
  g.$gameMap = map;
  check(map, vanilla, 'primed');
  // JsonEx-restored spawn dropped into a slot with _starting already true: no start() or
  // clearStartingFlag() runs, so only the array-extent stamp can notice the insert.
  const restored = makeEvent(1);
  restored._starting = true;
  map._events[1000] = restored;
  check(map, vanilla, 'after slot write');
  restored.clearStartingFlag();
  check(map, vanilla, 'after clear');
});

test('transitions on foreign events stay exact (and just recount)', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  installOk();
  const evs = [null, makeEvent(1)];
  const map = makeMap(evs);
  g.$gameMap = map;
  map._events[1].start();
  check(map, vanilla, 'one starting');
  const foreign = makeEvent(1);         // a temp/old-map event, same _eventId, different object
  foreign.start();
  check(map, vanilla, 'foreign start ignored');
  foreign.clearStartingFlag();
  check(map, vanilla, 'foreign clear ignored');
});

test('perf.enabled=false answers with vanilla and keeps the count live', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  const item = installOk();
  const evs = [null, makeEvent(1), makeEvent(2)];
  const map = makeMap(evs);
  g.$gameMap = map;
  evs[1].start();
  check(map, vanilla, 'starting before toggle');
  g.OmoriPerf.enabled = false;
  check(map, vanilla, 'vanilla route answers the same');
  evs[2].start();
  check(map, vanilla, 'vanilla route after start');
  evs[1].clearStartingFlag();
  check(map, vanilla, 'vanilla route after clear');
  g.OmoriPerf.enabled = true;
  check(map, vanilla, 'back on fast path');
  assert.ok(item.vanilla >= 3, 'vanilla counter saw the disabled calls');
});

test('fuzz: random ops stay identical to vanilla', function () {
  makeEnv();
  const vanilla = g.Game_Map.prototype.isAnyEventStarting;
  installOk();
  let seed = 42;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }

  let map = makeMap([null, makeEvent(1), makeEvent(2), makeEvent(3)]);
  g.$gameMap = map;
  for (let step = 0; step < 500; step++) {
    const live = map._events.filter(Boolean);
    const ev = pick(live);
    const op = rnd();
    if (op < 0.35) ev.start();
    else if (op < 0.6) ev.clearStartingFlag();
    else if (op < 0.7) ev._encounterLocked = !ev._encounterLocked;
    else if (op < 0.8) {
      // map setup: fresh array, fresh events, arbitrary restored _starting values
      const next = [null, makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4)];
      for (const e of next) if (e) e._starting = rnd() < 0.3;
      map._events = next;
    } else if (op < 0.9) {
      // spawn: constructed-started event inserted at a slot != its _eventId. Insert is
      // extend-only (index >= length), matching real YEP_EventSpawner writes — spawnEvent and
      // restoreSpawnedEvents both land at index >= IdStartRange (1000) while map extents top out
      // at 323, and nothing shrinks _events (membership audit in the module header). In-place
      // slot replacement is unreachable in-game, so the fuzz does not model it.
      const spawned = makeEvent(1, { encounterLocked: rnd() < 0.5 });
      if (rnd() < 0.5) spawned.start();
      map._events[map._events.length + Math.floor(rnd() * 3)] = spawned;
    } else {
      g.OmoriPerf.enabled = rnd() < 0.5;
    }
    check(map, vanilla, 'fuzz step ' + step);
  }
  g.OmoriPerf.enabled = true;
  check(map, vanilla, 'post-fuzz');
});
