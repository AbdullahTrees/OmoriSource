#!/bin/sh
set -eu
B=/mnt/mmc/ports/isat-perf
GAME=/mnt/mmc/ports/isat-test
MODE=${1:-pilot}
[ -z "$(pidof node 2>/dev/null || true)" ] || { echo 'Refusing: game active'; exit 2; }
STOPPED=""
for name in muxplore frontend.sh; do
 for p in $(pidof "$name" 2>/dev/null || true); do STOPPED="$STOPPED $p"; done
done
finish() {
 for p in $STOPPED; do kill -CONT "$p" 2>/dev/null || true; done
 dd if=/dev/zero of=/dev/fb0 bs=1228800 count=2 2>/dev/null || true
}
trap finish EXIT
trap 'exit 130' INT TERM
for p in $STOPPED; do kill -STOP "$p" 2>/dev/null || true; done
export SDL_BLITTER_DISABLED=1
run() {
 label=$1; variant=$2; seconds=$3; profiling=${4:-0}; verifying=${5:-0}
 R=$B/runtime
 [ "$variant" != normal ] || R=$GAME/runtime
 CACHE=$B/cache-experimental
 [ "$variant" != normal ] || CACHE=$B/cache-normal
 [ "$verifying" != 1 ] || CACHE=$B/cache-verify
 D=$B/results/$label
 mkdir "$D"
 if [ "$label" = seed ]; then
  SAVES=$B/seed-saves; mkdir "$SAVES"; action=seed
 else
  SAVES=$D/saves; mkdir "$SAVES"; cp -a "$B/seed-saves/." "$SAVES/";action=run
 fi
 DISABLED=''
 [ "$variant" != off ] || DISABLED=render.retained-encoding
 cp "$B/scene-retained.performance.js" "$B/runtime/share/pmjs/js/pmjs-pixi4/scene-retained.js"
 [ "$verifying" != 1 ] || cp "$B/scene-retained.verify.js" "$B/runtime/share/pmjs/js/pmjs-pixi4/scene-retained.js"
 echo "[isat-ab] start $label variant=$variant profile=$profiling verify=$verifying";date
 cat /sys/class/thermal/thermal_zone0/temp > "$D/temperature-before.txt"
 free -m > "$D/memory-before.txt"
 set +e
 env LD_LIBRARY_PATH="$R/lib" XDG_CACHE_HOME="$CACHE" \
  PMJS_DISABLE_OPT="$DISABLED" PMJS_FRAME_STATS="$D/frame-stats.jsonl" PMJS_FRAME_STATS_INTERVAL_MS=2000 \
  PMJS_RETAINED_VERIFY="$verifying" ISAT_BENCH_DIR="$D" ISAT_BENCH_MODE="$action" \
  ISAT_BENCH_SECONDS="$seconds" ISAT_BENCH_WARMUP=5 ISAT_BENCH_PROFILE="$profiling" \
  timeout -s TERM 420 "$R/bin/node" "$R/share/pmjs/tools/pmjs.mjs" "$R" run \
  --game "$GAME/gamedata/www" --state "$B/bootstrap-$variant" --config "$GAME/config.json" \
  --save-root "$SAVES" --asset-cache-root "$CACHE/assets" --patch "$GAME/patches/source-patches.js" --patch "$GAME/patches/source-qualification.js" --patch "$GAME/patches/plugin-policy.js" --patch "$GAME/patches/portrait-choice-indent.js" --patch "$GAME/patches/animated-picture-loading.js" --patch "$GAME/patches/independent-item-search.js" --patch "$GAME/patches/persistent-storage.js" --patch "$GAME/patches/auxiliary-storage.js" --patch "$GAME/patches/input-polling.js" --patch "$GAME/patches/message-fast-forward.js" --patch "$GAME/patches/intro-picture-handoff.js" --patch "$GAME/patches/plain-word-measure.js" --patch "$GAME/patches/choice-width.js" --patch "$GAME/patches/loop-recovery.js" --patch "$GAME/patches/battle-status-icons.js" --patch "$GAME/patches/battle-hud.js" --patch "$GAME/patches/battle-command-paint.js" --patch "$GAME/patches/battle-hidden-gauges.js" --patch "$GAME/patches/battle-popup-text.js" --patch "$GAME/patches/battle-closed-windows.js" --patch "$GAME/patches/battle-enemy-sprites.js" --patch "$GAME/patches/battle-selection-refresh.js" --patch "$GAME/patches/screen-effects.js" --patch "$GAME/patches/neutral-tone.js" --patch "$GAME/patches/hue-neutral-assets.js" --patch "$GAME/patches/map-sprite-dispatch.js" --patch "$GAME/patches/battle-sprite-dispatch.js" --patch "$GAME/patches/battle-local-transforms.js" --patch "$GAME/patches/mpp-gpu-fragments.js" --patch "$GAME/patches/horror-presentation.js" --patch "$GAME/patches/hud-cache-producers.js" --patch "$GAME/patches/static-events.js" --patch "$GAME/patches/blank-characters.js" --patch "$GAME/patches/local-map-transforms.js" --patch "$B/benchmark.js" > "$D/session.log" 2>&1
 code=$?
 set -e
 echo "$code" > "$D/exit.txt"
 cat /sys/class/thermal/thermal_zone0/temp > "$D/temperature-after.txt"
 free -m > "$D/memory-after.txt"
 echo "[isat-ab] finish $label exit=$code";tail -5 "$D/session.log"
 [ "$code" = 0 ] && grep -q '"type":"complete"' "$D/results.jsonl" || return 1
 if grep -E ' ERROR |event error:|[0-9]+ FAILED' "$D/session.log" >/dev/null; then echo 'INVALID: errors in log'; return 1; fi
}
case "$MODE" in
 seed) run seed normal 5 ;;
 pilot) run pilot-off off 5 ;;
 normal) run normal-control normal 15 ;;
 abba) run a1 off 15; sleep 12; run b1 on 15; sleep 12; run b2 on 15; sleep 12; run a2 off 15 ;;
 verify) run verify on 8 0 1 ;;
 profiles) run profile-off off 10 1; sleep 12; run profile-on on 10 1 ;;
 *) echo 'Unknown mode';exit 2 ;;
esac
