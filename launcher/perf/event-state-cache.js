// Runtime performance patch: O(1) isAnyEventStarting (event-state-cache task). Game files stay
// byte-identical.
//
// PMJS loads it with `--patch launcher/perf/event-state-cache.js`; NW.js would load it through
// launcher/compat.js. Disable with OMORI_PERF_DISABLE=startingCount; counters on
// `root.OmoriPerf.startingCount` (`fast` = O(1) answers, `rescan` = recounts, `vanilla` = calls
// routed to the original). Every replaced/wrapped method is pinned to the SHA-256 of
// Function.prototype.toString of the method as composed after all plugins load (LF-normalized;
// recorded below). If any pin does not match, the item installs nothing and logs
// `[omori-perf] startingCount refused: <method>`.
//
// Why it is behaviour-identical:
//
//   startingCount — rpg_objects.js:6222 `isAnyEventStarting` is `this.events().some(e =>
//     e.isStarting())`: the answer is just "does any non-null `_events` slot have truthy
//     `_starting`". The patch keeps an exact count of such slots on the map and answers in O(1).
//     The count is maintained by wrapping the only two methods that transition `_starting` at
//     runtime — `Game_Event.start` (to truthy; the composed YEP_EventEncounterAid version writes
//     it either directly or through the captured vanilla start, both inside the wrapper) and
//     `Game_Event.clearStartingFlag` (to falsy; called from `setupPage`) — with a before/after
//     compare on `this._starting`, adjusting the count only when the event is a member of
//     `$gameMap._events`, the only array vanilla's scan reads. A transition on an object that is
//     NOT in that array (a Game_Event still being constructed by YEP_EventSpawner, before
//     `spawnEvent` inserts it — its `setupPage` -> `checkEventTriggerAuto` may already `start()`
//     it) invalidates the count instead, so the next read recounts and picks it up after
//     insertion. Recount also runs when the count is absent (a save restored under JsonEx writes
//     `_starting` directly, and the restored Game_Map never had a count) or when `this._events`
//     is not the array — or not the length — the count was computed over (see the membership
//     audit below). The stamps are stored non-enumerable so saves keep vanilla's key set. With
//     `perf.enabled` false the original function answers and the wrappers keep maintaining, so
//     toggling back is seamless.
//
//     `_events` membership audit (grep project/js + launcher): the scanned array changes only
//     by `Game_Map.setupEvents` (rpg_objects.js:5583: `this._events = []` then ascending fills —
//     identity change, caught by the ref stamp) and by two YEP_EventSpawner slot writes —
//     `restoreSpawnedEvents` (:594, `this._events[i + IdStartRange]`) and `spawnEvent` (:612,
//     `this._events[_spawnedEvents.length + IdStartRange]`). Both land at index >=
//     Yanfly.Param.EventSpawnerID = 1000 (project/js/plugins.js) while the largest
//     `$dataMap.events.length` in any map is 323 (Map007), so both ALWAYS EXTEND the array;
//     `eraseEvent` (rpg_objects.js:5606) and `despawnEventId` (YEP_EventSpawner.js:617) leave
//     the erased event object in its slot. Every membership change is therefore an identity
//     change or a length increase — in-place slot replacement is unreachable — so stamping the
//     length beside the identity makes the next read recount after any insert. That is what
//     covers inserts that carry `_starting: true` with no wrapped transition (JsonEx-restored
//     spawned events dropped in by `restoreSpawnedEvents`) and inserts landing after a read
//     re-stamped the count in the pre-insertion window (a spawn whose `new Game_Event` already
//     `start()`ed itself via setupPage -> checkEventTriggerAuto).
//
//     `_starting` write-site audit (grep project/js): rpg_objects.js initMembers:8490 (fresh
//     events, falsy — object not yet in `_events`), clearStartingFlag:8622, start:8632,
//     YEP_EventEncounterAid.js:318 (inside the wrapped start). No other writer exists, and no
//     plugin replaces `isStarting` or `clearStartingFlag` (grep), so `_starting` truth and
//     `isStarting()` truth coincide — which the `isStarting` pin keeps underwritten.
//
// Pins (sha256 over the LF-normalized Function.prototype.toString source):
//
//   isAnyEventStarting  (rpg_objects.js:6222)              aa5b3505b08fcf37ac87cef06c2661e1ecf4e907892d4bbb87807ebe365ce70b
//   start               (YEP_EventEncounterAid.js:314)     8c348cdaee898953b749cab73ddc29dd6b893ce59aaeb0f3a8c22ea5362d9f15
//   clearStartingFlag   (rpg_objects.js:8621)              4907fc17838aec5be3bac3f494c2689f9dca63a467883183e41d08efb595b8b4
//   isStarting          (rpg_objects.js:8617)              4a995e3fa2429ae7283c2a0a343940e0c27ca7cd54841a6115262f979b736e79

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
  function checkPins(item, pins) {
    for (var i = 0; i < pins.length; i++) {
      if (pins[i].digests.length && pins[i].digests.indexOf(digest(pins[i].fn)) < 0) {
        item.refused = pins[i].name;
        console.log('[omori-perf] startingCount refused: ' + pins[i].name +
          ' digest ' + (digest(pins[i].fn) || '(missing)'));
        return false;
      }
    }
    return true;
  }

  function install() {
    if (typeof root.Game_Map !== 'function' || typeof root.Game_Event !== 'function') return;
    // logic-fastpaths.js assigns root.OmoriPerf at file load and runs its install after this
    // one's (module load order), so the counter entry is created here at install time, not in
    // the file body where a later module would clobber it.
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.startingCount) return;
    api.startingCount = { installed: false, refused: null, fast: 0, vanilla: 0, rescan: 0 };
    var item = api.startingCount;
    if (disabled.startingCount) {
      item.refused = 'disabled by OMORI_PERF_DISABLE';
      return;
    }

    var Game_Map = root.Game_Map, Game_Event = root.Game_Event;
    if (!checkPins(item, [
      { name: 'isAnyEventStarting', fn: Game_Map.prototype.isAnyEventStarting,
        digests: ['aa5b3505b08fcf37ac87cef06c2661e1ecf4e907892d4bbb87807ebe365ce70b'] },
      { name: 'start', fn: Game_Event.prototype.start,
        digests: ['8c348cdaee898953b749cab73ddc29dd6b893ce59aaeb0f3a8c22ea5362d9f15'] },
      { name: 'clearStartingFlag', fn: Game_Event.prototype.clearStartingFlag,
        digests: ['4907fc17838aec5be3bac3f494c2689f9dca63a467883183e41d08efb595b8b4'] },
      { name: 'isStarting', fn: Game_Event.prototype.isStarting,
        digests: ['4a995e3fa2429ae7283c2a0a343940e0c27ca7cd54841a6115262f979b736e79'] }
    ])) return;

    var originalStarting = Game_Map.prototype.isAnyEventStarting;
    var originalStart = Game_Event.prototype.start;
    var originalClear = Game_Event.prototype.clearStartingFlag;

    // Hidden so JsonEx never sees them: saves keep vanilla's key set, and a restored map (which
    // never had a count) recounts on first read.
    function putHidden(obj, name, value) {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && !d.enumerable && d.writable) obj[name] = value;
      else Object.defineProperty(obj, name, {
        value: value, writable: true, enumerable: false, configurable: true
      });
    }

    function inMapEvents(map, ev) {
      var evs = map._events;
      for (var i = 0; i < evs.length; i++) {
        if (evs[i] === ev) return true;
      }
      return false;
    }

    // Only reached on real truthiness transitions of _starting (event starts and page refreshes
    // that clear a starting flag), so the O(n) membership scan is fine.
    function noteTransition(ev, now) {
      var map = root.$gameMap;
      if (!map) return;
      var n = map._startingCount;
      // Recount already pending (invalidated count, swapped array, or an insert extended the
      // array past the stamped length) — do not adjust a count that the next read will replace.
      if (n === undefined || map._startingEventsRef !== map._events ||
          map._startingCountLen !== map._events.length) return;
      if (inMapEvents(map, ev)) putHidden(map, '_startingCount', now ? n + 1 : n - 1);
      else putHidden(map, '_startingCount', undefined);  // mid-construction event: recount after insert
    }

    item.installed = true;

    Game_Event.prototype.start = function () {
      var was = this._starting;
      originalStart.call(this);
      if (!was !== !this._starting) noteTransition(this, !!this._starting);
    };
    Game_Event.prototype.clearStartingFlag = function () {
      var was = this._starting;
      originalClear.call(this);
      if (!was !== !this._starting) noteTransition(this, !!this._starting);
    };

    Game_Map.prototype.isAnyEventStarting = function () {
      if (api.enabled === false) {
        item.vanilla++;
        return originalStarting.call(this);
      }
      var events = this._events;
      if (!events) {                                  // vanilla's throw preserved
        item.vanilla++;
        return originalStarting.call(this);
      }
      var n = this._startingCount;
      if (n === undefined || this._startingEventsRef !== events ||
          this._startingCountLen !== events.length) {
        n = 0;
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          if (ev && ev.isStarting()) n++;
        }
        putHidden(this, '_startingCount', n);
        putHidden(this, '_startingEventsRef', events);
        putHidden(this, '_startingCountLen', events.length);
        item.rescan++;
        return n > 0;
      }
      item.fast++;
      return n > 0;
    };
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.event-state-cache', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires.
    window.addEventListener('load', install);
  }
})();
