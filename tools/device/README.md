# Device development tools

These maintained host helpers belong to OmoriSource. They were moved out of the temporary
handover directory on 2026-10-29. Run shell helpers with Git Bash (Windows) or Bash (Linux).

- `dev.sh '<command>'`: SSH access; `OMORI_DEVICE_HOST` overrides the default address.
- `omori-test.sh`, `omori-test3.sh`: legacy test2/test3 upload/run wrappers. They upload source
  files and target the older `omori-pmjs2`/`omori-pmjs3` installs. Check the installed launcher
  and current handover before choosing a target; do not confuse these with the newer
  `omori-upstream-test` install.
- `release-install.sh [ZIP]`: installs a release over the legacy test2 runtime. Its default
  ZIP is `../../../../portmaster-builder/omori-pmjs/share/out/OMORI-PMJS.zip` relative to this
  directory. Set `OMORI_RELEASE_REPO` for another layout. This mutates the device: use only
  after selecting the correct install and ensuring no game is running.
- `fb2png.py`, `playtest-fps.py`, `state-diff.js`: offline capture/log/state analysis.
- `sd-writes.sh`: device-side SD I/O measurement helper.

## Private SSH files

The existing askpass helpers and known_hosts were preserved in `.local/device-auth/` at the
OmoriSource root. The entire `.local/` tree is ignored by Git. Never add credentials to this
directory, the release repository, or a package.

`OMORI_DEVICE_AUTH_DIR` selects a different private directory; `OMORI_SSH_ASKPASS` overrides
the askpass executable. These helpers never need the temporary handover directory to run.
