#!/bin/sh
set -eu
ROOT=/mnt/mmc/ports/lookoutside-test
B=$ROOT/harness
[ -z "$(pidof node 2>/dev/null || true)" ] || { echo 'Refusing: game active';exit 2; }
for name in seed baseline profile; do
 D=$B/results/$name
 [ "$(cat "$D/exit.txt")" = 0 ]
 grep -q '"type":"complete"' "$D/results.jsonl"
 if grep -E ' ERROR |event error:|[0-9]+ FAILED' "$D/session.log" >/dev/null;then echo 'Invalid run';exit 1;fi
done
grep -q '^title_seen=1$' "$B/normal-title-receipt.txt"
bash -n "$ROOT/menu-launcher.sh"
MENU='/mnt/mmc/ROMS/Ports/Look Outside (PMJS test).sh'
if [ -e "$MENU" ];then cmp -s "$MENU" "$ROOT/menu-launcher.sh" || { echo 'Shortcut differs from tested launcher';exit 2; };
else cp "$ROOT/menu-launcher.sh" "$MENU";fi
chmod +x "$MENU"
env LD_LIBRARY_PATH="$ROOT/runtime/lib" "$ROOT/runtime/bin/node" "$B/export-results.cjs" "$B"
cp "$ROOT/input-audit.json" "$B/input-audit.json"
cp "$ROOT/game-parity.log" "$B/game-parity.log"
{
 date
 echo 'Node processes (must be empty):';pidof node || true
 echo 'Frontends:';ps | grep -E 'muxplore|frontend.sh' | grep -v grep || true
 free -m;df -k /mnt/mmc
 echo 'Game-file parity:';grep -c ': OK$' "$ROOT/game-parity.log"
 echo 'Runtime and launcher hashes:'
 sha256sum "$ROOT/runtime/bin/node" "$ROOT/runtime/lib/pmjs_native.node" "$ROOT/runtime/build-info.json" "$ROOT/pmjs.json" "$MENU"
 echo 'Harness hashes:'
 sha256sum "$B/run-device.sh" "$B/bundle/pmjs.json" "$B/bundle/patches/game-metrics.js" "$B/bundle/patches/benchmark.js"
 sha256sum "$B/normal-launch-check.sh" "$B/retained-ab.sh" "$B/export-results.cjs" "$B/export-device.sh"
 echo 'Single game-data/runtime directories:';ls -d "$ROOT/gamedata" "$ROOT/runtime"
} > "$B/device-receipt.txt"
sync
echo '[lookoutside] ready; one normal-play shortcut installed'
