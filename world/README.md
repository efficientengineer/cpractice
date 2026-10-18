# world

The native C project for the **Procedural World** course: a procedural, high-detail open world on WebGPU (Dawn), SDL3 for windows and input. Lessons live on the course site; this is where you build and run the engine.

## Build on macOS

```sh
xcode-select --install          # compilers
brew install cmake ninja

cmake -S world -B build -G Ninja             # Dawn (default). First configure+build fetches and compiles Dawn: ~20-40 min, once.
cmake --build build
./build/00-sky                               # chapter demos are apps/NN-name.c
./build/world_tests                          # headless GPU tests (all), or ./build/world_tests terrain
```

Quick start without compiling Dawn: `cmake -S world -B build-wgpu -G Ninja -DWORLD_WEBGPU=WGPU` uses the prebuilt wgpu-native library. It implements the same `webgpu.h`, so the code is identical; you never touch Rust.

To build Dawn once and reuse it across build directories: build it yourself (`git clone https://github.com/google/dawn`, then `cmake -S dawn -B dawn/out -G Ninja -DDAWN_FETCH_DEPENDENCIES=ON -DDAWN_BUILD_MONOLITHIC_LIBRARY=SHARED -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF -DTINT_BUILD_TESTS=OFF && ninja -C dawn/out webgpu_dawn`) and configure with `-DWORLD_DAWN_SOURCE=$PWD/dawn -DWORLD_DAWN_BUILD=$PWD/dawn/out`.

Options: `-DWORLD_SANITIZE=ON` (AddressSanitizer + UBSan, use it while developing), `-DWORLD_HEADLESS=ON` (engine and tests only, no SDL).

## Layout

- `engine/`: the engine. `*.h` CPU modules are single-header (`static inline`) so the course site can compile them with your online exercises; GPU modules are `.h`/`.c` pairs on top of `gpu.h`.
- `shaders/`: WGSL, loaded at runtime from the source tree.
- `apps/`: one demo per chapter (`NN-name.c` → executable `NN-name`).
- `tests/`: headless tests (render/compute into textures and buffers, read back, compare).
- `exercises/`: the local steps from the course, with TODOs, built as `ex-NN-name`.
