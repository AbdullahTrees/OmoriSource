#!/bin/bash
G=/mnt/mmc/ports/omori-upstream-test
RUNTIME=${PMJS_RUNTIME:-/root/pmjs-upstream/pmjs-linux-arm64}
GAME=${PMJS_GAME:-/mnt/mmc/ports/omori-test/www}
CACHE=${PMJS_CACHE:-$G/.cache-new}
BINARY=node
cd "$G" || exit 1
LOG="$G/log.txt"
> "$LOG" 2>/dev/null || true
if command -v tee >/dev/null 2>&1; then exec > >(tee -a "$LOG") 2>&1; else exec >> "$LOG" 2>&1; fi
echo "[launcher] test runtime=$RUNTIME game=$GAME cache=$CACHE"
[ -x "$RUNTIME/bin/pmjs" ] || chmod +x "$RUNTIME/bin/pmjs" 2>/dev/null || true
[ -x "$RUNTIME/bin/node" ] || chmod +x "$RUNTIME/bin/node" 2>/dev/null || true
export LD_LIBRARY_PATH="$RUNTIME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export SDL_GAMECONTROLLERCONFIG="${sdl_controllerconfig:-}"
export PMJS_EXIT_HOTKEY=none
export XDG_CACHE_HOME="$CACHE"
mkdir -p "$G/saves" "$CACHE" "$G/fps"
export OMORI_FPS_DIR="$G/fps"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=480}"
PATCHES=()
PATCHES+=(--patch "$G/omori-performance.js" --patch "$G/patches/character-frames.js" --patch "$G/patches/omori-fps-log.js")
for module in "$G"/perf/*.js; do [ -f "$module" ] && PATCHES+=(--patch "$module"); done
[ -n "${PMJS_EXTRA_PATCH:-}" ] && PATCHES+=(--patch "$PMJS_EXTRA_PATCH")
"$RUNTIME/bin/pmjs" "$GAME" --save-root "$G/saves" --asset-cache-root "$CACHE" "${PATCHES[@]}" --config "$G/config.json"
