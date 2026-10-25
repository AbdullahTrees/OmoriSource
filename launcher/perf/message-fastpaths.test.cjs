'use strict';
// Behavioural test for launcher/perf/message-fastpaths.js.
//
// The fake Window_Message carries YEP_MessageCore's adjustWindowSettings body with counters for
// width/height assignments and createContents. The wrapper must produce the same final geometry
// and contents size while skipping the assignments when the values are unchanged, and must fall
// back to the original on a pin mismatch, the environment switch and the runtime switch.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = fs.readFileSync(path.join(__dirname, 'message-fastpaths.js'), 'utf8');

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
  const context = { console, Graphics: { boxWidth: 640, boxHeight: 480 } };
  vm.createContext(context);
  vm.runInContext(String.raw`
    class WindowMessage {
      constructor() {
        this._width = 608;
        this._height = 112;
        this._x = 0;
        this._contents = { width: 592, height: 96 };
        this.widthSets = 0;
        this.heightSets = 0;
        this.contentsCreated = 0;
      }
      get width() { return this._width; }
      set width(value) { this._width = value; this.widthSets++; }
      get height() { return this._height; }
      set height(value) { this._height = value; this.heightSets++; }
      get x() { return this._x; }
      set x(value) { this._x = value; }
      get contents() { return this._contents; }
      set contents(value) { this._contents = value; }
      windowWidth() { return this._windowWidth || 608; }
      windowHeight() { return this._windowHeight || 112; }
      lineHeight() { return 28; }
      contentsWidth() { return this._width - 16; }
      contentsHeight() { return this._height - 16; }
      createContents() {
        this.contentsCreated++;
        this._contents = { width: this.contentsWidth(), height: this.contentsHeight() };
      }
      adjustWindowSettings() {
        this.width = this.windowWidth();
        this.height = Math.min(this.windowHeight(), Graphics.boxHeight);
        if (Math.abs(Graphics.boxHeight - this.height) < this.lineHeight()) {
          this.height = Graphics.boxHeight;
        }
        this.createContents();
        this.x = (Graphics.boxWidth - this.width) / 2;
      }
    }
    globalThis.Window_Message = WindowMessage;
  `, context);
  if (disableItem) context.process = { env: { OMORI_PERF_DISABLE: disableItem } };
  vm.runInContext(MODULE, context);
  return context;
}

// --- enabled, unchanged size -----------------------------------------------------------------
{
  const context = load();
  const state = context.OmoriPerf.messageSettings;
  context.OmoriPerfMessageFastpaths.installForTest(true);
  ok(state.installed === true, 'installs when the reviewed function is accepted for test');

  const window = new context.Window_Message();
  window.adjustWindowSettings();
  eq([window.widthSets, window.heightSets, window.contentsCreated], [0, 0, 1],
    'unchanged size skips only the width/height rebuilds, not the contents/font reset');
  eq([window.width, window.height, window.x], [608, 112, 16], 'geometry matches YEP');
  eq(state.skipped, 1, 'the no-op call is counted');
  eq(state.resized, 0, 'no resize is counted');

  const wider = new context.Window_Message();
  wider._windowWidth = 600;
  wider.adjustWindowSettings();
  eq([wider.widthSets, wider.heightSets, wider.contentsCreated], [1, 0, 1],
    'a real width change still assigns and recreates contents once');
  eq([wider.width, wider.x], [600, 20], 'the changed width and centering match YEP');
  eq(state.resized, 1, 'the resize is counted');

  const taller = new context.Window_Message();
  taller._windowHeight = 200;
  taller.adjustWindowSettings();
  eq([taller.heightSets, taller.contentsCreated], [1, 1],
    'a real height change still assigns and recreates contents once');
  eq([taller.height, taller._contents.height], [200, 184], 'the contents bitmap follows the height');
}

// --- runtime off switch ----------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMessageFastpaths.installForTest(true);
  const window = new context.Window_Message();
  context.OmoriPerf.messageSettings.enabled = false;
  window.adjustWindowSettings();
  eq([window.widthSets, window.heightSets, window.contentsCreated], [1, 1, 1],
    'enabled=false runs the original unconditional assignments');
}

// --- production pin refusal ------------------------------------------------------------------
{
  const context = load();
  context.OmoriPerfMessageFastpaths.installForTest(false);
  eq(context.OmoriPerf.messageSettings.refused,
    'Window_Message.adjustWindowSettings does not match the reviewed source',
    'a fixture function that does not match the pin is refused');
  const window = new context.Window_Message();
  window.adjustWindowSettings();
  eq([window.widthSets, window.heightSets, window.contentsCreated], [1, 1, 1],
    'the refused module leaves the original in place');
}

// --- environment off switch ------------------------------------------------------------------
{
  const context = load('messageSettings');
  context.OmoriPerfMessageFastpaths.installForTest(true);
  eq(context.OmoriPerf.messageSettings.disabled, true, 'OMORI_PERF_DISABLE=messageSettings disables it');
  const window = new context.Window_Message();
  window.adjustWindowSettings();
  eq([window.widthSets, window.heightSets, window.contentsCreated], [1, 1, 1],
    'the environment switch leaves the original in place');
}

console.log(checks + ' checks, ' + failures + ' failure' + (failures === 1 ? '' : 's'));
process.exit(failures ? 1 : 0);
