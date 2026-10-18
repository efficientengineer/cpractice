# Writing content

Each chapter is `content/NN-name.txt`, listed in `js/manifest.js`. `content/00-start.txt` is the reference example.

## Format

- `=== chapter ID` / `=== exercise ID` / `=== quiz` starts a block. `key: value` lines right after it are header fields (`title:`, `blurb:`, `run: yes`, `flags: -O2`).
- `--- FIELD` starts a multi-line field that runs to the next `---` or `===` line. Leading/trailing blank lines are trimmed. Everything is raw text: no escaping.
- Chapter: `title:`, `blurb:`, `--- body` (markdown: `##`/`###` headings, paragraphs, `-`/`1.` lists, `|` tables, `>` notes, fenced code with ```c or ```text, inline `code`, **bold**, *italic*, [links](url)). A ```c block containing `main(` gets an "Open in playground" button.
- Exercise: `title:`, `--- prompt` (markdown), `--- starter`, `--- solution`, any number of `--- hint`, and then either:
  - `--- harness`: function exercise. A full test program with its own `int main(void)` ending `return TEST_END();`, using `CHECK(cond)`, `CHECK_INT(got, want)`, `CHECK_UINT`, `CHECK_DBL`, `CHECK_STR`. It is appended after the user's code (the user's own `main`, if any, is renamed), so it can call their functions directly. stdio.h, string.h, stdlib.h and math.h are included for it.
  - `--- test` (stdin) / `--- out` (expected stdout) pairs, optionally `--- exit` (expected exit code, default 0): program exercise.
- Quiz: `--- q` (markdown), optional `--- code`, `--- choice` for wrong options, `--- answer` for the right one (order kept), `--- explain`. With `run: yes` the code is compiled and its output must equal the answer.

## Checking

`node tools/verify.mjs [file-prefix]` compiles every solution with gcc `-std=c17 -Wall -Wextra -fsanitize=address,undefined` (leaks detected), runs the tests, requires zero warnings, requires starters to compile but not pass, and checks `run: yes` quizzes. It must report 0 failures.

## JavaScript and Procedural World courses

Chapters live in `content/js/` and `content/world/` (file lists in `js/manifest.js`). Same format, with these differences:

- Code runs as the body of an `async` function in a Web Worker (`js/jsrunner.js`): top-level `await` works; no `import`/`export` statements (use dynamic `import()` only in prose); no DOM. `console.log` output is formatted like Node's (`[ 1, 'a' ]`, `{ a: 1 }`, `Map(1) { 'k' => 1 }`). Use ```js fences for runnable code (every js block gets a playground button), ```wgsl for shader listings.
- Function exercises: `--- harness` is plain JS appended after the user's code in the same scope (then `return __testEnd()` is added). Helpers: `eq(got, want, msg?)` (deep equality), `check(cond, msg?)`, `near(got, want, eps?, msg?)`, `throws(fn, msg?)`, `await rejects(promiseOrFn, msg?)`. Never redeclare a name the user's code declares; wrap harness locals in a block `{ ... }` if needed. At least one check must run.
- Program exercises: `--- test` (leave empty) + `--- out` is the expected console output. 5 second timeout (WebGPU: 15 s).
- WebGPU globals: `canvas` (an OffscreenCanvas; don't assume its size, use `canvas.width`), `await getDevice()` (shared GPUDevice), `await readBuffer(device, buffer, size?, offset?)` → ArrayBuffer (buffer needs COPY_SRC), `await readPixels(device, texture)` → Uint8Array of RGBA rows (texture needs COPY_SRC, format `rgba8unorm`). Render exercises should take `device` (and a format) as parameters and the harness renders into its own `rgba8unorm` texture and checks pixels; the canvas is for showing results when the learner clicks Run.
- Verify with `node tools/verify-browser.mjs js [prefix]` or `node tools/verify-browser.mjs world [prefix]` (headless Chromium, WebGPU on SwiftShader). Must report 0 failures.

## Focus: 3D graphics and procedural generation, with performance

The learner wants graphics programming with a heavy focus on procedural generation (above all procedural textures; also terrain, foliage, L-systems, procedural models), 3D-oriented, plus the basic interactive parts (character controller, camera, collision). They also want performant habits from the start. In every chapter:

- Prefer graphics/procgen-flavored examples and exercises (pixels and colors, image buffers, vectors and matrices, noise, hashing, meshes, vertices/indices, transforms, height fields, grids, PRNG seeds) over abstract ones, when it doesn't distort the concept.
- Teach the performant way first and say why, in `> **Performance:** ...` notes: contiguous typed/flat arrays, struct-of-arrays for hot loops, no allocation in per-pixel/per-vertex/per-frame code, precomputed tables (permutation tables, gradient tables), hashing instead of storing, batching (one draw call / one buffer upload), doing bulk work on the GPU, measuring before optimizing. Call out bad habits explicitly.
- Where it fits, add tests that a naive solution fails by timing out (large inputs), so performance is checked, not just preached.
- Procedural generators must be deterministic per seed so tests can compare exact values (or values within tolerance).
- C programs can show images: a program that prints an ASCII PNM image (`P2` grayscale or `P3` color, header `P3\nW H\n255\n` then values) to stdout is drawn as a picture in the output panel. Keep Run images at most 128×128 (the remote compiler limits output size); tests check pixel/noise functions directly, not printed images.

## Project chains

- `continues: STEP_ID` (header, same chapter) makes an exercise build on an earlier one. Give it a `--- stubs` field (the new declarations/stubs for this step) instead of a `--- starter`: the starter becomes the previous step's solution + stubs. In the app, a learner who solved the previous step starts from *their own* code + stubs. Stubs must compile with the previous solution and must not pass. Prefer function (harness) exercises for steps; in C the user's `main` is renamed during tests, so stubs appended after it are fine.
- To build across chapters, the first step of a project chapter has an explicit `--- starter` that contains the finished engine code from the chapter it builds on (copy the previous chapter's final solution, trimmed to what is needed), and the prose says so.

## Interactive canvas (JS and WebGPU)

- Code that mentions `canvas` gets a 512×512 canvas (`canvas.getContext('2d')` or `'webgpu'`). The worker stays alive after the code finishes, so `requestAnimationFrame` loops keep running until the next Run; later console output streams in.
- Input globals: `keys` (a Set of `KeyboardEvent.code` values currently held, e.g. `'ArrowLeft'`, `'KeyW'`, `'Space'`), `mouse` (`{ x, y, down }` in canvas pixels), `input.onKeyDown(fn(code))`, `input.onKeyUp(fn)`, `input.onMouseDown(fn(x, y))`.
- Keep logic testable: generators and math are pure functions over typed arrays; interactive parts use `update(state, dt, keys, mouse)` and a separate render. Harness tests call the pure functions and drive `update` with fake input (`new Set(['KeyW'])`) and fixed `dt`; the canvas is for looking at results when the learner clicks Run. Any run (including test runs) gets a canvas when the code mentions `canvas`, so a solution may start its loop at top level; the test still finishes when the main body returns.

## The Procedural World course

See [ENGINE.md](ENGINE.md). Chapters with `lib: yes` ship `content/world/lib/FILE.js`; later chapters get it preloaded. The world canvas is 960×540 with pointer lock on click (`mouse.dx`/`mouse.dy` accumulate movement; read and zero them each frame; `mouse.locked`).
