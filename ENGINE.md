# The Procedural World engine (C, native WebGPU)

The `world` course (`content/world/`) is one continuous project: a procedural, high-detail open world in C on native WebGPU (Dawn by default, wgpu-native optional; both implement `webgpu.h`), with SDL3 for windows and input. The project lives in [world/](world/) (see its README). Lessons are on the course site. Each chapter has:

- **online exercises**: CPU-side C (math, noise, terrain functions, meshing, placement, culling math, controller physics, ...) compiled on the site with gcc + sanitizers and checked by tests. A chapter's `lib:` header names the engine headers it introduces (e.g. `lib: wmath.h noise.h`); every later chapter's exercises get them prepended, so exercises build on the engine. These headers are the same files the native engine uses.
- **local steps** (`--- local` field, "Mark as done" on the site): GPU and integration work in `world/`: write WGSL, wire pipelines, run the chapter demo (`apps/NN-name.c`) and the headless tests (`./build/world_tests NAME`). Starters with TODOs go in `world/exercises/NN-name/`; the finished reference is in `engine/`, `shaders/` and `apps/`.

## Conventions

- C17, `-Wall -Wextra` clean, ASan/UBSan clean (`-DWORLD_SANITIZE=ON`).
- **CPU modules** are single headers in `world/engine/` with only `static inline` functions and types (no `static` non-inline functions: unused ones warn), no GPU dependency, including only standard headers and other CPU module headers via `#include "x.h"`. They must compile when concatenated in chapter order into one file (the site does that). Each starts with a comment listing its API.
- **GPU modules** are `name.h` + `name.c` using `gpu.h`; added to the `engine` library in `world/CMakeLists.txt`.
- Shaders in `world/shaders/*.wgsl`; shared WGSL snippets are included by `gpu_shader_file` (`//#include "noise.wgsl"` lines, added in chapter 01).
- Coordinates: meters, right-handed, **Y up**, camera looks down **-Z** in view space. Matrices column-major `float[16]` matching WGSL `mat4x4f`. WebGPU clip depth 0..1, **reversed-Z** (depth32float, clear 0, `Greater`) from chapter 03.
- Determinism: everything procedural is a pure function of `(world_seed, position or id)` via integer hashes; no `rand()`, no shared RNG state across chunks.
- CPU/GPU parity: functions evaluated on both sides (terrain height, biome, density) exist in C (CPU module) and WGSL and agree within 1e-3 at test points (tested by GPU readback in `world/tests`).
- Performance: create pipelines, layouts, samplers and long-lived buffers once; one uniform write per frame for frame data; no malloc/free in per-frame code (arenas, pools, preallocated arrays); no readbacks in the frame loop; instancing and indirect draws; bulk generation in compute shaders; data-oriented (struct-of-arrays) for hot CPU loops.

## Shared interfaces between parts

- **Frame uniforms** (ch 03): one uniform buffer per frame at `@group(0) @binding(0)`, WGSL `struct Frame` in `shaders/frame.wgsl` and matching C struct `FrameUniforms`: view, proj, view_proj, inv_view_proj, camera position, time, sun direction/color, resolution, frame index, TAA jitter. Later chapters only append fields.
- **Terrain function** (ch 01, 06): `terrain_height(const TerrainParams*, float x, float z)` (CPU module) + WGSL `terrain_height(p: vec2f) -> f32`.
- **Chunks** (ch 08): integer `(cx, cz)` grid; `chunk_seed(world_seed, cx, cz)`; chunk GPU resources come from fixed pools, recycled, never allocated per frame.
- **Instances** (ch 11 on): 8 floats per instance `x, y, z, yaw, scale, variant, tint, type_id` in storage buffers; object types registered with LOD meshes (vertex/index buffers, index counts, bounding sphere radius, screen-size thresholds) and a material id. Part 4's GPU culling consumes these.
- **Renderer** (ch 05 on): a frame is an ordered list of passes; later chapters add passes (shadow, depth prepass, Hi-Z, G-buffer, post); render targets come from a transient pool keyed by size/format.

## Chapters

<!-- Each chapter's author documents the exact API they add (CPU headers, GPU modules, shaders) under "### NN-name". -->
