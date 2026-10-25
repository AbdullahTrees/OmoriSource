#!/bin/sh
# OMORI on PMJS: test runner for a muOS handheld. Runs on the device:
#   sh omori-test.sh <startup|perf|room|verify|menus> [options]
#
#   startup   launch to the title screen and quit: startup time, catalog hit/miss, heap/RSS (~25 s)
#   perf      fixed set of heavy maps, fps and frame times per map (~1.5-2 min)
#   room      one map, optionally walking a loop while measuring (~50 s)
#   verify    sprite patch on vs off: cutscene wait steps and camera-jump captures (~1.5 min)
#   menus     open pause menu -> options -> back to map -> reopen -> textbox, one measurement per
#             phase, including the open/close tick (slowest-tick breakdown) (~2 min)
#
# Options:
#   --maps LIST            perf/verify maps, "id" or "id:x:y", comma-separated
#   --room MAP:X:Y         room mode map (default 14:45:44)
#   --walk                 room mode: the player walks a loop during the measurement
#   --sweep STEP           room mode: place the camera on a grid STEP tiles apart; fps, visible
#                          characters and native costs per point (where in a map the cost is)
#   --settle S             seconds after arrival (default 18; maps run slower for ~17 s after entry)
#   --measure S            seconds per measurement (default 8)
#   --patch on,off         sprite patch state per measurement phase
#   --variant NAME[:K=V[,K=V...]]
#                          one run per variant with extra environment (repeatable; default "base"),
#                          e.g. --variant base --variant nocull:PMJS_DISABLE_OPT=scene.viewport-cull
#                          Values can't contain spaces (each word becomes another variant and launch)
#                          or commas (they separate K=V pairs)
#   --shots                save framebuffer captures (convert with omori-handover/tools/fb2png.py)
#   --profile              V8 CPU profile of each measurement (<logs>/<variant>-profiles/*.cpuprofile;
#                          read with cpuprofile-tree.js). Sampling costs some fps: not for fps tables
#   --census               log a scene-tree census (nodes walked per frame, off-screen, by class)
#   --breakdown            per-frame logic/build/render/native bucket split (small overhead)
#   --inventory            log the scene inventory and plain-sprite conditions per class
#   --disable LIST         OMORI_PERF_DISABLE items for every variant (comma-separated)
#   --no-pause             leave the muOS menu running (not representative of a menu launch)
#   --timeout S            per run (default 300)
#
# Runs the Ports-menu launcher with its defaults, as the player gets it, plus the test driver
# (omori-test.js next to this script). The muOS menu is paused during runs, as when a game is
# launched from it, and SDL_BLITTER_DISABLED=1 is set as muOS's launch chain does.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LAUNCHER=${OMORI_TEST_LAUNCHER:-"/mnt/mmc/ROMS/Ports/OMORI (PMJS test).sh"}
GAMEDIR=${OMORI_TEST_GAMEDIR:-/mnt/mmc/ports/omori-pmjs2}
DRIVER=$HERE/omori-test.js

MODE=${1:-}; [ $# -gt 0 ] && shift
case "$MODE" in startup|perf|room|verify|menus) ;; *) sed -n '2,27p' "$0"; exit 2;; esac
MAPS= ROOM= WALK= SWEEP= SETTLE= MEASURE= PATCH= SHOTS= PROFILE= CENSUS= PAUSE=1 TIMEOUT=300 VARIANTS= BREAKDOWN= DISABLE= INVENTORY=
while [ $# -gt 0 ]; do
  case "$1" in
    --maps) MAPS=$2; shift;;
    --room) ROOM=$2; shift;;
    --walk) WALK=1;;
    --sweep) SWEEP=$2; shift;;
    --settle) SETTLE=$2; shift;;
    --measure) MEASURE=$2; shift;;
    --patch) PATCH=$2; shift;;
    --variant) VARIANTS="$VARIANTS $2"; shift;;
    --shots) SHOTS=1;;
    --profile) PROFILE=1;;
    --census) CENSUS=1;;
    --breakdown) BREAKDOWN=1;;
    --inventory) INVENTORY=1;;
    --disable) DISABLE=$2; shift;;
    --no-pause) PAUSE=;;
    --timeout) TIMEOUT=$2; shift;;
    *) echo "unknown option $1"; exit 2;;
  esac
  shift
done
[ -n "$VARIANTS" ] || VARIANTS=base
OUT=$GAMEDIR/tests/$(date +%Y%m%d-%H%M%S)-$MODE
mkdir -p "$OUT"

MENU=
if [ -n "$PAUSE" ]; then
  MENU="$(pgrep -f '[m]uxplore') $(pgrep -f '[f]rontend.sh')"
  trap 'for p in $MENU; do kill -CONT "$p" 2>/dev/null; done' EXIT INT TERM
  for p in $MENU; do kill -STOP "$p"; done
fi

for variant in $VARIANTS; do
  name=${variant%%:*}
  extra=; case "$variant" in *:*) extra=$(echo "${variant#*:}" | tr ',' ' ');; esac
  log=$OUT/$name.log
  # --disable first, then the variant env, so a variant may override OMORI_PERF_DISABLE.
  env OMORI_PERF_DISABLE=$DISABLE $extra SDL_BLITTER_DISABLED=1 PMJS_TIMEOUT=$TIMEOUT PMJS_WATCHDOG_MB=${PMJS_WATCHDOG_MB:-100} \
    OMORI_TEST_MODE=$MODE OMORI_TEST_MAPS=$MAPS OMORI_TEST_ROOM=$ROOM OMORI_TEST_WALK=$WALK OMORI_TEST_SWEEP=$SWEEP \
    OMORI_TEST_SETTLE=$SETTLE OMORI_TEST_MEASURE=$MEASURE OMORI_TEST_PATCH=$PATCH \
    OMORI_TEST_SHOTS=${SHOTS:+$OUT/$name-shots} OMORI_TEST_PROFILE=${PROFILE:+$OUT/$name-profiles} OMORI_TEST_CENSUS=$CENSUS \
    OMORI_TEST_BREAKDOWN=$BREAKDOWN OMORI_TEST_INVENTORY=$INVENTORY \
    PMJS_EXTRA_PATCH="$DRIVER" \
    bash "$LAUNCHER" >/dev/null 2>&1
  # Blank both framebuffer pages: with the menu paused nothing else redraws, and the game's last
  # (possibly half-drawn) frame would otherwise stay on screen like a game that is still running.
  dd if=/dev/zero of=/dev/fb0 bs=1228800 count=2 2>/dev/null
  cp "$GAMEDIR/log.txt" "$log"
  echo "== $MODE / $name ${extra:+($extra)}"
  grep -a -o '\[launcher\].*' "$log" | head -1
  grep -a -o 'stage=maps event=finish status=[a-z]* cache=[a-z]* catalog_hit=[a-z]* catalog=[a-z]* duration_ms=[0-9.]*' "$log" | head -1
  grep -a -o 'ready size=[0-9x]* startup_ms=[0-9.]*' "$log" | head -1
  grep -a -o '\[omori-test\] .*' "$log" | cut -c14-
  grep -a -E '\[watchdog\]|FATAL' "$log" | head -2
done
echo "logs: $OUT"
