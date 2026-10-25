# Menu session unload (parked 2026-10-25)

`menu-unload.js` records the windows created while a pause-menu scene is being built and, when
the menu returns to the map, releases their owned bitmap canvases (back, frame, cursor, contents,
arrows, pause sign) through PMJS's canvas width setter / native release path. It skips
ImageManager bitmaps and the shared `SceneManager` background snapshot. The release happens
inside the existing close tick, not as a garbage collection.

## Measured on the RG40XX-H

- Per menu session: 19 windows / 70 canvases / 6.6 MB released; 9.3 ms for the first close,
  ~5.7-8.7 ms after that (one run's first close took 28.2 ms).
- 14-cycle menu+options storm: 266 windows / 980 canvases / 93 MB released in 145 ms total,
  release maximum 28.2 ms. No errors, no visual or gameplay failure.
- Soak A/B (14 cycles, no forced GC): with the unload, live native canvas plateaued at 35 MB and
  GPU images at 53 MB; without it, 42 MB and 60 MB. But the MemAvailable decline from the
  session's start was identical (230 -> 144-149 MB with the unload, 166 -> 78-87 MB without):
  the freed memory is reused by the next session, so the plateau relative to the starting
  baseline does not move.

## Why parked

The crash this was written for is decided by the launcher watchdog floor versus the game's
working set (the same storm completes at 78-87 MB available under a 60 MB floor). Freeing 6.6 MB
of window canvases per session is real native-memory hygiene but does not raise that plateau, so
shipping it adds a moving part without fixing the failure. It also needs a within-session
randomized A/B with a post-GC + later-task settle sample (the current synchronous after-GC sample
cannot see FinalizationRegistry releases) before anyone can claim a per-cycle memory benefit.

The structural version belongs in PMJS, not a game patch: release the native canvases of a scene
at `Scene_Base.terminate`/destroy (a scene-lifecycle release hook exists in name only —
`canvas.js` has a `sceneLifecycle` counter with no writer; only `Scene_Map` gets
`releaseSceneResources`). That would free every scene's canvases deterministically, including
maps, battle scenes and menus, without game-specific window knowledge.
