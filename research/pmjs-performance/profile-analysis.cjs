'use strict';

// Read-only V8 profile audit. The first sample gap is reported separately because
// profiler activation can precede the first captured stack by over a second.
const fs = require('node:fs');
function analyze(file) {
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (profile.samples.length !== profile.timeDeltas.length) throw new Error('profile sample/delta mismatch');
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of nodes.values()) for (const child of node.children || []) parents.set(child, node.id);
  const label = node => (node.callFrame.functionName || '(anonymous)')+' '+
    decodeURI(node.callFrame.url || '(native)').split('/').slice(-2).join('/')+':'+(node.callFrame.lineNumber+1);
  const self = new Map(), inclusive = new Map();
  const selfByFile = new Map(), inclusiveByFile = new Map();
  const fileOf = node => decodeURI(node.callFrame.url || '').split('/').slice(-2).join('/') || '(native)';
  const buckets = { gameUpdate: 0, sceneEncoding: 0, nativeRenderSwap: 0, gc: 0, other: 0 };
  const targetNames = ['updateScene', 'Game_Map.update', 'Game_Map.updateEvents',
    'Game_Event.update', 'Game_Event.updateParallel', 'Game_Interpreter.update',
    'Sprite_Character.update', 'Sprite_Base.update', 'Sprite.update',
    'Game_Map.isSlippery', 'Game_CharacterBase.onSlipperyFloor',
    'Game_CharacterBase.slipperyPose', 'Game_Map.terrainTag', 'Game_Map.regionId',
    'prepareTransforms', 'writeNativeSceneNode', 'hideOnLevel', '_sortChildren', 'weatherUpdateUnion'];
  const targets = new Map(targetNames.map(name => [name, 0]));
  let total = 0;
  for (let index = 1; index < profile.samples.length; ++index) {
    const ms = profile.timeDeltas[index]/1000;
    total += ms;
    const leaf = nodes.get(profile.samples[index]), stack = [];
    for (let node = leaf; node; node = nodes.get(parents.get(node.id))) stack.push(node);
    const labels = new Set(stack.map(label));
    self.set(label(leaf), (self.get(label(leaf)) || 0)+ms);
    for (const key of labels) inclusive.set(key, (inclusive.get(key) || 0)+ms);
    const leafFile = fileOf(leaf);
    selfByFile.set(leafFile, (selfByFile.get(leafFile) || 0)+ms);
    for (const file of new Set(stack.map(fileOf))) {
      inclusiveByFile.set(file, (inclusiveByFile.get(file) || 0)+ms);
    }
    for (const name of targetNames) {
      const matches = name === 'weatherUpdateUnion'
        ? stack.some(node => /weather|rain/i.test(node.callFrame.functionName))
        : stack.some(node => node.callFrame.functionName === name);
      if (matches) targets.set(name, targets.get(name)+ms);
    }
    let bucket = 'other';
    if (leaf.callFrame.functionName === '(garbage collector)') bucket = 'gc';
    else if (stack.some(node => ['renderNativeStage', 'renderNativeMvStage'].includes(node.callFrame.functionName))) bucket = 'sceneEncoding';
    else if (stack.some(node => node.callFrame.functionName === 'updateMain' && node.callFrame.url.endsWith('/GTP_OmoriFixes.js'))) bucket = 'gameUpdate';
    else if (leaf.callFrame.functionName === 'dispose' && !leaf.callFrame.url) bucket = 'nativeRenderSwap';
    buckets[bucket] += ms;
  }
  const rows = (map, count) => [...map].sort((a,b) => b[1]-a[1]).slice(0,count)
    .map(([name, ms]) => ({ name, ms: +ms.toFixed(2), percent: +(ms*100/total).toFixed(2) }));
  return { file, samples: profile.samples.length, profileWallMs: (profile.endTime-profile.startTime)/1000,
    firstSampleGapMs: profile.timeDeltas[0]/1000, firstSample: label(nodes.get(profile.samples[0])),
    analyzedMs: +total.toFixed(2), buckets: rows(new Map(Object.entries(buckets)), 5),
    topSelf: rows(self, 35), topInclusive: rows(inclusive, 35), targets: rows(targets, targetNames.length),
    selfByFile: rows(selfByFile, 40), inclusiveByFile: rows(inclusiveByFile, 40) };
}
if (require.main === module) for (const file of process.argv.slice(2)) console.log(JSON.stringify(analyze(file), null, 2));
module.exports = { analyze };
