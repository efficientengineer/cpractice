# Writing content

Each chapter is `content/NN-name.txt`, listed in `tools/lib/manifest.js`. `content/00-start.txt` is the reference example. `tools/review.mjs` turns every quiz into a question card and every exercise with a harness or tests into a code card.

## Format

- `=== chapter ID` / `=== exercise ID` / `=== quiz` starts a block. `key: value` lines right after it are header fields (`title:`, `blurb:`, `run: yes`, `flags: -O2`).
- `--- FIELD` starts a multi-line field that runs to the next `---` or `===` line. Leading/trailing blank lines are trimmed. Everything is raw text: no escaping.
- Chapter: `title:`, `blurb:`, `--- body` (markdown: `##`/`###` headings, paragraphs, `-`/`1.` lists, `|` tables, `>` notes, fenced code with ```c or ```text, inline `code`, **bold**, *italic*, [links](url)).
- Exercise: `title:`, `--- prompt` (markdown), `--- starter`, `--- solution`, any number of `--- hint`, and then either:
  - `--- harness`: function exercise. A full test program with its own `int main(void)` ending `return TEST_END();`, using `CHECK(cond)`, `CHECK_INT(got, want)`, `CHECK_UINT`, `CHECK_DBL`, `CHECK_STR`. It is appended after the user's code (the user's own `main`, if any, is renamed), so it can call their functions directly. stdio.h, string.h, stdlib.h and math.h are included for it.
  - `--- test` (stdin) / `--- out` (expected stdout) pairs, optionally `--- exit` (expected exit code, default 0): program exercise.
- Quiz: `--- q` (markdown), optional `--- code`, `--- choice` for wrong options, `--- answer` for the right one (order kept), `--- explain`. With `run: yes` the code is compiled and its output must equal the answer.

## Checking

`node tools/verify.mjs [file-prefix]` compiles every solution with gcc `-std=c17 -Wall -Wextra -fsanitize=address,undefined` (leaks detected on Linux; macOS's ASan has no leak checker), runs the tests, requires zero warnings, requires starters to compile but not pass, and checks `run: yes` quizzes. It must report 0 failures. On macOS `gcc` is Apple clang; the verifier turns off the two clang-only warnings (unused `static inline` functions, deprecated `sprintf`) so results match gcc.

## Focus: 3D graphics and procedural generation, with performance

The learner wants graphics programming with a heavy focus on procedural generation (above all procedural textures; also terrain, foliage, L-systems, procedural models), 3D-oriented, plus the basic interactive parts (character controller, camera, collision). They also want performant habits from the start. In every chapter:

- Prefer graphics/procgen-flavored examples and exercises (pixels and colors, image buffers, vectors and matrices, noise, hashing, meshes, vertices/indices, transforms, height fields, grids, PRNG seeds) over abstract ones, when it doesn't distort the concept.
- Teach the performant way first and say why, in `> **Performance:** ...` notes: contiguous typed/flat arrays, struct-of-arrays for hot loops, no allocation in per-pixel/per-vertex/per-frame code, precomputed tables (permutation tables, gradient tables), hashing instead of storing, batching (one draw call / one buffer upload), doing bulk work on the GPU, measuring before optimizing. Call out bad habits explicitly.
- Where it fits, add tests that a naive solution fails by timing out (large inputs), so performance is checked, not just preached.
- Procedural generators must be deterministic per seed so tests can compare exact values (or values within tolerance).
- C programs can show images by printing an ASCII PNM image (`P2` grayscale or `P3` color, header `P3\nW H\n255\n` then values) to stdout: redirect it to a `.pnm` file and open it in Preview. Tests check pixel/noise functions directly, not printed images.

## Project chains

- `continues: STEP_ID` (header, same chapter) makes an exercise build on an earlier one. Give it a `--- stubs` field (the new declarations/stubs for this step) instead of a `--- starter`: the starter becomes the previous step's solution + stubs, and that is what the code card's work file starts from. Stubs must compile with the previous solution and must not pass. Prefer function (harness) exercises for steps; in C the user's `main` is renamed during tests, so stubs appended after it are fine.
- To build across chapters, the first step of a project chapter has an explicit `--- starter` that contains the finished engine code from the chapter it builds on (copy the previous chapter's final solution, trimmed to what is needed), and the prose says so.

## The Procedural World course (WebGPU)

See [ENGINE.md](ENGINE.md). The engine code is in `world/`; its lesson text (`content/world/`) is not in this repo yet. Its chapters use the same format: CPU-side exercises with the engine headers named in earlier chapters' `lib:` headers prepended, and GPU work as **local steps**, exercises with a `--- local` field (markdown instructions: files to edit, commands to run, which test must pass), verified by building `world/` and running `world_tests` (see world/README.md).
