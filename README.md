# C Practice

A static site for learning C, aimed at programmers coming from C# or JavaScript. Chapters with runnable examples, quizzes, and exercises checked against tests. Code is compiled and run remotely by the [Compiler Explorer](https://godbolt.org) API (falling back to [Wandbox](https://wandbox.org)) with gcc and AddressSanitizer/UBSan. Progress lives in localStorage.

- Host: enable GitHub Pages for this repository (Settings → Pages → deploy from branch, root). No build step.
- Run locally: `python3 -m http.server` and open http://localhost:8000.
- Content: `content/*.txt`, format in [CONTENT.md](CONTENT.md). Check every solution, test and quiz with `node tools/verify.mjs` (needs gcc).
