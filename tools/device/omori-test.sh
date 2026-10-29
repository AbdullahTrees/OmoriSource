#!/bin/bash
# Run an OMORI device test from the PC: tools/omori-test.sh <startup|perf|room|verify> [options]
# Uploads the current test driver, runner and sprite patch from OmoriSource, then runs
# research/pmjs-performance/omori-test.sh on the device with the same arguments (see that file).
# Examples:
#   tools/omori-test.sh startup
#   tools/omori-test.sh perf --variant base --variant nocull:PMJS_DISABLE_OPT=scene.viewport-cull
#   tools/omori-test.sh room --room 111:15:25 --walk --shots
set -e
S="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$S/../.." && pwd)"
DEV="$S/dev.sh"
G=/mnt/mmc/ports/omori-pmjs2
"$DEV" "cat > $G/omori-test.js" < "$SRC/research/pmjs-performance/omori-test.js"
"$DEV" "cat > $G/omori-test.sh" < "$SRC/research/pmjs-performance/omori-test.sh"
"$DEV" "cat > $G/omori-performance.js" < "$SRC/launcher/omori-performance.js"
args=""
for a in "$@"; do args="$args '$a'"; done
exec "$DEV" -o ConnectTimeout=20 -o ServerAliveInterval=30 "sh $G/omori-test.sh $args"
