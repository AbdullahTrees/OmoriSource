'use strict';
// Behavioural test for launcher/perf/menu-fastpaths.js.
//
// The four option windows are faked with the parts the guard touches: a visible flag, a parent,
// and a _refreshAllParts counter standing in for the back/frame bitmap rebuild. The category
// window's callUpdateHelp reproduces the game's visibility toggle. Every case compares the
// wrapper's observable effect with the unwrapped path.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = fs.readFileSync(path.join(__dirname, 'menu-fastpaths.js'), 'utf8');

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
    class WindowBase {
      constructor() {
        this.visible = true;
        this.parent = null;
        this.refreshes = 0;
        this.contentDraws = 0;
        this.contents = { clear: function () {} };
      }
      _refreshAllParts() { this.refreshes++; }
      refresh() { this.contentDraws++; }
    }
    class General extends WindowBase {}
    class Audio extends WindowBase {}
    class Controls extends WindowBase {}
    class System extends WindowBase {}
    class Category {
      constructor(windows) { this._optionWindows = windows; this.index = 0; }
      callUpdateHelp() {
        for (var i = 0; i < this._optionWindows.length; i++) {
          this._optionWindows[i].visible = i === this.index;
        }
      }
    }
    globalThis.Window_OmoMenuOptionsGeneral = General;
    globalThis.Window_OmoMenuOptionsAudio = Audio;
    globalThis.Window_OmoMenuOptionsControls = Controls;
    globalThis.Window_OmoMenuOptionsSystem = System;
    globalThis.Window_OmoMenuOptionsCategory = Category;
    globalThis.PMJS = { phases: { on: function (name, id, fn) { fn(); } } };
  `, context);
  if (disableItem) context.process = { env: { OMORI_PERF_DISABLE: disableItem } };
  vm.runInContext(MODULE, context);
  return context;
}

function attach(context, window) {
  context.attach = window;
  vm.runInContext('globalThis.attach.parent = {};', context);
  return window;
}

// --- enabled install -------------------------------------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.menuParts;
  ok(state.installed === true, 'installs when the option window classes exist');
  ok(state.refused === null, 'does not refuse');

  const General = context.Window_OmoMenuOptionsGeneral;
  const Audio = context.Window_OmoMenuOptionsAudio;
  const Controls = context.Window_OmoMenuOptionsControls;
  const visible = attach(context, new General());
  visible._refreshAllParts();
  eq(visible.refreshes, 1, 'a visible, parented window refreshes normally');
  eq(visible._omoriMenuPartsDirty, false, 'a visible refresh clears the stale flag');

  const hidden = attach(context, new Audio());
  hidden.visible = false;
  hidden._refreshAllParts();
  eq(hidden.refreshes, 0, 'a hidden window defers _refreshAllParts');
  eq(hidden._omoriMenuPartsDirty, true, 'the hidden window records stale parts');
  ok(state.skipped >= 1, 'the skip is counted');
  hidden.refresh();
  eq(hidden.contentDraws, 0, 'a hidden window defers its contents drawing');
  eq(hidden._omoriMenuContentDirty, true, 'the hidden window records stale contents');
  visible.refresh();
  eq(visible.contentDraws, 1, 'a visible window draws its contents normally');

  const orphan = new Controls();
  orphan._refreshAllParts();
  eq(orphan.refreshes, 0, 'an unparented window defers _refreshAllParts');
  eq(orphan._omoriMenuPartsDirty, true, 'the unparented window records stale parts');

  const category = context.Window_OmoMenuOptionsCategory;
  const wins = [visible, hidden, orphan, attach(context, new (context.Window_OmoMenuOptionsSystem)())];
  const cat = new category(wins);
  cat.index = 1;
  cat.callUpdateHelp();
  eq(hidden.refreshes, 1, 'becoming visible refreshes the stale window once');
  eq(hidden._omoriMenuPartsDirty, false, 'the refresh clears the stale flag');
  eq(hidden.contentDraws, 1, 'becoming visible draws the deferred contents once');
  eq(hidden._omoriMenuContentDirty, false, 'the contents refresh clears the stale flag');
  eq(visible.visible, false, 'the previously visible window is hidden');
  eq(wins[3].refreshes, 0, 'the still-hidden window stays deferred');
}

// --- runtime off switch ----------------------------------------------------------------------
{
  const context = load();
  const Audio = context.Window_OmoMenuOptionsAudio;
  const hidden = attach(context, new Audio());
  hidden.visible = false;
  context.OmoriPerf.menuParts.enabled = false;
  hidden._refreshAllParts();
  eq(hidden.refreshes, 1, 'OmoriPerf.menuParts.enabled=false restores the original refresh');
  hidden.refresh();
  eq(hidden.contentDraws, 1, 'the runtime switch also restores the contents drawing');
}

// --- disabled at install ---------------------------------------------------------------------
{
  const context = load('menuParts');
  const Audio = context.Window_OmoMenuOptionsAudio;
  const hidden = attach(context, new Audio());
  hidden.visible = false;
  hidden._refreshAllParts();
  eq(hidden.refreshes, 1, 'OMORI_PERF_DISABLE=menuParts leaves the window unwrapped');
  hidden.refresh();
  eq(hidden.contentDraws, 1, 'the environment switch leaves the contents drawing unwrapped');
  eq(context.OmoriPerfMenuFastpaths.stats.menuParts.disabled, true, 'the disabled state is recorded');
}

console.log(checks + ' checks, ' + failures + ' failure' + (failures === 1 ? '' : 's'));
process.exit(failures ? 1 : 0);
