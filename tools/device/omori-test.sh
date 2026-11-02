#!/bin/bash
# Run an OMORI device test from the PC: tools/omori-test.sh <mode> [options] (modes and options: research/pmjs-performance/omori-test.sh)
# Uploads the current test driver, runner and sprite patch from OmoriSource, then runs
# research/pmjs-performance/omori-test.sh on the device with the same arguments (see that file).
# Examples:
#   tools/omori-test.sh startup
#   tools/omori-test.sh perf --variant base --variant nocull:PMJS_DISABLE_OPT=scene.viewport-cull
#   tools/omori-test.sh room --room 111:15:25 --walk --shots
#   tools/omori-test.sh battle --battles bunny,sweetheart,something --breakdown
set -e
S="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$S/../.." && pwd)"
DEV="$S/dev.sh"
# The install the Ports launcher runs (its GAMEDIR); OMORI_TEST_GAMEDIR overrides for
# the legacy omori-pmjs2/omori-pmjs3 installs. The driver must run from the same
# install or the results copy reads a stale log.txt.
G=${OMORI_TEST_GAMEDIR:-/mnt/mmc/ports/omori-upstream-test}
"$DEV" "cat > $G/omori-test.js" < "$SRC/research/pmjs-performance/omori-test.js"
"$DEV" "cat > $G/omori-test.sh" < "$SRC/research/pmjs-performance/omori-test.sh"
"$DEV" "cat > $G/omori-performance.js" < "$SRC/launcher/omori-performance.js"
args=""
for a in "$@"; do args="$args '$a'"; done
# Forward runtime selection to the device-side runner and (through its env) the launcher.
remote_env="OMORI_TEST_GAMEDIR=$G"
for v in PMJS_RUNTIME PMJS_CACHE PMJS_RETAINED_STATS PMJS_RETAINED_VERIFY PMJS_WATCHDOG_MB; do
  eval "value=\${$v:-}"
  [ -n "$value" ] && remote_env="$remote_env $v=$value"
done
exec "$DEV" -o ConnectTimeout=20 -o ServerAliveInterval=30 "$remote_env sh $G/omori-test.sh $args"
