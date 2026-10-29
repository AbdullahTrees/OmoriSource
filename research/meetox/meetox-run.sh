#!/bin/sh
# Runner for the meetox80/omori native engine on the muOS handheld (task T8).
# Copy to the device and run there:  sh /tmp/meetox-run.sh [INPUT_SCRIPT] [TAG]
#
# Pauses the muOS menu as /mnt/mmc/ports/omori-pmjs2/omori-test.sh does (SIGSTOP muxplore and
# frontend.sh, SIGCONT on exit), sets SDL_BLITTER_DISABLED=1 as muOS's launch chain does, runs the
# engine with --perf and the input script under a timeout, logs stdout+stderr (perf lines go to
# stderr) to $DIR/$TAG.log, then blanks both framebuffer pages and resumes the menu.
set -u
DIR=/mnt/mmc/ports/meetox-omori
SCRIPT=${1:-/tmp/meetox-bench.txt}
TAG=${2:-bench}
LOG=$DIR/$TAG.log
TIMEOUT=${MEETOX_TIMEOUT:-720}
FAST=
[ "${MEETOX_FAST:-0}" = "1" ] && FAST=--fast

MENU="$(pgrep -f '[m]uxplore') $(pgrep -f '[f]rontend.sh')"
resume() { for p in $MENU; do kill -CONT "$p" 2>/dev/null; done; }
trap resume EXIT INT TERM
for p in $MENU; do kill -STOP "$p"; done
echo "paused menu: [$MENU]"

mkdir -p "$DIR/shots"
cd "$DIR" || exit 1
echo "start $(date) temp $(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)" > "$LOG"
SDL_BLITTER_DISABLED=1 timeout "$TIMEOUT" ./omori --data "$DIR/data/omori.pak" --saves "$DIR/saves" --scale 1 \
  --input "$SCRIPT" --perf $FAST --shot-prefix "$DIR/shots/$TAG" >> "$LOG" 2>&1
echo "engine rc=$?" | tee -a "$LOG"
dd if=/dev/zero of=/dev/fb0 bs=1228800 count=2 2>/dev/null
echo "end $(date) temp $(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)" >> "$LOG"
resume
trap - EXIT
echo "perf lines: $(grep -a -c '^perf ' "$LOG")"
echo "shots: $(ls -1 "$DIR/shots" | grep -c "^$TAG")"
