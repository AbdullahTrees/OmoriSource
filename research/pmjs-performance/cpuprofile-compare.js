// Compare V8 .cpuprofiles side by side: inclusive ms per rendered frame for a fixed list of OMORI
// frame parts (each sample counted once per part, even under recursion).
// node cpuprofile-compare.js <file.cpuprofile>:<frames> [...]
// <frames> is the number of frames rendered during the profile (fps x seconds).
'use strict';
const fs = require('fs');
const path = require('path');

// [label, test(callFrame)]. Matches on "functionName file:line" substrings.
const PARTS = [
  ['frame total (ticker)', 'Ticker._tick pixi.js'],
  ['game update (updateMain)', 'updateMain GTP_OmoriFixes.js'],
  ['  map logic (Game_Map.update)', 'Game_Map.update rpg_objects.js'],
  ['    events (Game_Event.update)', 'Game_Event.update rpg_objects.js'],
  ['    interpreter', 'Game_Interpreter.update rpg_objects.js'],
  ['    slippery tiles', 'Game_Map.isSlippery YEP_SlipperyTiles.js'],
  ['  player (Game_Player.update)', 'Game_Player.update rpg_objects.js'],
  ['  sprites (Spriteset_Map.update)', 'Spriteset_Map.update rpg_sprites.js'],
  ['    tilemap children (Tilemap.update)', 'Tilemap.update GTP_CoreUpdates.js'],
  ['    character sprites', 'Sprite_Character.update rpg_sprites.js'],
  ['    reflections (YED)', 'Sprite_CharacterReflect.update'],
  ['    child sort (_sortChildren)', 'Tilemap._sortChildren rpg_core.js'],
  ['    horror effects wrapper', 'Olivia.HorrorEffects.___Sprite_update___'],
  ['    weather/screen effects', 'Spriteset_Map.updateWeather'],
  ['  windows (WindowLayer.update)', 'WindowLayer.update GTP_CoreUpdates.js'],
  ['render (renderScene)', 'SceneManager.renderScene rpg_managers.js'],
  ['  YED retained tiles (prepare)', 'prepare bootstrap'],
  ['    full repaint (paint)', 'paint bootstrap'],
  ['  prepareTransforms', 'prepareTransforms '],
  ['  encodeNativeScene', 'encodeNativeScene '],
  ['  bitmap caches', 'prepareNativeBitmapCaches '],
  ['native GL submit/swap', 'dispose '],
  ['garbage collector', '(garbage collector) '],
  ['idle', '(idle) '],
];

function label(node) {
  const f = node.callFrame;
  return (f.functionName || '(anon)') + ' ' + path.basename(decodeURIComponent(f.url || 'native')) + ':' + (f.lineNumber + 1);
}

function analyse(file, frames) {
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const stacks = new Map();
  function stack(id) {
    if (stacks.has(id)) return stacks.get(id);
    const own = label(byId.get(id));
    const up = parent.has(id) ? stack(parent.get(id)) : [];
    const result = up.concat([own]);
    stacks.set(id, result);
    return result;
  }
  const totals = PARTS.map(() => 0);
  const deltas = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const ms = (deltas[i + 1] !== undefined ? deltas[i + 1] : deltas[i]) / 1000;
    const labels = stack(profile.samples[i]);
    PARTS.forEach(([, test], k) => { if (labels.some(l => l.includes(test))) totals[k] += ms; });
  }
  return totals.map(t => t / frames);
}

const runs = process.argv.slice(2).map(arg => {
  const i = arg.lastIndexOf(':');
  return { name: path.basename(arg.slice(0, i), '.cpuprofile'), ms: analyse(arg.slice(0, i), Number(arg.slice(i + 1))) };
});
console.log('ms per frame'.padEnd(40) + runs.map(r => r.name.padStart(10)).join(''));
PARTS.forEach(([name], k) => {
  console.log(name.padEnd(40) + runs.map(r => r.ms[k].toFixed(1).padStart(10)).join(''));
});
