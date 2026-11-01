#!/bin/sh
# One installed game/runtime/cache. Only disposable harness saves/state/logs differ.
set -eu
ROOT=/mnt/mmc/ports/lookoutside-test
B=$ROOT/harness
MODE=${1:-baseline}
LABEL=${2:-$MODE}
case "$LABEL" in ''|*[!a-zA-Z0-9_-]*) echo 'Invalid run label';exit 2;;esac
[ -z "$(pidof node 2>/dev/null || true)" ] || { echo 'Refusing: game active';exit 2; }
STOPPED=''
MONITOR=''
for name in muxplore frontend.sh; do
 for pid in $(pidof "$name" 2>/dev/null || true); do STOPPED="$STOPPED $pid";done
done
finish() {
 [ -z "$MONITOR" ] || kill "$MONITOR" 2>/dev/null || true
 for pid in $STOPPED; do kill -CONT "$pid" 2>/dev/null || true;done
 dd if=/dev/zero of=/dev/fb0 bs=1228800 count=2 2>/dev/null || true
}
trap finish EXIT
trap 'exit 130' INT TERM
for pid in $STOPPED; do kill -STOP "$pid" 2>/dev/null || true;done
export SDL_BLITTER_DISABLED=1
R=$ROOT/runtime
D=$B/results/$LABEL
mkdir "$D"
action=measure;profile=0;seconds=15
case "$MODE" in
 seed) action=seed;SAVES=$B/seed-saves;mkdir "$SAVES";;
 title|retained-probe) action=$MODE;SAVES=$D/saves;mkdir "$SAVES";;
 baseline|smoke|profile)
  SAVES=$D/saves;mkdir "$SAVES";cp -a "$B/seed-saves/." "$SAVES/"
  [ "$MODE" != smoke ] || seconds=3
  [ "$MODE" != profile ] || { profile=1;seconds=10; };;
 *) echo 'Mode: seed, title, retained-probe, smoke, baseline, profile';exit 2;;
esac
echo "[lookoutside-bench] start $LABEL mode=$MODE";date
free -m > "$D/memory-before.txt"
cat /proc/sys/kernel/random/boot_id > "$D/boot-id.txt"
sync
if [ "${GAME_BENCH_MEMORY_TRACE:-0}" = 1 ];then
 (
  while true;do
   date +%s
   grep -E 'MemAvailable:|MemFree:' /proc/meminfo
   cat /sys/class/thermal/thermal_zone0/temp
   for pid in $(pidof node 2>/dev/null || true);do
    if [ "$(readlink -f /proc/$pid/exe)" = "$R/bin/node" ];then
     echo "node_pid=$pid";grep -E 'VmRSS:|VmHWM:' /proc/$pid/status 2>/dev/null || true
    fi
   done
   sync
   sleep 2
  done
 ) > "$D/memory-trace.log" 2>&1 &
 MONITOR=$!
fi
set +e
env LD_LIBRARY_PATH="$R/lib" XDG_CACHE_HOME="$ROOT/.cache" \
 PMJS_DISABLE_OPT="${GAME_BENCH_DISABLE_OPT:-}" GAME_BENCH_DIR="$D" GAME_BENCH_MODE="$action" \
 GAME_BENCH_PROFILE="$profile" GAME_BENCH_SECONDS="$seconds" \
 timeout -k 10 -s TERM 600 "$R/bin/node" "$R/share/pmjs/tools/pmjs.mjs" "$R" "$B/bundle" \
 --game "$ROOT/gamedata" --state "$B/bootstrap" --save-root "$SAVES" \
 --asset-cache-root "$ROOT/.cache/assets" > "$D/session.log" 2>&1
code=$?
set -e
echo "$code" > "$D/exit.txt"
free -m > "$D/memory-after.txt"
sync
echo "[lookoutside-bench] finish $LABEL exit=$code";tail -7 "$D/session.log"
[ "$code" = 0 ] && grep -q '"type":"complete"' "$D/results.jsonl" || exit 1
if grep -E ' ERROR |event error:|[0-9]+ FAILED' "$D/session.log" >/dev/null; then echo 'INVALID: errors in log';exit 1;fi
