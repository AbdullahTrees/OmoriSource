# PMJS performance on OMORI / RG40XX-H: the White Space filter-chain cost

Measured 2026-10-21 on an Anbernic RG40XX-H (muOS 2502.0 PIXIE, Allwinner H700,
4x Cortex-A53 @ 1.51 GHz, Mali-G31 at up to 648 MHz, 973 MB RAM, no swap).

Two PMJS runtimes were measured:

| Runtime | Build |
| --- | --- |
| old | `build-2026-10-20-eb96ef4-8` (the release installed on the test device) |
| new | `build-2026-10-20-640aaa1-11` (latest at the time) |

The game is the decrypted `www` from Steam v1.0.8, unmodified. Bench starts a
new game, transfers to White Space (map 87, x=28 y=27) and walks left/right
after 30 s.

## Result

**White Space runs at 11.6-11.7 fps on both runtimes. The limiter is not a
frame cap or vsync: it is the offscreen filter-group path that PMJS enters as
soon as one container carries more than one filter.**

Frame budget (old runtime, steady state):

| Component | Time |
| --- | --- |
| MV tick (update + scene command build) | 33-38 ms (update 22-25, scene build 11-13) |
| Native draw inside the GPU driver | 44-49 ms |
| Swap + scheduling | 2.9-4.0 ms |

- `swap+idle` is ~3 ms, so the loop never waits on the display. The pacing code
  is doing its job: on the splash screens (work ~4 ms) the same loop waits
  ~13-46 ms on vsync and reports 55-60 fps.
- The main JS/render thread uses ~5.4-5.6 s of CPU per 10 s (about 56%); the
  rest of the native-draw time is blocked in the Mali driver. The GPU devfreq
  was at its maximum (648 MHz) during the runs.
- At 11.6 fps the game's own `SceneManager.updateMain` accumulator runs about
  five 60 Hz logic steps per rendered frame, which inflates the tick; the tick
  shrinks as fps rises (32-34 ms with filters off).

## Filters on the map

Runtime inventory of enabled filters in White Space:

| Host | Enabled filters | Disabled filters kept by the game |
| --- | --- | --- |
| `Scene_Map/Spriteset_Map` | `BlurFilter`, custom FilterController filter `t`, custom FilterController filter `n` | `t`, `n`, `n` |
| `Scene_Map/Spriteset_Map/Sprite` | `ToneFilter` | - |
| `Scene_Map/WindowLayer` | `AlphaFilter` | - |

Renderer counters at baseline (5 s window, 58 frames): ~28 draw calls/frame,
13 of them filter draws; 2 filter applications of kind `custom` per frame;
2 filter-target acquires and 2 reuses per frame; 1 identity-shader filter draw
per frame.

The Spriteset filters are the screen-effect filters that
`Aries001_AnimationScreenEffects.js` creates for every spriteset. They sit in
the live filter array at zero strength so an animation can ramp them up later.
The runtime properties (logged from the live objects) are:

| Filter | Runtime properties | Passes in the custom plan | Identity while idle |
| --- | --- | --- | --- |
| `BlurFilter` | `blur=0`, `blurX=0`, `blurY=0`, `quality=4` | 8 (two directions x quality 4) | yes |
| `t` = `ZoomBlurFilter` | `strength=0`, `uStrength=0`, `innerRadius=0`, `radius=-1` | 1 | yes |
| `n` = `AdvancedBloomFilter` | `bloomScale=0`, `brightness=1`, `blur=0`, `quality=4` | 3 | yes |

Each is an exact identity at these values, per the shaders the game ships:

- pixi's blur fragment shader weights sum to 1 (2 * kernel sum - centre
  weight = 1.0 for every kernel size); with strength 0 every tap samples the
  same texel, so the output equals the input.
- The ZoomBlur shader does `dir *= uStrength` before sampling and divides by
  the accumulated weight; at strength 0 every sample is `vTextureCoord`.
- The AdvancedBloom composite is
  `out = input * brightness + bloom * bloomScale` with the bloom alpha forced
  to 0; at `bloomScale=0, brightness=1` it is the input exactly.

So the 12 passes that cost ~45 ms per frame in White Space compute an identity
image. This is the whole of the frame's filter cost; there is no visible blur
or bloom on the map.

## Ablations

All phases are 10 s long (two 5 s profiler reports each) and change only the
`filters` arrays of the live display objects. Tone and Alpha are present in
every phase unless stated otherwise. The numbers are the two reports in each
phase: fps and native draw per frame.

### Remove one filter at a time (corrected)

The first version of this experiment removed entries from the array by
identity, which does not change the array the renderer reads: every phase kept
the same 12-pass plan, and the table looked like "no single filter helps". The
corrected run splices the live arrays and logs each plan:

| Phase | plan passes | fps | native draw |
| --- | --- | --- | --- |
| baseline (3 on Spriteset) | 12 | 11.7 | 42-48 ms |
| remove `BlurFilter` (2 remain) | 4 | 22.5 | 4.6 ms |
| remove `t` (2 remain) | 11 | 18.5 | ~23 ms |
| remove `n` (2 remain) | 9 | ~16 | ~16 ms |
| remove `ToneFilter` | 12 | 11.6-11.7 | 43-48 ms |
| remove `AlphaFilter` | 12 | 11.7 | 41-47 ms |
| all filters off | 0 | 25.7 -> 29.8 | 5.5 -> 2.0 ms |
| restored | 12 | 11.7 | 45-48 ms |

The composite `BlurFilter` is 8 of the 12 passes (two directions times quality
4); `t` is one pass and `n` is three. Removing any one filter shortens the
chain; what matters is that the Spriteset enters the custom-plan path at all.

### Remove filters per container

| Phase | fps | native draw |
| --- | --- | --- |
| baseline | 11.7 | 43-49 ms |
| all `Spriteset_Map` filters off (Tone + Alpha remain) | 24.7 -> 28.3 | 5.0 -> 2.0 ms |
| Tone + Alpha off (Spriteset chain remains) | 11.7 | 46.5 ms |
| all filters off | 26.7 -> 29.4 | 4.3 -> 2.0 ms |
| restored | 11.7 | 46-48 ms |

The Spriteset container is the trigger; Tone and Alpha contribute nothing while
the Spriteset chain exists.

### Keep only one filter on the Spriteset

"Only X" here means: restore every host, then keep only X on its host. Tone and
Alpha therefore stay active in all of these phases.

| Phase | fps | native draw |
| --- | --- | --- |
| baseline (3 on Spriteset) | 11.7 | 42-44 ms |
| only `BlurFilter` | 23.8 -> 27.2 | 6.2 -> 2.7 ms |
| only `t` | 27.7 | 2.7 ms |
| only `n` | 27.4 | 2.7 ms |
| all filters off | 26.2 -> 30.0 | 5.4 -> 2.0 ms |

(Only-Tone and only-Alpha were no-ops relative to baseline: those hosts already
carried exactly one filter and the Spriteset chain remained, so they measured
11.7 fps. They are excluded from the informative table.)

A lone composite `BlurFilter` never enters the custom-plan path (it has no
fragment shader of its own), and a lone `t` or `n` becomes a one- or three-pass
plan. Mixing them with the blur expands the blur into its eight directional
passes inside one plan, which is why the whole chain costs far more than the
sum of its parts seen alone.

## The fix: elide identity filters

`js/pmjs-pixi4/scene-filters.js` now leaves identity filters out of both the
custom plan and the fallback group chain:

- `BlurFilter` with `blurX == 0` and `blurY == 0`
- `ZoomBlurFilter` (the game's `t`) with `strength == 0`
- `AdvancedBloomFilter` (the game's `n`) with `bloomScale == 0` and
  `brightness == 1`

The check runs against the live filter array every frame, so a filter that an
animation starts ramping up is included again on the next frame.

Measured in the same White Space scene, same runtime and bench:

| | baseline | with the fix |
| --- | --- | --- |
| fps | 11.7 | 29.4 |
| native draw | 42-48 ms | 2.7 ms |
| tick | 33-39 ms | 29.3 ms |
| swap+idle | ~3 ms | 2.0 ms |
| Spriteset custom plan | 12 passes | gone |
| remaining filter plan | - | 1 pass (Sprite ToneFilter) |

The fixed frame time matches the all-filters-off ablation (29.7 fps, 2.1 ms):
the 12 identity passes were the whole difference. The next limit is the JS tick
(~29 ms: update ~19.7, scene build ~8.9), not the renderer.

### Visual check

Both builds were run with the same bench, which parks the player at the
transfer point (28,27) after the map intro and holds no input. Frames were
captured 100 s after the map line and compared pixel for pixel (640x480 BGRA
framebuffer dumps):

- Flat areas (the white field), the laptop and the lightbulb sprite are
  pixel-identical.
- The player sprite and the room outline differ only on edge pixels, by at
  most 33/255: black 0 -> 12 and white 255 -> 235 in the stock frame. The
  stock path renders the spriteset through a power-of-two offscreen target and
  samples it back, so it resamples edges by a fraction of a pixel; the fixed
  path draws the spriteset directly and comes out slightly sharper.
- The other differences are the cat's animation phase (up to 255 on its own
  pixels), the lightbulb cord's slow sway, and the muOS volume OSD that the
  system draws over the top-right corner (a black box with a number that
  changes between captures; not part of the game).

No blur or bloom appears in either frame. A real blur at strength 8 would
spread every high-contrast edge over several pixels with differences near 255;
here single edge pixels move by at most 33, and only because the old path
resampled them.

## Interpreting it

Measured facts:

- The plan's cost tracks its pass count but not linearly: 12 passes ~45 ms,
  removing the 8 blur passes leaves 4 passes ~4.6 ms, removing `t` leaves 11
  passes ~23 ms, removing `n` leaves 9 passes ~16 ms. Every pass is an
  offscreen target switch at 1024x512 (power-of-two 640x480).
- The custom-plan path is entered when any filter in the chain carries a
  fragment shader (`t` and `n` do); the composite `BlurFilter` is expanded
  into 8 passes inside that plan even at strength 0.
- Tone (identity color matrix on a Sprite) and Alpha (alpha 1 on WindowLayer)
  are cheap single-pass plans on their own hosts; they do not matter while the
  Spriteset chain exists.
- With the identity filters elided the map runs at the same rate as with all
  filters disabled, so no visible effect was lost.
- The new runtime had an identical baseline before the fix (11.7 fps,
  tick ~35, native ~45).

Code paths involved:

- `js/pmjs-pixi4/scene-filters.js` (`nativeRecordCustomFilter`) turns a
  container's filter chain into one native "custom filter plan". For more than
  one filter it allocates an extra intermediate target and emits every filter
  pass; targets are power-of-two sized (`pot(width) x pot(height)`), so a
  640x480 frame becomes 1024x512.
- `src/renderer_draw.cpp` has an inline path (the `inlineFilterMatrix` block,
  around lines 516-560). It only inlines `FilterKind::colorMatrix` filters at
  filter depth 0 and explicitly disqualifies a nested `filterBegin`, so a chain
  of two filters - even two color matrices - cannot be inlined. It falls back
  to the offscreen group path (`filterBegin`/`filterEnd`, around lines 1213+).
- `src/renderer_custom_filters.cpp` already detects identity color-matrix plans
  (`isIdentityColorMatrixPlan`) and substitutes an identity shader, but still
  draws the pass; `identityFilterShaderDrawCalls` counts one such pass per frame.

Not yet proven: why each additional pass costs roughly 3.4 ms of wall time on
this driver. Candidates are per-pass framebuffer/target switches in the Mali
driver, the cost of the custom shaders, and the POT target size (about 1.7x the
frame pixels for one target). The device exposes no GPU counters and has no
`perf`/`strace`/`gdb`; `/proc/<pid>/stack`, `/proc/<pid>/task/*/schedstat` and
the renderer counters are available.

## What could improve the engine

1. **Cheaper group path for real effects.** The multi-pass custom plan still
   runs when an effect actually applies (battle transitions, animation screen
   effects). Avoid power-of-two targets when the sampling does not require
   them, reuse plan targets across frames (the guest rebuilds the plan each
   frame), and investigate whether the per-pass framebuffer switches flush the
   Mali pipeline.
2. **Inline filter chains.** For non-identity chains, apply inlineable filters
   during the scene draw instead of entering the offscreen group. Consecutive
   color matrices compose exactly. Identity elision removed the White Space
   case; this matters where filters do real work.
3. **The JS tick is now the limiter on the map.** With the filters gone the
   tick is ~29 ms (update ~19.7, scene build ~8.9) against a 2.7 ms native
   draw; the 60 Hz logic loop runs about two steps per presented frame.
   Further map performance needs less per-frame JS, not less GPU work.

## Reproducing

Device layout used:

- runtime (old): `/root/pmjs-test/pmjs-linux-arm64`
- runtime (new): `/root/pmjs-test2/pmjs-linux-arm64` (build `640aaa1-11` plus
  the `GTP_OmoriFixes` adapter from PMJS PR #1)
- game: `/mnt/mmc/ports/omori-test/www`
- test launcher: `/mnt/mmc/ROMS/Ports/OMORI (PMJS test).sh`
- logs and cache: `/mnt/mmc/ports/omori-pmjs/` (old) and
  `/mnt/mmc/ports/omori-pmjs2/` (new)

Bench and profiler patches in this folder are test-only:

- `pmjs-bench.js` - logs fps every 5 s, starts a new game, moves to map 87 and
  walks.
- `pmjs-bench-pin.js` - the same, but after the intro it parks the player at
  (28,27) with no input, so frames from two builds render the same camera and
  can be compared pixel for pixel.
- `profile-patch.js` - wraps `__pmjsTick`, `__pmjsRender` and
  `__pmjsAfterPresent`, logs 5 s averages for tick/update/scene build/native
  draw/swap, memory counters once per report, and optionally runs filter
  ablations:
  - `PMJS_ABLATE=1 PMJS_ABLATE_MODE=single` - remove one filter at a time
  - `PMJS_ABLATE_MODE=groups` - per container
  - `PMJS_ABLATE_MODE=only` - keep only one filter on its host

  It also logs the pass count and resolutions of every custom filter plan
  (`[plan]`), and the inventory prints the live filter properties (blur,
  strength, bloomScale, quality, resolution, uniform values). Counter deltas
  are taken from numeric copies: the renderer's `stats()` returns one cached
  object that it mutates in place.

Example (run over SSH, launcher passes both patches):

```sh
PMJS_ABLATE=1 PMJS_ABLATE_MODE=only \
PMJS_EXTRA_PATCH=/mnt/mmc/ports/omori-pmjs/profile-patch.js \
PMJS_TIMEOUT=230 bash "/mnt/mmc/ROMS/Ports/OMORI (PMJS test).sh"
```

Thread CPU is sampled from `/proc/<pid>/task/*/stat` (USER_HZ deltas) in 10 s
windows; `native draw` above is the `frameCosts` wall time reported by the
native renderer (`drawMs`), not CPU time.

Visual captures: `cat /dev/fb0` while the game runs (640x960 BGRA, two
640x480 pages), convert with `tools/fb2png.py`, and compare pages with
`PIL`/`numpy` (per-channel max difference per region). The `[bench] pinning`
line in the log marks the frame the player was parked; frames are taken 100 s
after the map line. The muOS volume OSD sometimes draws a black number box in
the top-right corner and is not part of the game; exclude that box from
comparisons.

## Memory notes (same runs)

| | old runtime | `640aaa1-11` |
| --- | --- | --- |
| fps | 11.6-11.7 | 11.7 |
| tick / native draw | ~35 / 44-48 ms | ~35 / 45-48 ms |
| images GPU memory | 64.4 MB (peak 74.3) | 4.7-8.8 MB |
| images CPU memory | 92.0 MB | 110.3 MB |
| render targets | 14.3 MB | 14.3 MB |
| process RSS | ~580-677 MB | ~551-580 MB |
| system available while playing | ~185-200 MB | ~260-280 MB |

The new runtime's palette/sparse prepared images save ~100 MB RSS and about 7x
GPU image memory, with no fps change.

## Raw data

- `raw/profiled-baseline-old-runtime.log`, `raw/new-runtime-640aaa1-11.log` -
  the runtime comparison.
- `raw/ablation-per-filter.log` - the first, invalid per-filter table (see the
  retraction above); `raw/ablation-per-container.log` and
  `raw/ablation-keep-only-one.log` - the valid early ablations.
- `raw/ablation-index-based-plans.log` - the corrected per-filter run: plan
  pass counts of 12 / 4 / 11 / 9 through the phases.
- `raw/elision-device-run.log` - the fixed build in White Space: steady
  29.4-29.7 fps, native draw 2.7 ms, no Spriteset plan.
- `raw/elision-visual-check.txt` - the region-by-region pixel comparison of
  the stock and fixed frames.
- `frames/stock-pinned.png`, `frames/fixed-pinned.png`,
  `frames/stock-vs-fixed-diff.png` - the pinned-player frames and their
  difference heatmap.

The per-phase fps and native-draw numbers quoted above come from these files.
