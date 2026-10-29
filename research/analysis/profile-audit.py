"""Reproduce the roadmap timing audit; no device or game execution required."""
import json
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('evidence', type=Path, help='Saved-state evidence folder containing the raw profiles')
parser.add_argument('--out', type=Path, required=True, help='Output JSON path')
args = parser.parse_args()
base = args.evidence
inputs = [
    ('20261028-032929-load/base-profiles/save1-92-21-11.cpuprofile', 182),
    ('20261028-033242-load/base-profiles/new-92-21-11.cpuprofile', 403),
]
result = []
for file, frames in inputs:
    profile = json.loads((base / file).read_text())
    nodes = {node['id']: node for node in profile['nodes']}
    parent = {child: node['id'] for node in nodes.values() for child in node.get('children', [])}
    inclusive, own = {}, {}
    for index, (sample, delta) in enumerate(zip(profile['samples'], profile['timeDeltas'])):
        if index == 0:
            continue  # Inspector start gap, reported separately; not a gameplay frame.
        own[sample] = own.get(sample, 0) + delta
        seen = set()
        while sample in nodes:
            name = nodes[sample]['callFrame']['functionName']
            if name not in seen:
                inclusive[name] = inclusive.get(name, 0) + delta
                seen.add(name)
            sample = parent.get(sample)
    names = ['renderScene', 'submitNativeScene', 'encodeNativeScene',
             'writeNativeSceneNode', 'prepareTransforms', 'disposeNativeCustomFilterPlans', 'updateMain']
    native = []
    for node_id, delta in sorted(own.items(), key=lambda pair: -pair[1]):
        if nodes[node_id]['callFrame']['functionName'] != 'dispose' or delta < 10000:
            continue
        caller = nodes[parent[node_id]]['callFrame']
        native.append({'selfMsPerFrame': round(delta / 1000 / frames, 3), 'caller': caller})
    result.append({'profile': file, 'framesFromHarness': frames,
                   'excludedFirstDeltaMs': profile['timeDeltas'][0] / 1000,
                   'inclusiveMsPerFrame': {name: round(inclusive.get(name, 0) / 1000 / frames, 3) for name in names},
                   'nativeCallbacksNamedDispose': native})

out = args.out
out.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
for row in result:
    print(row['profile'], row['inclusiveMsPerFrame'])
