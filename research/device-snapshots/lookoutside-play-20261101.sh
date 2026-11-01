#!/bin/bash

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

GAMEDIR="/${directory#/}/ports/lookoutside-test"
BINARY=node
cd "$GAMEDIR" || exit 1
GAMEDIR=$(pwd -P)
PMJS_ROOT="$GAMEDIR/runtime"
> "$GAMEDIR/log.txt" && exec > >(tee "$GAMEDIR/log.txt") 2>&1 || exit 1
echo '[pmjs-port] launcher started'
export SDL_GAMECONTROLLERCONFIG="${SDL_GAMECONTROLLERCONFIG:-${sdl_controllerconfig:-}}"
export PMJS_EXIT_HOTKEY=${PMJS_EXIT_HOTKEY-none}

[ -n "$GPTOKEYB2" ] || { echo 'PortMaster gptokeyb2 is required' >&2; exit 1; }
$GPTOKEYB2 "$BINARY" > /dev/null 2>&1 &
pm_platform_helper "$GAMEDIR/runtime/bin/$BINARY"
platform_status=$?
if [ "$platform_status" -ne 0 ]; then
  echo "[pmjs-port] PortMaster platform helper returned $platform_status; continuing"
fi

export SDL_BLITTER_DISABLED=1
echo '[pmjs-port] starting runtime'
XDG_CACHE_HOME="$GAMEDIR/.cache" \
LD_LIBRARY_PATH="$PMJS_ROOT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$GAMEDIR/runtime/bin/$BINARY" "$PMJS_ROOT/share/pmjs/tools/pmjs.mjs" "$PMJS_ROOT" "$GAMEDIR" \
  --save-root "$GAMEDIR/saves" --asset-cache-root "$GAMEDIR/.cache/assets"
status=$?
echo "[pmjs-port] runtime exited status=$status"
pm_finish || { [ "$status" -ne 0 ] || status=1; }
exit "$status"
