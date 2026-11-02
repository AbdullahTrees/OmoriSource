#!/usr/bin/env node
// Compact battle results from an omori-test log.
//
// Accepts both formats:
//   device install log:  2026-11-02T02:34:38Z INFO [omori-test] {"battle":...}
//   wrapper stdout:      {"battle":...}
//
// Logs accumulate across sessions, so a test directory's base.log can hold
// earlier runs too. Filter by timestamp or use --last.
//
// Usage:
//   node battle-summary.cjs <log> [--last N] [--json]

'use strict';

const fs = require('fs');

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('--'));
if (!file) {
  console.error('usage: node battle-summary.cjs <log> [--last N] [--json]');
  process.exit(2);
}
const lastIndex = args.indexOf('--last');
const last = lastIndex >= 0 ? Number(args[lastIndex + 1]) : 0;
const json = args.includes('--json');

function extract(line) {
  let match = line.match(/^(\S+) .*\[omori-test\] (\{"battle":.*)$/);
  if (match) return { time: match[1], payload: match[2] };
  match = line.match(/^(\{"battle":.*)$/);
  if (match) return { time: '', payload: match[1] };
  return null;
}

function window(battle, name) {
  const entry = battle[name] || {};
  const measure = entry.measure || {};
  const native = measure.native || {};
  const nativeMax = measure.nativeMax || {};
  return {
    fps: measure.fps,
    ft: measure.ft,
    drawMs: native.drawMs,
    drawMaxMs: nativeMax.drawMs,
    uploadMs: native.uploadMs,
    stepsPerFrame: measure.stepsPerFrame,
    breakdown: measure.breakdown || null,
    profile: measure.profile || null,
    nativeStats: measure.nativeStats || null,
    started: entry.started,
    returned: entry.returned,
    actions: entry.actions
  };
}

const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const parsed = extract(line);
  if (!parsed) continue;
  let battle;
  try {
    battle = JSON.parse(parsed.payload).battle;
  } catch (error) {
    continue;
  }
  rows.push({
    time: parsed.time,
    name: battle.name,
    troop: battle.troop,
    idle: window(battle, 'idle'),
    turns: window(battle, 'turns')
  });
}

const selected = last > 0 ? rows.slice(-last) : rows;
if (json) {
  console.log(JSON.stringify(selected));
} else {
  for (const row of selected) {
    const part = entry => entry.fps + ' fps ft=' + (entry.ft || []).join('/') +
      ' draw=' + entry.drawMs + 'ms' + (entry.breakdown ? ' breakdown=yes' : '');
    console.log(row.time + '  ' + row.name +
      '  idle=' + part(row.idle) +
      '  turns=' + part(row.turns));
  }
}
