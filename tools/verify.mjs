// Parses content/*.txt, compiles every exercise solution against its tests, checks starters compile,
// and checks "run" quizzes print the marked answer. Usage: node tools/verify.mjs [chapter-file-prefix]
import fs from 'fs'; import vm from 'vm'; import { execFileSync, spawnSync } from 'child_process'; import os from 'os'; import path from 'path';
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const ctx = { window: {}, COURSE: [] }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(root + '/js/manifest.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(root + '/js/assemble.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(root + '/js/format.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(root + '/js/format.js', 'utf8'), ctx);
const A = ctx.window.Assemble;
const only = process.argv[2];
for (const f of ctx.window.CHAPTER_FILES) {
  if (only && !f.startsWith(only)) continue;
  const p = `${root}/content/${f}.txt`;
  if (fs.existsSync(p)) ctx.COURSE.push(ctx.window.Format.parseChapter(fs.readFileSync(p, 'utf8')));
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
const FLAGS = ['-std=c17', '-Wall', '-Wextra', '-g', '-O0', '-fsanitize=address,undefined', '-fno-omit-frame-pointer'];
let n = 0;
function run(src, stdin = '', extra = []) {
  const c = `${tmp}/t${n++}.c`, exe = c.replace(/\.c$/, '');
  fs.writeFileSync(c, src);
  const b = spawnSync('gcc', [...FLAGS, ...extra, c, '-o', exe, '-lm'], { encoding: 'utf8' });
  if (b.status !== 0) return { didExecute: false, build: b.stderr, exit: -1, stdout: '', stderr: '' };
  const r = spawnSync(exe, [], { input: stdin, encoding: 'utf8', timeout: 10000, env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1' } });
  return { didExecute: true, build: b.stderr, exit: r.status, stdout: r.stdout, stderr: r.stderr };
}
let fails = 0, exs = 0, qs = 0; const ids = new Set();
const bad = (where, msg, extra) => { fails++; console.log(`FAIL ${where}: ${msg}`); if (extra) console.log(String(extra).slice(0, 1500)); };
for (const ch of ctx.COURSE) {
  if (ids.has(ch.id)) bad(ch.id, 'duplicate chapter id'); ids.add(ch.id);
  for (const ex of ch.exercises || []) {
    exs++; const w = `${ch.id}/${ex.id}`;
    if (ids.has(w)) bad(w, 'duplicate exercise id'); ids.add(w);
    for (const k of ['id', 'title', 'prompt', 'starter', 'solution']) if (!ex[k]) bad(w, 'missing ' + k);
    if (ex.harness) {
      const s = run(A.harness(ex.solution, ex));
      if (!A.passed(s)) bad(w, 'solution does not pass', s.build + s.stdout + s.stderr);
      else if (/warning:/.test(s.build)) bad(w, 'solution has warnings', s.build);
      const st = run(A.harness(ex.starter, ex));
      if (!st.didExecute) bad(w, 'starter does not compile', st.build);
      else if (A.passed(st) && !ex.starterPasses) bad(w, 'starter already passes');
    } else if (ex.tests) {
      for (const [i, t] of ex.tests.entries()) {
        const s = run(ex.solution, t.stdin || '');
        if (!s.didExecute) { bad(w, 'solution does not compile', s.build); break; }
        if (/warning:/.test(s.build)) bad(w, 'solution has warnings', s.build);
        if (A.norm(s.stdout) !== A.norm(t.out) || s.exit !== (t.exit || 0)) bad(w, `test ${i} mismatch (exit ${s.exit})`, `got:\n${s.stdout}${s.stderr}\nwant:\n${t.out}`);
      }
      const st = run(ex.starter);
      if (!st.didExecute) bad(w, 'starter does not compile', st.build);
    } else bad(w, 'needs harness or tests');
  }
  for (const [i, q] of (ch.quiz || []).entries()) {
    qs++; const w = `${ch.id}/quiz${i}`;
    if (!(q.answer >= 0 && q.answer < q.choices.length)) bad(w, 'bad answer index');
    if (q.run) {
      const s = run(q.code, '', q.flags || []);
      const out = A.norm(s.stdout);
      if (out !== A.norm(q.choices[q.answer])) bad(w, 'quiz output mismatch', `got:\n${s.build}${s.stdout}${s.stderr}\nmarked:\n${q.choices[q.answer]}`);
      q.choices.forEach((c, j) => { if (j !== q.answer && A.norm(c) === out) bad(w, 'two choices match output'); });
    }
  }
}
console.log(`${ctx.COURSE.length} chapters, ${exs} exercises, ${qs} quiz questions, ${fails} failures`);
fs.rmSync(tmp, { recursive: true });
process.exit(fails ? 1 : 0);
