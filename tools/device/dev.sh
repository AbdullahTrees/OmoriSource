#!/bin/bash
# Run a command on the muOS device. Credentials stay in ignored .local/device-auth/.
set -e
S="$(cd "$(dirname "$0")" && pwd)"
AUTH="${OMORI_DEVICE_AUTH_DIR:-$S/../../.local/device-auth}"
ASKPASS="${OMORI_SSH_ASKPASS:-$AUTH/askpass.cmd}"
if [ ! -f "$ASKPASS" ]; then
  printf 'Missing SSH askpass helper: set OMORI_SSH_ASKPASS or populate .local/device-auth/.\n' >&2
  exit 2
fi
SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force DISPLAY=:0 \
  ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$AUTH/known_hosts" -o ConnectTimeout=8 "root@${OMORI_DEVICE_HOST:-192.168.68.103}" "$@"
