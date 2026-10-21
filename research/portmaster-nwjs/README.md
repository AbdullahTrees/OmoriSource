# PortMaster + NW.js experiment

Scripts from running OMORI on an RG40XX-H (muOS) with NW.js 0.60 arm64 under PortMaster's westonpack.
Findings, measurements and next steps are in the main README:
[PortMaster / ARM handheld research](../../README.md#portmaster--arm-handheld-research-on-hold).

| File | Runs on | Purpose |
| --- | --- | --- |
| `OMORI-test.sh` | device | Ports-menu launcher (software rendering mode) |
| `run.sh` | device | Runs an NW.js app under westonwrap with a timeout; mode from `WMODE` |
| `nwrun.sh` | device | Library path and NW.js flags (`NW_GL`, `NW_SDL_GL`, `NW_EGLSHIM`, `NW_EGL_TRACE`, `NW_MESA`) |
| `omori.gptk` | device | gptokeyb controller-to-keyboard mapping |
| `test-autoplay.js` | device | Benchmark helper: new game straight into White Space, then walks |
| `probe/` | device | Minimal NW.js app that reports versions and why WebGL failed |
| `fetchdeb.py` | device | Downloads Debian 12 arm64 packages and unpacks them (no root, stdlib only) |
| `eglshim.c` | device | `libEGL.so.1` forwarder that hides EGL extensions and can trace calls. Build: `zig cc -target aarch64-linux-gnu.2.17 -O2 -shared -fPIC -Wl,-soname,libEGL.so.1 -o libEGL.so.1 eglshim.c -ldl` |
| `fb2png.py` | host | Converts a `/dev/fb0` dump (640×960 BGRA) into PNG screenshots |
| `symbolize.py` | host | Maps crash offsets to functions using Breakpad `.sym` files |

The paths assume the test layout: runtime in `/root/omori-test`, game in `/mnt/mmc/ports/omori-test`.
