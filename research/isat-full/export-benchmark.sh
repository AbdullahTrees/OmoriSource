#!/bin/sh
# Run only after measurement. Stream non-game evidence to stdout as gzip tar.
set -eu
B=/mnt/mmc/ports/isat-perf
[ -z "$(pidof node 2>/dev/null || true)" ] || { echo 'Game active' >&2; exit 2; }
env LD_LIBRARY_PATH="$B/runtime/lib" "$B/runtime/bin/node" "$B/export-benchmark.cjs" "$B"
{
 date
 echo 'Node processes (must be empty):'; pidof node || true
 echo 'Frontend processes:'; ps | grep -E 'muxplore|frontend.sh' | grep -v grep || true
 free -m
 echo 'CPU governor:'; cat /sys/devices/system/cpu/cpufreq/policy0/scaling_governor
 echo 'Temperature:'; cat /sys/class/thermal/thermal_zone0/temp
 echo 'Normal launcher SHA:'; sha256sum '/mnt/mmc/ROMS/Ports/In Stars and Time (PMJS test).sh'
 echo 'Restored performance encoder SHA:'
 sha256sum "$B/scene-retained.performance.js" "$B/runtime/share/pmjs/js/pmjs-pixi4/scene-retained.js"
 echo 'Harness SHA:'
 sha256sum "$B/benchmark.js" "$B/retained-ab.sh" "$B/export-benchmark.cjs" "$B/export-benchmark.sh"
} > "$B/device-receipt.txt"
cd "$B"
{
 find results -type f ! -path '*/saves/*'
 find module-maps -type f
 printf '%s\n' overlay-manifest.json native-sha256.txt benchmark-sha256.txt device-receipt.txt
} > evidence-files.txt
tar -cf - -T evidence-files.txt | gzip -c
