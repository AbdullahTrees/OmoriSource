#!/bin/bash
# runs inside westonwrap: add our bundled libraries and start NW.js.
# Our libraries go before westonpack's: it ships an older Pango that Debian's GTK3 can't use.
# In virgl mode Mesa's own libgbm/libdrm/libGL must win over the Debian copies, so it goes first.
T=/root/omori-test
export OMORI_FPS_LOG=${OMORI_FPS_LOG:-5}
# NW.js keeps ANGLE's libEGL.so/libGLESv2.so in nwjs/lib, which its RPATH searches first.
# Westonpack's SDL opens the GPU driver by those names, so point it at the real driver by path.
if [ -n "$NW_SDL_GL" ]; then
    export SDL_VIDEO_GL_DRIVER=$NW_SDL_GL SDL_VIDEO_EGL_DRIVER=$NW_SDL_GL
fi
LIBS=$T/sysroot/usr/lib/aarch64-linux-gnu:$T/sysroot/lib/aarch64-linux-gnu
[ "$NW_MESA" = 1 ] && LIBS=/tmp/mesa/lib/aarch64-linux-gnu:$LIBS
# Our libEGL.so.1 shim in front of crusty's: hides EGL_KHR_surfaceless_context (see eglshim.c).
if [ "$NW_EGLSHIM" = 1 ]; then
    LIBS=$T/eglshim:$LIBS
    export NW_REAL_EGL=${NW_REAL_EGL:-/tmp/weston/lib_aarch64/graphics/crusty_x11egl/libcrusty.so}
fi
export LD_LIBRARY_PATH=$LIBS:$LD_LIBRARY_PATH
exec $T/nwjs/nwjs-v0.60.1-linux-arm64/nw --no-sandbox --enable-logging=stderr ${NW_GL:---use-gl=egl} --ignore-gpu-blocklist "$@"
