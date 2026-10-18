#!/bin/zsh
# Menu for the C + WebGPU learning project. "C Practice.app" opens this in Terminal (see tools/make-app.sh).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "${0:A:h:h}" || exit 1

not_built() {
  echo "The world project is not built yet. Build it with:"
  echo "  cmake -S world -B build -G Ninja && cmake --build build"
}

while true; do
  clear
  echo "C Practice"
  node tools/review.mjs --stats | tail -1
  echo
  echo "  1) Review: due cards plus new ones"
  echo "  2) Review everything you have learned"
  echo "  3) Review one chapter"
  echo "  4) Progress by chapter"
  echo "  5) Run the world demo (00-sky)"
  echo "  6) Run the world tests"
  echo "  q) Quit"
  echo
  read "choice?> "
  case $choice in
    1) node tools/review.mjs ;;
    2) node tools/review.mjs --all ;;
    3) read "ch?Chapter (e.g. pointers, p3-noise): "; node tools/review.mjs --chapter "$ch" ;;
    4) node tools/review.mjs --stats ;;
    5) if [[ -x build/00-sky ]]; then ./build/00-sky; else not_built; fi ;;
    6) if [[ -x build/world_tests ]]; then ./build/world_tests; else not_built; fi ;;
    q|Q) exit 0 ;;
    *) continue ;;
  esac
  echo
  read "?Press Enter to return to the menu "
done
