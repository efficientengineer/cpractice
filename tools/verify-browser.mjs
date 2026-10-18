// Verifies JS and WebGPU courses in headless Chromium through the site's own worker runner.
// Usage: node tools/verify-browser.mjs js|world [file-prefix]
import http from 'http'; import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const [course, prefix = ''] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
}).listen(0);
const port = server.address().port;
const browser = await pw.chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`http://localhost:${port}/#/settings`);
await page.waitForFunction(() => window.JSRunner && window.COURSES);
const result = await page.evaluate(async ({ course, prefix }) => {
  const c = COURSES.find(x => x.id === course), log = [];
  let fails = 0, exs = 0, qs = 0, chs = 0;
  const bad = (w, m, extra = '') => { fails++; log.push(`FAIL ${w}: ${m}\n${String(extra).slice(0, 1500)}`); };
  // Like the app: a canvas when the code mentions it.
  // Libraries of earlier chapters with "lib: yes", in course order (like the app).
  let libs = [];
  const run = code => {
    let canvas;
    if (/\bcanvas\b/.test(code)) { const el = document.createElement('canvas'); el.width = el.height = 256; canvas = el.transferControlToOffscreen(); }
    return JSRunner.run(code, { canvas, timeout: 30000, libs });
  };
  const ids = new Set();
  const libsSoFar = [];
  for (const f of c.files) {
    if (f[0] === '#') continue;
    const r = await fetch(`${c.dir}/${f}.txt`); if (!r.ok) continue;
    let ch; try { ch = Format.parseChapter(await r.text()); } catch (e) { bad(f, 'parse error ' + e); continue; }
    libs = libsSoFar.slice();
    if (ch.lib === 'yes') libsSoFar.push(`${c.dir}/lib/${f}.js`);
    if (!f.startsWith(prefix)) continue;
    if (ch.lib === 'yes' && !(await fetch(`${c.dir}/lib/${f}.js`)).ok) bad(f, 'lib: yes but no lib file');
    chs++;
    for (const ex of ch.exercises) {
      exs++; const w = `${ch.id}/${ex.id}`;
      if (ids.has(w)) bad(w, 'duplicate id'); ids.add(w);
      for (const k of ['id', 'title', 'prompt', 'starter', 'solution']) if (!ex[k]) bad(w, 'missing ' + k);
      if (ex.harness) {
        const s = await run(JSRunner.harness(ex.solution, ex));
        if (!Assemble.passed(s)) bad(w, 'solution does not pass', s.stdout + '\n' + s.stderr);
        const st = await run(JSRunner.harness(ex.starter, ex));
        if (Assemble.passed(st) && !ex.starterPasses) bad(w, 'starter already passes');
      } else if (ex.tests) {
        for (const [i, t] of ex.tests.entries()) {
          const s = await run(ex.solution);
          if (Assemble.norm(s.stdout) !== Assemble.norm(t.out) || s.exit !== (t.exit || 0)) bad(w, `test ${i} mismatch`, `got:\n${s.stdout}\n${s.stderr}\nwant:\n${t.out}`);
        }
        const st = await run(ex.starter);
        if (Assemble.norm(st.stdout) === Assemble.norm(ex.tests[0].out)) bad(w, 'starter already passes');
      } else bad(w, 'needs harness or tests');
    }
    for (const [i, q] of ch.quiz.entries()) {
      qs++; const w = `${ch.id}/quiz${i}`;
      if (!(q.answer >= 0)) bad(w, 'no answer');
      if (q.run) {
        const s = await run(q.code), out = Assemble.norm(s.stdout);
        if (out !== Assemble.norm(q.choices[q.answer])) bad(w, 'quiz output mismatch', `got:\n${s.stdout}\n${s.stderr}\nmarked:\n${q.choices[q.answer]}`);
        q.choices.forEach((x, j) => { if (j !== q.answer && Assemble.norm(x) === out) bad(w, 'two choices match output'); });
      }
    }
  }
  log.push(`${chs} chapters, ${exs} exercises, ${qs} quiz questions, ${fails} failures`);
  return { log: log.join('\n'), fails };
}, { course, prefix });
console.log(result.log);
await browser.close(); server.close();
process.exit(result.fails ? 1 : 0);
