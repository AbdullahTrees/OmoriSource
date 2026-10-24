'use strict';
// Equivalence tests for launcher/perf/label-fastpaths.js.
//
// The pinned YEP/GTP methods are not re-typed here: their exact source slices are extracted
// from the game files and evaluated in a fresh vm context, so the SHA-256 pins in the module
// match the way they do after a real plugin load. Scenarios run the same sprite twice, once
// with the item disabled (full vanilla chain) and once enabled, and compare the per-step
// observable state (label shown, text, parent, delay, position).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..', '..'); // .../REVERSE
const SRC = path.join(REPO, 'OmoriSource');
const MODULE = path.join(__dirname, 'label-fastpaths.js');

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

const YEP = 'project/js/plugins/YEP_EventMiniLabel.js';
const GTP = 'project/js/plugins/GTP_OmoriFixes.js';
const REAL = {
  setupYep: [YEP, 'Sprite_Character.prototype.setupMiniLabel = function() {'],
  setupGtp: [GTP, 'Sprite_Character.prototype.setupMiniLabel = function() {'],
  position: [YEP, 'Sprite_Character.prototype.positionMiniLabel = function() {'],
  setCharacter: [YEP, 'Window_EventMiniLabel.prototype.setCharacter = function(character) {'],
  gather: [YEP, 'Window_EventMiniLabel.prototype.gatherDisplayData = function() {'],
  extract: [YEP, 'Window_EventMiniLabel.prototype.extractNotedata = function(comment) {'],
  setText: [YEP, 'Window_EventMiniLabel.prototype.setText = function(text) {'],
  updatePage: [YEP, 'Window_EventMiniLabel.prototype.updatePage = function() {']
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
    var Yanfly = { Param: { EMWMinWidth: 136, EMWBufferX: 0, EMWBufferY: 36, EMWFontSize: 20 } };
    var Imported = {};
    Array.prototype.contains = function (value) { return this.indexOf(value) >= 0; };
    Array.prototype.clone = function () { return this.slice(); };
    var $gameSystem = { isShowEventMiniLabel: function () { return true; } };
    var $gameTemp = {};
    function Window_Base() {}
    Window_Base.prototype.initialize = function () {};
    Window_Base.prototype.update = function () {};
    var SceneManager = { _scene: { _spriteset: null } };
    var constructionCount = 0;
    function Window_EventMiniLabel() { this.initialize.apply(this, arguments); }
    Window_EventMiniLabel.prototype.initialize = function () {
      this._text = '';
      this._pageIndex = 0;
      this.visible = true;
      this.contentsOpacity = 255;
      this.width = 136;
      this.height = 36;
      this.scale = { x: 1, y: 1 };
      this.contents = { clear: function () {} };
      this.parent = null;
      this.refreshCount = 0;
      constructionCount++;
    };
    Window_EventMiniLabel.prototype.refresh = function () { this.refreshCount++; };
    Window_EventMiniLabel.prototype.bufferX = function () { return 0; };
    Window_EventMiniLabel.prototype.bufferY = function () { return 0; };
    Window_EventMiniLabel.prototype.show = function () { this.visible = true; };
    Window_EventMiniLabel.prototype.hide = function () { this.visible = false; };
    Window_EventMiniLabel.prototype.updateOpacity = function () { this.visible = this._text !== ''; };
    Window_EventMiniLabel.prototype.update = function () {
      this.updatePage();
      if (this._text === '') return;
      this.updateOpacity();
    };
    function Sprite_Character() {}
    Sprite_Character.prototype.setupMiniLabel = ${slice(REAL.setupYep[0], REAL.setupYep[1])};
    Sprite_Character.prototype.positionMiniLabel = ${slice(REAL.position[0], REAL.position[1])};
    Window_EventMiniLabel.prototype.setCharacter = ${slice(REAL.setCharacter[0], REAL.setCharacter[1])};
    Window_EventMiniLabel.prototype.gatherDisplayData = ${slice(REAL.gather[0], REAL.gather[1])};
    Window_EventMiniLabel.prototype.extractNotedata = ${slice(REAL.extract[0], REAL.extract[1])};
    Window_EventMiniLabel.prototype.setText = ${slice(REAL.setText[0], REAL.setText[1])};
    Window_EventMiniLabel.prototype.updatePage = ${slice(REAL.updatePage[0], REAL.updatePage[1])};
    var _old_sprite_character_setupMiniLabel = Sprite_Character.prototype.setupMiniLabel;
    Sprite_Character.prototype.setupMiniLabel = ${slice(REAL.setupGtp[0], REAL.setupGtp[1])};
  `);
  if (opts.tamper) {
    run('Sprite_Character.prototype.setupMiniLabel = function () { return "tampered"; };');
  }

  run(`
    var spriteset = {
      children: [],
      addChild: function (child) { child.parent = this; this.children.push(child); },
      removeChild: function (child) {
        var i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        child.parent = null;
      }
    };
    SceneManager._scene._spriteset = spriteset;
    var PMJS = { phases: { on: function (phase, id, fn) { if (phase === 'afterPlugins') fn(); } } };
  `);
  run(fs.readFileSync(MODULE, 'utf8'));

  return {
    context,
    logs,
    run,
    OmoriPerf: run('OmoriPerf'),
    spriteset: run('spriteset'),
    windowCount: () => run('constructionCount'),
    sprite: (character, parentIndex) => {
      const s = run('Object.create(Sprite_Character.prototype)');
      s._character = character;
      s._miniLabel = undefined;
      s._labelDelay = undefined;
      s.x = 100;
      s.y = 200;
      s.height = 32;
      s.parent = null;
      if (parentIndex !== undefined && parentIndex !== null) {
        const children = [];
        for (let i = 0; i < parentIndex; i++) children.push({});
        children.push(s);
        s.parent = { children: children, getChildIndex: function (child) { return this.children.indexOf(child); } };
      }
      return s;
    }
  };
}

const command = (code, text) => ({ code: code, parameters: [text] });
const labelPage = (text) => ({ list: [command(101, 'x'), command(108, '<Mini Label: ' + text + '>')] });
const plainPage = () => ({ list: [command(101, 'x'), command(108, 'nothing here')] });

function makeCharacter(page, eventId) {
  const c = {
    _eventId: eventId === undefined ? 7 : eventId,
    _pageIndex: 0,
    _page: page,
    page: function () { return this._page; },
    list: function () { return this._page.list; }
  };
  return c;
}

function setPage(character, page, index) {
  character._page = page;
  character._pageIndex = index;
}

function step(world, sprite) {
  sprite.setupMiniLabel();
  const children = world.spriteset.children.slice();
  for (const child of children) {
    if (child && typeof child.update === 'function') child.update();
  }
  if (sprite._miniLabel) sprite.positionMiniLabel();
}

function trace(world, sprite, frames, hooks) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    if (hooks && hooks[i]) hooks[i](world, sprite);
    step(world, sprite);
    const w = sprite._miniLabel;
    out.push({
      delay: sprite._labelDelay === undefined ? 'u' : sprite._labelDelay,
      exists: !!w,
      shown: !!(w && w.parent && w._text !== ''),
      parented: !!(w && w.parent),
      text: w ? w._text : '',
      visible: !!(w && w.parent && w.visible),
      x: w && w.parent ? w.x : null,
      y: w && w.parent ? w.y : null
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); }
}

function sameObservable(a, b, includeExists) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    for (const key of ['delay', 'shown', 'parented', 'text', 'visible', 'x', 'y']) {
      if (a[i][key] !== b[i][key]) return false;
    }
    if (includeExists && a[i].exists !== b[i].exists) return false;
  }
  return true;
}

function runPair(options) {
  // The vanilla world refuses the item entirely, so its prototype is the stock composition.
  const vanilla = makeWorld({ env: { OMORI_PERF_DISABLE: 'miniLabelLazy' } });
  const fast = makeWorld(Object.assign({}, options, { env: options && options.env ? options.env : {} }));
  return { vanilla, fast };
}

// ---------------------------------------------------------------------------------------------
// 1. A page with no label: vanilla builds an empty window after the stagger; the fast path
//    never builds one. Nothing is shown in either, and the delay timeline is identical.
{
  const { vanilla, fast } = runPair();
  check('fast path installs', fast.OmoriPerf.miniLabelLazy.installed === true,
    fast.OmoriPerf.miniLabelLazy);
  const cv = makeCharacter(plainPage());
  const cf = makeCharacter(plainPage());
  const sv = vanilla.sprite(cv, 3);
  const sf = fast.sprite(cf, 3);
  const tv = trace(vanilla, sv, 8);
  const tf = trace(fast, sf, 8);
  check('no-label: delay timeline identical', JSON.stringify(tv.map(s => s.delay)) === JSON.stringify(tf.map(s => s.delay)),
    { vanilla: tv.map(s => s.delay), fast: tf.map(s => s.delay) });
  check('no-label: nothing shown in either path', tv.every(s => !s.shown) && tf.every(s => !s.shown));
  check('no-label: vanilla built the empty window once', vanilla.windowCount() === 1, vanilla.windowCount());
  check('no-label: fast path built no window', fast.windowCount() === 0, fast.windowCount());
  check('no-label: fast path marked absent once', fast.OmoriPerf.miniLabelLazy.absent === 1,
    fast.OmoriPerf.miniLabelLazy.absent);
  check('observable trace identical apart from window existence',
    sameObservable(tv, tf, false));
}

// 2. A label on the current page: both construct at the same step, with the same text and
//    position, and the window is parented into the spriteset.
{
  const { vanilla, fast } = runPair();
  const cv = makeCharacter(labelPage('Hello'));
  const cf = makeCharacter(labelPage('Hello'));
  const sv = vanilla.sprite(cv, 2);
  const sf = fast.sprite(cf, 2);
  const tv = trace(vanilla, sv, 7);
  const tf = trace(fast, sf, 7);
  check('label: identical observable trace (window, text, parent, position)', sameObservable(tv, tf, true));
  const firstShown = tv.findIndex(s => s.shown);
  // Parent index 2: steps 0 and 1 consume the delay, construction happens on step 2.
  check('label: shown at the first step after the stagger', firstShown === 2, firstShown);
  check('label: text is the tag text', tv[firstShown] && tv[firstShown].text === 'Hello');
  check('label: fast path constructed exactly one window', fast.windowCount() === 1, fast.windowCount());
}

// 3. The page changes to a label page during the stagger delay: vanilla constructs with the
//    page current at the end of the delay, and so does the fast path.
{
  const { vanilla, fast } = runPair();
  const cv = makeCharacter(plainPage());
  const cf = makeCharacter(plainPage());
  const sv = vanilla.sprite(cv, 4);
  const sf = fast.sprite(cf, 4);
  const hooks = { 1: () => {} };
  const tv = trace(vanilla, sv, 8, {
    1: () => setPage(cv, labelPage('Late'), 1)
  });
  const tf = trace(fast, sf, 8, {
    1: () => setPage(cf, labelPage('Late'), 1)
  });
  check('page-during-delay: identical observable trace',
    sameObservable(tv, tf, true), { vanilla: tv, fast: tf });
  check('page-during-delay: label shown at the delay end', tv.some(s => s.shown && s.text === 'Late'),
    tv);
}

// 4. The page gains a label after the empty window would have been built: vanilla's empty
//    window is never parented and never updated, so no label can appear. The fast path's
//    absent flag matches that observable outcome.
{
  const { vanilla, fast } = runPair();
  const cv = makeCharacter(plainPage());
  const cf = makeCharacter(plainPage());
  const sv = vanilla.sprite(cv, 1);
  const sf = fast.sprite(cf, 1);
  const tv = trace(vanilla, sv, 10, { 5: () => setPage(cv, labelPage('TooLate'), 1) });
  const tf = trace(fast, sf, 10, { 5: () => setPage(cf, labelPage('TooLate'), 1) });
  check('late label after empty window: nothing shown in either path',
    tv.every(s => !s.shown) && tf.every(s => !s.shown), { vanilla: tv, fast: tf });
  check('late label after empty window: observable trace identical', sameObservable(tv, tf, false));
  check('late label after empty window: fast path built no window', fast.windowCount() === 0,
    fast.windowCount());
}

// 5. A label page turns into a no-label page: the window exists, so the fast path delegates
//    every call; parent removal and text changes must match vanilla step for step.
{
  const { vanilla, fast } = runPair();
  const cv = makeCharacter(labelPage('Bye'));
  const cf = makeCharacter(labelPage('Bye'));
  const sv = vanilla.sprite(cv, 1);
  const sf = fast.sprite(cf, 1);
  const tv = trace(vanilla, sv, 12, { 6: () => setPage(cv, plainPage(), 1) });
  const tf = trace(fast, sf, 12, { 6: () => setPage(cf, plainPage(), 1) });
  check('label->plain: identical observable trace', sameObservable(tv, tf, true));
  check('label->plain: label disappears', tv[tv.length - 1].shown === false);
  check('label->plain: fast path delegated after construction',
    fast.OmoriPerf.miniLabelLazy.fallback > 0);
}

// 6. label -> plain -> label: the unparented window is not updated, so vanilla shows no
//    label again; the fast path delegates and must reproduce it.
{
  const { vanilla, fast } = runPair();
  const cv = makeCharacter(labelPage('One'));
  const cf = makeCharacter(labelPage('One'));
  const sv = vanilla.sprite(cv, 1);
  const sf = fast.sprite(cf, 1);
  const tv = trace(vanilla, sv, 16, {
    6: () => setPage(cv, plainPage(), 1),
    10: () => setPage(cv, labelPage('Two'), 2)
  });
  const tf = trace(fast, sf, 16, {
    6: () => setPage(cf, plainPage(), 1),
    10: () => setPage(cf, labelPage('Two'), 2)
  });
  check('label->plain->label: identical observable trace', sameObservable(tv, tf, true),
    { vanilla: tv, fast: tf });
  check('label->plain->label: no label returns (vanilla window is unparented)',
    tv[tv.length - 1].shown === false);
}

// 7. Player/follower sprite (no event id): vanilla builds an empty window, fast skips it.
{
  const { vanilla, fast } = runPair();
  const cv = makeCharacter(labelPage('Never'), 0);
  const cf = makeCharacter(labelPage('Never'), 0);
  const sv = vanilla.sprite(cv, 0);
  const sf = fast.sprite(cf, 0);
  const tv = trace(vanilla, sv, 5);
  const tf = trace(fast, sf, 5);
  check('non-event: nothing shown in either path', tv.every(s => !s.shown) && tf.every(s => !s.shown));
  check('non-event: observable trace identical', sameObservable(tv, tf, false));
  check('non-event: fast path built no window', fast.windowCount() === 0, fast.windowCount());
}

// 8. No parent: no stagger delay; a label page constructs immediately in both paths.
{
  const { vanilla, fast } = runPair();
  const cv = makeCharacter(labelPage('Now'));
  const cf = makeCharacter(labelPage('Now'));
  const sv = vanilla.sprite(cv, null);
  const sf = fast.sprite(cf, null);
  const tv = trace(vanilla, sv, 3);
  const tf = trace(fast, sf, 3);
  check('no parent: identical observable trace', sameObservable(tv, tf, true));
  check('no parent: shown on the first step', tv[0].shown === true);
}

// 9. `enabled = false` restores the vanilla chain exactly, including the empty window.
{
  const { vanilla, fast } = runPair();
  fast.OmoriPerf.miniLabelLazy.enabled = false;
  const cv = makeCharacter(plainPage());
  const cf = makeCharacter(plainPage());
  const sv = vanilla.sprite(cv, 2);
  const sf = fast.sprite(cf, 2);
  const tv = trace(vanilla, sv, 6);
  const tf = trace(fast, sf, 6);
  check('disabled: identical trace including window existence', sameObservable(tv, tf, true));
  check('disabled: fast world built the same empty window', fast.windowCount() === 1,
    fast.windowCount());
}

// 10. A composed method that is not the pinned GTP wrapper refuses to install.
{
  const world = makeWorld({ tamper: true });
  check('tampered composition is refused', world.OmoriPerf.miniLabelLazy.installed === false,
    world.OmoriPerf.miniLabelLazy);
  check('refusal is logged',
    world.logs.some(line => line.indexOf('miniLabelLazy refused') >= 0), world.logs);
}

// 11. OMORI_PERF_DISABLE=miniLabelLazy refuses to install.
{
  const world = makeWorld({ env: { OMORI_PERF_DISABLE: 'miniLabelLazy' } });
  check('OMORI_PERF_DISABLE refuses the item',
    world.OmoriPerf.miniLabelLazy.installed === false, world.OmoriPerf.miniLabelLazy);
}

// ---------------------------------------------------------------------------------------------
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
