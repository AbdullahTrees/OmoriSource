// Runtime performance patch: event-logic fast paths (task I2). Game files stay byte-identical.
//
// PMJS loads it with `--patch launcher/perf/logic-fastpaths.js`; NW.js would load it through
// launcher/compat.js. Each item can be disabled with OMORI_PERF_DISABLE=<item>[,<item>] and each
// exposes counters on `root.OmoriPerf.<item>` (`fast` = calls served by the fast path, `vanilla` =
// calls routed to the original function). Every replaced method is pinned to the SHA-256 of
// Function.prototype.toString of the method as composed after all plugins load (LF-normalized;
// recorded below). If any pin does not match, that item installs nothing and logs
// `[omori-perf] <item> refused: <method>`.
//
// Why each fast path is behaviour-identical (full audit in omori-handover/agents/reports/i2-logic-fastpaths.md):
//
//   slipperyCache — YEP_SlipperyTiles.js:132 `Game_Map.isSlippery(mx, my)` is a pure function of
//     $gameParty.inBattle() (dynamic: checked live on every call, before the cache, as the original
//     does), map id, width/height (YED_Tiled derives them only from the Tiled map data object and
//     the static "Half-tile movement" plugin parameter), the tileset object
//     (`$dataTilesets[_tilesetId]`: its `slippery` list is parsed once at database load and nothing
//     in project/js writes `.slippery`, `.flags` or `_tilesetId` outside `changeTileset`, which the
//     tileset key covers), `_regions[currentMapLevel]` (the `_regions` root array is rebuilt on
//     every Game_Map setup and its per-level cell values are written only during setup: YED 1208,
//     1254, 1594-1643; `currentMapLevel` is a live getter that may read a game variable, so it is
//     read on every call), `$dataMap` (terrainTag reads only `$dataMap.width/height/data`,
//     constants per map load; the array identity is in the key), and Yanfly.Param.SlipRegion
//     (watched live per call). The cache stores one byte per cell (0 unknown, 1 true, 2 false);
//     unknown cells and every key change fall through to the original function, so the first
//     answer for a cell is exactly vanilla's. Non-integer coordinates fall through too (vanilla
//     would index fractional cells). Out-of-bounds answers come from the cached width/height,
//     which the pinned width/height/isValid guarantee equal vanilla's isValid inputs. A call that
//     rebuilds the key answers its own cell through the original, so nothing is invented.
//
//   autorunCandidates — rpg_objects.js:6211 `setupAutorunCommonEvent` scans all 2001
//     `$dataCommonEvents` entries for `trigger === 1`, then checks `$gameSwitches.value` (17 such
//     entries in OMORI's database). A cached ascending list of the trigger-1 indexes preserves
//     iteration order, so the same event wins and the same `$gameSwitches.value` calls happen in
//     the same order (vanilla only ever calls it for trigger-1 entries, which the subsequence
//     respects). The trigger check and the switch check stay live per call. The list rebuilds when
//     the `$dataCommonEvents` reference or length changes (DataManager replaces the array
//     wholesale on new game / save load); nothing in project/js writes a common event's `trigger`
//     at runtime (grep: no `.trigger =` writers).
//
//   saveLocationAlloc — YEP_SaveEventLocations.js:153 `Game_System.saveEventLocation` stored
//     `this._savedEventLocations[[mapId, eventId]] = [x, y, dir]`: two fresh arrays per moving
//     event per step plus array-to-string for the property key. An array used as a property key is
//     its `.toString()`, exactly `String(mapId) + ',' + String(eventId)`; the patch computes that
//     string directly, so entries store under identical keys. Reusing the existing 3-element
//     array (writing [0..2]) is invisible: the only readers (`getSavedEventX/Y/Dir`,
//     `isSavedEventLocation`, JsonEx save/load) read by index or serialize the same content, and
//     nothing in project/js keeps a reference to a stored array. The read order of event fields
//     (eventId, x, y, direction) is unchanged, so odd events throw at the same point as vanilla.
//
//   eventsStartingNoAlloc — rpg_objects.js:6222 `isAnyEventStarting` is
//     `this.events().some(e => e.isStarting())`: `events()` is exactly `_events` without holes, in
//     index order, and `.some` short-circuits at the first truthy `isStarting()`. A `for` loop over
//     `this._events` skipping holes reproduces the same call sequence over the same objects and the
//     same first-true answer, without the 102-element filter array per call. `events()` itself is
//     NOT replaced (GTP_OmoriFixes and others rely on getting a fresh array they may retain).
//
// Pins (sha256 over the LF-normalized Function.prototype.toString source; the project's js files
// are LF, so this equals both the raw and CRLF-normalized digest). Dependency methods that the
// equivalence argument leans on are pinned even though the patch does not replace them:
//
//   isSlippery               (YEP_SlipperyTiles.js:132)        425386319071765fdcb4f7874c65eb031dbe13f651098a84b1e1ff633505ccbe
//   regionId                 (YED_Tiled.js:2046)               7c2e048eb034b94157ac4be179311d604d867ff30bb2d9dc6a81a797ff69af6a
//   width                    (YED_Tiled.js:2029)               534c56c5ec894a95f7b3f04087821e890f7ce5942c767b710ccbeffbf5e881b0
//   height                   (YED_Tiled.js:2037)               e73277cb4abb04863468ebe53d5a74c11abee87eb73f1c69141807c0be572955
//   tiledData.get            (YED_Tiled.js module 76)          e687609b1430802d1ccfad336b7fdfb9c13a5a0747799b335420b2b4b4534beb
//   currentMapLevel.get      (YED_Tiled.js module 76)          cd9c0d777cfc22b9405f01ae0b87db05fc8bc5d215aa81e858f0cba04439ef27
//   setupAutorunCommonEvent  (rpg_objects.js:6211)             a8a74a9b784ae7ec9e5e6e68d0e005aed7292a1c6228590052921b7bbd4ad56c
//   isAnyEventStarting       (rpg_objects.js:6222)            aa5b3505b08fcf37ac87cef06c2661e1ecf4e907892d4bbb87807ebe365ce70b
//   events                   (rpg_objects.js:5596)             506f1ee64fd3bfb33a91e517d0dd955534d0979c8e7696d4cfcb7f3c3b694994
//   isValid                  (rpg_objects.js:5944)             2cf19d9703caeaed1463afffd690e44303a523a2d8b3494c9c00ac657ace1f9b
//   terrainTag               (rpg_objects.js:6028)             c486790fa3a2b6c29178f7ba022359887fbb889cc1e5c0288e57cde42241ea57
//   tileset                  (rpg_objects.js:5682)             83062238a79ce3b5ac490dfcb6b5987ea9875872fbd19b91c48ef5adb0ac111b
//   saveEventLocation        (YEP_SaveEventLocations.js:153)   766aa7868ecb6cc15a351f573b0f06b51d3fced7bcb6e4f69e8c7f8b946426e8
//   saveLocation(Game_Event) (YEP_SaveEventLocations.js:223)   a82360442864409b0884d00b99257a14a52b40ca72ca96f5fd45d4ba9557ad59

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

  var perf = root.OmoriPerf = {
    installed: false,       // this patch is active
    enabled: true,          // set false at runtime to compare against vanilla in one session
    slipperyCache: { installed: false, refused: null, fast: 0, vanilla: 0 },
    autorunCandidates: { installed: false, refused: null, fast: 0, vanilla: 0 },
    saveLocationAlloc: { installed: false, refused: null, fast: 0, vanilla: 0 },
    eventsStartingNoAlloc: { installed: false, refused: null, fast: 0, vanilla: 0 }
  };
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
  // pins: array of { name, fn, digests }. An empty digests list accepts any source (test fakes).
  function checkPins(item, pins) {
    for (var i = 0; i < pins.length; i++) {
      if (pins[i].digests.length && pins[i].digests.indexOf(digest(pins[i].fn)) < 0) {
        perf[item].refused = pins[i].name;
        console.log('[omori-perf] ' + item + ' refused: ' + pins[i].name +
          ' digest ' + (digest(pins[i].fn) || '(missing)'));
        return false;
      }
    }
    return true;
  }

  function install() {
    if (perf.installed) return;
    if (typeof root.Game_Map !== 'function' || typeof root.$gameSwitches === 'undefined' ||
        typeof root.$gameParty === 'undefined' || typeof root.$dataTilesets === 'undefined') return;
    perf.installed = true;

    var Game_Map = root.Game_Map, Game_System = root.Game_System;

    // ---- slipperyCache: Game_Map.isSlippery, YEP_SlipperyTiles.js:132 (region mode) --------
    if (!disabled.slipperyCache) {
      var slipPins = checkPins('slipperyCache', [
        { name: 'isSlippery', fn: Game_Map.prototype.isSlippery,
          digests: ['425386319071765fdcb4f7874c65eb031dbe13f651098a84b1e1ff633505ccbe'] },
        { name: 'regionId', fn: Game_Map.prototype.regionId,
          digests: ['7c2e048eb034b94157ac4be179311d604d867ff30bb2d9dc6a81a797ff69af6a'] },
        { name: 'width', fn: Game_Map.prototype.width,
          digests: ['534c56c5ec894a95f7b3f04087821e890f7ce5942c767b710ccbeffbf5e881b0'] },
        { name: 'height', fn: Game_Map.prototype.height,
          digests: ['e73277cb4abb04863468ebe53d5a74c11abee87eb73f1c69141807c0be572955'] },
        { name: 'isValid', fn: Game_Map.prototype.isValid,
          digests: ['2cf19d9703caeaed1463afffd690e44303a523a2d8b3494c9c00ac657ace1f9b'] },
        { name: 'terrainTag', fn: Game_Map.prototype.terrainTag,
          digests: ['c486790fa3a2b6c29178f7ba022359887fbb889cc1e5c0288e57cde42241ea57'] },
        { name: 'tileset', fn: Game_Map.prototype.tileset,
          digests: ['83062238a79ce3b5ac490dfcb6b5987ea9875872fbd19b91c48ef5adb0ac111b'] }
      ]);
      if (slipPins) {
        var c = { ok: false, mapId: 0, level: 0, tiles: null, tiled: null, dm: null,
          regions: null, region: -1, w: 0, h: 0, bits: null };
        var originalSlippery = Game_Map.prototype.isSlippery;
        perf.slipperyCache.installed = true;
        // YED's module that defines these getters is not loaded at afterPlugins on classic
        // maps, so they are absent here. Verify them lazily, when the cache rebuilds its key
        // (map/tileset/level change); if they never appear, the cache reads the same backing
        // values the reviewed getters would return. A getter that appears with another source
        // refuses the cache and keeps vanilla.
        var optionalGetters = [
          { name: 'tiledData', fn: null,
            digests: ['e687609b1430802d1ccfad336b7fdfb9c13a5a0747799b335420b2b4b4534beb'] },
          { name: 'currentMapLevel', fn: null,
            digests: ['cd9c0d777cfc22b9405f01ae0b87db05fc8bc5d215aa81e858f0cba04439ef27'] }
        ];
        function optionalGettersOk() {
          for (var g = 0; g < optionalGetters.length; g++) {
            var pin = optionalGetters[g];
            var descriptor = Object.getOwnPropertyDescriptor(Game_Map.prototype, pin.name);
            var getter = descriptor && descriptor.get;
            if (!getter) continue;
            if (pin.fn !== getter) {
              pin.fn = getter;
              if (pin.digests.indexOf(digest(getter)) < 0) {
                perf.slipperyCache.refused = pin.name + '.get';
                console.log('[omori-perf] slipperyCache refused: ' + pin.name + '.get source');
                return false;
              }
            }
          }
          return true;
        }
        Game_Map.prototype.isSlippery = function (mx, my) {
          if (!perf.enabled) {
            perf.slipperyCache.vanilla++;
            return originalSlippery.call(this, mx, my);
          }
          if ($gameParty.inBattle()) {
            perf.slipperyCache.fast++;
            return false;                                 // dynamic part, checked exactly like vanilla
          }
          if ((mx % 1) !== 0 || (my % 1) !== 0) {         // fractional cells: vanilla indexes them oddly
            perf.slipperyCache.vanilla++;
            return originalSlippery.call(this, mx, my);
          }
          var tiled = DataManager._tempTiledData;         // pinned getter returns exactly this
          var level = this.currentMapLevel;               // live getter: may read a game variable
          var tiles = $dataTilesets[this._tilesetId];     // === this.tileset() (pinned)
          var dm = $dataMap;
          var region = Yanfly.Param.SlipRegion;           // watched live
          if (!c.ok || c.mapId !== this._mapId || c.level !== level || c.tiles !== tiles ||
              c.tiled !== tiled || c.dm !== dm || c.regions !== this._regions ||
              c.region !== region) {
            if (!optionalGettersOk()) {
              perf.slipperyCache.vanilla++;
              return originalSlippery.call(this, mx, my);
            }
            c.ok = true;
            c.mapId = this._mapId; c.level = level; c.tiles = tiles; c.tiled = tiled;
            c.dm = dm; c.regions = this._regions; c.region = region;
            c.w = this.width(); c.h = this.height();      // pinned width/height
            c.bits = (c.w === (c.w | 0) && c.h === (c.h | 0))
              ? new Uint8Array(c.w * c.h) : null;         // 0 unknown, 1 true, 2 false
          }
          var bits = c.bits;
          if (!bits) {                                    // unsized map: nothing to cache
            perf.slipperyCache.vanilla++;
            return originalSlippery.call(this, mx, my);
          }
          if (mx < 0 || mx >= c.w || my < 0 || my >= c.h) {  // vanilla isValid false
            perf.slipperyCache.fast++;
            return false;
          }
          var i = my * c.w + mx;
          var v = bits[i];
          if (v) { perf.slipperyCache.fast++; return v === 1; }
          var r = originalSlippery.call(this, mx, my);    // first visit: exactly vanilla's answer
          bits[i] = r ? 1 : 2;
          perf.slipperyCache.vanilla++;
          return r;
        };
      }
    }

    // ---- autorunCandidates: Game_Map.setupAutorunCommonEvent, rpg_objects.js:6211 ----------
    if (!disabled.autorunCandidates) {
      if (checkPins('autorunCandidates', [
        { name: 'setupAutorunCommonEvent', fn: Game_Map.prototype.setupAutorunCommonEvent,
          digests: ['a8a74a9b784ae7ec9e5e6e68d0e005aed7292a1c6228590052921b7bbd4ad56c'] }
      ])) {
        var a = { ce: null, len: -1, idx: null };
        var originalAutorun = Game_Map.prototype.setupAutorunCommonEvent;
        perf.autorunCandidates.installed = true;
        Game_Map.prototype.setupAutorunCommonEvent = function () {
          if (!perf.enabled) { perf.autorunCandidates.vanilla++; return originalAutorun.call(this); }
          var ce = $dataCommonEvents;
          if (!ce) {                                      // undefined database: vanilla's throw preserved
            perf.autorunCandidates.vanilla++;
            return originalAutorun.call(this);
          }
          if (a.ce !== ce || a.len !== ce.length) {       // rebuild on a new/replaced database
            a.ce = ce; a.len = ce.length;
            var idx = [];
            for (var i = 0; i < ce.length; i++) {
              if (ce[i] && ce[i].trigger === 1) idx.push(i);
            }
            a.idx = idx;
          }
          var list = a.idx;
          var found = null;
          for (var j = 0; j < list.length; j++) {
            var event = ce[list[j]];
            if (event && event.trigger === 1 && $gameSwitches.value(event.switchId)) {
              found = event;
              break;
            }
          }
          if (found) this._interpreter.setup(found.list);
          perf.autorunCandidates.fast++;
          return !!found;
        };
      }
    }

    // ---- saveLocationAlloc: Game_System.saveEventLocation, YEP_SaveEventLocations.js:153 ---
    if (!disabled.saveLocationAlloc) {
      if (typeof Game_System === 'function') {
        if (checkPins('saveLocationAlloc', [
          { name: 'saveEventLocation', fn: Game_System.prototype.saveEventLocation,
            digests: ['766aa7868ecb6cc15a351f573b0f06b51d3fced7bcb6e4f69e8c7f8b946426e8'] },
          { name: 'Game_Event.saveLocation', fn: root.Game_Event && root.Game_Event.prototype.saveLocation,
            digests: ['a82360442864409b0884d00b99257a14a52b40ca72ca96f5fd45d4ba9557ad59'] }
        ])) {
          var originalSave = Game_System.prototype.saveEventLocation;
          perf.saveLocationAlloc.installed = true;
          Game_System.prototype.saveEventLocation = function (mapId, event) {
            if (!perf.enabled) {
              perf.saveLocationAlloc.vanilla++;
              return originalSave.call(this, mapId, event);
            }
            perf.saveLocationAlloc.fast++;
            if (this._savedEventLocations === undefined) this.initSavedEventLocations();
            var eventId = event.eventId();
            var eventX = event.x;
            var eventY = event.y;
            var eventDir = event.direction();
            var key = mapId + ',' + eventId;              // === [[mapId, eventId]].toString()
            var loc = this._savedEventLocations[key];
            if (loc) { loc[0] = eventX; loc[1] = eventY; loc[2] = eventDir; }
            else this._savedEventLocations[key] = [eventX, eventY, eventDir];
          };
        }
      }
    }

    // ---- eventsStartingNoAlloc: Game_Map.isAnyEventStarting, rpg_objects.js:6222 -----------
    if (!disabled.eventsStartingNoAlloc) {
      if (checkPins('eventsStartingNoAlloc', [
        { name: 'isAnyEventStarting', fn: Game_Map.prototype.isAnyEventStarting,
          digests: ['aa5b3505b08fcf37ac87cef06c2661e1ecf4e907892d4bbb87807ebe365ce70b'] },
        { name: 'events', fn: Game_Map.prototype.events,
          digests: ['506f1ee64fd3bfb33a91e517d0dd955534d0979c8e7696d4cfcb7f3c3b694994'] }
      ])) {
        var originalStarting = Game_Map.prototype.isAnyEventStarting;
        perf.eventsStartingNoAlloc.installed = true;
        Game_Map.prototype.isAnyEventStarting = function () {
          if (!perf.enabled) {
            perf.eventsStartingNoAlloc.vanilla++;
            return originalStarting.call(this);
          }
          var events = this._events;
          if (!events) {                                  // vanilla's throw preserved
            perf.eventsStartingNoAlloc.vanilla++;
            return originalStarting.call(this);
          }
          for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (ev && ev.isStarting()) {
              perf.eventsStartingNoAlloc.fast++;
              return true;
            }
          }
          perf.eventsStartingNoAlloc.fast++;
          return false;
        };
      }
    }
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.logicFastpaths', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires.
    window.addEventListener('load', install);
  }
})();
