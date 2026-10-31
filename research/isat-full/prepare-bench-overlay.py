"""Export immutable experimental JS and measurement-only fixes; never move Git refs."""
from pathlib import Path
import hashlib
import io
import json
import subprocess
import tarfile

REPO = Path(__file__).resolve().parents[2] / 'pmjs'
OUTPUT = REPO.parent / '.local/pmjs-games/isat/bench-overlay'
BASE = '3fef914f113c4ea8595bdf95a29fc373c9fd8f9c'
VERIFY = '8a7bee5cdf35a9dc27e9ddd820aaa773e11713a7'


def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])


share = OUTPUT / 'share/pmjs'
share.mkdir(parents=True, exist_ok=True)
archive = git('archive', BASE, 'js', 'runner', 'tools', 'profiles', 'patches', 'package.json')
with tarfile.open(fileobj=io.BytesIO(archive)) as stream:
    stream.extractall(share, filter='data')

stats = share / 'runner/frame-stats.cjs'
source = stats.read_text(encoding='utf-8')
source = source.replace('const guestEnter = new Array(GUEST_SLOTS).fill(NaN);',
    'const guestEnter = new Array(GUEST_SLOTS).fill(NaN);\n  const guestDepth = new Uint32Array(GUEST_SLOTS);')
source = source.replace('enter(slot) { guestEnter[slot] = now(); },',
    'enter(slot) { if (guestDepth[slot]++ === 0) guestEnter[slot] = now(); },')
source = source.replace('const started = guestEnter[slot];',
    'if (!guestDepth[slot] || --guestDepth[slot]) return;\n      const started = guestEnter[slot];')
source = source.replace('guestSpan[slot] = 0;', 'guestSpan[slot] = 0;\n        guestDepth[slot] = 0;')
source = source.replace('return { p50: round(at(0.5)),',
    'return { mean: round(sorted.reduce((sum, value) => sum + value, 0) / count), p50: round(at(0.5)),')
stats.write_text(source, encoding='utf-8', newline='\n')


def world_getter(source):
    source = source.replace('var current = { active:', 'var lastWorldState = null;\n  var current = { active:')
    source = source.replace('splicedRecords: 0, encodedRecords: 0',
                            'worldStatePasses: 0, localStatePasses: 0, splicedRecords: 0, encodedRecords: 0')
    source = source.replace('function beginFrame(stage, backgroundColor) {',
        'function beginFrame(stage, backgroundColor) {\n' +
        '    lastWorldState = nativeSceneUsePixiWorldState;\n' +
        '    if (lastWorldState) stats.worldStatePasses++; else stats.localStatePasses++;')
    return source.replace('return { get active()',
        'return { get usesWorldState() { return lastWorldState; }, get active()')


retained = share / 'js/pmjs-pixi4/scene-retained.js'
retained.write_text(world_getter(retained.read_text(encoding='utf-8')), encoding='utf-8', newline='\n')
(OUTPUT / 'scene-retained.verify.js').write_text(world_getter(
    git('show', VERIFY + ':js/pmjs-pixi4/scene-retained.js').decode()), encoding='utf-8', newline='\n')
hashes = {file.relative_to(OUTPUT).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
          for file in OUTPUT.rglob('*') if file.is_file() and file.name != 'overlay-manifest.json'}
(OUTPUT / 'overlay-manifest.json').write_text(json.dumps({
    'source_ref': BASE, 'verify_ref': VERIFY,
    'measurement_changes': ['nested phase union timing', 'phase arithmetic means',
                            'last world-state getter and world/local pass counters before enable guard'],
    'sha256': hashes}, indent=2), encoding='utf-8')
with tarfile.open(OUTPUT.parent / 'bench-overlay.tar.gz', 'w:gz') as stream:
    for file in OUTPUT.iterdir():
        stream.add(file, arcname=file.name)
print(f'Prepared {len(hashes)} files; working tree and refs untouched.')
