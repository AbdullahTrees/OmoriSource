#!/usr/bin/env python3
"""Summarise a meetox80/omori --perf log per input-script phase.

The engine prints one "perf <scene>: update a/max ... frame a/max" block every 120 frames
(g_perf resets each report), plus "perf sections:" / "perf counts:" / "perf audio:" lines.
console.log() lines appear as "console: PHASE ..." and mark the script phases (warp markers).

Usage: python meetox-perf.py <log>
The first window after each PHASE marker is dropped: the report window is 120 frames and the
marker is placed 50 frames after a warp, so that first line can still contain the warp/load.
"""
import re
import sys
from statistics import mean, median

RE_PERF = re.compile(
    r"^perf (?P<scene>[^:]+): update (?P<up>[\d.]+)/(?P<upmax>[\d.]+) ms, "
    r"render (?P<ren>[\d.]+)/(?P<renmax>[\d.]+) ms, "
    r"present (?P<pres>[\d.]+)/(?P<presmax>[\d.]+) ms, "
    r"frame (?P<fr>[\d.]+)/(?P<frmax>[\d.]+) ms")
RE_SECT = re.compile(r"^perf sections: (?P<body>.*)$")


def main(path):
    phases = []  # (name, [windows], [sections])
    cur = None
    pending_sections = None
    for line in open(path, "r", errors="replace"):
        line = line.rstrip("\n")
        if line.startswith("console: PHASE"):
            name = line[len("console: "):]
            cur = (name, [], [])
            phases.append(cur)
            continue
        m = RE_PERF.match(line)
        if m and cur is not None:
            cur[1].append({k: float(m.group(k)) for k in
                           ("up", "ren", "pres", "fr", "frmax")})
            pending_sections = None
            continue
        m = RE_SECT.match(line)
        if m and cur is not None:
            sec = {}
            for part in m.group("body").split(", "):
                k, v = part.rsplit(" ", 1)
                sec[k] = float(v)
            cur[2].append(sec)

    print(f"{'phase':28s} {'win':>3s} {'frame':>7s} {'fps':>6s} {'update':>7s} "
          f"{'render':>7s} {'present':>7s} {'p99max':>7s}")
    for name, wins, secs in phases:
        use = wins[1:] or wins          # drop the window that may contain the warp
        if not use:
            print(f"{name:28s} {0:3d}  (no perf window)")
            continue
        fr = [w["fr"] for w in use]
        print(f"{name:28s} {len(use):3d} {mean(fr):7.2f} {1000.0/mean(fr):6.2f} "
              f"{mean(w['up'] for w in use):7.2f} {mean(w['ren'] for w in use):7.2f} "
              f"{mean(w['pres'] for w in use):7.2f} {max(w['frmax'] for w in use):7.2f}")
        if secs:
            keys = sorted(secs[0], key=lambda k: -mean(s[k] for s in secs))
            top = ", ".join(f"{k} {mean(s[k] for s in secs):.2f}" for k in keys[:6])
            print(f"    sections (avg ms): {top}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
