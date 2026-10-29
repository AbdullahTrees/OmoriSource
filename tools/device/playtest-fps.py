"""Per-location fps from a PMJS log.txt (playtest sessions).

PMJS diagnostics sample the game location every 10 s and log a line on each
map or scene change. Each line carries `from` (the previous sample, 10 s
earlier) and `to` (this sample), both with Graphics.frameCount, which PMJS
increments once per rendered frame. Between two consecutive change lines the
game stayed in one location, so
  fps = (from.frameCount of next line - to.frameCount of this line) / elapsed
with elapsed = (next.uptimeMs - 10 s) - this.uptimeMs.

usage: python playtest-fps.py log.txt
"""
import json
import re
import sys
from collections import defaultdict

SAMPLE_MS = 10000
line_re = re.compile(r'\[pmjs\] diagnostic (\{.*\})')

events = []
for raw in open(sys.argv[1], encoding='utf-8', errors='replace'):
    m = line_re.search(raw)
    if not m:
        continue
    try:
        d = json.loads(m.group(1))
    except ValueError:
        continue
    if d.get('reason') in ('map-transition', 'scene-transition') and 'to' in d:
        events.append(d)

def name(loc):
    if loc.get('scene') == 'Scene_Map':
        return '%s (map %s)' % ((loc.get('mapName') or '').strip(' -'), loc.get('mapId'))
    return loc.get('scene')

totals = defaultdict(lambda: [0, 0.0])
print('%-36s %8s %8s %6s' % ('location', 'start_s', 'secs', 'fps'))
for cur, nxt in zip(events, events[1:]):
    start_ms, start_f = cur['uptimeMs'], cur['to'].get('frameCount')
    end_ms, end_f = nxt['uptimeMs'] - SAMPLE_MS, nxt['from'].get('frameCount')
    secs = (end_ms - start_ms) / 1000
    if start_f is None or end_f is None or secs < 5 or end_f < start_f:
        continue
    fps = (end_f - start_f) / secs
    label = name(cur['to'])
    totals[label][0] += end_f - start_f
    totals[label][1] += secs
    print('%-36s %8.0f %8.0f %6.1f' % (label, start_ms / 1000, secs, fps))

print('\nper location (time-weighted):')
for label, (frames, secs) in sorted(totals.items(), key=lambda kv: kv[1][0] / kv[1][1]):
    print('%-36s %6.0f s %6.1f fps' % (label, secs, frames / secs))
