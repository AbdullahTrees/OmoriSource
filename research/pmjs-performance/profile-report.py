"""Summarize standard V8 profiles, resolving bundled PMJS module line ranges.

Sample i uses timeDeltas[i]. Inclusive functions overlap: do not sum them.
The older OMORI top/tree scripts remain usable for navigation but shift deltas
by one sample; this report deliberately uses the profile's sample alignment.
"""
import json
from collections import defaultdict
from pathlib import Path
import sys
from urllib.parse import unquote

root = Path(sys.argv[1])
maps = {p.name.removesuffix('.json'): json.loads(p.read_text())
        for p in (root / 'module-maps').glob('*.json')}
if not maps:
    raise SystemExit('Missing bundled module maps: export evidence after the runs first')
reports = []
for run in (sys.argv[2:] or ['profile-off', 'profile-on']):
    variant = run.removeprefix('profile-')
    folder = root / 'results' / run
    phases = {r['phase']: r for r in map(json.loads, (folder / 'results.jsonl').read_text().splitlines())
              if r['type'] == 'phase'}
    for phase, row in phases.items():
        profile = json.loads((folder / (phase + '.cpuprofile')).read_text())
        nodes = {n['id']: n for n in profile['nodes']}
        parents = {child: n['id'] for n in nodes.values() for child in n.get('children', [])}

        def module(n):
            f = n['callFrame']
            file = unquote(f.get('url', '')).replace('\\', '/').split('/')[-1]
            line = f.get('lineNumber', -1) + 1
            for span in maps.get(file, []):
                if span['start'] <= line <= span['end']:
                    return span['label']
            return file or '(runtime/native)'

        def label(n):
            f = n['callFrame']
            return f"{f['functionName'] or '(anonymous)'} {module(n)}:{f.get('lineNumber', -1)+1}"

        node_modules = {key: module(n) for key, n in nodes.items()}
        node_labels = {key: label(n) for key, n in nodes.items()}
        own, inclusive, modules, parts = (defaultdict(float) for _ in range(4))
        total = 0
        excluded_inspector = 0
        for i, sample in enumerate(profile['samples']):
            ms = profile['timeDeltas'][i] / 1000
            n = nodes[sample]
            # Profiler.start itself contributes a large first delta before the
            # driver's measured window. Keep it in raw evidence, exclude its
            # inspector-only sample from game cost, and report the exclusion.
            if node_modules[sample] == 'node:inspector' and n['callFrame']['functionName'] == 'post':
                excluded_inspector += ms
                continue
            total += ms
            own[node_labels[sample]] += ms
            modules[node_modules[sample]] += ms
            seen, names, retained_names = set(), set(), set()
            while True:
                seen.add(node_labels[n['id']])
                names.add(n['callFrame']['functionName'])
                if 'scene-retained.js' in node_modules[n['id']]:
                    retained_names.add(n['callFrame']['functionName'])
                if n['id'] not in parents:
                    break
                n = nodes[parents[n['id']]]
            for name in seen:
                inclusive[name] += ms
            for name in ['encodeNativeScene', 'prepareTransforms', 'visit', 'captureSigWords',
                         'sigEqual', 'splice', 'capture', 'beginFrame', '(garbage collector)', '(idle)']:
                scoped_names = retained_names if name in ['visit', 'captureSigWords', 'sigEqual', 'splice', 'capture', 'beginFrame'] else names
                if name in scoped_names:
                    parts[name] += ms
        frames = row['frame']['frames']

        def ranked(values):
            return [{'name': k, 'ms': round(v, 3), 'msPerFrame': round(v / frames, 4)}
                    for k, v in sorted(values.items(), key=lambda item: -item[1])[:30]]

        reports.append({'variant': variant, 'phase': phase, 'frames': frames, 'sampleMs': total,
                        'excludedInspectorMs': excluded_inspector,
                        'partsMsPerFrame': {k: round(v / frames, 4) for k, v in parts.items()},
                        'selfModules': ranked(modules), 'selfFunctions': ranked(own),
                        'inclusiveFunctions': ranked(inclusive)})
out = root / 'analysis'
out.mkdir(exist_ok=True)
(out / 'profiles.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')
for r in reports:
    print(r['variant'], r['phase'], r['frames'], 'frames', r['partsMsPerFrame'])
