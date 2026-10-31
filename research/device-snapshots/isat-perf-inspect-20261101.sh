#!/bin/sh
set -eu
R=/root/pmjs-retained/pmjs-arm64
ls -l "$R/bin/node" "$R/lib/pmjs_native.node" "$R/build-info.json"
cat "$R/build-info.json"
sha256sum "$R/share/pmjs/js/pmjs-pixi4/scene-retained.js" "$R/share/pmjs/runner/frame-stats.cjs"
ls "$R/share/pmjs/patches/isat" 2>/dev/null || true
cat /sys/class/thermal/thermal_zone0/temp
