# Where the Faraway house frame goes (2026-10-22)

Source: fresh-state CPU profiles (no rain), RG40XX-H, `raw/session-20261021-continuation/profiles-fresh-rooms/`.
Map 14 (Player's house, day) at 13.0 fps and map 78 (Player's home, night) at 13.6 fps; ~21 s each.
Tree view: `node cpuprofile-tree.js <profile> <frames> "<root label>" [min ms] [depth]`
(frames = fps × profile seconds: 279 and 291).

## Per-frame breakdown, map 14 (72 ms/frame while profiling; 2 logic steps per frame)

| Part | ms/frame | Notes |
| --- | ---: | --- |
| `Spriteset_Map.update` (sprite updates) | 33.8 | almost all inside `Tilemap.update` (GTP_CoreUpdates) |
| - YED_Tiled reflection sprites (`Sprite_CharacterReflect.update`, YED_Tiled.js:2381) | **15.0** | full `Sprite_Character` update per character, then `visible = reflections.length > 0`; invisible almost everywhere |
| - character sprites (`Sprite_Character.update` chain) | **13.2** | Omori BASE → Liquid_EventIcons → YEP_EventMiniLabel → stock; `updateFrame` ~5, `Sprite_Base.update` ~2, `updatePosition` ~1.5 |
| - of which mini-label window construction | ~2.8 | GTP staggers `setupMiniLabel` by child index, so windows are still being built ~17 s after map entry; reflections get labels too |
| PMJS scene encoding (`renderNativeStage`) | 16.3 | `prepareTransforms` 6.1, `encodeNativeScene` 8.2; **no viewport culling**: every node is transformed and encoded |
| Game logic (`Scene_Map.updateMain`: map, events, interpreters, player) | 8.3 | ~4 ms per logic step; not the problem |
| Windows and the rest | ~2 | |

Map 78 has the same shape (reflections 13.9, characters 13.1, logic 8.3, encode 15.8 ms/frame).

## Why
Maps 14 and 78 are 90×80 tiles holding the whole house; the 20×15-tile view is ~4% of the map. 168 events,
each with a character sprite and a reflection sprite, so ~340 full sprite updates per logic step (~40 µs
each), ~95% of them for sprites that are off screen or invisible. Rain Town (19% visible) and White Space
(10%) suffer less, which matches their higher fps.

## Levers, largest first (estimates from the profile, not yet measured)
1. **Reflection sprites:** skip `Sprite_CharacterReflect`'s inherited update while the character has no
   reflections (the sprite stays invisible); run the full update on the step it becomes visible. ~13–14 ms.
   Care: reflection sprites can consume a character's animation/balloon request before the real sprite
   (whichever updates first calls `setupAnimation`); check order and keep vanilla's outcome.
2. **Off-screen character sprites:** skip the update of idle sprites well outside the viewport (no active
   animation, balloon or pending request), full update on re-entry. ~10–12 ms. Invisible deviation: sprite-side
   counters pause while off screen.
3. **PMJS viewport culling:** skip transforms and encoding for subtrees whose conservative bounds are outside
   the screen (respect filters, masks, `filterArea`). Pixel-identical. ~8–10 ms.
4. **Mini labels:** extend PMJS's `event-mini-label` adapter to OMORI's version (plus GTP's delay wrapper) so
   pages without label tags never build a window; skip reflections. ~3 ms for the first ~17 s per map, and
   roughly 300 fewer canvases in memory.
5. Game logic (~8 ms/frame) only after the above.

1–4 together project from ~72 to ~35–40 ms/frame on these maps, i.e. around 25–30 fps, before any engine work.
