# Boot time and prepared-asset validation

Startup on the RG40XX-H test build is ~53-54 s. From a normal boot log
(`tests/20261025-032818-room`):

| stage | time |
|---|---:|
| native initialize | 6.1 s |
| VFS index (5,148 paths) | 0.46 s |
| images preparation | 18.1 s (2,470 sources, 2,460 hits, 10 fallbacks) |
| maps preparation | 15.7 s (519 maps, 519 hits, 101 fallbacks) |
| rest (install, game bootstrap, title) | ~13 s |

The images stage includes a 6.3 s fallback re-decode for `FA_AUBREY_Stump.png`
("cannot decode preparation PNG row") and several invalid-PNG fallbacks. The maps stage
revalidates 519 map manifests. Neither is content hashing on this build: `verify_hashes=false`
and the file receipts reuse hashes (12 hashed files, 0 on trust runs); the cost is iterating
thousands of manifests and output receipts, plus the fallback decodes.

## Attempted 2026-10-25 (reverted)

A PMJS runner branch (`perf/trust-prepared` in `~/omori-test/pmjs-trust`) added
`assetPreparation.trustPrepared` / `PMJS_TRUST_PREPARED=1`:

1. **Trusted validation.** `preparation-files.cjs` returned cached receipts when size/mtime/ctime
   matched (inode ignored, for exFAT renumbering), skipped manifest/output header validation,
   and `asset-preparation.cjs` skipped re-decoding sources recorded as failures.
   Result: startup 54.3 -> 49.9 s; images 18.1 -> 11.5 s, maps 15.7 -> 12.3 s. The 6.3 s
   fallback disappeared; hashed files 0.
2. **Install-payload skip.** Persisted 12.1 MB of image/map install entries to
   `.cache/prepared-install.json`, then installed them directly on the next boot to skip the
   remaining loops. Result: the second boot took **183 s** because the payload did not install
   cleanly and the run fell back to a full preparation after the previous trust run had churned
   the cache state; it re-decoded fallbacks and regenerated a map. The 12 MB payload itself was
   not shown to cause a crash. Separately, one run hit the 100 MB watchdog because a background
   room test and the startup test overlapped two PMJS instances; that OOM was a test collision,
   not the skip. Attribution corrected 2026-10-25.

The branch was not deployed in the release; the test runtime's runner files were restored from
`.orig-trust-20261025` backups and a normal startup verified (53.4 s). The worktree remains
local for reference.

## Direct mode: measured 2026-10-25

The test game tree (`/mnt/mmc/ports/omori-test/www`) is already decrypted. Setting the port
config to `{"assetPreparation":{"enabled":false}}` makes PMJS load the plain PNG/OGG/JSON/map
files directly: no image atlas preparation, no map tile packing, no per-boot manifest validation.

| metric | prepared cache | direct |
|---|---:|---:|
| startup | 53.4 s | **18.5-22.2 s** |
| map 92 standing (clean, no breakdown) | 55-58 fps | **56.6 fps** |
| map 92 walking (clean) | 33.8 fps | **38.4 fps** |
| map 203 standing (clean) | 30.3 fps, 4.2 ms draw | **32.2 fps, 3.2 ms draw** |
| native draw map 92 standing/walking | 2.6 / 3.5 ms | **2.1 / 2.4 ms** |
| RSS map 92 / 203 | ~693 / 711 MB | ~706-723 / 745 MB |

The prepared atlases and packed maps were costing boot time and did not improve runtime on
either test map; direct PNG loading was faster and only 13-34 MB higher in RSS. Caveats: a Steam
install must be decrypted once into the game tree first (the key-free `tools/extract.js` path),
and maps with extraordinary image counts may still benefit from atlases for memory, so keep
preparation as an opt-in. The intended fork shape is: one-time decrypted install, direct
loading by default, preparation opt-in for encrypted installs or memory-constrained cases, and
`asset-recheck.json` on a missing/broken asset to force a repair on the next boot.

## Direction (user decision)

Do not iterate thousands of manifests on every boot. Preferred design:

- **Skip validation by default** once a preparation has completed.
- If an asset is missing/rejected at install, or the game exits abnormally, write
  `asset-recheck.json`; the next boot runs a full check/rebuild and clears it on success.
- **Replace-originals mode** is the clean long-term version: a one-time, reversible preparation
  writes the prepared files into the game tree (with a manifest/backup) so the runtime loads
  them directly and there is nothing to validate. Keep it opt-in, never silent; Steam updates
  invalidate it.
- Any install-payload cache must be compact/streamed. A 12 MB JSON is not acceptable on a 1 GB
  device while the game is also resident.

The recheck-flag path is not implemented yet; the trust branch's validation-skip pieces are the
starting point, but the default skip must not read per-asset manifests.
