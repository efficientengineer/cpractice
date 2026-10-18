// Spaced repetition for the C course. Two kinds of card:
//   question: a quiz from content/*.txt, answered by picking a choice.
//   code:     an exercise. You write the code in review-work/, and the exercise's own tests decide.
// New cards are introduced a few at a time; every card comes back on a spacing schedule (SM-2 style),
// and a failed card comes back again in the same session.
//
// Usage:
//   node tools/review.mjs               due cards plus new ones (default 5 new)
//   node tools/review.mjs --new 8       introduce up to 8 new cards
//   node tools/review.mjs --all         also review every learned card, not just the due ones
//   node tools/review.mjs --chapter 05-arrays
//   node tools/review.mjs --stats
import fs from 'fs'; import vm from 'vm'; import path from 'path'; import os from 'os';
import readline from 'readline/promises'; import { spawnSync } from 'child_process'; import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROGRESS = `${root}/review-progress.json`;
const WORK = `${root}/review-work`;
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

const ctx = { window: {} }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['manifest', 'assemble', 'format']) vm.runInContext(fs.readFileSync(`${root}/tools/lib/${f}.js`, 'utf8'), ctx);
const A = ctx.window.Assemble, F = ctx.window.Format;

// Cards in course order.
const cards = [];
for (const f of ctx.window.CHAPTER_FILES) {
  if (f[0] === '#') continue;
  const p = `${root}/content/${f}.txt`;
  if (!fs.existsSync(p)) continue;
  const ch = F.parseChapter(fs.readFileSync(p, 'utf8'));
  (ch.quiz || []).forEach((q, i) => cards.push({ id: `${ch.id}/q${i}`, kind: 'question', chapter: ch.id, q }));
  for (const ex of ch.exercises || []) {
    if (ex.harness || ex.tests) cards.push({ id: `${ch.id}/${ex.id}`, kind: 'code', chapter: ch.id, ex });
  }
}

// Progress: { cards: { [id]: { ease, interval, reps, lapses, due } } }. Only a missing file starts fresh.
function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { cards: {} }; throw e; }
}
const saveProgress = p => fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 1) + '\n');

// grade: 0 again, 3 hard, 4 good, 5 easy. A miss resets the card to one day; a correct answer
// grows the gap (1, 3, 6, then ease-scaled). Nothing retires, so every card keeps coming back.
function schedule(prev, grade) {
  const s = { ease: 2.5, interval: 0, reps: 0, lapses: 0, streak: 0, due: today(), ...prev };
  if (grade < 3) {
    s.lapses++; s.reps = 0; s.streak = 0; s.interval = 1; s.ease = Math.max(1.3, s.ease - 0.2);
  } else {
    s.streak++;
    s.ease = Math.max(1.3, s.ease + (grade === 3 ? -0.15 : grade === 5 ? 0.15 : 0));
    if (grade === 3) s.interval = Math.max(1, Math.round(s.interval * 1.2));
    else if (s.reps === 0) s.interval = grade === 5 ? 4 : 1;
    else if (s.reps === 1) s.interval = grade === 5 ? 6 : 3;
    else s.interval = Math.round(s.interval * s.ease * (grade === 5 ? 1.3 : 1));
    s.reps++;
  }
  s.due = addDays(today(), s.interval);
  return s;
}

// Code cards: compile with the same flags verify.mjs uses, then run the harness or tests.
const FLAGS = ['-std=c17', '-Wall', '-Wextra', '-g', '-O0', '-fsanitize=address,undefined', '-fno-omit-frame-pointer'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
let builds = 0;
function build(src) {
  const c = `${tmp}/t${builds++}.c`, exe = c.replace(/\.c$/, '');
  fs.writeFileSync(c, src);
  const b = spawnSync('gcc', [...FLAGS, c, '-o', exe, '-lm'], { encoding: 'utf8' });
  return { ok: b.status === 0, exe, log: b.stderr };
}
const runExe = (exe, stdin) => spawnSync(exe, [], { input: stdin, encoding: 'utf8', timeout: 10000 });
function grade(ex, code) {
  if (ex.harness) {
    const b = build(A.harness(code, ex));
    if (!b.ok) return { pass: false, msg: b.log };
    const r = runExe(b.exe, '');
    return { pass: A.passed({ didExecute: true, exit: r.status, stdout: r.stdout }), msg: r.stdout + r.stderr };
  }
  const b = build(code);
  if (!b.ok) return { pass: false, msg: b.log };
  for (const [i, t] of ex.tests.entries()) {
    const r = runExe(b.exe, t.stdin || '');
    if (A.norm(r.stdout) !== A.norm(t.out) || r.status !== (t.exit || 0)) {
      return { pass: false, msg: `test ${i + 1} failed\ngot:\n${r.stdout}${r.stderr}\nwant:\n${t.out}` };
    }
  }
  return { pass: true, msg: `all ${ex.tests.length} tests passed` };
}

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const chapterFilter = opt('--chapter', null);
const pool = cards.filter(c => !chapterFilter || c.chapter === chapterFilter);
const progress = loadProgress();
const S = progress.cards;
const t = today();

if (args.includes('--stats')) {
  const byChapter = new Map();
  for (const c of pool) {
    const row = byChapter.get(c.chapter) || { total: 0, learned: 0, due: 0 };
    row.total++;
    if (S[c.id]) { row.learned++; if (S[c.id].due <= t) row.due++; }
    byChapter.set(c.chapter, row);
  }
  console.log('chapter'.padEnd(22) + 'cards  learned  due');
  for (const [ch, r] of byChapter) console.log(ch.padEnd(22) + String(r.total).padStart(5) + String(r.learned).padStart(9) + String(r.due).padStart(5));
  const all = pool.length, learned = pool.filter(c => S[c.id]).length;
  console.log(`\n${learned} of ${all} cards learned, ${pool.filter(c => S[c.id] && S[c.id].due <= t).length} due today`);
  process.exit(0);
}

const learned = pool.filter(c => S[c.id]);
const due = learned.filter(c => S[c.id].due <= t);
const fresh = pool.filter(c => !S[c.id]).slice(0, Number(opt('--new', 5)));
const queue = shuffle(args.includes('--all') ? learned.concat(fresh) : due.concat(fresh));
// Within a session, a card you missed keeps coming back (about every 3 cards) until you get it right
// twice in a row. MAX_REQUEUES caps it so one stubborn card cannot trap the session.
const MAX_REQUEUES = 6;
const sessionState = new Map();

fs.mkdirSync(WORK, { recursive: true });
// Read answers through the line iterator: it buffers, so piped input works, and Ctrl-D ends the session.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
async function ask(prompt) {
  process.stdout.write(prompt);
  const { value, done } = await lines.next();
  if (done) { console.log('\nStopped. Progress is saved.'); process.exit(0); }
  return value;
}
console.log(`${queue.length} cards this session (${due.length} due, ${fresh.length} new). Ctrl-D to stop; progress saves after each card.`);

async function askQuestion(card) {
  const q = card.q;
  console.log(`\n${q.q}`);
  if (q.code) console.log(`\n${q.code}`);
  const order = shuffle(q.choices.map((_, i) => i));
  console.log();
  order.forEach((j, k) => console.log(`  ${k + 1}) ${q.choices[j]}`));
  const pick = Number((await ask('\n> ')).trim()) - 1;
  const correct = order[pick] === q.answer;
  console.log(correct ? '\nCorrect.' : `\nNot quite. The answer is ${order.indexOf(q.answer) + 1}.`);
  if (q.explain) console.log(`\n${q.explain}`);
  return correct;
}

async function askCode(card) {
  const ex = card.ex;
  const file = `${WORK}/${card.id.replace('/', '-')}.c`;
  if (!fs.existsSync(file)) fs.writeFileSync(file, (ex.starter || '') + '\n');
  console.log(`\n${ex.title}\n\n${ex.prompt}`);
  console.log(`\nWrite your code in ${path.relative(process.cwd(), file)}, then press Enter here.`);
  console.log('Type "h" for a hint, "s" for the solution (counts as a miss), or Enter to run.');
  let hint = 0, looked = false;
  for (;;) {
    const a = (await ask('> ')).trim();
    if (a === 'h') {
      if (hint < (ex.hints || []).length) console.log(`Hint: ${ex.hints[hint++]}`);
      else console.log('No more hints.');
    } else if (a === 's') {
      console.log(`\n${ex.solution}\n`); looked = true; break;
    } else break;
  }
  if (looked) {
    console.log('Solution shown, so this counts as a miss. Study it, then try again in a later session.');
    return false;
  }
  for (;;) {
    const r = grade(ex, fs.readFileSync(file, 'utf8'));
    if (r.pass) { console.log(`PASS: ${r.msg.trim()}`); return true; }
    console.log(`FAIL:\n${r.msg.slice(0, 2000)}`);
    const a = (await ask('Fix the file and press Enter to re-run, or "g" to give up: ')).trim();
    if (a === 'g') { console.log(`\n${ex.solution}\n`); return false; }
  }
}

while (queue.length) {
  const card = queue.shift();
  console.log(`\n── ${card.id} (${card.kind}) ──`);
  const passed = card.kind === 'question' ? await askQuestion(card) : await askCode(card);
  S[card.id] = schedule(S[card.id], passed ? 4 : 0);
  saveProgress(progress);
  const st = sessionState.get(card.id) || { run: 0, missed: false, requeues: 0 };
  if (passed) st.run++; else { st.run = 0; st.missed = true; }
  sessionState.set(card.id, st);
  if (st.missed && st.run < 2 && st.requeues < MAX_REQUEUES) {
    st.requeues++;
    queue.splice(Math.min(3, queue.length), 0, card);
    console.log(passed ? 'Right once. Get it right again to clear it for this session.' : 'Missed. This card comes back again in this session.');
  }
  console.log(`next review: ${S[card.id].due} (correct in a row: ${S[card.id].streak})`);
}
console.log('\nSession done.');
rl.close();
