"""Validate setup receipts and summarize the clean baseline, never profile FPS."""
from pathlib import Path
import json
import subprocess
import sys

root = Path(sys.argv[1])
out = root / 'analysis'
out.mkdir(exist_ok=True)
accepted = {}
for label in ['seed', 'smoke', 'baseline', 'profile']:
    folder = root / 'results' / label
    rows = [json.loads(line) for line in (folder / 'results.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    log = (folder / 'session.log').read_text(encoding='utf-8')
    if (folder / 'exit.txt').read_text().strip() != '0' or not any(r['type'] == 'complete' for r in rows):
        raise SystemExit('Incomplete run: ' + label)
    if any(' ERROR ' in line or 'event error:' in line or ' FAILED' in line for line in log.splitlines()):
        raise SystemExit('Errors in run: ' + label)
    phases = [r for r in rows if r['type'] == 'phase']
    if label != 'seed':
        if [r['phase'] for r in phases] != ['standing', 'walking', 'menu', 'items']:
            raise SystemExit('Missing scene coverage: ' + label)
        walk = phases[1]['positions']
        if walk['minX'] == walk['maxX'] and walk['minY'] == walk['maxY']:
            raise SystemExit('No actual movement: ' + label)
        if any(not r['player']['canMove'] or r['player']['messageBusy'] for r in phases[:2]):
            raise SystemExit('Player control was blocked: ' + label)
    accepted[label] = phases

receipt = (root / 'normal-title-receipt.txt').read_text()
if 'title_seen=1' not in receipt:
    raise SystemExit('Normal PortMaster launch not validated')
retained = json.loads((root / 'retained-ab-result.json').read_text())
table = ['| Fixture | FPS | Mean ms | P95 ms | P99 ms | Max ms | >=100 ms | Logic Hz |',
         '|---|---:|---:|---:|---:|---:|---:|---:|']
for row in accepted['baseline']:
    f = row['frame']
    table.append(f"| {row['phase']} | {f['fps']:.2f} | {f['meanMs']:.2f} | {f['p95']:.2f} | "
                 f"{f['p99']:.2f} | {f['max']:.2f} | {f['hitches100ms']} | {row['logicHz']:.2f} |")
(out / 'baseline.md').write_text('\n'.join(table) + '\n', encoding='utf-8')
(out / 'setup.json').write_text(json.dumps({'acceptedRuns': list(accepted), 'normalWrapperReachedTitle': True,
    'nativePhaseTimingAvailable': False, 'retainedPreflight': retained,
    'baseline': accepted['baseline']}, indent=2), encoding='utf-8')
reporter = Path(__file__).parents[1] / 'pmjs-performance/fps-report.py'
summary = subprocess.check_output([sys.executable, str(reporter), str(root / 'results/baseline/fps.jsonl')], text=True)
(out / 'fps-report.txt').write_text(summary, encoding='utf-8')
print('\n'.join(table))
print('Retained A/B status:', retained['status'])
