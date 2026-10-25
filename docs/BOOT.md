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
   remaining loops. The second boot took 183 s. The payload was never shown to cause a crash;
   one run hit the 100 MB watchdog because a background room test and the startup test overlapped
   two PMJS instances.

### Corrected root cause (2026-10-25, later)

The 183 s boot was a full cache re-hash, and the cause was found independently of the payload: a
preparation session that runs only the port phase (direct mode still runs it, ~8.3 s per boot)
builds an empty file-receipt map, and `session.finish()` pruned every receipt absent from the
session. Each direct boot therefore deleted all image and map receipts; the next prepared boot
re-hashed 2,470 sources and 2,460 outputs (1.3 GB): images 105 s validate, maps 26-55 s compile.
An images-only session likewise deleted map receipts. Fixed in pmjs `205e5bf` by pruning only
when both the image and map phases completed (the rule the results/failures pruning already
uses), with regression tests for the port-only and images-only cases. A prepared boot after a
direct boot now hashes 8 files and reuses 4,977 image and 12,947 map files (15-18 s stages).

The trust branch was not deployed; the test runtime's runner files were restored from
`.orig-trust-20261025` backups. The worktree remains local for reference.

## Asset-cache components: measured 2026-10-25

The test game tree is already decrypted. Three configs were measured with a warm cache built
first, in alternating order (run order and thermal state move fps by 5-10% on this device):

- **none** (`assetPreparation.enabled=false`): plain PNG/OGG/JSON/map files, no cache work.
- **images** (`enabled=true, maps=false`): prepared image pages, original maps.
- **both** (`enabled=true, maps=true`): prepared image pages and prepared map tile pages.

### Boot (startup to title)

| config | startup_ms |
|---|---:|
| none | 18.6-27.1 s (most runs 19-23) |
| images | 35.0-39.8 s |
| both | 53.4-79.1 s (typically 55-66) |

Warm stage costs: images 14.4-18.0 s (validate 10-15, install 3.6-6.1, cleanup 0-4); maps
15.5-16.7 s (validate 3.2-3.8, compile 6.2-7.4, install 2.3-2.4, cleanup 2.9-3.4); the port
adapter phase 8.3 s and host initialization 6.2-8.2 s run in **every** mode, including direct.

### Runtime: map 92, `--breakdown`, two alternating rounds

| config | per-step logic | native draw | fps (rounds) |
|---|---:|---:|---:|
| none | 5.9-6.2 ms | 2.1-2.2 ms | 48.9, 53.8 |
| images | 5.8-6.0 ms | 2.3 ms | 51.9, 52.7 |
| both | 6.0 ms | 2.6-2.7 ms | 46.9, 47.5 |

Per-step logic is identical across configs. The fps spread is the game's 1-vs-2-step catch-up
loop: `both` sat at 1.2 steps/frame in both rounds, the others at 1.0-1.2; a ~0.4 ms higher draw
cost is enough to shift the mix, which then doubles logic work per frame.

### Runtime: other maps (no breakdown unless noted)

| map | config | fps | steps/frame | draw | RSS | map load |
|---|---|---:|---:|---:|---:|---:|
| 203 | none | 31.1 | 2.0 | 3.1 ms | 716 MB | 3301 ms |
| 203 | images | 31.9 | 2.0 | 3.2 ms | 649 MB | 1983 ms |
| 203 | both (breakdown) | 28.5 | 2.0 | 4.2 ms | 678 MB | 2740 ms |
| 111 | images | 34.3 | 2.0 | 2.5 ms | 673 MB | 1063 ms |
| 111 | both | 34.4 | 2.0 | 2.8 ms | 659 MB | 1493 ms |
| 92 walking | none | 40.9 | 1.4 | 2.4 ms | 724 MB | 2209 ms |
| 92 walking | images | 36.2 | 1.5 | 2.8 ms | 680 MB | 1350 ms |
| 92 walking | both | 35.7 | 1.5 | 3.3 ms | 665 MB | 1457 ms |

The walking runs executed the same number of logic steps in all three configs (~561 in 10 s);
the fps difference is fewer rendered frames (the step mix), not slower logic.

### Memory headroom

Direct mode is at the edge of the 1 GB device on map 203: one breakdown run was killed by the
100 MB watchdog with 94 MB available, and with the watchdog lowered to 70 MB it completed at
716 MB RSS. The image cache brings that to 649 MB (-67 MB) and images+maps to 678 MB. This is
the one measured benefit large enough to justify a cache on 1 GB hardware.

### Conclusion

- **Image preparation**: no per-step logic cost, +0.1-0.4 ms draw, saves 40-80 MB on heavy
  maps, and map entry is 0.5-1.3 s faster. Costs ~20 s on every warm boot.
- **Map preparation**: no fps, logic or load benefit on maps 92, 111 or 203; +0.3-0.8 ms draw;
  memory is mixed (adds ~44 MB on 203 versus images-only, saves ~14-16 MB on 111/92); costs
  ~16 s on every boot. Drop it.
- **Direct mode**: fastest boot (19 s) and lowest draw, but no memory headroom on map 203. Keep
  it as an opt-in for 2 GB devices, not the 1 GB default.

The earlier direct-versus-prepared fps gap (58.4 vs 36.9) was a thermal/measurement artifact:
those runs were in different catch-up regimes. Atlases do not slow game logic; they add draw
time and boot time, and they buy texture memory by uploading only used crops.

## Fast boot: implemented and measured 2026-10-25

The image cache now has a verified fast path, so keeping it no longer costs boot time.

**Mechanism.** After a completed image phase, `runner/prepared-catalog.cjs` writes
`<prep-root>/prepared-catalog.json` (1.16 MB for OMORI): per prepared image, the cache directory,
the VFS source identity and the captured page identities, plus a fingerprint of the image
results and failures, the image source inventory, the effective policy (recipes, ASTC, lossless
prefixes, workspace budget, asset-index file) and the processor identity. The next boot reads
the catalog and calls `native.assets.installPreparedCatalog`, which installs the entries
**without opening source or page files**. Any of these refuses the catalog and runs the full
phase, which rewrites it: a changed processor, policy, source inventory, result set, failure
set, invalidated image or install rejection, or `verifyHashes: true`. A rejected individual
image simply keeps ordinary loading; a `failed` result refuses the whole catalog so the full
phase can repair it.

| boot | startup_ms |
|---|---:|
| images+maps, full validation | 53.4-79.1 s |
| images only, full validation | 32.8-46.7 s (32.8 with no repair) |
| **images only, fast catalog** | **19.1-20.5 s** |
| direct (no cache) | 18.6-19.4 s |

The fast boot installs 2,460/2,460 prepared images. On map 203 it kept the cache's benefit:
prepared hits 156/159 live images, only `non-sprite` fallbacks (677-697, normal) and
`gpuBytes` **21.7 MB vs 116.9 MB direct** (cropped uploads instead of full source textures),
CPU-side page data 104 MB vs 73 MB, RSS 674 vs 711 MB, draw 3.3 vs 3.1 ms, fps 31.8 vs 31.9.
Map 92 on a fast boot: 56.1 fps, draw 2.3 ms, 1 step/frame. The port adapter phase still runs
(~4-8 s) and is the largest remaining boot cost.

**Recheck flag, exercised end to end.** Deleting a prepared page (`img/system/IconSet.png`) and
booting fast: the game reached the title with the image falling back to the original, and the
runner wrote `<cache-root>/asset-recheck.json` with `reason: prepared asset invalidated`. The
next boot logged `fast_boot=off`, ran the full image phase, regenerated the image, cleared the
flag and rewrote the catalog (46.7 s including the repair). The following boot was fast again
(20.5 s). A fatal error during a fast-boot session also writes the flag; any successful full
preparation clears it.

**Tests.** `test/prepared-catalog.test.cjs` covers fingerprints (results, image failures, map
failures excluded), source-set hashes, policy identity (recipes/ASTC/lossless/workspace/index
file), roundtrip, stale/processor/policy/source mismatch, failed and invalidated images,
directory containment and zero-page uniform images; the receipt fix has its own regression
tests. Full preparation, catalog, asset-preparation and build/runtime suites pass under WSL
Node: 150 passed, 1 skipped.

**Policy and inventory gates exercised on device.** Changing `losslessPrefixes` forced one full
validation and a catalog rewrite, then the next boot was fast again (19.9 s). Adding a new
`img/` file made the next boot full (2,471 discovered, 2,461 prepared), and the following boot
was fast with 2,461 (19.0 s). `verifyHashes: true` forced the documented full re-hash
(`fast:false`, images 100.8 s, startup 120.4 s); removing it restored the fast boot (21.2 s).

**Known remaining cost: catalog identities carry inodes.** The catalog stores the VFS identity
captured during the writing boot, and that identity includes `st_ino`. On this firmware's
exFAT/FUSE storage the inode changes in every process, so `capturePrepared` sees an identity
that differs only in the inode and, because the source has a content hash, re-verifies the
source bytes at first load; pages likewise get `verifyHash`. The cache and memory benefit are
kept, but first loads pay SHA-256 work that the old full validation paid at boot. The fix is a
native trust flag for catalog-installed backings: when the identity differs only in the inode,
skip the content verification (the same decision the preparation receipts make) and let a
content change (size/mtime/ctime/path) or a failed load write the recheck flag. Needs a runtime
build; not in the JS-only test runtime.

## Direction

Done: image cache by default, map preparation off, and the image stage's per-boot scan removed.
Remaining boot work:

- The port adapter phase still runs for 4-8 s on every boot; give it a warm-skip or remove it
  from the critical path.
- Keep `asset-recheck.json` as the only repair trigger; do not add per-asset reads to the fast
  path. The catalog must always be tied to a result-set fingerprint and the processor identity.
- The release config should ship `{"assetPreparation":{"enabled":true,"maps":false}}`; the
  catalog is written automatically on the first full boot.


