#!/bin/bash
# usage: run.sh <nw app dir> [seconds]   -- run NW.js under PortMaster's westonpack
controlfolder=/mnt/mmc/MUOS/PortMaster
source $controlfolder/control.txt
[ -f "${controlfolder}/mod_${CFW_NAME}.txt" ] && source "${controlfolder}/mod_${CFW_NAME}.txt"
get_controls
weston_dir=/tmp/weston
mkdir -p $weston_dir /tmp/mesa
mountpoint -q $weston_dir || mount -o loop,ro $controlfolder/libs/weston_pkg_0.2.squashfs $weston_dir
mountpoint -q /tmp/mesa || mount -o loop,ro $controlfolder/libs/mesa_pkg_0.1.squashfs /tmp/mesa
timeout ${2:-60} $weston_dir/westonwrap.sh ${WMODE:-headless noop kiosk crusty_x11egl} ${NWRUN:-/root/omori-test/nwrun.sh} "$1"
$weston_dir/westonwrap.sh cleanup
