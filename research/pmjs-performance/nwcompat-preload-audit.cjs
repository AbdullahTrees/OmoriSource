'use strict';

// Inspect configuration only; this does not boot the game or execute plugins.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../project/js/plugins.js'), 'utf8'), context);
const all = [];
for (const plugin of context.$plugins.filter(plugin => plugin.status &&
    ['YEP_EventCopier', 'YEP_EventMorpher', 'YEP_EventSpawner'].includes(plugin.name))) {
  const templates = JSON.parse(plugin.parameters.TemplateNames || '[]')
    .map(template => Number(JSON.parse(template).MapID));
  const preloads = vm.runInNewContext(plugin.parameters.TemplateMaps || '[]');
  const calls = [...templates, ...preloads].map(Number).map(id => Math.max(1, Math.min(999, id)));
  all.push(...calls);
  const counts = new Map();
  calls.forEach(id => counts.set(id, (counts.get(id) || 0)+1));
  console.log(JSON.stringify({ plugin: plugin.name, templates: templates.length,
    preloads: preloads.length, calls: calls.length, unique: counts.size,
    duplicateCalls: calls.length-counts.size,
    mostRepeated: [...counts].sort((a, b) => b[1]-a[1]).slice(0, 5) }));
}
console.log(JSON.stringify({ totalCalls: all.length, unique: new Set(all).size,
  duplicateCalls: all.length-new Set(all).size }));
