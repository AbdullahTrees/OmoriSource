#!/usr/bin/env node
// Compact memory samples from an omori-test log.
//
// The battle driver logs {"mem":{point,...}} lines the moment each sample is
// taken, so a watchdog kill does not erase them. Accepts both log formats:
//   2026-11-02T03:38:58Z INFO [omori-test] {"mem":...}
//   {"mem":...}
//
// Usage: node mem-summary.cjs <log>

'use strict';

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node mem-summary.cjs <log>');
  process.exit(2);
}

const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  let match = line.match(/^(\S+) .*\[omori-test\] (\{"mem":.*)$/);
  if (!match) match = line.match(/^(\{"mem":.*)$/);
  if (!match) continue;
  let payload;
  try {
    payload = JSON.parse(match[2] !== undefined ? match[2] : match[1]);
  } catch (error) {
    continue;
  }
  const sample = payload.mem || {};
  const images = sample.images || {};
  const cache = payload.cache || {};
  rows.push({
    point: payload.point || '',
    battle: payload.battle || '',
    rssMB: sample.rssMB,
    heapMB: sample.heapMB,
    liveImages: images.liveCount,
    gpuBytes: images.gpuBytes,
    cpuBytes: images.cpuBytes,
    cacheEntries: cache.entries,
    cacheMp: cache.megapixels,
    reserved: cache.reserved,
    notReady: cache.notReady
  });
}

console.log(JSON.stringify(rows));
