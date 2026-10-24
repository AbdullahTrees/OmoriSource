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

## Direction

Keep the image cache by default and disable map preparation. The remaining boot cost is the
image stage's per-boot scan and install (~14-18 s). Next steps:

- Skip the image validation/install loops on a boot whose cache was already verified, with a
  single `asset-recheck.json` flag (written on a missing/broken asset or fatal asset error) that
  forces a full check on the next boot and is cleared on success. The fixed receipt handling
  (`205e5bf`) makes a flag-based skip safe; it must not reintroduce per-asset manifest reads.
- The port adapter phase runs for 8.3 s on every boot in every mode and needs the same
  treatment or a warm-skip.
- Any install-payload cache must be compact/streamed; a 12 MB JSON is not acceptable on a 1 GB
  device while the game is resident.

