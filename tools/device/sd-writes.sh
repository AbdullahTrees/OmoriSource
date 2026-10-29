#!/bin/sh
# On the device: MB read and written on the SD card's game partition (mmcblk0p6) while a command runs.
# sh sd-writes.sh <command...>   (e.g. sh /mnt/mmc/ports/omori-pmjs2/omori-test.sh startup)
# /proc/diskstats fields after the name: reads, merged, sectors read, ms, writes, merged, sectors written.
sectors() { awk '$3 == "mmcblk0p6" { print $6, $10 }' /proc/diskstats; }
sync

before=$(sectors)
"$@"
sync
after=$(sectors)
echo "$before $after" | awk '{ printf "[sd] read %.1f MB, written %.1f MB\n", ($3 - $1) * 512 / 1048576, ($4 - $2) * 512 / 1048576 }'
