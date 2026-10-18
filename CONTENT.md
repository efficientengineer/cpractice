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

## JavaScript and WebGPU courses

Chapters live in `content/js/` and `content/webgpu/` (file lists in `js/manifest.js`). Same format, with these differences:

- Code runs as the body of an `async` function in a Web Worker (`js/jsrunner.js`): top-level `await` works; no `import`/`export` statements (use dynamic `import()` only in prose); no DOM. `console.log` output is formatted like Node's (`[ 1, 'a' ]`, `{ a: 1 }`, `Map(1) { 'k' => 1 }`). Use ```js fences for runnable code (every js block gets a playground button), ```wgsl for shader listings.
- Function exercises: `--- harness` is plain JS appended after the user's code in the same scope (then `return __testEnd()` is added). Helpers: `eq(got, want, msg?)` (deep equality), `check(cond, msg?)`, `near(got, want, eps?, msg?)`, `throws(fn, msg?)`, `await rejects(promiseOrFn, msg?)`. Never redeclare a name the user's code declares; wrap harness locals in a block `{ ... }` if needed. At least one check must run.
- Program exercises: `--- test` (leave empty) + `--- out` is the expected console output. 5 second timeout (WebGPU: 15 s).
- WebGPU globals: `canvas` (an OffscreenCanvas; don't assume its size, use `canvas.width`), `await getDevice()` (shared GPUDevice), `await readBuffer(device, buffer, size?, offset?)` → ArrayBuffer (buffer needs COPY_SRC), `await readPixels(device, texture)` → Uint8Array of RGBA rows (texture needs COPY_SRC, format `rgba8unorm`). Render exercises should take `device` (and a format) as parameters and the harness renders into its own `rgba8unorm` texture and checks pixels; the canvas is for showing results when the learner clicks Run.
- Verify with `node tools/verify-browser.mjs js [prefix]` or `node tools/verify-browser.mjs webgpu [prefix]` (headless Chromium, WebGPU on SwiftShader). Must report 0 failures.
