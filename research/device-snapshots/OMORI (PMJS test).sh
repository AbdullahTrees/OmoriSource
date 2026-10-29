#!/bin/bash
# User launcher for the OMORI test install.
# Game data: /mnt/mmc/ports/omori-test/www (decrypted Steam 1.0.8 output)
# Port data: /mnt/mmc/ports/omori-upstream-test
# Default runtime: /root/pmjs-old/pmjs-linux-arm64 (v0.7.2 baseline, prepared cache).
# Create /mnt/mmc/ports/omori-upstream-test/use-upstream after the upstream runtime is ready
# to switch to /root/pmjs-upstream/pmjs-linux-arm64 and its .cache-new.

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P) || SCRIPT_DIR=$(dirname -- "$0")
EARLY_LOG="$SCRIPT_DIR/OMORI-PMJS-test-launch.log"
if ! ( : >> "$EARLY_LOG" ) 2>/dev/null; then
  EARLY_LOG="/tmp/OMORI-PMJS-test-launch.log"
fi
if ( : >> "$EARLY_LOG" ) 2>/dev/null; then exec >> "$EARLY_LOG" 2>&1; fi

echo "[launcher] start script=$0"

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

if [ -f "$controlfolder/control.txt" ]; then
  . "$controlfolder/control.txt"
  echo "[launcher] control=$controlfolder/control.txt"
else
  echo "[launcher] PortMaster control.txt not found at $controlfolder/control.txt"
  controlfolder=""
fi
if [ -n "$controlfolder" ] && [ -f "${controlfolder}/mod_${CFW_NAME:-}.txt" ]; then
  . "${controlfolder}/mod_${CFW_NAME:-}.txt"
fi
if command -v get_controls >/dev/null 2>&1; then
  get_controls
else
  echo "[launcher] get_controls unavailable"
fi

command -v pm_show_error >/dev/null 2>&1 || pm_show_error() { echo "[launcher] $*" >&2; }
command -v pm_message >/dev/null 2>&1 || pm_message() { echo "[launcher] message: $*" >&2; }
command -v pm_platform_helper >/dev/null 2>&1 || pm_platform_helper() { echo "[launcher] no platform helper for $*" >&2; }
command -v pm_finish >/dev/null 2>&1 || pm_finish() { :; }

GAMEDIR=/mnt/mmc/ports/omori-upstream-test
GAME=${PMJS_GAME:-/mnt/mmc/ports/omori-test/www}
if [ -n "${PMJS_RUNTIME:-}" ]; then
  RUNTIME=$PMJS_RUNTIME
elif [ -f "$GAMEDIR/use-upstream" ] && [ -x /root/pmjs-upstream/pmjs-linux-arm64/bin/pmjs ]; then
  RUNTIME=/root/pmjs-upstream/pmjs-linux-arm64
else
  RUNTIME=/root/pmjs-old/pmjs-linux-arm64
fi
if [ -n "${PMJS_CACHE:-}" ]; then
  CACHE=$PMJS_CACHE
elif [ "$RUNTIME" = /root/pmjs-upstream/pmjs-linux-arm64 ]; then
  CACHE=$GAMEDIR/.cache-new
else
  CACHE=$GAMEDIR/.cache-old
fi
# PMJS_SAVE_ROOT: run against a copy of the saves (harness load mode); the live saves stay untouched.
SAVE_ROOT=${PMJS_SAVE_ROOT:-$GAMEDIR/saves}
BINARY=node

if [ ! -d "$GAMEDIR" ]; then
  echo "[launcher] missing test port $GAMEDIR"
  pm_show_error "Missing $GAMEDIR" --title "OMORI test" --type error
  exit 1
fi
cd "$GAMEDIR" || exit 1

[ -x "$RUNTIME/bin/pmjs" ] || chmod +x "$RUNTIME/bin/pmjs" 2>/dev/null || true
[ -x "$RUNTIME/bin/node" ] || chmod +x "$RUNTIME/bin/node" 2>/dev/null || true
if [ ! -f "$RUNTIME/bin/pmjs" ] || [ ! -f "$RUNTIME/bin/node" ]; then
  echo "[launcher] missing runtime at $RUNTIME"
  pm_show_error "Missing runtime at $RUNTIME" --title "OMORI test" --type error
  exit 1
fi
if [ ! -f "$GAME/index.html" ]; then
  echo "[launcher] missing game at $GAME"
  pm_show_error "Missing game at $GAME" --title "OMORI test" --type error
  exit 1
fi

LOG="$GAMEDIR/log.txt"
[ -f "$LOG" ] && mv -f "$LOG" "$LOG.prev" 2>/dev/null
cp "$EARLY_LOG" "$LOG" 2>/dev/null || true
if command -v tee >/dev/null 2>&1; then
  exec > >(tee -a "$LOG") 2>&1
else
  exec >> "$LOG" 2>&1
fi
echo "[launcher] version=test runtime=$RUNTIME game=$GAME cache=$CACHE saves=$SAVE_ROOT"
echo "[launcher] script_dir=$SCRIPT_DIR controlfolder=${controlfolder:-<none>} directory=${directory:-<unset>} log=$LOG"

export LD_LIBRARY_PATH="$RUNTIME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export SDL_GAMECONTROLLERCONFIG="${sdl_controllerconfig:-}"
export PMJS_EXIT_HOTKEY=none
export XDG_CACHE_HOME="$CACHE"
export PMJS_GRAPHICS_DIAGNOSTICS="${PMJS_GRAPHICS_DIAGNOSTICS:-1}"
mkdir -p "$SAVE_ROOT" "$CACHE" "$GAMEDIR/fps" 2>/dev/null || true

PATCHES=()
if [ "${PMJS_PERF:-1}" != 0 ]; then
  [ -f "$GAMEDIR/omori-performance.js" ] && PATCHES+=(--patch "$GAMEDIR/omori-performance.js")
  [ -f "$GAMEDIR/patches/character-frames.js" ] && PATCHES+=(--patch "$GAMEDIR/patches/character-frames.js")
fi
if [ "${PMJS_PERF_EXTRA:-1}" = 1 ]; then
  for module in "$GAMEDIR"/perf/*.js; do
    [ -f "$module" ] && PATCHES+=(--patch "$module")
  done
fi
if [ "${PMJS_FPS:-1}" != 0 ]; then
  export OMORI_FPS_DIR="$GAMEDIR/fps"
  [ -f "$GAMEDIR/patches/omori-fps-log.js" ] && PATCHES+=(--patch "$GAMEDIR/patches/omori-fps-log.js")
fi
# Extra test patch (the harness driver); never part of the port itself.
[ -n "${PMJS_EXTRA_PATCH:-}" ] && PATCHES+=(--patch "$PMJS_EXTRA_PATCH")
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=480}"

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

if [ -n "${GPTOKEYB2:-}" ]; then
  "$GPTOKEYB2" "$BINARY" > /dev/null 2>&1 &
else
  echo "[launcher] GPTOKEYB2 unavailable"
fi
pm_platform_helper "$RUNTIME/bin/$BINARY"

${PMJS_TIMEOUT:+timeout $PMJS_TIMEOUT} "$RUNTIME/bin/pmjs" "$GAME" --save-root "$SAVE_ROOT" --asset-cache-root "$CACHE" "${PATCHES[@]}" --config "$GAMEDIR/config.json"
status=$?
kill $MEMLOG $WATCHDOG 2>/dev/null

pm_finish
exit $status
