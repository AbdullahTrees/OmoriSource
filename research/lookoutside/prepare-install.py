"""Stage the supplied MZ game unchanged; omit PC binaries, saves and cache."""
from pathlib import Path
import hashlib
import json
import tarfile
import zipfile

repo = Path(__file__).resolve().parents[2]
source = Path('D:/Large Games/Look Outside')
archive = Path('C:/Users/Abdullah/Downloads/Compressed/lookoutside.zip')
work = repo / '.local/pmjs-games/lookoutside'
stage = work / 'port'
stage.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as stream:
    bad = stream.testzip()
    if bad:
        raise RuntimeError('ZIP CRC failed: ' + bad)
    for item in stream.infolist():
        if not (stage / item.filename).resolve().is_relative_to(stage.resolve()):
            raise RuntimeError('Unsafe archive path')
    stream.extractall(stage)
port = stage / 'lookoutside'
descriptor = json.loads((port / 'pmjs.json').read_text())


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


audit = []
for name, expected in descriptor['bootstrapGameInputs'].items():
    path = source / name
    actual = sha(path) if path.is_file() else None
    audit.append({'path': name, 'expected': expected, 'actual': actual, 'match': actual == expected})
for name, expected in descriptor['compositionFiles'].items():
    if sha(port / name) != expected:
        raise RuntimeError('Corrupt composition: ' + name)
if sha(port / descriptor['bootstrap']) != descriptor['bootstrapSha256']:
    raise RuntimeError('Corrupt bundled bootstrap')

files = []
for directory in ['audio', 'css', 'data', 'effects', 'fonts', 'icon', 'img', 'js', 'lib']:
    files.extend(p for p in (source / directory).rglob('*') if p.is_file())
for name in ['index.html', 'package.json', 'credits.html', 'GalaxyConfig.json', 'greenworks.js', 'game_messages.csv']:
    if (source / name).is_file():
        files.append(source / name)
checksums = ''.join(f'{sha(p)}  gamedata/{p.relative_to(source).as_posix()}\n' for p in sorted(files))
(work / 'gamefiles.sha256').write_text(checksums, encoding='utf-8', newline='\n')
(work / 'input-audit.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')
with tarfile.open(work / 'install.tar.gz', 'w:gz', compresslevel=1) as stream:
    stream.add(port, arcname='lookoutside-test')
    for file in files:
        stream.add(file, arcname='lookoutside-test/gamedata/' + file.relative_to(source).as_posix())
    stream.add(work / 'gamefiles.sha256', arcname='lookoutside-test/gamefiles.sha256')
    stream.add(work / 'input-audit.json', arcname='lookoutside-test/input-audit.json')
result = {'source': str(source), 'gameFiles': len(files), 'gameBytes': sum(p.stat().st_size for p in files),
          'bootstrapInputsMatch': all(row['match'] for row in audit),
          'mismatches': [row['path'] for row in audit if not row['match']],
          'archiveSha256': sha(archive), 'archiveCrc': 'passed'}
(work / 'install-audit.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
