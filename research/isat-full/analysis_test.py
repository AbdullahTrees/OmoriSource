"""Check profile attribution against known sample durations and same-name code."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ProfileAttribution(unittest.TestCase):
    def test_delta_alignment_setup_exclusion_and_retention_module_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            maps = root / 'module-maps'
            maps.mkdir()
            (maps / 'bootstrap-demo.js.json').write_text(json.dumps([
                {'label': 'js/pmjs-pixi4/scene-retained.js', 'start': 1, 'end': 100}]))
            profile = {'nodes': [
                {'id': 1, 'children': [2, 3, 4], 'callFrame':
                    {'functionName': '(root)', 'url': '', 'lineNumber': -1}},
                {'id': 2, 'callFrame': {'functionName': 'post', 'url': 'node:inspector', 'lineNumber': 114}},
                {'id': 3, 'callFrame': {'functionName': 'captureSigWords', 'url': '/bootstrap-demo.js', 'lineNumber': 10}},
                {'id': 4, 'callFrame': {'functionName': 'captureSigWords', 'url': '/game.js', 'lineNumber': 10}}],
                'samples': [2, 3, 4], 'timeDeltas': [900000, 2000, 3000]}
            for variant in ['off', 'on']:
                folder = root / 'results' / ('profile-' + variant)
                folder.mkdir(parents=True)
                (folder / 'results.jsonl').write_text(json.dumps(
                    {'type': 'phase', 'phase': 'standing', 'frame': {'frames': 10}}))
                (folder / 'standing.cpuprofile').write_text(json.dumps(profile))
            subprocess.run([sys.executable, str(Path(__file__).with_name('profile-retained.py')), str(root)],
                           check=True, capture_output=True)
            reports = json.loads((root / 'analysis/profiles.json').read_text())
            for row in reports:
                self.assertEqual(row['excludedInspectorMs'], 900)
                self.assertEqual(row['sampleMs'], 5)
                self.assertEqual(row['partsMsPerFrame']['captureSigWords'], 0.2)
                modules = {x['name']: x['ms'] for x in row['selfModules']}
                self.assertEqual(modules['game.js'], 3)
                self.assertEqual(modules['js/pmjs-pixi4/scene-retained.js'], 2)


if __name__ == '__main__':
    unittest.main()
