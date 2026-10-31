# ISAT retained-encoding experiment

This is a bounded cross-game test, not a replacement play launcher. Full ISAT
v1.0.6.3 and its original PortMaster adapter composition are unchanged. See the
handover evidence `isat-retained-20261101` for hashes, receipts and measured results.

## Runtime and isolation

`prepare-bench-overlay.py` exports immutable PMJS JS/runner source from
`3fef914f113c4ea8595bdf95a29fc373c9fd8f9c`. Its retained algorithm is identical to
`pr/retained-encoding@6cbd194`. It applies only experimental measurement repairs:
reentrant same-slot timers measure the outer union; phase summaries include
arithmetic means; the last encoder mode and world/local pass counts are exposed
even with retention disabled. It also exports a separate verification encoder
from `8a7bee5cdf35a9dc27e9ddd820aaa773e11713a7`. No checked-out PMJS code or refs
are changed. Run the preparation before `node benchmark.test.cjs` (4 timing and
summary checks).
`python analysis_test.py` additionally checks profile delta alignment, exclusion of
inspector setup, and module scoping of same-name functions (one test). Windows
sandbox restrictions on Python temporary-directory ACLs may require running that
host test outside the restricted shell.

The experiment uses a copy of the already installed `/root/pmjs-retained/pmjs-arm64`
native package. It reports unknown/dirty provenance: hashes identify the tested
binary, not its exact source commit. Both comparison arms use that **same** binary,
JS, source assets, adapter list and cache. Off sets only
`PMJS_DISABLE_OPT=render.retained-encoding`; on clears that setting. Do not interpret
the separate normal-package control as a causal retained-encoder comparison.

Stage under `/mnt/mmc/ports/isat-perf`, never `/tmp`. Copy the exported `share/pmjs`
over its runtime's share directory; retain original and verification encoders as
`scene-retained.performance.js` and `scene-retained.verify.js` in the experiment
root. Copy `benchmark.js` and `retained-ab.sh` there. Normal-package, experimental
and debug-verification runs each have a different asset-cache root. The two A/B
arms share the one experimental runtime/cache. Keep `isat-test`'s normal saves,
descriptor, bootstrap and cache separate.

## Fixture and sequence

The controller refuses an active game, pauses the muOS frontend, sets
`SDL_BLITTER_DISABLED=1`, and resumes the frontend/clears the framebuffer on exit.
Do not run while somebody is playing. It never changes the governor or libraries.
It invokes the CLI with the bundle's explicit patch composition rather than the
PortMaster shell wrapper (no `pm_platform_helper` or controller remapper). Therefore
the packaged-runtime control is contextual, not a receipt for the exact user's
menu-launch conditions. All clean A/B arms have the same invocation and environment.

1. `sh retained-ab.sh seed`: normal New Game, acknowledge intro dialogue, authored
   transfer to Dormont, then **onBeforeSave followed by saveGame**. Keep seed saves
   outside the normal game saves. Warm both runtime caches before timing.
2. `sh retained-ab.sh normal`: shipped-package control, four scenes, 15 seconds each.
3. `sh retained-ab.sh abba`: off / on / on / off; 12 seconds between runs. Each run
   clones the same seed save, reseeds JS RNG, and waits for a fully started scene.
   Each scene has 5 seconds warmup followed by 15 seconds measurement.
4. `sh retained-ab.sh profiles`: separate off/on runs, 10 seconds per scene, V8
   inspector sampling at 1 ms. No debugger network port. Exclude their FPS from A/B.
5. `sh retained-ab.sh verify`: separate 8-second scenes with the verification
   encoder and its independent cache. Exclude its timings from A/B. Restore the
   performance encoder afterward, even if verification fails.

Scene fixtures: Dormont standing at (19,37); oscillating between (19,37)/(20,37);
main menu; idle battle against troop 3 (Goomba1_Rock). They are save-derived,
scripted fixtures, **not a natural walkthrough** or active combat benchmark.
Dormont qualifies for local-state encoding, menu/battle for world-state encoding.
No measured input wrapper replaces updateMain; logic steps count updateScene.

## Metrics and analysis

Present intervals provide FPS, mean/p50/p95/p99/max and >=100 ms hitches. Omit the
first clipped interval. Frame stats provide weighted arithmetic phase means from
complete 2-second windows entirely inside each clean measurement interval. Tick,
prepare, encode and other spans overlap: **do not add them or subtract medians**
to claim exclusive code ownership. Record logic Hz, actual mode, retained counters,
source qualification, RSS, MemAvailable, frequency and temperature for every scene.
Frequency/temperature are endpoint snapshots, not a continuous clock trace.

Only exit-0 runs with all four scenes and no JS/plugin errors count. Preserve failed
fixture trials under distinct names and exclude them; never silently reuse a label.
Original bad-save, exit-hitbox and not-yet-started-scene trials are setup failures.

After all runs, upload `export-benchmark.cjs` and `export-benchmark.sh`; stream the
latter's stdout to a gzip tar on the host. It exports logs/profiles/hashes and bundled
module line ranges, **not saves, game assets or executable game bootstrap source**.
Run `python analyze-retained.py <export-root>` and
`python profile-retained.py <export-root>`. The latter resolves bundled modules and
uses `timeDeltas[i]` for sample i. Inclusive CPU costs overlap and are sampled,
not an independent stopwatch.
It excludes and reports the inspector-only `post` sample from profiler startup,
which precedes the driver's measured window; raw profiles retain it.

The FPS adapter output can be read by the existing
`research/pmjs-performance/fps-report.py`; filter by `run` before comparing variants
because the legacy report groups locations across all input rows. Standard
`.cpuprofile` files work with OMORI's top/tree tools or DevTools. Its hard-coded
OMORI driver, plugin labels and logic assumptions cannot be reused unchanged.
The older profile summary tools shift sample deltas by one; the new summary keeps
their input format but corrects that alignment without changing existing tools.

A few repeated scenes on one device establish a premise check, not whole-game
visual/logic parity, long-session memory safety, or the roadmap's multi-game M2 map.
