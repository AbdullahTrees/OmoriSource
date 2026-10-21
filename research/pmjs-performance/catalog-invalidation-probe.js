// Test-only provenance for native preparation flags. Flags are requeued for the runner.
(function() {
  'use strict';
  var assets = NativeHost.assets, consume = assets.consumePreparationInvalidations;
  if (typeof consume !== 'function') { console.log('[catalog-probe] unavailable'); return; }
  var queued = 0;
  function sample(operation, args) {
    var flags = consume.call(assets);
    if (!flags) return;
    queued |= flags;
    var map = typeof $gameMap !== 'undefined' && $gameMap && $gameMap.mapId();
    var entry = assets.preparedMapIndex && assets.preparedMapIndex[map];
    var source = typeof args[0] === 'string' ? args[0] : '';
    var record = { operation: operation, flags: flags, map: map, source: source,
      tileSet: typeof args[2] === 'string' ? args[2] : typeof args[1] === 'string' ? args[1] : '',
      expected: entry && { identity: entry.identity, sources: entry.sources } };
    if (source && !source.startsWith('generated-assets:')) {
      try { record.sourcePath = assets.sourcePath(source); record.sourceIdentity = assets.sourceIdentity(source); }
      catch (error) { record.sourceError = String(error.message || error); }
    }
    console.log('[catalog-probe] '+JSON.stringify(record));
  }
  assets.consumePreparationInvalidations = function() {
    var flags = queued | consume.call(assets);
    queued = 0;
    if (flags) console.log('[catalog-probe-flush] '+flags);
    return flags;
  };
  function wrap(owner, method) {
    var original = owner && owner[method];
    if (typeof original !== 'function') return;
    owner[method] = function() {
      sample(method+':before', arguments);
      try { return original.apply(this, arguments); }
      finally { sample(method+':after', arguments); }
    };
  }
  wrap(NativeHost.images, 'acquireCached');
  wrap(NativeHost.images, 'loadAsync');
  wrap(assets, 'loadImageAsync');
  console.log('[catalog-probe] installed');
})();
