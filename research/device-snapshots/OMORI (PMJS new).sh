#!/bin/bash
# OMORI under PMJS (github.com/bbbreaddd/pmjs) - test launcher adapted from PMJS's PortMaster template.
# Runtime: /root/pmjs-test, game: the decrypted copy in ports/omori-test, logs/saves/cache: ports/omori-pmjs.
XDG_DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}
if [ -d "/opt/system/Tools/PortMaster/" ]; then
  controlfolder="/opt/system/Tools/PortMaster"
elif [ -d "/opt/tools/PortMaster/" ]; then
  controlfolder="/opt/tools/PortMaster"
elif [ -d "$XDG_DATA_HOME/PortMaster/" ]; then
  controlfolder="$XDG_DATA_HOME/PortMaster"
else
  controlfolder="/roms/ports/PortMaster"
fi
source "$controlfolder/control.txt" || exit $?
[ ! -f "$controlfolder/mod_${CFW_NAME}.txt" ] || source "$controlfolder/mod_${CFW_NAME}.txt" || exit $?
get_controls || exit 1

GAMEDIR="/${directory#/}/ports/${PMJS_GAMEDIR_NAME:-omori-pmjs3}"
RUNTIME=${PMJS_RUNTIME:-/root/pmjs-test3/pmjs-linux-arm64}
GAME=${PMJS_GAME:-"/${directory#/}/ports/omori-test/www"}
BINARY=node
mkdir -p "$GAMEDIR/saves" "$GAMEDIR/.cache"
cd "$GAMEDIR" || exit 1
exec > "$GAMEDIR/log.txt" 2>&1 || exit 1
export SDL_GAMECONTROLLERCONFIG="${SDL_GAMECONTROLLERCONFIG:-${sdl_controllerconfig:-}}"
export PMJS_EXIT_HOTKEY=${PMJS_EXIT_HOTKEY-none}
[ -f "$GAMEDIR/omori.ini" ] || printf '[controls]\n' > "$GAMEDIR/omori.ini"

(while true; do echo "[mem] $(date +%T) $(free -m | awk 'NR==2{print "used " $3 " MB, available " $7 " MB"}') cpu $(( $(cat /sys/class/thermal/thermal_zone0/temp) / 1000 ))C"; sleep 10; done) &
MEMLOG=$!
# Watchdog: 1 GB devices have no swap; kill PMJS before an out-of-memory freeze.
# Floor 60 MB: menu-heavy play plateaus at 78-121 MB MemAvailable on this 1 GB device; a
# 100 MB floor killed a healthy session at 95 MB (2026-10-25). PMJS_WATCHDOG_MB raises it for
# experiments that prepare a new cache.
(while sleep 2; do
  avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  if [ "$avail" -lt "${PMJS_WATCHDOG_MB:-60}" ]; then echo "[watchdog] $(date +%T) only ${avail} MB available, killing PMJS"; pkill -9 -f "$RUNTIME/bin/node"; fi
done) &
WATCHDOG=$!
# Cap the JS heap so a runaway heap fails inside Node instead of starving the device.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=480}"

$GPTOKEYB2 "$BINARY" -c "$GAMEDIR/omori.ini" &
# muOS's helper returns 1 when /opt/muos/config/system/foreground_process is absent, so ignore its status.
pm_platform_helper "$RUNTIME/bin/$BINARY" || true
PATCHES=""
# OMORI sprite-update culling (OmoriSource launcher/omori-performance.js); PMJS_PERF=0 disables it.
[ "${PMJS_PERF:-1}" = 0 ] || { [ -f "$GAMEDIR/omori-performance.js" ] && PATCHES="--patch $GAMEDIR/omori-performance.js"; }
# Game-side fast paths (OmoriSource launcher/perf/*.js); on in this test build, PMJS_PERF_EXTRA=0 disables them.
if [ "${PMJS_PERF_EXTRA:-1}" = 1 ]; then
  for module in "$GAMEDIR"/perf/*.js; do [ -f "$module" ] && PATCHES="$PATCHES --patch $module"; done
fi
# Per-phase fps log in $GAMEDIR/fps/ (OmoriSource launcher/omori-fps-log.js); PMJS_FPS=0 disables it.
[ "${PMJS_FPS:-1}" = 0 ] || { [ -f "$GAMEDIR/omori-fps-log.js" ] && export OMORI_FPS_DIR="$GAMEDIR/fps" && PATCHES="$PATCHES --patch $GAMEDIR/omori-fps-log.js"; }
# The benchmark starts a new game in White Space by itself, so it only loads on request.
[ "${PMJS_BENCH:-0}" = 1 ] && [ -f "$GAMEDIR/pmjs-bench.js" ] && PATCHES="$PATCHES --patch $GAMEDIR/pmjs-bench.js"
# Extra test patch (profiling experiments); never part of the port itself.
[ -n "${PMJS_EXTRA_PATCH:-}" ] && PATCHES="$PATCHES --patch $PMJS_EXTRA_PATCH"
CONFIG=""
[ -z "${PMJS_CONFIG:-}" ] && [ -f "$GAMEDIR/config.json" ] && PMJS_CONFIG="$GAMEDIR/config.json"
[ -n "${PMJS_CONFIG:-}" ] && CONFIG="--config $PMJS_CONFIG"
(
  # Keep muOS's SDL_BLITTER_DISABLED=1: with the menu exited (a real menu launch) frames are
  # correct and it is ~6% faster than the Mali blitter thread. PMJS_BLITTER=on re-enables it.
  [ "${PMJS_BLITTER:-firmware}" != on ] || [ "${SDL_BLITTER_DISABLED:-}" != 1 ] || unset SDL_BLITTER_DISABLED
  echo "[launcher] runtime=$RUNTIME gamedir=$GAMEDIR SDL_BLITTER_DISABLED=${SDL_BLITTER_DISABLED:-unset} patches=$PATCHES"
  XDG_CACHE_HOME="$GAMEDIR/.cache" ${PMJS_TIMEOUT:+timeout $PMJS_TIMEOUT} "$RUNTIME/bin/pmjs" "$GAME" \
    --save-root "$GAMEDIR/saves" --asset-cache-root "$GAMEDIR/.cache" $PATCHES $CONFIG
)
status=$?
kill $MEMLOG $WATCHDOG
pm_finish || { [ "$status" -ne 0 ] || status=1; }
exit "$status"
