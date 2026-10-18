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
