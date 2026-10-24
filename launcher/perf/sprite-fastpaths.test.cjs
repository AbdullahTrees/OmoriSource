'use strict';
// Equivalence tests for launcher/perf/sprite-fastpaths.js.
//
// The pinned functions are not re-typed here: the test extracts their exact source slices from
// the game files and evaluates them in a fresh vm context, so the SHA-256 pins in the module
// match the way they do after a real plugin load. Each scenario runs the same sprite twice,
// once with the item's `enabled` switch off (full vanilla chain) and once on (fast path), and
// compares all observable state plus the recorded call log.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..', '..'); // .../REVERSE
const SRC = path.join(REPO, 'OmoriSource');
const MODULE = path.join(__dirname, 'sprite-fastpaths.js');

// ---------------------------------------------------------------------------------------------
// Real source extraction (same slice hashing the module does: toString, CRLF -> LF).
function slice(file, marker, occurrence) {
  const text = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');
  let from = 0, idx = -1;
  for (let n = 0; n <= (occurrence || 0); n++) {
    idx = text.indexOf(marker, from);
    if (idx < 0) throw new Error('marker not found: ' + marker + ' in ' + file);
    from = idx + marker.length;
  }
  const start = idx + marker.indexOf('function');
  let depth = 0, str = null, esc = false;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    const ch = text[i];
    if (str) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === str) str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + marker);
}

const HORROR = 'project/js/plugins/Olivia_HorrorEffects.js';
const FIXES = 'project/js/plugins/GTP_OmoriFixes.js';
const SPRITES = 'project/js/rpg_sprites.js';
const REAL = {
  update: [HORROR, 'Sprite.prototype.update = function() {'],
  synchronize: [HORROR, 'Sprite.prototype.synchronizeHorrorFiltersWithSource = function() {'],
  effects: [HORROR, 'Sprite.prototype.updateHorrorEffects = function() {'],
  noise: [HORROR, 'Sprite.prototype.updateHorrorNoise = function() {'],
  glitch: [HORROR, 'Sprite.prototype.updateHorrorGlitch = function() {'],
  tv: [HORROR, 'Sprite.prototype.updateHorrorTV = function() {'],
  children: [FIXES, 'Olivia.HorrorEffects.___Sprite_update___ = function() {'],
  base: [SPRITES, 'Sprite_Base.prototype.update = function() {'],
  hide: [SPRITES, 'Sprite_Base.prototype.hide = function() {'],
  show: [SPRITES, 'Sprite_Base.prototype.show = function() {'],
  visibility: [SPRITES, 'Sprite_Base.prototype.updateVisibility = function() {'],
  animations: [SPRITES, 'Sprite_Base.prototype.updateAnimationSprites = function() {']
};

// ---------------------------------------------------------------------------------------------
function makeWorld(options) {
  const opts = options || {};
  const logs = [];
  const context = vm.createContext({
    console: { log: function (m) { logs.push(String(m)); } },
    __pmjsBuiltinRequire: function (name) { return require(name); },
    process: { env: opts.env || {} }
  });
  const run = (code) => vm.runInContext(code, context);

  run(`
    var Olivia = { HorrorEffects: {} };
    function Sprite() {}
    Sprite.prototype = { initialize: function () {}, update: function () {}, children: [] };
    function Sprite_Base() {}
    Sprite_Base.prototype = Object.create(Sprite.prototype);
    Sprite_Base.prototype.constructor = Sprite_Base;
    var Graphics = { frameCount: 0 };
    var PIXI = { filters: { GlitchFilter: function () { this.slices = 0; } } };
    Math.random = function () { return 0.5; };
    Math.randomInt = function (n) { return 0; };
    Array.prototype.clone = function () { return this.slice(); };
  `);

  const assign = {
    update: 'Sprite.prototype.update',
    synchronize: 'Sprite.prototype.synchronizeHorrorFiltersWithSource',
    effects: 'Sprite.prototype.updateHorrorEffects',
    noise: 'Sprite.prototype.updateHorrorNoise',
    glitch: 'Sprite.prototype.updateHorrorGlitch',
    tv: 'Sprite.prototype.updateHorrorTV',
    children: 'Olivia.HorrorEffects.___Sprite_update___',
    base: 'Sprite_Base.prototype.update',
    hide: 'Sprite_Base.prototype.hide',
    show: 'Sprite_Base.prototype.show',
    visibility: 'Sprite_Base.prototype.updateVisibility',
    animations: 'Sprite_Base.prototype.updateAnimationSprites'
  };
  for (const key of Object.keys(assign)) {
    if (opts.tamper === key) {
      run(assign[key] + ' = function () { return "tampered"; };');
    } else {
      run(assign[key] + ' = ' + slice(REAL[key][0], REAL[key][1]) + ';');
    }
  }
  if (opts.pmjsGuard) {
    // The device composition seen in the profiles: the PMJS adapter wraps the dispatcher. The
    // wrapper's exact source is taken from the PMJS file so its pin digest is the real one.
    const guardSource = slice('pmjs/js/pmjs-plugins/olivia/horror-effects.js',
      'var guarded = function() {');
    run(`
      (function () {
        var original = Sprite.prototype.updateHorrorEffects;
        var knownNoise = Sprite.prototype.updateHorrorNoise;
        var knownGlitch = Sprite.prototype.updateHorrorGlitch;
        var knownTV = Sprite.prototype.updateHorrorTV;
        function hasActiveHorrorFilter(sprite) {
          var filters = sprite._horrorFilters;
          return !!(filters && (filters.noiseFilter || filters.glitchFilter || filters.tvFilter));
        }
        var guarded = ${guardSource};
        guarded._pmjsOliviaGuard = true;
        Sprite.prototype.updateHorrorEffects = guarded;
      })();
    `);
  }
  // Helper methods Olivia calls from the pinned functions but which are not pinned themselves.
  run(`
    Sprite.prototype.createHorrorFilter = function (f) { (this._filters = this._filters || []).push(f); };
    Sprite.prototype.createHorrorNoise = function () {
      this.log.push('createNoise');
      this._horrorFilters.noiseFilter = { animated: false };
      this.createHorrorFilter(this._horrorFilters.noiseFilter);
    };
    Sprite.prototype.createHorrorGlitch = function () {
      this._horrorFilters.glitchFilter = { animated: false, slices: 0 };
    };
    Sprite.prototype.createHorrorTV = function () {
      this._horrorFilters.tvFilter = { animated: false };
    };
    Sprite.prototype.removeHorrorNoise = function () {
      this.log.push('removeNoise');
      this._horrorFilters.noiseFilter = undefined;
    };
    Sprite.prototype.updateHorrorGlitchEffect = function (f) {
      this.log.push('glitchEffect');
      f.slices = f.slices === 0 ? 1 : f.slices;
      return f;
    };
  `);

  run(`
    var PMJS = { phases: { on: function (phase, id, fn) { if (phase === 'afterPlugins') fn(); } } };
    function makeSprite() {
      var s = Object.create(Sprite_Base.prototype);
      s.children = [];
      s._animationSprites = [];
      s._hiding = false;
      s.visible = true;
      s._horrorFilters = {};
      s._horrorFiltersSource = null;
      s.log = [];
      return s;
    }
  `);
  run(fs.readFileSync(MODULE, 'utf8'));

  return {
    context,
    logs,
    run,
    OmoriPerf: run('OmoriPerf'),
    sprite: () => run('makeSprite()'),
    // End state the vanilla chain can observe.
    snapshot: (s) => {
      const filters = s._horrorFilters || {};
      const seen = {};
      for (const key of Object.keys(filters)) {
        if (filters[key]) seen[key] = JSON.parse(JSON.stringify(filters[key]));
      }
      return {
        visible: s.visible,
        hiding: s._hiding,
        children: s.children.length,
        anims: s._animationSprites.length,
        filters: seen,
        log: s.log.slice()
      };
    }
  };
}

// ---------------------------------------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); }
}
function same(name, a, b) { check(name, JSON.stringify(a) === JSON.stringify(b), { vanilla: a, fast: b }); }

// Runs `action` on a fresh sprite twice: enabled=false (full chain) then enabled=true (fast path).
function pair(world, item, action) {
  const stats = world.OmoriPerf[item];
  world.OmoriPerf.hiddenLeafSkip.enabled = false;
  world.OmoriPerf.horrorFastPath.enabled = false;
  stats.enabled = false;
  const before = { taken: stats.taken, fallback: stats.fallback };
  const vanillaSprite = world.sprite();
  const vanilla = action(vanillaSprite);
  const vanillaCounts = { taken: stats.taken - before.taken, fallback: stats.fallback - before.fallback };

  world.OmoriPerf.hiddenLeafSkip.enabled = item === 'hiddenLeafSkip';
  world.OmoriPerf.horrorFastPath.enabled = item === 'horrorFastPath';
  const fastBefore = { taken: stats.taken, fallback: stats.fallback };
  const fastSprite = world.sprite();
  const fast = action(fastSprite);
  const fastCounts = { taken: stats.taken - fastBefore.taken, fallback: stats.fallback - fastBefore.fallback };

  return {
    vanilla: world.snapshot(vanillaSprite), fast: world.snapshot(fastSprite),
    state: { vanilla, fast }, vanillaCounts, fastCounts
  };
}

// =============================================================================================
// install
{
  const world = makeWorld();
  check('install: both items installed',
    world.OmoriPerf.hiddenLeafSkip.installed === true && world.OmoriPerf.horrorFastPath.installed === true);
  check('install: logs installed lines', world.logs.join('\n').includes('horrorFastPath installed'));
}

// =============================================================================================
// hiddenLeafSkip
{
  const w = makeWorld();
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => { s._hiding = true; s.visible = false; s.update(); return s; });
    check('leaf 1: pool tile takes the fast path', r.fastCounts.taken === 1 && r.fastCounts.fallback === 0, r.fastCounts);
    check('leaf 1: vanilla chain ran fully', r.vanillaCounts.taken === 0 && r.vanillaCounts.fallback === 1, r.vanillaCounts);
    same('leaf 1: identical end state', r.vanilla, r.fast);
  }
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => {
      s._hiding = true; s.visible = false;
      s.children.push({ update: function () { s.log.push('child'); } });
      s.update(); return s;
    });
    same('leaf 2: hidden sprite with a child updates it', r.vanilla, r.fast);
    check('leaf 2: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => {
      s._hiding = true; s.visible = false; s.show(); s.update(); return s;
    });
    same('leaf 3: show() resumes the full chain', r.vanilla, r.fast);
    check('leaf 3: visible after show+update', r.fast.visible === true);
    check('leaf 3: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => {
      s._hiding = true; s.visible = false;
      s._animationSprites.push({ isPlaying: function () { return false; }, remove: function () { s.log.push('removed'); } });
      s.update(); return s;
    });
    same('leaf 4: finished animation sprite removed identically', r.vanilla, r.fast);
    check('leaf 4: animation list emptied', r.fast.anims === 0);
  }
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => {
      s._hiding = true; s.visible = true; // inconsistent: update must still correct visible
      s.update(); return s;
    });
    same('leaf 5: visible/_hiding disagree -> corrected identically', r.vanilla, r.fast);
    check('leaf 5: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => {
      s._hiding = true; s.visible = false;
      s.updateVisibility = function () { s.log.push('override'); this.visible = !this._hiding; };
      s.update(); return s;
    });
    same('leaf 6: instance updateVisibility override honoured', r.vanilla, r.fast);
    check('leaf 6: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => {
      s._hiding = true; s.visible = false;
      s._horrorFilters.noiseFilter = { animated: false, seed: 1 };
      s.update(); return s;
    });
    same('leaf 7: horror filter present -> full chain', r.vanilla, r.fast);
    check('leaf 7: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'hiddenLeafSkip', (s) => {
      s._hiding = true; s.visible = false;
      delete s._horrorFilters; // vanilla throws in the Olivia dispatcher
      let error = null;
      try { s.update(); } catch (e) { error = e.constructor.name; }
      return error;
    });
    check('leaf 8: missing _horrorFilters throws in both', r.state.vanilla === r.state.fast, r.state);
    check('leaf 8: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
}

// =============================================================================================
// horrorFastPath
{
  const w = makeWorld();
  {
    const r = pair(w, 'horrorFastPath', (s) => { s.update(); return s; });
    check('horror 1: plain sprite takes the fast path', r.fastCounts.taken === 1 && r.fastCounts.fallback === 0, r.fastCounts);
    check('horror 1: vanilla ran the wrapper', r.vanillaCounts.fallback === 1, r.vanillaCounts);
    same('horror 1: identical end state', r.vanilla, r.fast);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      s.children.push({ update: function () { s.log.push('a'); } });
      s.children.push({ update: function () { s.log.push('b'); } });
      s.update(); return s;
    });
    same('horror 2: children loop order preserved', r.vanilla, r.fast);
    check('horror 2: fast path taken', r.fastCounts.taken === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      const added = { update: function () { s.log.push('added'); } };
      s.children.push({ update: function () { s.log.push('first'); s.children.push(added); } });
      s.update(); return s;
    });
    same('horror 3: children appended during iteration are visited', r.vanilla, r.fast);
    check('horror 3: appended child logged', r.fast.log.join(',') === 'first,added', r.fast.log);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      s.children.push({ update: function () {
        s._horrorFilters.glitchFilter = { animated: false, slices: 3, sliceMax: 5, sliceMin: 1 };
      } });
      s.update(); return s;
    });
    same('horror 4: child-injected filter is animated after the loop', r.vanilla, r.fast);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      s.children.push({ update: function () {
        s.updateHorrorEffects = function () { s.log.push('replaced'); };
      } });
      s.update(); return s;
    });
    same('horror 5: delegate replaced mid-loop is called like vanilla', r.vanilla, r.fast);
    check('horror 5: replacement called', r.fast.log.indexOf('replaced') >= 0, r.fast.log);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      s._horrorFiltersSource = { _horrorFilters: { noiseFilter: { needUpdate: true, noise: 0.7, animated: false } } };
      s.update(); return s;
    });
    same('horror 6: horror source copied', r.vanilla, r.fast);
    check('horror 6: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      s._horrorFilters.noiseFilter = { animated: true, seed: 0 };
      s.update(); return s;
    });
    same('horror 7: active filter animated', r.vanilla, r.fast);
    check('horror 7: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      s.synchronizeHorrorFiltersWithSource = function () { s.log.push('sync-override'); };
      s.update(); return s;
    });
    same('horror 8: instance synchronize override honoured', r.vanilla, r.fast);
    check('horror 8: falls back', r.fastCounts.fallback === 1, r.fastCounts);
  }
  {
    const r = pair(w, 'horrorFastPath', (s) => {
      s.children.push({ update: function () { s.log.push('kid'); } });
      s.update(); return s;
    });
    same('horror 9: sprite with filters and children', r.vanilla, r.fast);
  }
}

// =============================================================================================
// PMJS guarded dispatcher (the composition seen on the device profiles)
{
  const w = makeWorld({ pmjsGuard: true });
  check('pmjs 0: guard accepted as a pin',
    w.OmoriPerf.horrorFastPath.installed === true && w.OmoriPerf.hiddenLeafSkip.installed === true);
  const r = pair(w, 'horrorFastPath', (s) => { s.update(); return s; });
  same('pmjs 1: identical end state under the guarded dispatcher', r.vanilla, r.fast);
  const g = pair(w, 'hiddenLeafSkip', (s) => { s._hiding = true; s.visible = false; s.update(); return s; });
  same('pmjs 2: hidden leaf identical under the guarded dispatcher', g.vanilla, g.fast);
  check('pmjs 3: hidden leaf taken', g.fastCounts.taken === 1, g.fastCounts);
}

// =============================================================================================
// refusal and switches
{
  const w = makeWorld({ tamper: 'base' });
  check('refuse 1: tampered Sprite_Base.update refuses hiddenLeafSkip',
    w.OmoriPerf.hiddenLeafSkip.installed === false && w.logs.join('\n').includes('hiddenLeafSkip refused: Sprite_Base.prototype.update'));
  check('refuse 2: horrorFastPath still installs', w.OmoriPerf.horrorFastPath.installed === true);
}
{
  const w = makeWorld({ tamper: 'update' });
  check('refuse 3: tampered Sprite.update refuses horrorFastPath',
    w.OmoriPerf.horrorFastPath.installed === false && w.logs.join('\n').includes('horrorFastPath refused: Sprite.prototype.update'));
  check('refuse 3b: tampered Sprite.update also refuses hiddenLeafSkip',
    w.OmoriPerf.hiddenLeafSkip.installed === false && w.logs.join('\n').includes('hiddenLeafSkip refused: Sprite.prototype.update'));
}
{
  const w = makeWorld({ tamper: 'children' });
  check('refuse 4: tampered children delegate refuses both items',
    w.OmoriPerf.horrorFastPath.installed === false && w.OmoriPerf.hiddenLeafSkip.installed === false &&
    w.logs.join('\n').includes('Olivia.HorrorEffects.___Sprite_update___'));
}
{
  const w = makeWorld({ tamper: 'effects' });
  check('refuse 5: tampered dispatcher refuses both items',
    w.OmoriPerf.horrorFastPath.installed === false && w.OmoriPerf.hiddenLeafSkip.installed === false);
}
{
  const w = makeWorld({ env: { OMORI_PERF_DISABLE: ' horrorFastPath , other ' } });
  check('switch 1: OMORI_PERF_DISABLE turns horrorFastPath off',
    w.OmoriPerf.horrorFastPath.installed === false && w.OmoriPerf.hiddenLeafSkip.installed === true);
  const r = pair(w, 'hiddenLeafSkip', (s) => { s._hiding = true; s.visible = false; s.update(); return s; });
  same('switch 2: hiddenLeafSkip still equivalent without item 2', r.vanilla, r.fast);
  check('switch 3: hiddenLeafSkip taken without item 2', r.fastCounts.taken === 1, r.fastCounts);
}
{
  const w = makeWorld();
  const s1 = w.sprite(); s1._hiding = true; s1.visible = false; s1.update();
  w.OmoriPerf.hiddenLeafSkip.enabled = false;
  const s2 = w.sprite(); s2._hiding = true; s2.visible = false; s2.update();
  same('switch 4: runtime enabled=false restores the full chain', w.snapshot(s1), w.snapshot(s2));
}

{
  const w = makeWorld();
  const hidden = w.sprite();
  hidden._hiding = true; hidden.visible = false;
  hidden.update();
  const plain = w.sprite();
  plain.children.push({ update: function () { plain.log.push('kid'); } });
  plain.update();
  check('both 1: hidden tile skipped with item 2 also live',
    w.OmoriPerf.hiddenLeafSkip.taken === 1 && w.OmoriPerf.horrorFastPath.taken === 1,
    { leaf: w.OmoriPerf.hiddenLeafSkip, horror: w.OmoriPerf.horrorFastPath });
  check('both 2: non-hidden sprite still runs its children', plain.log.join(',') === 'kid');
  same('both 3: hidden tile unchanged', w.snapshot(hidden),
    { visible: false, hiding: true, children: 0, anims: 0, filters: {}, log: [] });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
