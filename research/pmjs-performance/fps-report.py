"""Summarise an fps log written by launcher/omori-fps-log.js.

usage: python fps-report.py fps-YYYYMMDD-HHMMSS.log [--min-secs 3]

Per location (map + sub-phase, or scene), time-weighted over the session: seconds, fps, game speed
(logic steps/s as % of 60), worst window p95, hitches. Sorted slowest first and grouped into
  HIGH    below 30 fps (the game runs in slow motion)
  MEDIUM  30-55 fps
  OK      55+ fps
"""
import json
import sys
from collections import defaultdict

args = sys.argv[1:]
min_secs = 3.0
if '--min-secs' in args:
    i = args.index('--min-secs')
    min_secs = float(args[i + 1])
    del args[i:i + 2]

rows = defaultdict(lambda: {'secs': 0.0, 'frames': 0, 'logic': 0.0, 'p95': 0, 'max': 0, 'hitch': 0, 'where': set()})
header = None
for raw in open(args[0], encoding='utf-8'):
    line = json.loads(raw)
    if 'session' in line:
        header = line
        continue
    if 'map' in line:
        label = '%s (map %d) %s' % (line['name'], line['map'], line['sub'])
    else:
        label = line['scene']
    row = rows[label]
    row['secs'] += line['secs']
    row['frames'] += line['frames']
    row['logic'] += line['logic'] * line['secs']
    row['p95'] = max(row['p95'], line['p95'])
    row['max'] = max(row['max'], line['max'])
    row['hitch'] += line['hitch']
    if 'x' in line:
        row['where'].add((line['x'], line['y']))

if header:
    print('session %s (%s, sprite patch %s)' % (header['session'], header['runtime'], header['spritePatch']))
print('%-7s %-46s %7s %6s %6s %5s %5s %6s' % ('', 'location', 'secs', 'fps', 'speed', 'p95', 'max', 'hitch'))
for label, row in sorted(rows.items(), key=lambda kv: kv[1]['frames'] / kv[1]['secs']):
    if row['secs'] < min_secs:
        continue
    fps = row['frames'] / row['secs']
    tier = 'HIGH' if fps < 30 else 'MEDIUM' if fps < 55 else 'OK'
    speed = row['logic'] / row['secs'] / 60 * 100
    print('%-7s %-46s %7.0f %6.1f %5.0f%% %5d %5d %6d' % (tier, label[:46], row['secs'], fps, speed,
                                                         row['p95'], row['max'], row['hitch']))
