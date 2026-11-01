"""Package small instrumentation only; do not duplicate game data or runtime."""
from pathlib import Path
import json
import tarfile

repo = Path(__file__).resolve().parents[2]
work = repo / '.local/pmjs-games/lookoutside'
port = work / 'port/lookoutside'
stage = work / 'harness-stage'
bundle = stage / 'harness/bundle'
(bundle / 'patches').mkdir(parents=True, exist_ok=True)
descriptor = json.loads((port / 'pmjs.json').read_text())
descriptor['patches'] += ['patches/game-metrics.js', 'patches/benchmark.js']
# This modified composition must compile honestly, never reuse the uninstrumented
# bootstrap based on forged updated composition receipts. Normal bundle is untouched.
descriptor['compositionFiles'] = None
(bundle / 'pmjs.json').write_text(json.dumps(descriptor, indent=2), encoding='utf-8')
for name in ['config.json', 'bootstrap.js', 'asset-index.json', 'patches/dom.js']:
    target = bundle / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes((port / name).read_bytes())
(bundle / 'patches/game-metrics.js').write_bytes((repo / 'research/pmjs-performance/game-metrics.js').read_bytes())
(bundle / 'patches/benchmark.js').write_bytes((repo / 'research/lookoutside/benchmark.js').read_bytes())
for name in ['run-device.sh', 'finish-device.sh', 'normal-launch-check.sh', 'retained-ab.sh',
             'export-results.cjs', 'export-device.sh']:
    (stage / 'harness' / name).write_bytes((repo / 'research/lookoutside' / name).read_bytes())
if (work / 'retained-source-audit.json').exists():
    (stage / 'harness/retained-source-audit.json').write_bytes((work / 'retained-source-audit.json').read_bytes())
launcher = (repo / 'research/lookoutside/play.sh').read_text(encoding='utf-8')
(stage / 'menu-launcher.sh').write_text(launcher, encoding='utf-8', newline='\n')
with tarfile.open(work / 'harness.tar.gz', 'w:gz') as stream:
    for path in stage.iterdir():
        stream.add(path, arcname=path.name)
print('Prepared instrumentation: same game/runtime/cache, disposable harness state and saves only')
