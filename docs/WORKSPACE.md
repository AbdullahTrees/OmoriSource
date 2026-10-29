# Repository ownership and workspace layout

Updated 2026-10-29. Paths below are relative to the shared `source/` workspace.

| Path | Owner and purpose |
| --- | --- |
| `REVERSE/OmoriSource/` | Primary development repository: runtime optimization patches, build/extraction/parity tools, research code and tests. |
| `REVERSE/OmoriSource/pmjs/` | PMJS Git submodule: generic runtime/renderer changes. Keep OMORI-specific patches in `launcher/`. |
| `portmaster-builder/omori-pmjs/` | Independent Git repository for PortMaster release sources, metadata, packaging and output. Snapshot verified changes from OmoriSource here. |
| `REVERSE/omori-handover/` | Agent communication, progress notes, reports, raw profiling evidence and drafts. No required executable tooling or release builder lives here. |

`REVERSE/OmoriSource-release` was a detached, clean worktree at `dab94ec`. It held no unique
changes or untracked/ignored files. Its commit is an ancestor of development HEAD. It was
removed with `git worktree remove`; no branch or commit was deleted.

## Code moved out of handover

- `tools/device/`: SSH, test/deployment wrappers and offline device utilities.
- `research/device-snapshots/`: historical copies of installed launchers/patches. They are
  reference snapshots, not a second implementation or the automatically deployed source.
- `research/analysis/`: reusable recovery-log and CPU-profile audit tools. Input evidence
  directories and output locations are explicit CLI arguments.
- `research/experiments/logic-20261025/`: preserved runtime optimization experiments.
- `research/meetox/`: personal-use comparison build/measurement scripts; external engine code
  remains in its own checkout, excluded from this repository.

The canonical release builder is now `portmaster-builder/omori-pmjs/tools/release-build.py`.
Old handover builder/template/ZIP copies are superseded, preserved under that release repo's
ignored `.local/legacy-packaging/`. Old release-verification script snapshots are in its
`.local/verification-snapshots/`. The published artifacts and existing Git history are retained.

## Private local material

The OmoriSource `.local/` directory is ignored:

- `device-auth/`: SSH credentials/helpers and known_hosts.
- `session-artifacts/scratch/` and `session-artifacts/archive/`: historical session scripts,
  native runtime artifacts, keys and build leftovers; retained without making them release inputs.
- `references/meetox-omori/`: independent third-party reference checkout. Do not vendor or
  redistribute it. Comparison scripts resolve it here, or use `MEETOX_REPO`.
- `layout-moves.json`: exact old-to-new migration map for this machine.

Historical reports may cite the former handover paths. Use this mapping rather than recreating
executable files there. Existing external WSL symlinks to the old reference path were not changed;
the maintained comparison scripts now resolve the new checkout directly.

## Offline analysis examples

From OmoriSource, with the handover evidence still at its current location:

```powershell
python research/analysis/profile-audit.py ../omori-handover/evidence/save-state-20261028 --out .local/profile-audit.json
python research/analysis/recovery-summary.py ../omori-handover/evidence/recovery-20261026 --out .local/recovery-summary.json
```

The scripts can equally analyze evidence stored elsewhere; their implementation has no dependency
on the handover directory. No device files, saves, caches or system libraries were changed by
this workspace cleanup. Local commits only; nothing was pushed.
