# The Procedural World engine

The `world` course (`content/world/`) is one continuous project: a procedural, high-detail open world in WebGPU, built chapter by chapter. Every chapter that adds an engine system ships a reference implementation in `content/world/lib/FILE.js` (chapter header `lib: yes`). The site loads the libraries of all *earlier* chapters before the learner's code (via `importScripts` in the worker), so a chapter's exercises build on a working engine and focus on the new system. The playground loads all of them.

## Conventions (all libraries)

- Plain classic scripts, no `import`/`export`. Each file starts with `self.W = self.W || {};` and adds to the global `W` namespace (`W.math`, `W.noise`, `W.terrain`, ...). Libraries may use anything from earlier libraries.
- A header comment in each file lists its public API with one line per function. Exact APIs are also documented below under the chapter's heading, by the chapter's author (edit only your own chapter's section).
- Coordinates: meters, right-handed, **Y up**, camera looks down **-Z** in view space. Matrices are column-major `Float32Array(16)`, matching WGSL `mat4x4f`. Clip-space depth is WebGPU's 0..1. Use reversed-Z (near=1, far=0, `depthCompare: 'greater'`, depth32float) from chapter 03 on, and say why (precision over long view distances).
- Determinism: everything procedural is a pure function of `(worldSeed, position or id)` using integer hashes (`W.hash`), never `Math.random` and never call-order-dependent RNG state shared between chunks.
- CPU/GPU parity: any function evaluated on both sides (terrain height, biome, density) has a JS version and a WGSL version (a string in `W.wgsl.*`) that agree within 1e-3 at test points. The CPU version is for collision, placement and tests; the GPU version for rendering and bulk generation.
- Performance rules: create pipelines, bind group layouts, samplers and long-lived buffers once; per-frame data goes in one uniform buffer written once per frame; no allocation in per-frame code (reuse typed arrays and objects); no `mapAsync` readbacks in the frame loop; batch with instancing and indirect draws; bulk generation runs in compute shaders.
- Everything must run on SwiftShader in headless Chromium for tests (small sizes in tests), and look good at 960×540 in a real browser.

## Shared interfaces between parts

- **Frame uniforms** (chapter 03): one uniform buffer per frame bound at `@group(0) @binding(0)` in every world pipeline, struct `Frame` in `W.wgsl.frame` (view, proj, viewProj, invViewProj, camera position, time, sun direction/color, resolution, frame index, jitter for TAA later). Later chapters may append fields only at the end.
- **Terrain function** (chapters 01, 06): `W.terrain.height(x, z)` / WGSL `terrainHeight(p: vec2f) -> f32` from a params object; later chapters extend it (erosion adds a baked correction layer per chunk).
- **Chunks** (chapter 08): the world is a grid of square chunks addressed by integer `(cx, cz)`; `W.chunkSeed(worldSeed, cx, cz)` gives each chunk its own seed; chunk resources come from fixed pools and are recycled, never allocated per frame.
- **Instances** (chapter 11 on, consumed by Part 4): placed objects are packed records of 8 float32 per instance: `x, y, z, yaw, scale, variant, tint, typeId`. Object types are registered in `W.objects` with LOD meshes (vertex/index buffers, index counts, bounding sphere radius, screen-size thresholds) and a material id. Part 4's GPU-driven pipeline culls and draws from these instance buffers.
- **Render passes** (chapter 05 on): the frame is a list of passes executed by `W.Renderer`; later chapters add passes (shadow, depth prepass, Hi-Z, G-buffer, post-processing) and textures come from a transient pool keyed by size/format rather than being created per frame.

## Chapters

<!-- Each chapter's lib author documents the exact API of content/world/lib/FILE.js here. -->
