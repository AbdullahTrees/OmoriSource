# NWCompat review — 2026-10-21

Source: [fifomori/nwcompat](https://github.com/fifomori/nwcompat), pinned to
`6e8db27355bbd07166a0833730cf85510d3a9194`. Local inspection copy:
`../omori-handover/research-nwcompat` relative to OmoriSource.

This repository patches OMORI's JavaScript to run in an Android browser host.
It bundles PIXI 6.5.10 and browser replacements for Node modules; it is not a
collection of native NW.js engine patches. No NWCompat implementation was
copied into PMJS during this session. Its root license is MIT, copyright
2024 cafeed28; retain its notice and check the provenance of individual
borrowed implementations if code is reused later. Its README also credits
other Android ports and MV/PIXI upgrade guides.

## Best lead: duplicate template-map preloads

[common/performance.js, lines 1–42](https://github.com/fifomori/nwcompat/blob/6e8db27355bbd07166a0833730cf85510d3a9194/patches/common/performance.js#L1)
replaces Yanfly's async read/decrypt/parse with a synchronous operation. A
comment reports a boot-time improvement, but that number is not a PMJS or
handheld measurement.

OMORI's three Yanfly loaders return early only when
`Yanfly.PreloadedMaps[mapId]` is truthy. They set it to null while loading,
so another call before completion starts another read and JSON parse.
`SetupParameters()` executes during each plugin's evaluation.

Configuration-only audit of our actual `project/js/plugins.js`:

| Plugin | Calls configured | Distinct maps | Repeated calls |
| --- | ---: | ---: | ---: |
| YEP_EventCopier | 255 | 23 | 232 |
| YEP_EventMorpher | 10 | 10 | 0 |
| YEP_EventSpawner | 13 | 10 | 3 |
| Across all three | 278 | 23 | 255 |

EventCopier alone requests map 2 116 times and map 3 94 times. Reproduce with
`node research/pmjs-performance/nwcompat-preload-audit.cjs` from OmoriSource.
These are configured calls, not observed physical disk-read counts. Actual
duplication depends on when completions run and the host's filesystem shim.

Recommended follow-up: instrument reads and parses during PC/device startup,
then coalesce pending loads by normalized map ID while keeping null pending
state, asynchronous completion, error behavior, and the existing map-ready
barrier. Hook before `SetupParameters()`, across all three plugin definitions;
an ordinary after-load wrapper misses the first plugin's initial burst. Pin
the reviewed loader sources and refuse unknown compositions. Do not substitute
a truthy pending sentinel: consumers interpret truthiness as fully parsed data.
The existing PMJS event-copier adapter waits for readiness but does not deduplicate
these initial requests. Blocking I/O would change scheduling and startup event
polling, so the NWCompat implementation needs more review before reuse.

## Other patches and applicability

| Idea | Assessment for PMJS |
| --- | --- |
| Reuse a GPU render texture for menu backgrounds | Worth investigating if menu entry is slow. PMJS already supplies native bitmap snapshots/blur. NWCompat changes the snapshot/blur path and shares a sprite across scenes; require visual and lifecycle comparisons first. |
| Build window borders/cursors from sprites, backported from MZ | Potential reduction in canvas redraw/allocation. PMJS already has native window preparation paths. NWCompat also suppresses Archeia's frame override, so direct reuse can alter authored styling and child structure. |
| Cache `DataManager.loadGlobalInfo` | Startup/menu lead only. PMJS already coalesces physical storage reads within a turn. NWCompat's longer-lived parsed cache needs mutation, save/delete/restore, and external-write invalidation review. |
| Cache all map/Tiled/tileset objects | Conflicts with the current memory priority on 1 GB devices. Cached objects are reused by reference and `DataManager.onLoad` repeats; review plugin mutation and use a bounded cache before considering this. |
| `willReadFrequently` canvas option | Chromium canvas allocation hint, not a direct optimization for PMJS's native canvas backend. |
| Replace OMORI's ticker/update loop | Do not adopt: [omori/performance.js, line 49](https://github.com/fifomori/nwcompat/blob/6e8db27355bbd07166a0833730cf85510d3a9194/patches/omori/performance.js#L49) runs one update per rendered frame and removes the game's repeat calculation. At 30 rendered fps this changes simulation progress versus vanilla's two steps per frame. |
| PIXI 6 compatibility and filter substitutions | Browser-renderer migration work; PMJS implements its own PIXI 4/native renderer contract. A filter-class substitution can change pixels. |
| Remove pixelation/resolution snapping | Deliberately changes presentation; unsuitable for preserving vanilla looks. |

Inspected `patches/index.js`, both performance files, both PIXI files,
`omori/plugins_undo.js`, package metadata, README, and root license. This is a
bounded source review, not a complete Android-port audit or a performance test.

## Session implementation and evidence

The changes made this session follow the handover rather than importing the
browser patches: unused tilesets load without a prepared-map scope; live map
preparation stops returning offline-only compilation receipts; character frame
updates defer presentation lookup until a bitmap has zero dimensions.

`map-retention-probe.cjs` exercises actual PMJS preparation with the maintained
test mock and 32 synthetic maps (7,077,888 tile entries), retaining its returned
report after forced GC. Baseline `1590601`: 57,038,912-byte live-heap increase;
fixed: 80,000 bytes. Both select 32 maps, reuse 32 compilations, and report no
error. RSS after collection was 143,577,088 versus 83,333,120 bytes in these
individual host runs. This demonstrates ownership release; it does not measure
handheld RSS, peak preparation memory, native fragmentation, or gameplay FPS.

Run under Node 22 with `--expose-gc`, passing `1590601` for the baseline and
no argument for current code. The probe's first pass populates the index; its
second pass validates the warm index without the optional catalog API, matching
the slow warm path. Temporary data is confined to PMJS's test-cache directory
and cleaned by the existing test helper.

Local PMJS commits: `8df29fc` (unused tilesets, finishing the inherited draft),
`a679917` (live receipt lifetime), `78587a2` (character lookup). Focused Node 22
tests: 42/42 pass. The broader run reports 1,444 passed, 9 failed, 5 skipped;
the same eight build-environment failures occur on `1590601`, and both versions
hang in `runner.test.cjs` until that test process is killed. Thus the broader
comparison found no new failure names but is not a clean full-suite pass.
Details and raw log paths are in `../omori-handover/DELIVER.md`.

## Subsequent device validation

The user approved one two-map test and supplied the device's current address,
`192.168.68.105`. With the three fixes installed, a catalog-missing startup
completed map validation in 71.56 seconds and visited both maps successfully:

| Map | FPS | JS tick ms | RSS MiB | JS heap MiB | Map catalog |
| --- | ---: | ---: | ---: | ---: | --- |
| 87 White Space | 27.1 | 32.11 | 711.3 | 135.0 | present |
| 90 North Coast | 28.3 | 30.68 | 718.2 | 119.3 | deleted |

The heap readings support releasing the slow-path receipts; RSS remains high.
The diagnostic also reports ~154 MiB free inside malloc arenas and ~110 MiB
CPU image data. These categories overlap other accounting and should not be
summed as an RSS breakdown.

**The unused-sheet workaround does not finish the catalog fix.** North Coast
records nine scoped loads, one unscoped load, and no guest refusal reason, but
the catalog still disappears. The image catalog survives. Native source,
page/snapshot, or VFS mismatch paths need instrumentation before another fix
is selected. The handover's unused-sheet explanation was incomplete.

Both maps recorded zero error events; the tour finished and exited without a
watchdog kill. A White Space framebuffer looks normal, but no matched baseline
capture or isolated FPS comparison was made. No second game run was started.

Evidence: `raw/session-20261021-two-map.log` and
`raw/session-20261021-two-map-summary.json`. The delivery document records
device backups, exact settings, and the remaining approval boundary.
