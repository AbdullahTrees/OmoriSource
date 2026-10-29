#!/bin/bash
# tools/omori-test.sh against the integration runtime (/root/pmjs-test3) and its own game folder
# (omori-pmjs3, separate cache): same modes and options. The menu shortcut keeps using pmjs-test2.
set -e
S="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$S/../.." && pwd)"
DEV="$S/dev.sh"
G=/mnt/mmc/ports/omori-pmjs2
"$DEV" "cat > $G/omori-test.js" < "$SRC/research/pmjs-performance/omori-test.js"
"$DEV" "cat > $G/omori-test.sh" < "$SRC/research/pmjs-performance/omori-test.sh"
"$DEV" "cat > /mnt/mmc/ports/omori-pmjs3/omori-performance.js" < "$SRC/launcher/omori-performance.js"
mode=$1; shift
args=""
for a in "$@"; do args="$args '$a'"; done
exec "$DEV" -o ConnectTimeout=20 -o ServerAliveInterval=30 \
  "OMORI_TEST_GAMEDIR=/mnt/mmc/ports/omori-pmjs3 PMJS_GAMEDIR_NAME=omori-pmjs3 PMJS_RUNTIME=/root/pmjs-test3/pmjs-linux-arm64 sh $G/omori-test.sh $mode $args"
