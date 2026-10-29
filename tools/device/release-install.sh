#!/bin/bash
# Install a built release over the playtest build, in place.
#   tools/release-install.sh [release.zip] [--version VERSION]
# Default zip: the sibling portmaster-builder/omori-pmjs release repository's output.
# Override OMORI_RELEASE_REPO when using a different workspace layout.
# Keeps one previous runtime (/root/pmjs-test2/pmjs-linux-arm64.prev), backs up the
# game-side patches and the launcher inside the game folder, and preserves
# www/, saves/, .cache/, gamedata/ and config.json.
set -euo pipefail
S="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$S/../.." && pwd)"
RELEASE_REPO="${OMORI_RELEASE_REPO:-$ROOT/../../portmaster-builder/omori-pmjs}"
ZIP="${1:-$RELEASE_REPO/share/out/OMORI-PMJS.zip}"
VERSION=""
if [ "${2:-}" = "--version" ]; then VERSION="${3:-}"; fi
[ -f "$ZIP" ] || { echo "missing release zip: $ZIP" >&2; exit 2; }
if [ -z "$VERSION" ]; then
  VERSION=$(python - "$ZIP" <<'PY'
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as bundle:
    manifest = 'omori-pmjs/manifest.json' if 'omori-pmjs/manifest.json' in bundle.namelist() else 'manifest.json'
    print(json.loads(bundle.read(manifest))['version'])
PY
)
fi
echo "release $VERSION from $ZIP"
DEV="$S/dev.sh"
GD=/mnt/mmc/ports/omori-pmjs2
RT=/root/pmjs-test2/pmjs-linux-arm64
L="/mnt/mmc/ROMS/Ports/OMORI (PMJS test).sh"

# Preflight: the game must not be running; the device needs room for the extract.
"$DEV" "pidof node >/dev/null 2>&1 && { echo 'a game is running; install aborted' >&2; exit 1; }; command -v unzip >/dev/null || { echo no-unzip >&2; exit 1; }; df -h /root | tail -1"

# Upload and extract on the device.
"$DEV" 'rm -rf /root/omori-release /root/omori-release.zip'
cat "$ZIP" | "$DEV" 'cat > /root/omori-release.zip'
"$DEV" 'mkdir -p /root/omori-release && cd /root/omori-release && unzip -q /root/omori-release.zip && test -x omori-pmjs/runtime/bin/node'

# Install on the device: runtime swap (one backup), patches, version marker, launcher default.
"$DEV" "sh -s '$VERSION' '$GD' '$RT' '$L'" <<'REMOTE'
set -e
VERSION=$1; GD=$2; RT=$3; L=$4
ST=/root/omori-release
rm -rf "$RT.prev"
mv "$RT" "$RT.prev"
mv "$ST/omori-pmjs/runtime" "$RT"
mkdir -p "$GD/backup-$VERSION"
for f in omori-performance.js omori-fps-log.js VERSION RELEASE-manifest.json; do
  [ -f "$GD/$f" ] && cp -a "$GD/$f" "$GD/backup-$VERSION/" || true
done
[ -d "$GD/perf" ] && cp -a "$GD/perf" "$GD/backup-$VERSION/perf" || true
cp -a "$ST/omori-pmjs/patches/." "$GD/"
mkdir -p "$GD/perf"
cp -a "$ST/omori-pmjs/perf/." "$GD/perf/"
cp "$ST/omori-pmjs/VERSION" "$GD/VERSION"
cp "$ST/omori-pmjs/manifest.json" "$GD/RELEASE-manifest.json"
cp -a "$L" "$GD/launcher.before-$VERSION.sh"
sed -i 's/PMJS_PERF_EXTRA:-0/PMJS_PERF_EXTRA:-1/' "$L"
echo "installed $VERSION"
"$RT/bin/node" --version
grep -n 'PMJS_PERF_EXTRA' "$L"
REMOTE
