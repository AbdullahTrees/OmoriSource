"""Check the existing retained branch's actual MZ module composition, without checkout."""
from pathlib import Path
import hashlib
import json
import subprocess

repo = Path(__file__).resolve().parents[2]
ref = 'pr/retained-encoding'
git = ['git', '-C', str(repo / 'pmjs')]
revision = subprocess.check_output(git + ['rev-parse', ref], text=True).strip()
raw = subprocess.check_output(git + ['show', revision + ':profiles/mz.json'])
modules = json.loads(raw)['modules']
files = subprocess.check_output(git + ['ls-tree', '-r', '--name-only', revision], text=True).splitlines()
implementations = [name for name in files if name.endswith('/scene-retained.js')]
checks = []
for name in modules:
    if name.startswith('js/pmjs-pixi5/'):
        source = subprocess.check_output(git + ['show', revision + ':' + name])
        checks.append({'module': name, 'sha256': hashlib.sha256(source).hexdigest(),
                       'referencesRetainedFlag': b'render.retained-encoding' in source})
result = {'branch': ref, 'revision': revision, 'mzProfileSha256': hashlib.sha256(raw).hexdigest(),
          'mzRendererModules': [name for name in modules if 'pixi' in name],
          'retainedImplementationFiles': implementations,
          'loadsRetainedModule': any(name in modules for name in implementations),
          'pixi5Checks': checks,
          'conclusion': 'not-applicable: existing retained encoder is not part of the MZ renderer'}
out = repo / '.local/pmjs-games/lookoutside/retained-source-audit.json'
out.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
