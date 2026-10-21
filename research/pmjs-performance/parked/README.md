# Parked PMJS changes

## olivia-horror-fused-update.patch
Fuses Olivia_HorrorEffects' per-sprite `update` with its dispatcher: skips
`synchronizeHorrorFiltersWithSource` when the sprite has no filter source (the whole body is
inside that check, l.987-1049) and skips `updateHorrorEffects` when no horror filter is active;
any replaced method falls back. Correct (tests pass), but `fused-ab.log` (2026-10-21) measured
no reliable gain on maps 14 and 111 (about 0.4 ms per frame, within drift), so it was parked
rather than adding guard complexity. Apply against PMJS `8f83848` with `git apply`.
