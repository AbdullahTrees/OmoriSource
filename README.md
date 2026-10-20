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
| `launcher/compat.js` | Cross-platform fixes, injected by NW.js before any game script. It does nothing on Windows. |
| `tools/` | The parity checker and its hash manifest. |

The game's own files can't change without breaking parity, and when running from a Steam install they're encrypted anyway.
Platform fixes therefore live in `launcher/`.
OMORI's real install is laid out the same way: its `package.json` sits outside `www/`.

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

* Linux has been tested on x64 under WSL (boot, title screen, loading a save into a map), not yet on ARM or through a full playthrough.

# Planned

* Run directly from an unmodified Steam install, encrypted or decrypted, without redistributing the game's files.
* A Linux port for low-end ARM handhelds through [PortMaster](https://portmaster.games/), without needing a full browser runtime.

---

## Feel free to contribute to the project if you made changes
