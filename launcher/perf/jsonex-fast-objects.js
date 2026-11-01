// Runtime performance patch: keep game objects in V8 fast-property mode across saves, loads and
// JsonEx.makeDeepCopy (jsonexFastObjects item). Game files and save files stay byte-identical.
//
// PMJS loads it with `--patch launcher/perf/jsonex-fast-objects.js`; NW.js would load it through
// launcher/compat.js. Disable with OMORI_PERF_DISABLE=jsonexFastObjects; counters on
// `root.OmoriPerf.jsonexFastObjects` (`stringified`, `parsed`). The vanilla JsonEx methods are
// pinned to the SHA-256 of their LF-normalized source (recorded below). If a pin does not match,
// the item installs nothing and logs `[omori-perf] jsonexFastObjects refused: <method>`.
//
// The problem (measured 2026-11-01): RPG Maker MV 1.6.1's JsonEx.stringify writes '@c' (and '@'
// for class instances) into every live object it serializes, temporarily replaces shared and
// array fields in place, then removes the tags with `delete` (_cleanMetadata). JsonEx.parse
// likewise deletes '@c'/'@' from every decoded object. V8 moves an object whose properties were
// deleted into dictionary (slow) mode for good. After one save every Game_Event, interpreter and
// character on the map is a dictionary object: map 92 on the device drops from ~37 to ~20 fps
// right after saving, and every loaded save starts in that state. A synthetic per-frame update
// loop over 200 such objects runs ~25x slower after one JsonEx.stringify.
//
// Why it is behaviour-identical:
//
//   stringify — the vanilla algorithm runs unchanged, but on a clone of the argument graph instead
//     of the live objects. The clone has the same prototype per object (so constructor names and
//     toJSON resolve the same), the same own enumerable keys in the same order (data properties
//     copied by value, accessor properties copied as descriptors so getters/setters run exactly as
//     vanilla runs them), the same array lengths and holes, and the same sharing and cycles
//     (one clone per original object). Non-Object/Array values (Map, Date, typed arrays, ...)
//     are shared, not cloned: vanilla's _encode never mutates them either. Vanilla's traversal
//     over an isomorphic graph emits the same ids in the same order, so the JSON is
//     byte-identical; the live graph is never written to.
//
//   parse — the vanilla parse runs unchanged; its result is then rebuilt once into fresh objects
//     (Object.create(same prototype), same keys in the same order, same values, same sharing and
//     cycles, arrays with the same length and holes). Nothing else holds a reference to the
//     intermediate graph, so callers see an equivalent graph whose objects were never `delete`d.
//
//   Not reproduced: vanilla's write into a frozen/sealed live object would throw or be ignored;
//   the clone is writable. No game object is frozen.
//
// Pins (sha256 over the LF-normalized Function.prototype.toString source, rpg_core.js 1.6.1):
//
//   JsonEx.stringify       f828473f50eb89841799e5931d5afb03a48be61ecce223823b432ed4ddf8d8a0
//   JsonEx.parse           73b2d0010667280feea4478bee3525547e336af3be36433872315e100c95204f
//   JsonEx._encode         250424483d8681b975cd188c4f6636664db6101c532d9058b240ce623c151255
//   JsonEx._decode         a72730ac0df340c3bc74223ab1ac52461dc14bb04fb67d038a13c88b2161cdc5
//   JsonEx._cleanMetadata  8f5fa23992a701049c8f7309049c70e12480df3e616b452c4da89f51cb6266d2

(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && root.NativeHost.runtime && typeof root.NativeHost.runtime.env === 'function') {
      return root.NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  if (env('OMORI_PERF') === '0') return;

  var disabled = {};
  String(env('OMORI_PERF_DISABLE') || '').split(',').forEach(function (name) {
    if (name) disabled[name.trim()] = true;
  });

  var requireFn = typeof root.__pmjsBuiltinRequire === 'function'
    ? root.__pmjsBuiltinRequire
    : (typeof require === 'function' ? require : null);
  function digest(fn) {
    if (typeof fn !== 'function') return '';
    var src = Function.prototype.toString.call(fn).replace(/\r\n/g, '\n');
    return requireFn('crypto').createHash('sha256').update(src).digest('hex');
  }

  var toTag = Object.prototype.toString;
  function isGraphNode(value) {
    if (!value || typeof value !== 'object') return false;
    var tag = toTag.call(value);
    return tag === '[object Object]' || tag === '[object Array]';
  }

  // V8 keeps an object in fast mode only for a dozen or so properties added through computed keys
  // (`o[key] = v`), but up to 128 added through literal names (`o.name = v`, as constructors do).
  // A shape factory adds an object's keys as literal names, in order, so a 121-key Game_Event comes
  // out fast. Values are filled in afterwards: writing existing fields never changes the shape.
  var MAX_FAST_KEYS = 128, MAX_FACTORIES = 2000;
  var factories = new Map();
  function shapeFactory(keys) {
    var signature = keys.join('\u0000');
    var factory = factories.get(signature);
    if (factory) return factory;
    if (factories.size >= MAX_FACTORIES) return null;
    var body = 'var o = Object.create(proto);\n';
    for (var i = 0; i < keys.length; i++) body += 'o[' + JSON.stringify(keys[i]) + '] = undefined;\n';
    factory = new Function('proto', body + 'return o;');
    factories.set(signature, factory);
    return factory;
  }

  // Copy of `value`'s Object/Array graph: same prototypes, own enumerable keys in order, array
  // lengths and holes, and sharing. `copies` maps each original to its single copy.
  function cloneGraph(value, copies) {
    if (!isGraphNode(value)) return value;
    var existing = copies.get(value);
    if (existing) return existing;
    var keys = Object.keys(value);
    var descriptors = new Array(keys.length);
    var dataOnly = true;
    for (var d = 0; d < keys.length; d++) {
      descriptors[d] = Object.getOwnPropertyDescriptor(value, keys[d]);
      if (!('value' in descriptors[d])) dataOnly = false;
    }
    var copy;
    if (Array.isArray(value)) {
      copy = new Array(value.length);
    } else {
      var factory = dataOnly && keys.length <= MAX_FAST_KEYS ? shapeFactory(keys) : null;
      copy = factory ? factory(Object.getPrototypeOf(value)) : Object.create(Object.getPrototypeOf(value));
    }
    copies.set(value, copy);
    for (var i = 0; i < keys.length; i++) {
      if (!('value' in descriptors[i])) {
        Object.defineProperty(copy, keys[i], descriptors[i]);
      } else {
        copy[keys[i]] = cloneGraph(descriptors[i].value, copies);
      }
    }
    return copy;
  }

  function install() {
    var JsonEx = root.JsonEx;
    if (!JsonEx || typeof JsonEx.stringify !== 'function') return;
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.jsonexFastObjects) return;
    api.jsonexFastObjects = { installed: false, refused: null, stringified: 0, parsed: 0 };
    var item = api.jsonexFastObjects;
    if (disabled.jsonexFastObjects) {
      item.refused = 'disabled by OMORI_PERF_DISABLE';
      return;
    }
    var pins = [
      ['stringify', 'f828473f50eb89841799e5931d5afb03a48be61ecce223823b432ed4ddf8d8a0'], ['parse', '73b2d0010667280feea4478bee3525547e336af3be36433872315e100c95204f'], ['_encode', '250424483d8681b975cd188c4f6636664db6101c532d9058b240ce623c151255'],
      ['_decode', 'a72730ac0df340c3bc74223ab1ac52461dc14bb04fb67d038a13c88b2161cdc5'], ['_cleanMetadata', '8f5fa23992a701049c8f7309049c70e12480df3e616b452c4da89f51cb6266d2']
    ];
    for (var p = 0; p < pins.length; p++) {
      if (digest(JsonEx[pins[p][0]]) !== pins[p][1]) {
        item.refused = pins[p][0];
        console.log('[omori-perf] jsonexFastObjects refused: ' + pins[p][0] +
          ' digest ' + (digest(JsonEx[pins[p][0]]) || '(missing)'));
        return;
      }
    }

    var vanillaStringify = JsonEx.stringify;
    var vanillaParse = JsonEx.parse;

    JsonEx.stringify = function (object) {
      if (api.enabled === false) return vanillaStringify.call(this, object);
      item.stringified++;
      return vanillaStringify.call(this, cloneGraph(object, new Map()));
    };
    JsonEx.parse = function (json) {
      var contents = vanillaParse.call(this, json);
      if (api.enabled === false) return contents;
      item.parsed++;
      return cloneGraph(contents, new Map());
    };

    item.installed = true;
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.jsonex-fast-objects', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires.
    window.addEventListener('load', install);
  }
})();
