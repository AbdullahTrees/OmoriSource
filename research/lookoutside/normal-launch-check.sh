#!/bin/sh
# Exercise the actual normal PortMaster wrapper, then deliberately stop at title.
set -eu
ROOT=/mnt/mmc/ports/lookoutside-test
B=$ROOT/harness
[ -z "$(pidof node 2>/dev/null || true)" ] || { echo 'Game active';exit 2; }
STOPPED=''
MENU='/mnt/mmc/ROMS/Ports/Look Outside (PMJS test).sh'
NEW_ENTRY=0
SUCCESS=0
for name in muxplore frontend.sh; do
 for pid in $(pidof "$name" 2>/dev/null || true); do STOPPED="$STOPPED $pid";done
done
stop_owned_nodes() {
 for pid in $(pidof node 2>/dev/null || true); do
  if [ "$(readlink -f /proc/$pid/exe)" = "$ROOT/runtime/bin/node" ];then kill -"$1" "$pid" 2>/dev/null || true;fi
 done
}
finish() {
 stop_owned_nodes TERM
 for pid in $STOPPED;do kill -CONT "$pid" 2>/dev/null || true;done
 dd if=/dev/zero of=/dev/fb0 bs=1228800 count=2 2>/dev/null || true
 if [ "$NEW_ENTRY" = 1 ] && [ "$SUCCESS" = 0 ];then rm -f "$MENU";fi
}
trap finish EXIT
trap 'exit 130' INT TERM
for pid in $STOPPED;do kill -STOP "$pid" 2>/dev/null || true;done
export SDL_BLITTER_DISABLED=1
if [ -e "$MENU" ];then cmp -s "$MENU" "$ROOT/menu-launcher.sh" || exit 2;
else cp "$ROOT/menu-launcher.sh" "$MENU";chmod +x "$MENU";NEW_ENTRY=1;fi
: > "$ROOT/log.txt"
sync
bash "$MENU" > "$B/normal-wrapper.log" 2>&1 &
LAUNCHER=$!
seen=0
for tick in $(seq 1 150);do
 if grep -q '"scene":"Scene_Title"' "$ROOT/log.txt" 2>/dev/null;then seen=1;break;fi
 kill -0 "$LAUNCHER" 2>/dev/null || break
 sleep 1
done
if [ "$seen" = 1 ];then
 dd if=/dev/fb0 of="$B/normal-title.fb" bs=1228800 count=2 2>/dev/null || true
fi
stop_owned_nodes TERM
sleep 2
stop_owned_nodes KILL
set +e
wait "$LAUNCHER"
status=$?
set -e
cp "$ROOT/log.txt" "$B/normal-game.log" 2>/dev/null || true
printf 'title_seen=%s\nintentional_stop_exit=%s\n' "$seen" "$status" > "$B/normal-title-receipt.txt"
[ "$seen" = 1 ] || { tail -15 "$B/normal-wrapper.log";exit 1; }
if grep -E ' ERROR |event error:|[0-9]+ FAILED' "$B/normal-game.log" >/dev/null;then echo 'Normal launch logged errors';exit 1;fi
SUCCESS=1
echo '[lookoutside] normal PortMaster wrapper reached title; deliberately stopped'
