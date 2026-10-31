"""Analyze accepted runs, preserving per-run variation and overlapping phase semantics."""
import argparse
from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path
import statistics

parser = argparse.ArgumentParser()
parser.add_argument('root', type=Path, help='exported benchmark directory containing results/')
args = parser.parse_args()
output = args.root / 'analysis'
output.mkdir(exist_ok=True)


def lines(file):
    if not file.exists():
        return []
    return [json.loads(line) for line in file.read_text(encoding='utf-8').splitlines() if line.strip()]


rows = []
legacy = []
for label in ['normal-control', 'a1', 'b1', 'b2', 'a2', 'verify', 'profile-off', 'profile-on']:
    folder = args.root / 'results' / label
    if not folder.exists():
        continue
    log = (folder / 'session.log').read_text(encoding='utf-8')
    data = lines(folder / 'results.jsonl')
    valid = (folder / 'exit.txt').read_text().strip() == '0' and any(r['type'] == 'complete' for r in data)
    valid = valid and not any(' ERROR ' in line or 'event error:' in line or ' FAILED' in line for line in log.splitlines())
    if not valid:
        raise SystemExit(f'Refusing invalid run: {label}')
    if len([r for r in data if r['type'] == 'phase']) != 4:
        raise SystemExit(f'Incomplete scene coverage: {label}')
    timings = lines(folder / 'frame-stats.jsonl')
    for phase in [r for r in data if r['type'] == 'phase']:
        windows = []
        for window in timings:
            end = datetime.fromisoformat(window['time'].replace('Z', '+00:00')).timestamp() * 1000
            if end - window['elapsedMs'] >= phase['startTime'] and end <= phase['time']:
                windows.append(window)
        measured = sum(window['frames'] for window in windows)
        means = {}
        if measured:
            for name in ['tick', 'render', 'prepare', 'encode', 'submit', 'renderFrame', 'swap']:
                means[name] = sum(window['frames'] * window['phases'][name]['mean'] for window in windows) / measured
        stats = phase['retained'] or {}
        records = stats.get('encodedRecords', 0) + stats.get('splicedRecords', 0)
        passes = stats.get('worldStatePasses', 0) + stats.get('localStatePasses', 0)
        row = {'run': label, 'phase': phase['phase'], 'frame': phase['frame'], 'logicHz': phase['logicHz'],
               'phaseMeansMs': means, 'timingFrames': measured, 'retained': stats,
               'spliceFraction': stats.get('splicedRecords', 0) / records if records else None,
               'localFraction': stats.get('localStatePasses', 0) / passes if passes else None,
               'positions': phase['positions'], 'hardware': phase.get('hardware'),
               'mapTransforms': phase.get('mapTransforms')}
        if not phase['sourceQualification']['verified'] or not phase['sourceQualification']['dormontDataVerified']:
            raise SystemExit(f'Unqualified source: {label}')
        if label in ['a1', 'a2', 'b1', 'b2']:
            if row['localFraction'] != (1 if phase['phase'] in ['standing', 'walking'] else 0):
                raise SystemExit(f'Unexpected encoder mode: {label}/{phase["phase"]}')
        if row['phase'] == 'walking' and row['positions']['minX'] == row['positions']['maxX']:
            raise SystemExit(f'Walking did not move: {label}')
        rows.append(row)
        frame = phase['frame']
        legacy.append({'t': phase['time']/1000, 'scene': phase['scene'], 'map': phase['map'],
                       'name': 'DORMONT' if phase['scene'] == 'Scene_Map' else phase['scene'],
                       'sub': phase['phase'], 'secs': frame['frames']/frame['fps'], 'frames': frame['frames'],
                       'fps': frame['fps'], 'logic': phase['logicHz'], 'p50': frame['p50'], 'p95': frame['p95'],
                       'max': frame['max'], 'hitch': frame['hitches100ms'], 'run': label})

comparisons = []
table = ['| Scene | Off FPS (A1 / A2) | On FPS (B1 / B2) | Encode off / on, ms | Encode change | On splice % |',
         '|---|---:|---:|---:|---:|---:|']
for phase in ['standing', 'walking', 'menu', 'battle']:
    off = [r for r in rows if r['phase'] == phase and r['run'] in ['a1', 'a2']]
    on = [r for r in rows if r['phase'] == phase and r['run'] in ['b1', 'b2']]
    if len(off) != 2 or len(on) != 2:
        continue
    encode_off = statistics.mean(r['phaseMeansMs']['encode'] for r in off)
    encode_on = statistics.mean(r['phaseMeansMs']['encode'] for r in on)
    delta = (encode_on/encode_off-1)*100
    splice = statistics.mean(r['spliceFraction'] or 0 for r in on)*100
    comparisons.append({'phase': phase, 'encodeOffMs': encode_off, 'encodeOnMs': encode_on,
                        'encodeChangePercent': delta, 'splicePercent': splice,
                        'fpsOff': [r['frame']['fps'] for r in off], 'fpsOn': [r['frame']['fps'] for r in on]})
    table.append(f"| {phase} | {off[0]['frame']['fps']:.1f} / {off[1]['frame']['fps']:.1f} | "
                 f"{on[0]['frame']['fps']:.1f} / {on[1]['frame']['fps']:.1f} | "
                 f'{encode_off:.3f} / {encode_on:.3f} | {delta:+.1f}% | {splice:.3f}% |')

(output / 'runs.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
(output / 'comparison.json').write_text(json.dumps(comparisons, indent=2), encoding='utf-8')
(output / 'comparison.md').write_text('\n'.join(table)+'\n\nEncoder means use complete interior frame-stat windows. '
    'Tick, prepare and encode overlap and must not be added. Profiles and verify runs are excluded from A/B results.\n', encoding='utf-8')
(output / 'fps-compatible.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in legacy), encoding='utf-8')
for name, labels in [('off', ['a1', 'a2']), ('on', ['b1', 'b2']), ('normal', ['normal-control'])]:
    (output / f'fps-{name}.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in legacy if row['run'] in labels), encoding='utf-8')
print('\n'.join(table))
