#!/bin/sh
set -eu
ROOT=/mnt/mmc/ports/lookoutside-test
B=$ROOT/harness
[ -z "$(pidof node 2>/dev/null || true)" ] || { echo 'Game active' >&2;exit 2; }
cd "$B"
{
 find results -type f ! -path '*/saves/*'
 find module-maps -type f
 printf '%s\n' device-receipt.txt input-audit.json game-parity.log normal-wrapper.log normal-game.log normal-title-receipt.txt normal-title.fb retained-ab-result.json retained-ab-exit.txt retained-source-audit.json
} > evidence-files.txt
# No game saves or assets exported.
tar -cf - -T evidence-files.txt | gzip -c
