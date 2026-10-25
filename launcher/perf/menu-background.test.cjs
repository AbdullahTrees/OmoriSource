'use strict';
// Behavioural test for launcher/perf/menu-background.js.
//
// The fake scene classes reproduce GTP_OmoriFixes' createBackground: a background sprite whose
// filters array holds the same BlurFilter object the mod also stores as sprite.blur. The test
// proves the bitmap is blurred exactly once per snapshot, the filter is removed only when it is
// that exact object, a failed blur leaves the filter in place, and the off switches do nothing.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = fs.readFileSync(path.join(__dirname, 'menu-background.js'), 'utf8');

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
  const context = { console, performance: { now: (function (t) { return function () { return t += 2; }; })(0) } };
  vm.createContext(context);
  vm.runInContext(String.raw`
    var calls = { blurCalls: 0, filtersCreated: 0, foreign: false, blurThrows: false,
      currentBitmap: null, returns: 'created' };
    function makeBitmap() {
      return { blurCalls: 0, blur: function () {
        if (calls.blurThrows) throw new Error('blur failed');
        this.blurCalls++;
        calls.blurCalls++;
      } };
    }
    calls.makeBitmap = makeBitmap;
    var SceneManager = { backgroundBitmap: function () { return calls.currentBitmap; } };
    function Scene_Menu() {}
    Scene_Menu.prototype.createBackground = function () {
      calls.filtersCreated++;
      var filter = calls.foreign ? { foreignFilter: true } : { menuBlur: true };
      this._backgroundSprite = { filters: [filter], blur: calls.foreign ? { other: true } : filter };
      return calls.returns;
    };
    function Scene_OmoMenuBase() {}
    Scene_OmoMenuBase.prototype.createBackground = function () {
      calls.filtersCreated++;
      var filter = calls.foreign ? { foreignFilter: true } : { menuBlur: true };
      this._backgroundSprite = { filters: [filter], blur: calls.foreign ? { other: true } : filter };
      return calls.returns;
    };
    globalThis.SceneManager = SceneManager;
    globalThis.Scene_Menu = Scene_Menu;
    globalThis.Scene_OmoMenuBase = Scene_OmoMenuBase;
    globalThis.calls = calls;
  `, context);
  if (options.disableItem) context.process = { env: { OMORI_PERF_DISABLE: options.disableItem } };
  if (options.noBase) vm.runInContext('globalThis.Scene_OmoMenuBase = undefined;', context);
  vm.runInContext(MODULE, context);
  return context;
}

// --- enabled: one blur per snapshot, filter removed ------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuBackground;
  context.OmoriPerfMenuBackground.installForTest();
  eq(state.installed, true, 'installs with both menu scene classes present');

  const bitmap = context.calls.makeBitmap();
  context.calls.currentBitmap = bitmap;
  const menu = new context.Scene_Menu();
  eq(menu.createBackground(), 'created', 'the original createBackground return value passes through');
  eq(context.calls.blurCalls, 1, 'the first menu scene blurs the snapshot once');
  eq([menu._backgroundSprite.filters, menu._backgroundSprite.blur], [null, null],
    'the background sprite keeps no filter');
  eq([state.filtersRemoved, state.kept, state.blurred], [1, 0, 1],
    'the removal and blur are counted');

  // The options/skill/item scenes are pushed on top and share the same snapshot bitmap.
  const options = new context.Scene_OmoMenuBase();
  options.createBackground();
  eq(context.calls.blurCalls, 1, 'a shared snapshot is not blurred again');
  eq(options._backgroundSprite.filters, null, 'the shared sprite filter is removed too');
  eq(state.filtersRemoved, 2, 'each scene is counted separately');

  // A later menu open takes a new snapshot.
  const second = context.calls.makeBitmap();
  context.calls.currentBitmap = second;
  const reopened = new context.Scene_Menu();
  reopened.createBackground();
  eq([context.calls.blurCalls, second.blurCalls], [2, 1],
    'a new snapshot is blurred once');
  eq(state.blurred, 2, 'the second snapshot is counted');
}

// --- a sprite carrying any other filter is left alone -----------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuBackground;
  context.OmoriPerfMenuBackground.installForTest();
  context.calls.currentBitmap = context.calls.makeBitmap();
  context.calls.foreign = true;
  const menu = new context.Scene_Menu();
  menu.createBackground();
  ok(Array.isArray(menu._backgroundSprite.filters) && menu._backgroundSprite.filters.length === 1,
    'a foreign filter stays on the sprite');
  eq(context.calls.blurCalls, 0, 'a foreign filter does not blur the bitmap');
  eq([state.kept, state.filtersRemoved], [1, 0], 'the sprite is counted as kept');
}

// --- a failed blur keeps the filter -----------------------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuBackground;
  context.OmoriPerfMenuBackground.installForTest();
  context.calls.currentBitmap = context.calls.makeBitmap();
  context.calls.blurThrows = true;
  const menu = new context.Scene_Menu();
  menu.createBackground();
  ok(Array.isArray(menu._backgroundSprite.filters) && menu._backgroundSprite.filters.length === 1,
    'the filter remains when the bitmap blur throws');
  eq(state.filtersRemoved, 0, 'no removal is counted for a failed blur');
  eq(state.errors.length, 1, 'the blur error is recorded');

  // Once the bitmap is blurred successfully it is not blurred again.
  context.calls.blurThrows = false;
  const retry = new context.Scene_Menu();
  retry.createBackground();
  eq(context.calls.blurCalls, 1, 'the retry blurs the snapshot');
  eq(retry._backgroundSprite.filters, null, 'the retry removes the filter');
}

// --- no snapshot: nothing to blur, filter still removed ---------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuBackground;
  context.OmoriPerfMenuBackground.installForTest();
  context.calls.currentBitmap = null;
  const menu = new context.Scene_Menu();
  menu.createBackground();
  eq(context.calls.blurCalls, 0, 'a scene without a background bitmap blurs nothing');
  eq([menu._backgroundSprite.filters, state.filtersRemoved], [null, 1],
    'the filter is removed from an empty background');
}

// --- runtime off switch -----------------------------------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuBackground;
  context.OmoriPerfMenuBackground.installForTest();
  context.calls.currentBitmap = context.calls.makeBitmap();
  state.enabled = false;
  const menu = new context.Scene_Menu();
  menu.createBackground();
  eq(context.calls.blurCalls, 0, 'enabled=false blurs nothing');
  ok(Array.isArray(menu._backgroundSprite.filters), 'enabled=false leaves the filter in place');
  eq([state.kept, state.filtersRemoved], [0, 0], 'the disabled wrapper counts nothing');
}

// --- environment off switch -------------------------------------------------------------------
{
  const context = load({ disableItem: 'menuBackground' });
  const state = context.OmoriPerf.menuBackground;
  context.OmoriPerfMenuBackground.installForTest();
  eq(state.disabled, true, 'OMORI_PERF_DISABLE=menuBackground disables the module');
  context.calls.currentBitmap = context.calls.makeBitmap();
  const menu = new context.Scene_Menu();
  menu.createBackground();
  eq(context.calls.blurCalls, 0, 'the disabled module does not blur');
  ok(Array.isArray(menu._backgroundSprite.filters), 'the disabled module leaves the filter in place');
}

// --- missing class refusal --------------------------------------------------------------------
{
  const context = load({ noBase: true });
  context.OmoriPerfMenuBackground.installForTest();
  eq(context.OmoriPerf.menuBackground.installed, false, 'a missing menu class refuses installation');
  ok(/missing/.test(String(context.OmoriPerf.menuBackground.refused)),
    'the refusal reason is recorded');
}

console.log(checks + ' checks, ' + failures + ' failure' + (failures === 1 ? '' : 's'));
process.exit(failures ? 1 : 0);
