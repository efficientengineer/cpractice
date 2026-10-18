# C Practice

Learn C, then native WebGPU in C, on your Mac. The C course is 22 chapters of lessons in `content/`, aimed at programmers coming from C# or JavaScript, with a procedural graphics track. You learn it through spaced repetition: a mix of question cards and code cards that keep testing new concepts and keep bringing back old ones until they stick. The WebGPU part is `world/`, a native procedural open-world engine on Dawn and SDL3.

## Start

Open **C Practice** from Launchpad, Spotlight or the Desktop shortcut. It opens a menu in Terminal: review, progress by chapter, and the world demo and tests. To (re)install the app and shortcut, for example after moving this folder:

```sh
tools/make-app.sh
```

Or run the review directly:

```sh
node tools/review.mjs                 # due cards plus 5 new ones
node tools/review.mjs --new 10        # introduce more new cards
node tools/review.mjs --all           # every card you have learned, due or not
node tools/review.mjs --chapter pointers
node tools/review.mjs --stats
```

Needs Node and a C compiler (`xcode-select --install`).

## How review works

- **Question cards** come from each chapter's quizzes: pick the answer, then read the explanation.
- **Code cards** come from the exercises: the tool writes a starter to `review-work/`, you write the code in your editor, and the exercise's own tests decide (compiled with `-Wall -Wextra` and AddressSanitizer/UBSan). `h` shows a hint; `s` shows the solution and counts as a miss.
- New cards are introduced a few per session in course order, so you keep meeting new concepts.
- A miss keeps coming back in the same session (about every 3 cards) until you get it right twice in a row, and again the next day. A right answer pushes the next review out: 1 day, 3 days, about a week, then longer each time. Nothing retires, so every concept keeps getting retested, just less often as you master it.
- Progress is in `review-progress.json` (not committed). Delete it to start over.

Read the chapter text (`content/NN-name.txt`) when cards in a chapter are new to you or keep coming back.

## The WebGPU engine

See [world/README.md](world/README.md) to build it (`cmake -S world -B build -G Ninja && cmake --build build`) and [ENGINE.md](ENGINE.md) for how it is organized.

## Writing content

Lesson format is in [CONTENT.md](CONTENT.md). Check every solution, test and quiz with `node tools/verify.mjs` (must report 0 failures).
