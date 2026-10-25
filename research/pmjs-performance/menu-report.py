# Summarize a menus-mode run from an OMORI PMJS device log.
#
#   python menu-report.py <log.txt> [--phase ui-menu-open,ui-menu]
#
# The device driver logs one `[omori-test] {json}` line per run; this prints the phases that
# matter for menu transitions: the worst tick and its buckets (tick/logic/build/render), the
# worst single call of the transition probes (menuCreate, snapBg, optionsCreate), the steady
# fps, and the menu-background module counters. Values are milliseconds unless noted.
import json
import sys

PHASES = ['menuOpen', 'menu', 'menuMove', 'optionsOpen', 'options', 'optionsMove',
          'optionsList', 'menuBack', 'mapAfter', 'menuOpenWarm', 'menuWarm',
          'messageOpen', 'message']


def load(path):
    result = None
    for line in open(path, 'r', errors='replace'):
        marker = '[omori-test] '
        at = line.find(marker)
        if at < 0:
            continue
        try:
            record = json.loads(line[at + len(marker):])
        except ValueError:
            continue
        if record.get('mode') == 'menus':
            result = record
    return result


def ms(value):
    return '-' if value is None else '%g' % value


def main():
    if len(sys.argv) < 2:
        print(__doc__ or 'usage: menu-report.py <log.txt> [--phase a,b]')
        return 2
    phases = PHASES
    if '--phase' in sys.argv:
        phases = [p.strip() for p in sys.argv[sys.argv.index('--phase') + 1].split(',') if p.strip()]
    record = load(sys.argv[1])
    if not record:
        print('no menus result in ' + sys.argv[1])
        return 1
    result = record.get('result') or {}
    print('map %s' % record.get('map'))
    header = ('phase                     fps   ft-p50  ft-p95  ft-max  worst   logic   build'
              '   render  menuCreate snapBg  options  shot')
    print(header)
    for name in phases:
        phase = result.get(name)
        if not phase:
            continue
        worst = (phase.get('breakdown') or {}).get('worst') or {}
        top = (phase.get('breakdown') or {}).get('max') or {}
        ft = phase.get('ft') or [None, None, None]
        print('%-24s %6s %7s %7s %7s %7s %7s %7s %8s %9s %7s %8s  %s' % (
            name, ms(phase.get('fps')), ms(ft[0]), ms(ft[1]), ms(ft[2]),
            ms(worst.get('tick')), ms(worst.get('logic')), ms(worst.get('build')),
            ms(worst.get('render')), ms(top.get('menuCreate')), ms(top.get('snapBg')),
            ms(top.get('optionsCreate')), phase.get('shot') or ''))
    perf = record.get('perf') or {}
    background = dict((k, v) for k, v in perf.items() if k.startswith('OmoriPerf.menuBackground.'))
    if background:
        print('menuBackground ' + ' '.join('%s=%s' % (k.split('.')[-1], v)
                                          for k, v in sorted(background.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
