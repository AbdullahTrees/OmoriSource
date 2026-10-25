'use strict';
// Behavioural test for launcher/perf/window-fastpaths.js.
//
// The fake window reproduces rpg_core/rpg_windows initialization order: a synchronous windowskin
// load, move() at the final size, then updatePadding() assigning standardPadding(). The unwrapped
// path refreshes three times; the fast path must refresh once, with the same final size and
// padding, while a real padding change and a later resize still refresh normally.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = fs.readFileSync(path.join(__dirname, 'window-fastpaths.js'), 'utf8');

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

function load(disableItem) {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(String.raw`
    function Window() { this.initialize.apply(this, arguments); }
    Window.prototype.initialize = function () {
      this._width = 0;
      this._height = 0;
      this._padding = 18;
      this.refreshes = 0;
      this.skinLoads = 0;
    };
    Window.prototype._refreshAllParts = function () { this.refreshes++; };
    Window.prototype._onWindowskinLoad = function () {
      this.skinLoads++;
      this._refreshAllParts();
    };
    Window.prototype.move = function (x, y, width, height) {
      if (this._width !== width || this._height !== height) {
        this._width = width;
        this._height = height;
        this._refreshAllParts();
      }
    };
    Object.defineProperty(Window.prototype, 'padding', {
      get: function () { return this._padding; },
      set: function (value) { this._padding = value; this._refreshAllParts(); },
      configurable: true
    });
    function Window_Base() { this.initialize.apply(this, arguments); }
    Window_Base.prototype = Object.create(Window.prototype);
    Window_Base.prototype.constructor = Window_Base;
    Window_Base.prototype.initialize = function (x, y, width, height) {
      Window.prototype.initialize.call(this);
      this._onWindowskinLoad();
      this.move(x, y, width, height);
      this.updatePadding();
      this.contents = {};
    };
    Window_Base.prototype.standardPadding = function () { return this._standardPadding === undefined ? 18 : this._standardPadding; };
    Window_Base.prototype.updatePadding = function () { this.padding = this.standardPadding(); };
    globalThis.Window = Window;
    globalThis.Window_Base = Window_Base;
  `, context);
  if (disableItem) context.process = { env: { OMORI_PERF_DISABLE: disableItem } };
  vm.runInContext(MODULE, context);
  return context;
}

// --- unwrapped baseline ----------------------------------------------------------------------
{
  const context = load('windowParts');
  context.OmoriPerfWindowFastpaths.installForTest();
  ok(context.OmoriPerf.windowParts.disabled === true, 'OMORI_PERF_DISABLE=windowParts disables the module');
  const window = new context.Window_Base(0, 0, 608, 112);
  eq([window.refreshes, window.skinLoads, window._padding], [3, 1, 18],
    'without the fast path a window refreshes three times');
}

// --- enabled, default padding ----------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfWindowFastpaths.installForTest();
  const state = context.OmoriPerf.windowParts;
  const window = new context.Window_Base(0, 0, 608, 112);
  eq([window.refreshes, window.skinLoads, window._padding], [1, 0, 18],
    'the windowskin 0x0 refresh and the unchanged-padding refresh are skipped');
  eq([window._width, window._height], [608, 112], 'the kept move refresh uses the final size');
  eq([state.skinSkips, state.paddingSkips, state.preseeds], [1, 1, 1],
    'the skipped work and the padding pre-seed are counted');
}

// --- enabled, non-default padding ------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfWindowFastpaths.installForTest();
  context.Window_Base.prototype._standardPadding = 8;
  const custom = new context.Window_Base(0, 0, 400, 200);
  eq([custom.refreshes, custom._padding], [1, 8],
    'a non-default standard padding is laid out by the single move refresh');
}

// --- real changes still refresh --------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfWindowFastpaths.installForTest();
  const window = new context.Window_Base(0, 0, 608, 112);
  window.refreshes = 0;
  window.padding = 4;
  eq([window._padding, window.refreshes], [4, 1], 'a real padding change still refreshes once');
  window.refreshes = 0;
  window.move(0, 0, 300, 100);
  eq(window.refreshes, 1, 'a later resize still refreshes once');
  window.padding = 4;
  eq(window.refreshes, 1, 'an unchanged padding assignment after init stays a no-op');
}

// --- runtime off switch ----------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfWindowFastpaths.installForTest();
  context.OmoriPerf.windowParts.enabled = false;
  const window = new context.Window_Base(0, 0, 608, 112);
  eq(window.refreshes, 3, 'OmoriPerf.windowParts.enabled=false restores the three-refresh path');
}

console.log(checks + ' checks, ' + failures + ' failure' + (failures === 1 ? '' : 's'));
process.exit(failures ? 1 : 0);
