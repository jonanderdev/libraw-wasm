#!/usr/bin/env bash

set -e

rm -rf libs includes LibRawSource lcms2 2>/dev/null || true
mkdir libs
mkdir includes


#---------------------------------------------------------------------------------
# 0) Configure and Build LCMS with Emscripten
#---------------------------------------------------------------------------------
echo -e "\n==> Cloning LCMS from GitHub..."
git clone https://github.com/mm2/Little-CMS.git lcms2
cd lcms2
command -v libtoolize >/dev/null 2>&1 && libtoolize || glibtoolize # MacOS fallback

autoreconf -fi
# 2) Configure and make with Emscripten
emconfigure ./configure --host=wasm32-unknown-emscripten \
  --disable-shared
emmake make -j8

cp -R src/.libs/* ../libs/
cp -R include/* ../includes/
cd ..



#---------------------------------------------------------------------------------
# 1) Download & Prepare LibRaw
#---------------------------------------------------------------------------------
echo -e "\n==> Cloning LibRaw from GitHub..."
git clone https://github.com/LibRaw/LibRaw.git LibRawSource

pushd LibRawSource

echo -e "\n==> Generating configure script from configure.ac..."
# Generate ./configure from configure.ac
command -v libtoolize >/dev/null 2>&1 && libtoolize || glibtoolize # MacOS fallback
autoreconf -i

#---------------------------------------------------------------------------------
# 2) Configure and Build LibRaw with Emscripten
#---------------------------------------------------------------------------------
echo -e "\n==> Configuring LibRaw with Emscripten..."
emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --enable-openmp \
  --enable-lcms \
  --disable-shared \
  --disable-examples \
  CFLAGS="-O3 -flto -ffast-math -msimd128 -DNDEBUG -DUSE_LCMS2 -I../includes" \
  CXXFLAGS="-O3 -flto -ffast-math -msimd128 -DNDEBUG -DUSE_LCMS2 -I../includes" \
  LDFLAGS="-s USE_PTHREADS=1 -lpthread -L../libs/ -llcms2"

echo -e "\n==> Building LibRaw..."
emmake make -j8

# Copy artifacts out of the source folder for convenience
cp -R lib/.libs/* ../libs/
cp -R libraw ../includes/
popd  # out of LibRawSource

#---------------------------------------------------------------------------------
# 3) Build the final WASM from libraw_wrapper.cpp
#---------------------------------------------------------------------------------
echo -e "\n==> Building libraw.js + libraw.wasm..."
# em++, not emcc: this is C++, and emscripten >= 6 no longer links the C++ runtime
# implicitly for a .cpp input (emcc fails with undefined `operator new` / `__resumeException`).
#
# INITIAL_MEMORY is 48MB, NOT the 256MB this script used to claim. The shipped artifact on
# this branch declares 768 pages (48MB) in its wasm memory import, so the script had drifted
# from the binary it produced; 256MB here would make every consumer's heap start 5x larger.
#
# MAXIMUM_MEMORY=4gb is THE change this branch exists for. Emscripten's default for a wasm32
# build is 2 GiB, which is a hard ceiling on the decode: libraw's demosaic + FBDD noise
# reduction costs ~49 MB per megapixel, so a 60MP frame needs ~3.0GB and threw a C++
# allocation exception on every attempt — every camera past ~40MP simply could not export.
# 4 GiB is wasm32's own ceiling. Measured on this build: a 24MP decode is BIT-IDENTICAL to
# the 2 GiB artifact (same output hash, same 984MB heap), and a real 60.5MP Leica Q3 decodes
# at top quality (AAHD + full NR) in 3013MB. Consumers still decide what they SPEND; this
# only raises what they may.
#
# INCOMING_MODULE_JS_API must be spelled out because emscripten >= 6 narrowed its default and
# dropped INITIAL_MEMORY — which index.js/direct.js/worker.js all pass at runtime. Without
# this the override is silently ignored and every decode starts at the compiled baseline.
em++ \
  --bind \
  -I./includes \
  -s USE_LIBPNG=1 \
  -s USE_LIBJPEG=1 \
  -s USE_ZLIB=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s DISABLE_EXCEPTION_CATCHING=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=48MB \
  -s MAXIMUM_MEMORY=4gb \
  -s "INCOMING_MODULE_JS_API=ENVIRONMENT,arguments,canvas,dynamicLibraries,elementPointerLock,instantiateWasm,locateFile,monitorRunDependencies,noExitRuntime,noInitialRun,onAbort,onExit,onRuntimeInitialized,postRun,preInit,preRun,print,printErr,setStatus,statusMessage,stderr,stdin,stdout,thisProgram,wasm,websocket,INITIAL_MEMORY,wasmBinary" \
  -s USE_PTHREADS=1 \
  -s ENVIRONMENT="web,worker" \
  -msimd128 \
  -O3 -flto -pthread \
  libraw_wrapper.cpp \
  ./libs/liblcms2.a \
  ./libs/libraw.a \
  -o libraw.js


echo -e "\n==> Building Dist files..."

node build.js


echo ""
echo "==============================================="
echo " Build complete!"
echo " You should now have libraw.js & libraw.wasm."
echo "==============================================="
