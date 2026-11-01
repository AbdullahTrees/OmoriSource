# Look Outside: single-install play and measurement setup

Device game root: `/mnt/mmc/ports/lookoutside-test`; one normal shortcut,
`Look Outside (PMJS test)`. **One game-data directory, one runtime, one image cache.**
The harness uses that same installation. Its tiny instrumented bundle contains
runtime bootstrap/adapter metadata only, no second copy of the game or runtime.
User play uses `saves`; disposable harness saves, bootstrap state and logs live in
`harness/`. Assets/cache are shared because the runtime and rendering adapters
are identical and the harness only adds measurement/navigation hooks.

## Installation

`prepare-install.py` consumes the user's `D:/Large Games/Look Outside` and
`C:/Users/Abdullah/Downloads/Compressed/lookoutside.zip`. It CRC-checks/extracts the
port into ignored `.local/pmjs-games/lookoutside`, checks composition hashes,
audits engine/plugin bootstrap pins, and packages required game assets unchanged.
PC executables, browser locale/runtime files, existing saves/logs and backup CSVs
are omitted. `gamefiles.sha256` uses LF endings and covers every copied game file.
Transfer the generated archive to a **new** device directory; refuse an existing
installation rather than overwriting it. Check the manifest on the device before
launch. No source game files are modified; encryption is handled by the runtime.

This is RPG Maker **MZ 1.8.1**. The supplied files match engine/PIXI/plugin-manifest
pins, but lack `lib/steam_settings/achievements.json` expected by the downloaded
bundle. Keep the original descriptor/receipts intact: PMJS must detect this change
and rebuild the bootstrap honestly for the supplied files. No fake Steam metadata
or bypassed source guards. The original config requests the portable Steam provider.
Native package source provenance is unknown/dirty; identify it by artifact hashes.

`prepare-harness.py` packages `harness/bundle`, adding the shared collector and
game adapter to the original config/DOM patch. It invalidates the instrumented
composition's bootstrap receipt so PMJS rebuilds it. The normal descriptor and
bootstrap are untouched. `play.sh` is the normal PortMaster launcher: original
bundle mode, no input injection, debugger, benchmark patch or timed exit.

## Harness use

Only run while the handheld is idle. `run-device.sh` refuses an active game, pauses
muOS, disables its SDL blitter and restores the frontend/framebuffer on exit.
Labels are unique and existing results are never overwritten.

```
sh /mnt/mmc/ports/lookoutside-test/harness/run-device.sh seed
sh /mnt/mmc/ports/lookoutside-test/harness/run-device.sh baseline
sh /mnt/mmc/ports/lookoutside-test/harness/run-device.sh profile
```

The seed runs the real title/New Game path, acknowledges pretitle/intro dialogue,
selects **Survivor Mode** (item 498) through the game's own difficulty window,
waits for player control, calls onBeforeSave and saves slot 1 in `harness/seed-saves`.
It checks the selector's item pool before choosing. This selection affects only
the disposable benchmark save; normal New Game retains the user's own choice.
Survivor normally disables manual saving: fixture creation calls the save API
directly for repeatability, without enabling the play build's save menu.
MZ save/load promises resolve **0 on success**; do not apply MV's truthy-result
assumption. Each measured run loads its own copy of that small save, resets JS RNG,
and uses the real Scene_Load success hooks, including the game's load repairs.
It acknowledges delayed setup messages and requires 15 seconds of settled control
before preparing the first measurement. Input helpers are restored for measurement;
a message/event blocking control invalidates the sample. Four scripted fixtures:
standing, a checked two-tile walking route, main
menu, item menu, then return to the map. These are automation actions on the single
game, not duplicated scene content or a full walkthrough/active combat benchmark.

`baseline` uses 5-second warmups and 15-second samples. `profile` uses separate
10-second V8 samples, excluded from clean baseline FPS. `smoke` provides 3-second
samples; `title` checks title only. An optional second argument names a new run.
`GAME_BENCH_DISABLE_OPT` passes an explicit PMJS disable flag to the same runtime;
any future candidate must first establish that the corresponding MZ path exists.
`retained-ab.sh` audits runtime registration/API/counters before the off/on/on/off
sequence and verifies that frame counters really toggle. The existing retained
branch is **PIXI4-only**: this MZ/PIXI5 package has no retained registration/API.
The preflight therefore reports **not-applicable, exit 3**, with zero performance
pairs run. `audit-retained.py` also checks the immutable retained branch's module
composition without changing refs. This is not an A/B performance result; a PIXI5
implementation is needed first. `CAPABILITY_RUN` may select a recorded capability
run for the preflight; a positive candidate still needs a completed baseline.

Shared collector: `research/pmjs-performance/game-metrics.js`. FPS, mean/p50/p95/
p99/max frame interval, >=100 ms hitches, actual logic steps, memory, temperature
and frequency are recorded. Logic counting wraps updateScene, not updateMain.
Profiler start/stop work is outside the recorded FPS window. CPU profiles remain
standard `.cpuprofile` files, with no network debugging port. Two collector tests
cover presentation/logic accounting, legacy output and profiler window boundaries.
The supplied native package predates PMJS_FRAME_STATS: **native phase timing is
unavailable**, explicitly recorded as false, never represented as zero cost.

`normal-launch-check.sh` exercises the real Ports-menu wrapper through title, captures
the framebuffer, then deliberately stops it; it removes a newly created entry if
validation fails. `finish-device.sh` requires successful seed/baseline/profile and
normal-wrapper receipts with no logged JS/plugin errors before accepting that
single normal-play menu entry. It records
hashes/state and generates module maps; `export-device.sh` streams only metadata,
logs and profiles, never saves/game assets/executable bootstrap source.

Host reports:

```
python research/pmjs-performance/fps-report.py EVIDENCE/results/baseline/fps.jsonl
python research/pmjs-performance/profile-report.py EVIDENCE profile
python research/lookoutside/analyze-results.py EVIDENCE
```

The shared profile reporter resolves bundled module line ranges and uses each
sample's corresponding delta. It excludes/reports inspector startup samples;
inclusive function costs overlap and are not additive. Existing ISAT profile
entry point remains compatible. The old OMORI navigation and fixed plugin labels
are not reused. A clean baseline is a setup receipt, not evidence of an optimization
gain; native provenance, scripted fixtures and omitted native phase timing limit
cross-game comparisons until a common source-pinned runtime is tested.

One diagnostic attempt was interrupted by a device reboot, cause unconfirmed.
Uploads and run boundaries now sync to SD. `GAME_BENCH_MEMORY_TRACE=1` adds a durable
2-second memory/temperature trace with sync calls; use it for diagnostics only,
not clean FPS comparisons. The accepted smoke uses this trace; baseline/profiles
do not. Initial scene-ready/difficulty/blocked-dialogue trials are preserved and
excluded from clean results.
