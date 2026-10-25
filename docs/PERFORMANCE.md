# Runtime performance notes and optimization rationale

This file records **why** each runtime optimization exists, why it is behaviour-preserving, and
the measurement that justified it. The fast-path modules carry the same argument in their header
comments; this is the index and the numbers.

Measurements are on the Anbernic RG40XX-H (4x Cortex-A53, 640x480, muOS 2502.0), map 92
(Forest Playground), room mode unless stated. `--breakdown` adds wrappers around the frame
phases and costs ~2 ms standing / ~5 ms walking; **clean fps is the no-breakdown run**. Counters
(`OmoriPerformance.*`, `OmoriPerf.*`) are exposed by the patches and printed by
`research/pmjs-performance/omori-test.js`.

## 1. Off-screen sprite update culling (`launcher/omori-performance.js`)

**Mechanism.** During `Spriteset_Map.update`, a `Sprite_Character` for a map event is fully
updated only when it can be seen. The wrapper skips the update when all of these hold: the map is
drawn unscaled/unshaken, the sprite has had one full update, the character is a `Game_Event`, no
animation/balloon/event-icon is playing, its mini-label is absent, and its character is outside
a margin of 96 px plus twice its frame size. A skipped sprite still runs `updateAnimation` so
animation/balloon/icon "playing" flags clear exactly as vanilla; YED reflection sprites with no
reflections are skipped the same way. A sprite that comes back into view is updated fully on that
step, before the frame is drawn (`_omoriUpdated` + the margin).

**Why it is faster.** On map 92 this removes ~65-90 character updates and ~120-200 reflection
updates per rendered frame. `Spriteset_Map.update` falls from ~12.3 ms to ~4.3-4.8 ms
(instrumented), and map 92 standing goes from ~31 fps to ~45-49 fps instrumented / **54 fps
clean**.

**Why it is correct.** Only the routine presentation update is skipped; game logic
(`Game_Event`, interpreters, movement) is untouched. The character's animation/balloon/icon
flags are cleared by `updateAnimation`; the mini-label stagger countdown continues; direct
`sprite.update()` callers (morpher/spawner) are not intercepted. The only visible state a
skipped off-screen sprite would have advanced is presentation-side (pattern/bobble), which is
recomputed on re-entry before the frame is drawn.

**Lazy-label interaction (fixed 2026-10-25).** `label-fastpaths.js` sets
`_omoriMiniLabelAbsent` on pages that can never show a label; `labelAllowsSkip` originally only
knew `_miniLabel`/`_labelDelay`, so with lazy labels on it returned **false for every sprite**
and culling silently stopped. Diagnostic: 476 character calls, 408 blocked by the label gate,
238/238 reflection skips blocked, spriteset 12.3 ms, 31 fps. `labelAllowsSkip` now returns true
for `_omoriMiniLabelAbsent`: that flag is exactly vanilla's empty unparented window state, which
the culling patch already treats as skippable.

**Install retry.** The patch originally returned silently if `Game_Event`/`Spriteset_Map` were
not defined at the `afterPlugins` moment, leaving every sprite on the full path with no log. It
now logs `sprite culling installed` and retries (100 ms, up to 10 s) instead.

**Control.** `OMORI_PERF_SPRITES=0` disables the patch; `OmoriPerformance.enabled=false` at
runtime; counters `full`, `offscreen`, `reflections`.

## 2. Lazy mini-label construction (`launcher/perf/label-fastpaths.js`)

**Mechanism.** YEP_EventMiniLabel + GTP's stagger build a `Window_EventMiniLabel` for every
character sprite, then discard it when the page has no non-empty `<Mini Label: ...>` comment.
The fast path reproduces GTP's countdown exactly and, when the delay expires with no label,
records `_omoriMiniLabelAbsent` instead of constructing an empty, never-parented window. Once a
window exists, every call delegates.

**Why it is correct.** An empty unparented window is never updated (only windows in the
spriteset get `update()`), so it can never turn into a label later. Page changes during the
stagger are checked at the same step; a page that gains a label after an empty window stays
invisible in both paths. Pins are SHA-256 of the composed methods; a different composition
refuses the item.

**Measurement.** The intended saving is the first ~17 s of map entry (hundreds of window
objects/text metrics), visible on large maps; it was not the cause of the map-92 steady-state
cost once culling recognises the flag (see §1). Standing map 92 with lazy labels on now matches
lazy-off once culling works.

**Control.** `OMORI_PERF_DISABLE=miniLabelLazy`.

## 3. Character frame composition (`launcher/pmjs/character-frames.js`)

**Mechanism.** Replaces the composed `Sprite_Character.updateCharacterFrame` for the common
state (loaded bitmap, no single frame, no EMF, no custom rectangle) with the same rectangle
math inline; every other state calls the captured composed method. Eleven methods are pinned.

**Measurement.** Disabling it on map 92: 39.0 fps / spriteset 6.2 ms vs 43.0 / 5.4 ms
(instrumented, culling active); ~0.8 ms/frame and a real user-visible difference.

**Control.** `PMJS_DISABLE_OPT=plugins.tds.character-frames`.

## 4. Sprite update fast paths (`launcher/perf/sprite-fastpaths.js`)

- **hiddenLeafSkip.** YED allocates 256 priority-tile sprites and hides nearly all; the vanilla
  chain on a hidden leaf only writes `visible = !_hiding`. The fast path reproduces that write
  and skips the rest. Counters on map 92: ~300-400 skips/frame.
- **horrorFastPath.** Olivia wraps `Sprite.prototype.update` on every sprite and every container
  level; with no horror source/filters the chain is a no-op. The fast path re-issues GTP's live
  children loop and calls the effects dispatcher only if a child activated a filter/replaced a
  delegate.
Both pin the composed methods and fall back on any mismatch.

## 5. Event/window fast paths (`launcher/perf/logic-fastpaths.js`, `scene-fastpaths.js`)

- **slipperyCache.** `Game_Map.isSlippery` (YEP region mode) is a pure function of live map/
  tileset/region state; a per-cell byte cache answers first visits through vanilla and later
  visits from the cache. YED's `tiledData`/`currentMapLevel` getters are **not defined at
  afterPlugins on classic maps**, so the original pin refused the whole item; the getter pins
  are now optional and verified lazily on key rebuild (a getter that appears with another
  source refuses the cache). Measured: 370-380 cache hits/frame; logic 6.0-6.2 ms/step vs
  6.4-6.5 without; `Game_Map.update` 1.2-1.4 vs 1.6-2.0 ms.
- **autorunCandidates** caches the 17 trigger-1 common events (order preserved);
  **saveLocationAlloc** removes per-event array/property-key allocations; **eventsStartingNoAlloc**
  removes the filtered-array allocation in `isAnyEventStarting`.
- **idleWindows / parkedVehicles / destinationEarlyOut / overlayFixClear / masterVolumeIdle**
  skip six closed map windows, three off-map vehicles, the no-touch/no-destination branch, a
  never-drawn canvas clear, and an idempotent volume write. Each guard is the exact vanilla
  no-op condition, with an instance-level fallback.

## 6. YED classic-map fast paths (`launcher/perf/yed-fastpaths.js`)

**Mechanism.** `Game_CharacterBase.updateReflection` calls `$gameMap.isOnReflection` (position
math, then tiled/reflection checks) and assigns `reflections = []` when off a reflection. When
`$gameMap._reflection` is empty, the only result is that empty list; the fast path sets it
without the position math or a fresh array when already empty. `_updateHideOnLevel` evaluates
`currentMapLevel` (a getter that may parse a plugin parameter and read a game variable) then
loops `_tilemap._layers`; with no layers the loop body never runs, so the fast path returns
before the getter. Non-empty state delegates.

**Measurement.** `reflectionIdle` 137-199 skips/frame on map 92; small (~0.1 ms) but free.
The hide path does not fire on map 92 (layers exist), which is why it is guarded rather than
assumed.

**Control.** `OMORI_PERF_DISABLE=yedFastPaths`.

## 7. V8 polymorphic map limit (`runner/index.cjs`)

**Mechanism.** The runner's `run()` wrapper raises V8's polymorphic-map limit before the game
bootstrap compiles:

```js
const v8 = require('node:v8');
v8.setFlagsFromString('--max-valid-polymorphic-map-count=128');
```

OMORI's scene walk and its plugin wrappers touch many display-object subclasses (sprites,
windows, tilemaps, containers, particles) through the same hot update functions. Under V8's
default limit those call sites go polymorphic-megamorphic and the optimizing compiler gives up,
so the hot sprite/event update code runs deoptimized.

**Why it is safe.** A JIT configuration only; no game state, order or drawing changes.

**Measurement (map 92, standing, no breakdown, same build/counters).** Without the flag the
per-step logic is **9.4 ms** (`Game_Map` 2.4, `Spriteset` 5.1), which pushes the one-step frame
over the game's catch-up threshold, so `determineRepeatNumber` runs two steps per frame and the
game locks at **29-30 fps**. With the flag the per-step logic is **5.9-6.0 ms** (`Game_Map` 1.2,
`Spriteset` 3.7), the game stays at one step and runs **56.9 fps** standing; walking 40.2 fps in
the confirming run. The per-step counters (`OmoriPerformance.full`, offscreen, reflections) are
identical, so the difference is compiled code, not scene load.

**History.** The flag existed only in the device test build. A runner sync replaced the
integration-3 runner with the integration-2 copy and silently dropped it; the resulting 29-30 fps
was first misread as thermal/scene work (per-step logic had grown uniformly, `game_map` and
`spriteset` included). Keep the flag in the canonical runner; a build without it looks like a
50% slower game rather than a configuration change.

## 8. Measurement harness notes

- `--breakdown` wraps ~12 functions with `performance.now()`; it is for attribution, not fps
  tables. Clean vs instrumented on map 92: 54.2 vs 47-49 fps standing, 33.8 vs 29.1 walking.
- The runner used to export `OMORI_PERF_DISABLE=$DISABLE` **after** the variant environment,
  silently overwriting `--variant name:OMORI_PERF_DISABLE=...`. Fixed by exporting it first.
  Any old A/B that relied on a variant-level disable must be re-run.
- Run order matters: the first run in a batch is often 5-10% slower (page cache/thermal). Use
  balanced alternating orders and compare adjacent pairs.
- Per-thread CPU (`OMORI_TEST_CPU=1`): standing main thread 98.2% of one core, Mali backend
  7.2%, audio ~2.5%; walking main 97.4%, V8 workers 8-15% (GC/compilation), Mali 5.5%. The game
  is one sequential JS stream with idle cores; parallelism helps presentation (render thread)
  or boot preparation, not game logic.
- Standing time series from arrival (2 s windows, no breakdown): 55.1-58.2 fps for the full
  30 s, p50 16.9-17.7 ms. Walking the loop: 30-48 fps windows, full character updates swinging
  66-150/frame with the area's visible-event density; the 2-step catch-up amplifies each swing.
  The pan drop is workload density plus catch-up, not a tilemap repaint.
- Plugin census walking (`map92-walk.cpuprofile`, self ms/frame): PMJS bootstrap 13.93, native
  6.71, rpg_objects 2.71, pixi 2.09, YED_Tiled 1.44, rpg_sprites 1.22, rpg_core 1.20,
  GTP_CoreUpdates 0.72, GTP_OmoriFixes 0.43, EventSpriteOffset 0.33, YEP_CoreEngine 0.30,
  MoveRouteCore 0.22, Slippery 0.21 (cache), Olivia 0.20. YED's `_sortChildren` is
  **1.10 ms/frame** inclusive (comparator 0.99), the largest single plugin pass while walking.

## 9. Open candidates (rationale before implementation)

- **YED child sort (walking and standing).** `_sortChildren` costs 1.10-1.21 ms/frame
  inclusive in the walking and standing profiles, 0.99-1.03 of it in `_compareChildOrder`'s
  `z`/`y`/`priority` reads over 506 children. Extracting each child's four keys once and
  sorting index records with the exact comparator (including the original-index tiebreak, so
  stability is reproduced) was **neutral** in two device A/Bs, in both an object-record and an
  allocation-free typed-array version: standing build 8.4 vs 8.7 ms and walking build 10.8 vs
  10.9 ms, with fps inside noise. The reason is arithmetic: TimSort over a nearly sorted 506
  array makes about one comparison per child, so the stock comparator's getter reads are the
  same order as reading all four keys once; the profile's accessor cost is inflated by
  sampling. Do not retry key extraction without a mechanism that avoids reading unchanged keys
  (for example knowing which sprites moved).
- **Standing frame composition (map 92, fast boot, standing profile, ~527 frames/10 s):**
  tick 14.44 ms (renderScene/build **8.32**, updateMain/logic **6.07**), renderFrame 0.57
  (native 0.50), swapFrame **2.54** (native, `SDL_GL_SwapWindow`), program 0.26. The swap is
  the largest single optimizable item after build; uncapping the swap interval (0) changed
  standing 55.4 -> 56.9 fps, so the wait is not the frame limiter but hiding it on a render
  thread would still overlap ~2.5 ms.
- **Stock ShaderTilemap pan spikes (earlier hypothesis, disproved).** The walking profile shows
  `_paintAllTiles`/`_paintTiles` at 0.00 ms: map 92 uses YED's retained `TiledTilemap` (its
  `_compareChildOrder` is in the profile), so the stock window repaint is not the pan cost.
- **Retained/delta scene encoding.** The encoder re-walks and re-serializes every node each
  frame; per-node classification memoization (~0.4 ms) and retained records (~1 ms) are the
  candidates. The culling experiment (integration-2 feature restored) was neutral on map 92
  (44.0 vs 45.3 fps warm) and was not kept.
- **Native render thread (measured 2026-10-25, not shipped).** A probe proved SDL allows
  `SDL_GL_MakeCurrent`/`SDL_GL_SwapWindow` from a worker thread on this Mali/KMSDRM device
  (`worker_make_current=ok`, `swap=ok`, main context restored). A swap-only worker prototype
  (context alternation, deferred `beginFrame` GPU reset, guards on the GL bindings, no added
  frame latency) moved 1.2-2.0 ms (standing) and 4.0-4.5 ms (walking) of present off the main
  thread with main-thread waits of 0.005-0.065 ms, i.e. fully overlapped. A/B map 92: standing
  56.8-57.0 off vs 56.0-56.4 on; walking 35.8-36.6 off vs 36.9-37.3 on. **The present is not the
  limiter**: fps is set by the frame work and the 60 Hz pacing, not by the swap; the worker adds
  context-switch/driver contention. Do not ship it. The frame budget at standing is build 8.3 ms
  + logic 6.1 ms + renderFrame 0.6 ms; those are the next targets, along with the runner's
  per-frame overhead/pacing.
- **Plugin long tail.** `evidence/logic-20261025/plugin-census-map92.txt` ranks per-frame self
  time by file: YED_Tiled 1.67, GTP_CoreUpdates 0.76, YEP_SlipperyTiles 0.59 (now cached),
  GTP_OmoriFixes 0.50, Omori BASE 0.45, then sub-0.2 layers. Next: GTP window/tilemap loops and
  the YEP chase/move-route/movement-graphics chains.

## 10. Reproduce

```
tools/omori-test.sh room --room 92:21:11 --settle 18 --measure 8 --breakdown --variant base
tools/omori-test.sh room --room 92:21:11 --settle 18 --measure 10 --variant cpu:OMORI_TEST_CPU=1
```
The device runner uploads the current harness/runner/culling patch; perf modules in the port's
`perf/` directory are uploaded separately. A full run leaves logs under
`/mnt/mmc/ports/omori-pmjs2/tests/<time>-room/`.
