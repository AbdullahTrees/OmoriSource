#!/bin/bash
# Build meetox80/omori for a local performance comparison (personal use only; never redistributed):
# 1) the builder for x86_64 Linux (console engines replaced by empty placeholders: only the data matters),
# 2) libogg + libvorbis for aarch64 (static), 3) the desktop engine for aarch64 against the PMJS sysroot's SDL2/zlib.
set -euo pipefail
E=/home/abdullah/omori-test/ext
SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
R="${MEETOX_REPO:-$SOURCE_ROOT/.local/references/meetox-omori}"
ZIG=/home/abdullah/omori-test/zig/zig-linux-x86_64-0.13.0/zig
SYS=/home/abdullah/omori-test/pmjs-build/.cache/linux-arm64/sdk/work/sysroot-install/sysroot
TGT=aarch64-linux-gnu.2.38
DEPS=$E/arm64-deps
step=${1:-all}
# No host C compiler in this WSL: route cc through zig.
mkdir -p $E/bin && printf '#!/bin/sh\nexec %s cc "$@"\n' "$ZIG" > $E/bin/cc && chmod +x $E/bin/cc
export PATH=$E/bin:$PATH
# CMake toolchain for aarch64 glibc 2.38 (muOS) through zig, finding SDL2/zlib in the PMJS sysroot
# and ogg/vorbis in our prefix.
write_toolchain() {
  cat > $E/aarch64.cmake <<EOF
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER $E/bin/aarch64-cc)
set(CMAKE_CXX_COMPILER $E/bin/aarch64-c++)
set(CMAKE_AR $E/bin/zig-ar)
set(CMAKE_RANLIB $E/bin/zig-ranlib)
set(CMAKE_FIND_ROOT_PATH $SYS $DEPS/prefix)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
EOF
  printf '#!/bin/sh\nexec %s cc -target %s "$@"\n' "$ZIG" "$TGT" > $E/bin/aarch64-cc
  printf '#!/bin/sh\nexec %s c++ -target %s "$@"\n' "$ZIG" "$TGT" > $E/bin/aarch64-c++
  chmod +x $E/bin/aarch64-cc $E/bin/aarch64-c++
  printf '#!/bin/sh\nexec %s ar "$@"\n' "$ZIG" > $E/bin/zig-ar
  printf '#!/bin/sh\nexec %s ranlib "$@"\n' "$ZIG" > $E/bin/zig-ranlib
  chmod +x $E/bin/zig-ar $E/bin/zig-ranlib
}

if [ "$step" = all ] || [ "$step" = builder ]; then
  mkdir -p $E/dummy-engines/{psp,vita,3ds,wii,wiiu,ps3,ps2,xenon}
  for f in psp/EBOOT.PBP vita/eboot.bin vita/param.sfo 3ds/omori.3dsx wii/omori.dol wiiu/omori.rpx ps3/EBOOT.BIN ps2/OMORI.ELF xenon/xenon.elf; do
    [ -f $E/dummy-engines/$f ] || printf 'placeholder' > $E/dummy-engines/$f
  done
  cd $R && ZIG=$ZIG ENGINES_DIR=$E/dummy-engines JOBS=12 bash scripts/build-builder.sh x86_64-linux-musl 2>&1 | tail -3
fi

if [ "$step" = all ] || [ "$step" = deps ]; then
  mkdir -p $DEPS/src $DEPS/prefix && cd $DEPS/src
  [ -d libogg-1.3.5 ] || curl -sL https://downloads.xiph.org/releases/ogg/libogg-1.3.5.tar.gz | tar xz
  [ -d libvorbis-1.3.7 ] || curl -sL https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.gz | tar xz
  source /home/abdullah/omori-test/build-env/env.sh
  write_toolchain
  for lib in libogg-1.3.5 libvorbis-1.3.7; do
    cmake -S $lib -B $DEPS/build-$lib -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=$E/aarch64.cmake \
      -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_INSTALL_PREFIX=$DEPS/prefix \
      -DCMAKE_PREFIX_PATH=$DEPS/prefix -DINSTALL_DOCS=OFF 2>&1 | tail -2
    cmake --build $DEPS/build-$lib -j12 --target install 2>&1 | tail -2
  done
  ls $DEPS/prefix/lib $DEPS/prefix/lib/pkgconfig 2>/dev/null
fi

if [ "$step" = all ] || [ "$step" = engine ]; then
  write_toolchain
  ZLIBDIR=/home/abdullah/omori-test/pmjs-build/.cache/linux-arm64/sdk/work/zlib-build
  # The sysroot's SDL 2.0.x config defines no SDL2::SDL2 target; provide one.
  mkdir -p $E/sdl2-shim
  cat > $E/sdl2-shim/SDL2Config.cmake <<EOF
add_library(SDL2::SDL2 SHARED IMPORTED)
set_target_properties(SDL2::SDL2 PROPERTIES
  IMPORTED_LOCATION $E/device-sdl/lib/libSDL2.so
  INTERFACE_INCLUDE_DIRECTORIES "$E/device-sdl/SDL2-2.28.5/include")
set(SDL2_FOUND TRUE)
EOF
  rm -rf $E/build-arm64-wii
  export PKG_CONFIG_PATH= PKG_CONFIG_LIBDIR=$DEPS/prefix/lib/pkgconfig PKG_CONFIG_SYSROOT_DIR=
  source /home/abdullah/omori-test/build-env/env.sh
  cmake -S $R/engine -B $E/build-arm64-wii -G Ninja -DCMAKE_BUILD_TYPE=Release -DOMORI_TARGET=wii \
    -DCMAKE_TOOLCHAIN_FILE=$E/aarch64.cmake -DSDL2_DIR=$E/sdl2-shim \
    -DZLIB_INCLUDE_DIR=$ZLIBDIR -DZLIB_LIBRARY=$ZLIBDIR/libz.so -DCMAKE_EXE_LINKER_FLAGS=-L$DEPS/prefix/lib "-DCMAKE_CXX_STANDARD_LIBRARIES=-lvorbis -logg -lm" 2>&1 | tail -5
  cmake --build $E/build-arm64-wii -j12 2>&1 | tail -5
  file $E/build-arm64-wii/omori 2>/dev/null || true
fi
