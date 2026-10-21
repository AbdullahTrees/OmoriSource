# Omori Source
OMORI v1.0.8 as an unencrypted RPG Maker MV project, with every script readable as plain JavaScript.
This is for educational purposes only.

The `project/` folder is byte-identical to a known-good decrypted copy of the game's `www/` folder.
`tools/verify_parity.py` checks this (see [Verifying the files](#verifying-the-files)).

---

# Status

* Boots and plays on Windows with the game's own runtime (NW.js 0.29.0).
* Boots, loads saves and enters maps on Linux (x64, NW.js 0.29.0) through the launcher layer described below.
* No encryption anywhere: data, maps, languages, scripts, images and audio are all plain files.
* `tools/verify_parity.py project` reports 0 missing and 0 changed files.

---

# Layout

| Path | What it is |
| --- | --- |
| `project/` | The game, byte-identical to OMORI's `www/` folder. Never edited by hand. |
| `package.json` | Launcher manifest. It plays the role of the `package.json` next to `OMORI.exe`, but points at `project/` and loads `launcher/compat.js`. |
| `launcher/compat.js` | Injected by NW.js before any game script. It logs parity warnings everywhere and applies the Linux fixes on Linux; on Windows it changes nothing. |
| `launcher/omori-performance.js` | Runtime patch for slow hardware: skips the per-step update of character and reflection sprites that are off screen or invisible, keeping every part that feeds back into game state. Loaded by PMJS with `--patch`; under NW.js only when `OMORI_PERF_SPRITES=1`. |
| `launcher/pmjs/` | OMORI-specific runtime patches for the [PMJS](https://github.com/bbbreaddd/pmjs) runtime (`--patch`): a faster character-frame path, and a boot fix needed until PMJS ships NW.js semantics for exceptions in Node fs callbacks. |
| `pmjs/` | PMJS as a git submodule, for working on runtime fixes that go upstream. |
| `tools/` | The build script, Steam extractor and patch, and the parity checker with its hash manifest. |

The game's own files can't change without breaking parity, and when running from a Steam install they're encrypted anyway.
Platform fixes therefore live in `launcher/`.
OMORI's real install is laid out the same way: its `package.json` sits outside `www/`.

---

# Building

Requires Python 3 and an internet connection the first time (to download NW.js).

```
python tools/build.py                      # Windows build in build/windows/
python tools/build.py --platform linux     # Linux x64 build in build/linux/
python tools/build.py --sdk                # include the F12 developer console
```

Then run `build/windows/OMORI.exe` (or `build/linux/OMORI`).

**Building from your own copy of the game.** Use `--game` to build from an OMORI install instead of `project/`. It also needs Node on your PATH:

```
python tools/build.py --game "C:\Program Files (x86)\Steam\steamapps\common\OMORI"
```

`tools/extract.js` turns the install into a plain `www/`, file by file, so encrypted, decrypted and partly decrypted installs all work:
* Encrypted files are decrypted (see [File formats](#file-formats-in-the-steam-release)).
* Steam's versions of 11 scripts are patched to the working ones with `tools/steam-to-reference.patch`, a readable unified diff. `System.json` gets a direct edit that turns off its encryption flags.
* Steam-only files (Steam libraries, leftovers) are left out.

A Steam v1.0.8 install comes out identical to the reference. Missing or changed files don't stop the build; they're listed in the build's `parity.json`, and the game logs a warning about them at startup (`[compat] game files differ from the reference ...`).

`tools/make_patch.py` regenerates the patch if the reference ever changes.

The script downloads NW.js 0.29.0 (32-bit on Windows, like the shipped game) and caches it in `build/.cache/`.
It then lays the build out the way OMORI ships: the runtime, `package.json`, `launcher/` and `www/` (a copy of `project/`).
Saves in `project/save/` are copied in, and the build fails if `www/` doesn't match the reference manifest.
Each run deletes and rebuilds the output folder, **including its saves**, so copy any saves you want to keep out of `build/<platform>/www/save/` first.
`build/` is ignored by git.

---

# Running the game

The game needs **NW.js 0.29.0** (Chromium 65, Node 9.7.1), the same runtime OMORI ships with.
Point NW.js at the **repository root**, not at `project/`, so the launcher layer is loaded.

**Windows: reuse the runtime from your own OMORI install**
1. Make a new folder and copy everything from your OMORI install into it **except** `package.json` and `www/`.
2. Run `OMORI.exe path\to\OmoriSource`.

`OMORI.exe` ignores the folder argument if a `package.json` sits next to it, so leaving that file out of step 1 matters.

**Any platform: download NW.js 0.29.0** from [nwjs.io](https://dl.nwjs.io/v0.29.0/) and run `nw path/to/OmoriSource`.
Use the SDK build if you want the developer console (F12). The game ships the normal build.

**Linux** needs `libnss3`, `libnspr4`, `libxss1` and `libasound2` alongside NW.js.
Set `OMORI_COMPAT_DEBUG=1` to log every file name the launcher had to correct.
Set `OMORI_FPS_LOG=<seconds>` on any platform to log the rendered frame rate, renderer and scene at that interval.

**RPG Maker MV 1.6.2** can open `project/Game.rpgproject`.
Playtesting from the editor passes the `test` flag, which makes the game load files through a different code path (`XMLHttpRequest` instead of `fs`).
A bug may show up in one mode and not the other.

---

# Where the game stores data

| What | Where |
| --- | --- |
| Save slots (`file1.rpgsave`...), slot list (`global.rpgsave`), settings (`config.rpgsave`), title screen state (`TITLEDATA`) | `project/save/` (next to the game files, standard RPG Maker MV behaviour) |
| Skippable cutscenes (`CUTSCENE.json`) | Windows: `%LOCALAPPDATA%\OMORI\`, macOS: `~/Library/Preferences/com.omocat.omori/`, Linux: `$XDG_DATA_HOME/OMORI/` (usually `~/.local/share/OMORI/`) |
| NW.js browser profile (`User Data`) | Windows: `%LOCALAPPDATA%\OMORI\` |

`project/save/` is ignored by git so personal saves never get committed.
To use saves from another copy of the game, copy the slot files and `global.rpgsave` into `project/save/`.

---

# Verifying the files

`tools/reference.sha256` lists the SHA-256 hash of every file in the known-good game (it contains no game content).

```
python tools/verify_parity.py project
```

It prints every missing, extra or changed file. Player data in `save/` is skipped.
`Game.rpgproject` is the only expected extra.

Opening the project in RPG Maker MV and saving rewrites some files (for example `data/MapInfos.json` and `data/System.json`), so run the check after editing in RPG Maker.

`.gitattributes` turns off line-ending conversion. Without it, git on Windows rewrites text files on checkout and roughly 800 files stop matching.

---

# File formats in the Steam release

The Steam release encrypts its files. This project contains them already decrypted.

| Encrypted format | Decrypted format |
| --- | --- |
| .OMORI | .js |
| .KEL | .json |
| .HERO | .yaml |
| .AUBREY | .json |
| .PLUTO | .yaml |

As of OMORI v1.0.8, files are encrypted with the aes-256-ctr algorithm and the key `6bdb2e585882fbd48826ef9cffd4c511`.
Images encrypted by RPG Maker (`.rpgmvp`) use an MD5 hash as the key: `a7d70260aaebbce74bbbff3194f2b316`, the hash of `OMORI`.

`GTP_OmoriFixes.js` loads the game's data files, and `GTP_CoreUpdates.js` holds many core engine changes.

---

# What was wrong with earlier versions of this repo

Earlier commits stopped working after the title menu. Fixing them meant bringing `project/` in line with the working game:

* `YED_Tiled.js` asked for tilesets as `.AUBREY` files and `YEP_EventCopier/Morpher/Spawner.js` asked for maps as `.KEL` files. Neither exists in a decrypted copy, so map loading hung forever.
* `GTP_OmoriFixes.js` refused to start without Steam and refused to run on the NW.js SDK build. Steam support (greenworks, `Archeia_Steamworks.js`) has been removed.
* `fonts/gamefont.css` used RPG Maker's default font instead of `OMORI_GAME2.ttf` (menus were offset) and was missing `overflow: hidden` (scrollbars appeared).
* Leftover RPG Maker `Decrypter` code was removed from `rpg_core.js`, `rpg_managers.js` and `AudioStreaming.js`.
* Git line-ending conversion changed about 800 files on checkout.
* The `img/atlases/` source files (`.json`, `.yaml`, `.tps`) and `img/pictures/basil_something_3.jpg` were missing.

---

# Platform fixes (`launcher/compat.js`)

OMORI shipped for Windows and macOS only. Two things break on Linux, and both are fixed without touching `project/`:

* **`%LOCALAPPDATA%` is missing.** `Permanent_Manager` in `GTP_OmoriFixes.js` builds its folder from it. Without it, startup throws and the rest of that file never runs (the first visible error is `FPSMeter is not defined`). The launcher sets it to `$XDG_DATA_HOME` (or `~/.local/share`).
* **File names are case-sensitive.** The game was built on Windows, and its data asks for names in the wrong case: `/Languages/` for `languages/`, `AMB_FOREST` for `AMB_forest.ogg`, `Leaf` for `leaf.png`, tileset `DW_Interior.json` for `DW_INTERIOR.json`, and more. When an exact path is missing, the launcher looks for one that differs only in case. This covers `fs` reads, XHR, `fetch` and image/audio/video `src`.

---

# Vendored third-party code

Some scripts under `project/js` are other people's libraries, shipped as the game shipped them.
Minified files are left as they are; upstream sources are listed here.

| File | Upstream | Version | Status in OMORI |
| --- | --- | --- | --- |
| `plugins/stbvorbis.js`, `stbvorbis_asm.js`, `stbvorbis_stream_asm.js` | [hajimehoshi/stbvorbis.js](https://github.com/hajimehoshi/stbvorbis.js) (Apache-2.0) | 0.1.0 / 0.2.2 | Identical |
| `plugins/stbvorbis_stream.js` | [krmbn0576/rpgmakermv](https://github.com/krmbn0576/rpgmakermv) copy of stbvorbis.js (Apache-2.0) | 0.2.2, commit 278150a | Identical |
| `plugins/AudioStreaming.js` | [krmbn0576/rpgmakermv](https://github.com/krmbn0576/rpgmakermv) (MIT) | 2019-06-29 | Heavily modified (separate `StreamWebAudio` class) |
| `plugins/YSP_VideoPlayer.js` | [suppayami/yami-small-plugins](https://github.com/suppayami/yami-small-plugins) | 1.0.0, commit 8c87ecc | Adds `getVideoMap` |
| `plugins/Aries001_AnimationScreenEffects.js` | [Aries of Sheratan](https://ariesofsheratan.itch.io/001-animation-screen-effects) (paid, no redistribution of the source) | 1.0.2 | Shipped minified by its author; no public source |
| pixi-filters bundle inside `Aries001_AnimationScreenEffects.js` and `FilterController.js` | [pixijs/pixi-filters](https://github.com/pixijs/pixi-filters) (MIT) | 2.7.0 | Identical |
| pixi-filters bundle inside `Olivia_HorrorEffects.js` | [pixijs/pixi-filters](https://github.com/pixijs/pixi-filters) (MIT) | 2.6.1 | Identical |
| Godray filter inside `FilterController.js` | `@pixi/filter-godray` (MIT) | 2.6.0 | Adds a `strength` uniform |
| `libs/pixi.js` | [pixijs/pixijs](https://github.com/pixijs/pixijs) (MIT) | 4.8.9 | One "BlueMoon Edit" guard in the texture extract code |
| `libs/pixi-tilemap.js`, `pixi-picture.js`, `lz-string.js`, `fpsmeter.js`, `iphone-inline-video.browser.js` | RPG Maker MV 1.6.1 corescript copies (MIT) | | pixi-tilemap has 2 small fixes; the rest are identical |
| `libs/js-yaml-master/` | [nodeca/js-yaml](https://github.com/nodeca/js-yaml) (MIT) | Between 3.11.0 and 3.12.0 | Identical |
| `libs/dragonbones/` | [DragonBones/DragonBonesJS](https://github.com/DragonBones/DragonBonesJS) (MIT) | 5.0.0 | Not compared |

Two pixi-filters versions are loaded side by side, so whichever of `Olivia_HorrorEffects.js` and `FilterController.js` loads last provides `PIXI.filters`.

---

# Known issues

* Linux has been tested on x64 under WSL (boot, title screen, loading a save into a map) and on an ARM64 handheld (below), not through a full playthrough.

---

# PortMaster / ARM handheld research (on hold)

**Result:** OMORI runs on a $70-class ARM handheld through PortMaster's own runtimes, but only with software rendering: about **16 fps in White Space**, with two of four cores busy and the CPU above its throttling point. Getting Chromium onto the GPU got partway (Chromium talks to the Mali GPU) and then stalled. Every fix needed so far is specific to one GPU driver stack, which PortMaster can't rely on. So the long-term plan is to replace NW.js/Chromium altogether (see [Planned](#planned)).

The scripts used are in [`research/portmaster-nwjs/`](research/portmaster-nwjs/).

## Test device

Anbernic RG40XX-H running muOS 2502.0 PIXIE: Allwinner H700 (4× Cortex-A53 @ 1.51 GHz), Mali-G31 with the ARM fbdev blob (no `/dev/dri`), 973 MB RAM and no swap, glibc 2.38, exFAT SD card. PortMaster ships `weston_pkg_0.2` (Weston 14 + Xwayland, plus the `crusty` EGL/GBM shims) and `mesa_pkg_0.1` (Mesa 24.3 with virgl).

## What runs

| Piece | Choice |
| --- | --- |
| Runtime | NW.js **0.60.1 linux-arm64**, the community build from [LeonardLaszlo/nw.js-armv7-binaries](https://github.com/LeonardLaszlo/nw.js-armv7-binaries) (Jan 2022, Chromium 97, Node 17.3). There is no official ARM build and no ARM SDK flavor, so no remote debugging. |
| Extra libraries | 47 MB of Debian 12 arm64 packages (NSS, GTK3, Pango, HarfBuzz, FreeType, CUPS, ...), unpacked by `fetchdeb.py`. They're searched before westonpack's, which ships an older Pango and FreeType. |
| Display | `westonwrap.sh drm gl kiosk llvmpipe`: Weston composites on the Mali GPU, and Chromium runs with `--disable-gpu`. |
| Rendering | PixiJS rejects SwiftShader's WebGL (`failIfMajorPerformanceCaveat`), so the game uses PixiJS's **Canvas** renderer, drawn in software. |
| Input | `gptokeyb`: A=Z (confirm), B=X (cancel), Start=X (menu), X=Shift (run), Y=A (tag), L1/R1=Q/W, Select=Tab, Select+Start quits. |

Game files are the Steam install run through `tools/extract.js`. The case-insensitive exFAT card hides the case-sensitivity issue on this device.

## Measurements (software rendering)

Measured with `OMORI_FPS_LOG=5` and the autoplay script, which drops the player into White Space (map 87) and walks left and right:

| Scene | FPS |
| --- | --- |
| Splash screens (video) | 40–42 |
| Title screen | 35 |
| White Space, standing or walking | **15.5–16.7** |

CPU: about 51% of the whole chip. The game renderer process alone uses 153% of one core; Weston, Xwayland and the compositor about 35%. All cores sit at 1512 MHz. CPU temperature 70–73 °C: the passive throttling trips are 60 and 70 °C, critical is 115 °C. RAM: 420–445 MB used, about 480 MB left.

## GPU path: what was found

Each problem had to be solved before the next one became visible:

1. **GTK3 is loaded at runtime** (`Check failed: LoadGtk()`), so it doesn't show in `ldd`. Fixed by bundling Debian's GTK3.
2. **Westonpack's own Pango/FreeType come first** in the library path and are too old for Debian's GTK/HarfBuzz (`pango_font_family_get_face`, `FT_Get_Transform`). Fixed by putting the bundled libraries first.
3. **Weston DRM output and `crusty_x11egl` in the same session** fight over the one Mali fbdev window, and the GPU process crashes in `MALI_DestroyWindow`. Use `headless noop kiosk crusty_x11egl` instead, where the app's EGL draws straight to the screen.
4. **ANGLE shadowing the Mali driver.** NW.js keeps ANGLE's `libEGL.so`/`libGLESv2.so` in `lib/`, and its RPATH (`$ORIGIN/lib`) is searched before `LD_LIBRARY_PATH`. So crusty's SDL opened ANGLE instead of the Mali driver (`gl::GL_GetString` in the crash). Chromium loads ANGLE from `lib/` by absolute path, so it can't move. SDL can be pointed at the driver with `SDL_VIDEO_GL_DRIVER`/`SDL_VIDEO_EGL_DRIVER=/usr/lib/libmali.so`. This was applied in all later tests but not checked on its own.
5. **`crusty_x11egl` advertises `EGL_KHR_surfaceless_context`, but no GL context is really current afterwards.** Chromium crashes on a null GL extension string in `gl_surface_egl.cc:1066`. Fixed with `eglshim.c`, a `libEGL.so.1` placed in the port folder that forwards every call to crusty and hides that extension. After this, the GPU process starts and reports `GL_VENDOR = ARM, GL_RENDERER = Mali-G31, GL_VERSION = 20.0.01rel0`.
6. **Open: the GPU process stalls after its first `eglSwapBuffers`** on the X11 window surface. WebGL creation fails with `bindToCurrentThread failed` and `GPU state invalid after WaitForGetOffsetInRange`, even though every traced EGL call returns `EGL_SUCCESS`. Also, `eglGetCurrentSurface` always returns 0 under crusty, so Chromium keeps re-binding the context.

Dead ends, with the reasons:
* `--use-gl=angle --use-angle=gles` needs GLX (`libGL.so.1`).
* `--use-angle=gles-egl` fails with "Failed to get system egl display": ANGLE wants EGL 1.5 platform displays, and the blob is EGL 1.4.
* virgl + `--use-gl=desktop` crashes in `gl_surface_glx.cc:454`: the GLX visual picked doesn't exist in Xwayland.
* `--use_virtualized_gl_contexts` changed nothing.

The crash addresses were symbolized with `symbolize.py` and the `nwjs-symbol-v0.60.1-linux-arm64` Breakpad symbols from the same release.

## Why it's on hold

Everything above stays inside the port folder: no device library is modified, which PortMaster requires. But the fixes are for **this one stack** (Mali fbdev blob + westonpack crusty). A Panfrost/ROCKNIX device, an RK3566 with a different blob, or a future westonpack version would each need their own investigation. On top of that:
* Chromium alone uses about 420 MB on 1 GB devices.
* The only ARM64 NW.js is a 2022 community build with no debugging support.
* Software rendering is too slow and too hot to ship.

## If we pick it back up

* Find what blocks after the first swap: `strace -f -p` the GPU process, and add timestamps to `NW_EGL_TRACE`.
* Try `--disable-gpu-vsync`, `--disable-frame-rate-limit`, or `--use-gl=egl` with a pbuffer-only compositor (`--disable-gpu-compositing`).
* Test a Panfrost device (ROCKNIX), where Mesa and DRM are native and Chromium may need no shims at all.
* Test an official Electron linux-arm64 build: newer Chromium, but it would need a small `nw.*` API shim.
* Reproduce: `OMORI-test.sh` is the port launcher, and `nwrun.sh` switches modes with `WMODE`, `NW_GL`, `NW_SDL_GL`, `NW_EGLSHIM`, `NW_EGL_TRACE` and `NW_MESA`.

---

# Planned

* **Replace NW.js/Chromium with a lightweight runtime** built for RPG Maker MV, the way falcon-mkxp does it for XP/VX/Ace on PortMaster. It needs to provide what OMORI actually uses:
  * a JavaScript engine;
  * WebGL 1 for PixiJS 4, mapped onto GLES2;
  * the canvas 2D subset that RPG Maker's `Bitmap` uses (mainly text drawing);
  * WebAudio and Ogg decoding;
  * `<video>` for the WebM cutscenes;
  * gamepad and keyboard input;
  * the Node APIs the plugins call (`fs`, `path`, `os`, `require` for `js-yaml`);
  * the few `nw.*` window calls.

  `project/` stays byte-identical, and the parity tooling still applies.

---

## Feel free to contribute to the project if you made changes
