#!/bin/bash
# Convert the Steam copy of OMORI with meetox80's builder (Wii profile = 640x480).
E=/home/abdullah/omori-test/ext
SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
R="${MEETOX_REPO:-$SOURCE_ROOT/.local/references/meetox-omori}"
B=$R/build/builder/omori-builder-x86_64-linux-musl
GAME="/mnt/d/Large Games/Steam/steamapps/common/OMORI"
cd $E || exit 1
grep -n -E '"--[a-z]+"|strcmp\(a, "-' "$R/tools/builder/src/main.c" | cut -c1-140 | head -12
echo "=== run"
start=$(date +%s)
"$B" "$GAME" -o $E/out-wii --target wii ${KEY:+--key "$KEY"} 2>&1 | tail -15
echo "exit=$? seconds=$(( $(date +%s) - start ))"
du -sh $E/out-wii 2>/dev/null; ls $E/out-wii 2>/dev/null | head
