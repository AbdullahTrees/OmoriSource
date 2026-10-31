#!/bin/sh
for f in /opt/system/Tools/PortMaster/control.txt /opt/tools/PortMaster/control.txt /root/.local/share/PortMaster/control.txt /roms/ports/PortMaster/control.txt; do
 if [ -f "$f" ]; then grep -n 'pm_platform_helper\|governor\|performance' "$f" | head -25; fi
done
for f in /sys/devices/system/cpu/cpufreq/policy0/scaling_governor /sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq /sys/devices/system/cpu/cpufreq/policy0/scaling_min_freq /sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq; do echo "$f";cat "$f";done
