import json
import re
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description='Summarize a directory of recovery test logs.')
parser.add_argument('evidence', type=Path, help='Evidence folder containing per-run log directories')
parser.add_argument('--out', type=Path, help='Output JSON (default: EVIDENCE/summary.json)')
args = parser.parse_args()
if not args.evidence.is_dir():
    parser.error('evidence directory does not exist')

out = []
for path in sorted(args.evidence.glob('*/*.log')):
    text = path.read_text(errors='replace')
    records = []
    for line in text.splitlines():
        if '[omori-test] ' in line:
            try:
                records.append(json.loads(line.split('[omori-test] ', 1)[1]))
            except json.JSONDecodeError:
                pass
    mem = [int(v) for v in re.findall(r'available (\d+) MB', text)]
    result = {
        'file': str(path.relative_to(args.evidence)),
        'minimumLoggedAvailableMB': min(mem) if mem else None,
        'watchdog': re.findall(r'\[watchdog\].*', text),
        'done': [r['done'] for r in records if 'done' in r],
        'prewarmDisabled': 'menu prewarm disabled' in text,
    }
    for r in records:
        if r.get('mode') == 'menus':
            result['menus'] = {
                k: {'fps': v['fps'], 'maxFrameMs': v['ft'][-1]} if isinstance(v, dict) and 'fps' in v else v
                for k, v in r['result'].items()
            }
            result['endMemory'] = r['mem']
        if 'soak' in r:
            s = r['soak']
            result.setdefault('soak', []).append({
                'cycle': s['cycle'], 'phase': s['phase'], 'gc': s['gc'],
                'availableMB': s['before']['memAvailableMB'], 'rssMB': s['before']['rssMB'],
                'canvasMB': s['before']['canvas']['liveMB'] if s['before'].get('canvas') else None,
            })
        if r.get('mode') == 'soak':
            result['soakCompletedCycles'] = r['result']['cycles']
            result['soakFailures'] = [s for s in r['result']['samples']
                                      if s.get('opened') is False or s.get('closed') is False]
    out.append(result)
(args.out or args.evidence / 'summary.json').write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
for r in out:
    print(r['file'], 'min MB:', r['minimumLoggedAvailableMB'], 'done:', r['done'],
          'watchdog:', r['watchdog'])
