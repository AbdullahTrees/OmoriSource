# Summarize a soak-mode run (or a runner output file with several variants).
#
#   python soak-report.py <runner-output-or-log> [--variant NAME]
#
# Samples are `{"soak": {...}}` JSON lines, optionally grouped by runner headers
# `== soak / <name> (...)`. For every variant the report prints the per-cycle memory at the map
# before the open and after the close, then the start/end/minimum MemAvailable, resource growth
# (RSS, native canvas bytes, GPU image bytes, Skia text cache) and the menuBackground/memoryTrim
# module counters. Handles both sample shapes: an older flat `module.enabled` and the newer
# `module.background` / `module.memoryTrim`.
import json
import re
import sys

HEADER = re.compile(r'^== soak / (\S+)')


def load(path):
    variants = {}
    current = 'run'
    variants[current] = []
    for line in open(path, errors='replace'):
        match = HEADER.match(line)
        if match:
            current = match.group(1)
            variants.setdefault(current, [])
            continue
        at = line.find('{"soak":')
        if at < 0:
            continue
        try:
            record = json.loads(line[at:])
        except ValueError:
            continue
        variants[current].append(record['soak'])
    return {name: samples for name, samples in variants.items() if samples}


def module_flags(sample):
    module = sample.get('module') or {}
    if 'background' in module or 'memoryTrim' in module:
        background = module.get('background') or {}
        trim = module.get('memoryTrim') or {}
    else:
        background = module
        trim = {}
    if background.get('disabled'):
        background = dict(background, enabled=False)
    return {k: v for k, v in {
        'background': background.get('enabled'),
        'trimCalls': trim.get('gcCalls'),
        'trimMs': trim.get('gcMs'),
        'trimAvail': trim.get('lastAvailableMB'),
    }.items() if v is not None}


def view(sample):
    state = sample.get('afterGc') or sample.get('before') or {}
    canvas = state.get('canvas') or {}
    images = state.get('images') or {}
    return {
        'rss': state.get('rssMB'),
        'heap': state.get('heapMB'),
        'avail': state.get('memAvailableMB'),
        'canvasMB': canvas.get('liveMB'),
        'capacityMB': canvas.get('capacityMB'),
        'textMB': canvas.get('textMB'),
        'gpuMB': round((images.get('gpuBytes') or 0) / 1048576, 1),
        'imgLive': images.get('liveCount'),
        'gcMs': sample.get('gcMs'),
        'flags': module_flags(sample),
    }


def report(name, samples):
    cycles = {}
    for sample in samples:
        cycles.setdefault(sample['cycle'], {})[sample['phase']] = view(sample)
    print('### %s (%d samples, %d cycles)' % (name, len(samples), len(cycles)))
    print('cyc  bg   | before: avail rss canvas gpu text | after: avail rss canvas gpu text')
    first = cycles[min(cycles)].get('map-before', {})
    for cycle in sorted(cycles):
        phases = cycles[cycle]
        before = phases.get('map-before', {})
        after = phases.get('map-after', {})
        flags = before.get('flags') or after.get('flags') or {}
        background = flags.get('background')
        background = 'on' if background is True else 'off' if background is False else '?'
        print('%2d  %-3s | %5s %5s %5s %5s %5s | %5s %5s %5s %5s %5s' % (
            cycle, background,
            before.get('avail'), before.get('rss'), before.get('canvasMB'),
            before.get('gpuMB'), before.get('textMB'),
            after.get('avail'), after.get('rss'), after.get('canvasMB'),
            after.get('gpuMB'), after.get('textMB')))
    last = cycles[max(cycles)].get('map-after', {})
    avail = [phases.get('map-before', {}).get('avail') for phases in cycles.values()
             if phases.get('map-before', {}).get('avail') is not None]
    if avail:
        print('avail start %s, end %s, min %s' % (first.get('avail'), last.get('avail'), min(avail)))
    trim_samples = [phases[p].get('flags', {}) for phases in cycles.values() for p in phases]
    calls = [f.get('trimCalls') for f in trim_samples if f.get('trimCalls') is not None]
    if calls:
        # These counters are cumulative, so the final sample carries the totals.
        print('memoryTrim collections %s, collection time %s ms' % (
            max(calls), max(f.get('trimMs') or 0 for f in trim_samples)))
    print()


def main():
    if len(sys.argv) < 2:
        print('usage: soak-report.py <runner-output-or-log> [--variant NAME]')
        return 2
    variants = load(sys.argv[1])
    wanted = None
    if '--variant' in sys.argv:
        wanted = sys.argv[sys.argv.index('--variant') + 1]
    for name, samples in variants.items():
        if wanted and name != wanted:
            continue
        report(name, samples)
    return 0


if __name__ == '__main__':
    sys.exit(main())
