# Device performance investigation, 2026-10-21

All work is local. Game files remain unchanged. Experimental patches run through the extra-patch mechanism and disappear when the test process exits. Evidence lives in `raw/session-20261021-continuation/`.

## Profile findings

Four 20-second V8 profiles used the same runtime, heap cap 480 MB, watchdog floor 100 MB, and process-local `MALLOC_ARENA_MAX=2`. Profiles have overhead; use the unprofiled alternating phases for timing comparisons. These tours transfer directly into maps from new-game state and are diagnostic workloads, not faithful story playthroughs.

`profile-analysis.cjs` attributes each `timeDeltas[i]` to `samples[i]`, matching the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/). It reports the initial inspector-start delay separately instead of attributing its roughly 1.5 seconds to game work. The buckets below are mutually exclusive; the character and map stacks are inclusive subsets and must not be added to them.

| Map | Profiled FPS | Game update | Scene encoding | Native render/swap | Character-sprite update stack | Map update stack |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 87 White Space | 25.6 | 58.75% | 24.75% | 10.64% | 21.72% | 10.57% |
| 14 daytime house | 13.0 | 63.16% | 22.86% | 9.46% | 36.75% | 9.41% |
| 111 Rain Town | 15.6 | 53.72% | 33.17% | 9.00% | 23.78% | 8.88% |
| 78 nighttime house, inherited rain | 11.2 | 60.77% | 26.43% | 9.59% | 36.89% | 7.71% |

The heavy houses spend substantially more time updating character sprites than executing event interpreters: map 14 interpreter stacks were about 0.01%, versus 36.75% for character sprites. Their source event/page counts alone do not establish active interpreter cost. Map 14 has 370 character sprites including 185 reflections, compared with 100/50 on White Space. YED also preallocates 256 priority sprites, mostly hidden. A hidden reflection can still execute animation/RNG/game-state work; skipping it blindly would change behavior.

## Three candidate optimizations tested and rejected for shipping

`logic-experiments.js` tests no-effect horror traversal and empty `Sprite_Base` updates. `character-frame-experiment.js` specializes the reviewed composition of stock MV, OMORI, Custom Character Rectangles, EMF, and the PMJS pending-bitmap wrapper. All candidates pin source and retain fallback paths for incompatible delegates/state.

- Differential checks against the local vanilla methods: 33 comparisons across 11 logic scenarios passed; 61 frame cases passed, including 51 fast-path cases.
- `logic-ab` alternates baseline, horror, base, combined, restored baseline. Small differences are comparable to warm-up/drift; there is no dependable shipping gain.
- `frame-ab` alternates baseline, frame, logic combined, all, restored baseline. Map 14: frame-only 64.21 ms versus baselines 63.16/62.26 ms. Rain Town: 52.86 ms versus 52.82/52.23 ms. Night house: 75.88 ms versus 76.91/72.75 ms. The combined mode also fails to beat the final baseline reliably.
- More than 905,000 fast-path calls occurred. Added per-call contract checks can consume the work saved by a shorter arithmetic path. Passing differential checks is insufficient reason to ship a slower patch.

## Rain and workload isolation

Direct weather/rain update stacks cover 806.1 ms of the 20,077.1 ms Rain Town sample window, about 4.02%. This excludes generic transforms/preflight/encoding for those same sprites. `getVelocity` trigonometry is a small subset, so optimizing sin/cos cannot fix the broader problem alone.

The user reported rain in a bathroom appearing close to one FPS. The tour had visited Rain Town before the nighttime house. The weather diagnostic confirms that **192 rain sprites at power 6 carry into map 78**, and into map 461, because the direct transfer sequence does not reset weather. The earlier nighttime-house figures therefore describe an artificial house-plus-rain workload; do not present them as normal house performance. The daytime-house profile precedes Rain Town and is a separate slow workload.

`weather-ablation.js` deliberately hides Weather while preserving updates, then hides/stops Weather updates, followed by restored baselines. These modes alter the picture/simulation and are diagnostic only. Rain Town: baseline 17.0/18.2 FPS and 53.01/49.84 ms JS; hidden rain 19.9/20.4 FPS and 44.65/44.22 ms; hidden/stopped 21.1 FPS and 41.98 ms. The comparison suggests roughly 5.6–8.8 ms in rain presentation/encoding and another 2.2–2.7 ms in updates in this workload, with order/warm-up uncertainty. It does not demonstrate a production optimization or a one-FPS steady state.

The carry-over workload also measured nighttime-house baseline 12.7/13.6 FPS, hidden rain 14.8/15.1, hidden/stopped 15.6; bathtub baseline 28.7/28.9, hidden rain 34.7/35.2, hidden/stopped 39.6. All 15 measurement windows had maximum frame intervals below 128 ms, so none reproduces a one-FPS steady state. Direct Rain Town arrival did produce a sampled 5,974 ms load/transfer stall outside the measured windows. Early script errors on direct entry also demonstrate why story state matters.

An additional fresh-state room run checks the house and bathtub without weather inherited from Rain Town, and counts host presentation callbacks separately from `Graphics.frameCount` to check the FPS metric. The PMJS-owned `Graphics.render` resets `_skipCount=0` and submits every stage, unlike the stock MV/GTP skip policy; the extra counters verify the live behavior. Results are recorded below when complete.

Fresh-state run completed; every map had weather `none`, power 0, and zero particle sprites:

| Map | Profiled FPS | Host presentation callbacks/s | Nodes | JS tick (ms) | Native draw (ms) | RSS (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 14 daytime house | 13.0 | 12.9 | 977 | 70.38 | 2.14 | 618.8 |
| 78 nighttime house | 13.6 | 13.5 | 971 | 66.79 | 2.42 | 637.8 |
| 461 bathtub | 34.5 | 34.5 | 645 | 22.06 | 1.62 | 640.8 |

The callback executes after native rendering, immediately before swap; it measures host presentation cadence, not photons or uniquely changed pixels. Counts closely match the game counter. The house profiles still show 65.34%/65.02% in game update, 22.64%/22.86% encoding, and 38.11%/37.85% inside character-sprite updates. Thus the slow-house conclusion survives removal of inherited weather. The daytime-house profile includes a 1,579 ms interval near profiler activation; the profiler startup gap is separately excluded from the stack percentages, not from the tour's raw interval list. Do not interpret that isolated instrumentation-associated stall as evidence of sustained one-FPS play.

A further query audit on fresh map 14 found only 0.40% in terrain-tag stacks and about 4.15% in the union of slippery-related stacks. This bounds that avenue below the broader presentation/encoding work; no terrain cache was added. These are sampled attribution numbers, and V8 inlining can move work into callers.

## Map catalog invalidation

`catalog-invalidation-probe.js` records native flags immediately around loads and replays every consumed flag to the runner. The first flag 2 was synchronous in `images.loadAsync` for `Tile_Collision_32x32.png` on map 90. A captured installed catalog shows five of nine sheet identities differ only in inode number; paths/device IDs/lengths/mtime/ctime match. Collision inode 47342 became 62762. `/mnt/mmc` is mounted as fuseblk.

After the tours, read-only device `sha256sum` verified that all five inode-mismatched source sheets still match the catalog's SHA-256 hashes exactly (`catalog-source-hashes.txt`). The tile path requires exact identity in `effectiveTileSet`/`captureTileLoad`. Ordinary prepared images and VFS derived files already support inode-only changes with SHA-256 content verification. This is concrete evidence for implementing the same safety in tile handling, rather than deleting caches or ignoring invalidation flags. The probe alone cannot distinguish which condition inside `captureTileLoad` ran, and page/snapshot identities still need equivalent audit. `catalog-identities.json` retains the relevant source comparison without copying the whole transient catalog.

## Optimization plan

1. **Use the corrected benchmark state.** Independent new-game objects and presentation counts are now verified; retain the explicit carry-over workload as a stress test. Distinguish transfer/boot/profiler stalls from steady state. The user's apparent one-FPS bathroom state remains unconfirmed; reproduce its exact gameplay state before declaring it fixed.
2. **Reduce rain scene preparation/encoding.** All 192 particles use the general sprite path, with repeated render-method checks, prototype filter-descriptor walks, texture/frame extraction, transform planning and serialization. Investigate a reviewed Weather batch or retained sprite bindings that update dynamic position/opacity/scale/rotation while preserving count, ordering, RNG, blend mode, tint, filters, and custom-image fallback. Pixel and state parity plus restored-baseline device A/B are required. Hiding rain is only the cost ceiling, never the solution.
3. **Reduce repeated character presentation work.** Target the 37% inclusive sprite-update stacks, including both ordinary and reflection sprites. Cache only proven presentation results with complete invalidation; preserve animation requests, shared-character effects, and RNG order. Audit whether duplicate presentation between catch-up logic steps can be coalesced. Keep the authored 60 Hz simulation and plugin call semantics.
4. **Move invariant render validation out of hot per-sprite paths where safe.** Guard caching must still detect own/prototype method replacement and guest callbacks that mutate contracts. Measure actual node visits and saved time before adding another guarded wrapper.
5. **Repair map catalog inode refresh with hashes.** Add source/page/snapshot hashes and retain captured-file race checks; test inode-only churn, changed content, same-size replacement, and missing pages. This primarily improves startup and memory pressure, not steady FPS.
6. **Separate startup improvements.** Coalesce repeated Yanfly bitmap readiness/preload work (278 configured preloads across 23 maps), and make a matched allocator A/B before adopting `MALLOC_ARENA_MAX=2`. Neither is established as a game-logic FPS fix.

Do not adopt NWCompat's update-loop simplification, remove reflections, lower particle counts, or disable real effects as performance fixes: those change vanilla behavior or appearance. No native rebuild, firmware change, push, PR, or production installation of the experimental patches occurred in this continuation.
