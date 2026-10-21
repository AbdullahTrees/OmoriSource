#!/bin/bash
# OMORI test port from OmoriSource: NW.js 0.60 (arm64) under PortMaster's westonpack.
# Runtime + bundled libraries live in /root/omori-test (ext4, needs symlinks).

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
source $controlfolder/control.txt
source $controlfolder/device_info.txt
[ -f "${controlfolder}/mod_${CFW_NAME}.txt" ] && source "${controlfolder}/mod_${CFW_NAME}.txt"
get_controls

GAMEDIR=/$directory/ports/omori-test
RUNTIME=/root/omori-test
exec > >(tee "$GAMEDIR/log.txt") 2>&1
cd $GAMEDIR

weston_dir=/tmp/weston
$ESUDO mkdir -p $weston_dir /tmp/mesa
mountpoint -q $weston_dir || $ESUDO mount -o loop,ro $controlfolder/libs/weston_pkg_0.2.squashfs $weston_dir
mountpoint -q /tmp/mesa || $ESUDO mount -o loop,ro $controlfolder/libs/mesa_pkg_0.1.squashfs /tmp/mesa

free -m
(while true; do echo "[mem] $(date +%T) $(free -m | awk 'NR==2{print "used " $3 " MB, available " $7 " MB"}')"; sleep 10; done) &
MEMLOG=$!
$GPTOKEYB "nw" -c "$GAMEDIR/omori.gptk" &
# Weston composites on the Mali GPU; Chromium renders in software (WebGL via SwiftShader):
# its GPU process crashes on this Mali/westonpack stack.
export NW_GL=--disable-gpu
$ESUDO $weston_dir/westonwrap.sh drm gl kiosk llvmpipe $RUNTIME/nwrun.sh $GAMEDIR
$ESUDO $weston_dir/westonwrap.sh cleanup

kill $MEMLOG
$ESUDO kill -9 $(pidof gptokeyb)
printf "\033c" > /dev/tty0
