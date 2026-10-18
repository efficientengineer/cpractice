(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const main = $('#main'), side = $('#side');
  const PKEY = 'cpractice.progress';
  let COURSE = [];
  const P = (() => { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } })();
  P.done ||= {}; P.code ||= {}; P.quiz ||= {}; P.read ||= {};
  const save = () => localStorage.setItem(PKEY, JSON.stringify(P));
  const exKey = (ch, ex) => ch.id + '/' + ex.id;
  const esc = MD.esc;

  // ---------- editor ----------
  function makeEditor(host, value, onChange) {
    if (window.CodeMirror) {
      const cm = CodeMirror(host, {
        value, mode: 'text/x-csrc', lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
        matchBrackets: true, autoCloseBrackets: true, viewportMargin: Infinity,
        extraKeys: { Tab: c => c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ') }
      });
      cm.on('change', () => onChange && onChange(cm.getValue()));
      return { get: () => cm.getValue(), set: v => cm.setValue(v), focus: () => cm.focus() };
    }
    const ta = document.createElement('textarea');
    ta.className = 'plain-editor'; ta.spellcheck = false; ta.value = value;
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    ta.addEventListener('input', () => onChange && onChange(ta.value));
    host.appendChild(ta);
    return { get: () => ta.value, set: v => { ta.value = v; }, focus: () => ta.focus() };
  }

  // ---------- output ----------
  function showResult(out, res, extraHtml = '') {
    let h = '';
    if (res.build.trim()) h += `<div class="label">compiler</div><pre class="build">${esc(res.build)}</pre>`;
    if (!res.didExecute) h += `<div class="status bad">Build failed</div>`;
    else {
      h += `<div class="label">stdout</div><pre class="stdout">${esc(res.stdout) || '<span class="muted">(empty)</span>'}</pre>`;
      if (res.stderr.trim()) h += `<div class="label">stderr</div><pre class="stderr">${esc(res.stderr)}</pre>`;
      h += `<div class="status ${res.exit === 0 ? '' : 'bad'}">exit code ${res.exit}${res.timedOut ? ' (timed out)' : ''}</div>`;
    }
    out.innerHTML = extraHtml + h + `<div class="backend muted">${esc(res.backend)}</div>`;
  }
  const busy = (out, msg) => { out.innerHTML = `<div class="muted spin">${msg}</div>`; };
  const fail = (out, e) => { out.innerHTML = `<div class="status bad">Could not reach the compiler service: ${esc(String(e.message || e))}</div><p class="muted">Check your connection, or switch backend in <a href="#/settings">Settings</a>.</p>`; };

  // ---------- sidebar ----------
  function chapterStats(ch) {
    const total = ch.exercises.length, done = ch.exercises.filter(e => P.done[exKey(ch, e)]).length;
    const qt = ch.quiz.length, qd = ch.quiz.filter(q => P.quiz[q.id]).length;
    return { total, done, qt, qd };
  }
  function renderSide(curCh, curEx) {
    side.innerHTML = '<ol class="chapters">' + COURSE.map((ch, i) => {
      const s = chapterStats(ch), cur = ch === curCh;
      const exs = cur ? '<ul class="exlist">' + ch.exercises.map(e =>
        `<li class="${e === curEx ? 'cur' : ''}"><a href="#/ex/${ch.id}/${e.id}">${P.done[exKey(ch, e)] ? '✓' : '○'} ${esc(e.title)}</a></li>`).join('') + '</ul>' : '';
      return `<li class="${cur ? 'cur' : ''}"><a href="#/ch/${ch.id}"><span class="num">${i}</span> ${esc(ch.title)}
        <span class="pct">${s.done}/${s.total}</span></a>${exs}</li>`;
    }).join('') + '</ol>';
  }

  // ---------- pages ----------
  function home() {
    renderSide();
    const all = COURSE.flatMap(ch => ch.exercises.map(e => [ch, e]));
    const done = all.filter(([c, e]) => P.done[exKey(c, e)]).length;
    const next = all.find(([c, e]) => !P.done[exKey(c, e)]);
    main.innerHTML = `
      <section class="hero">
        <h1>Learn C by writing it</h1>
        <p>A course for people who already program in C#, JavaScript or similar, and want real C: pointers, memory, strings, undefined behavior and all. Every chapter has runnable examples, quizzes, and exercises that are compiled with gcc and checked against tests, with AddressSanitizer catching your memory bugs.</p>
        <div class="progressbar"><div style="width:${all.length ? 100 * done / all.length : 0}%"></div></div>
        <p class="muted">${done} of ${all.length} exercises solved. Progress is saved in this browser.</p>
        ${next ? `<a class="btn primary" href="#/ex/${next[0].id}/${next[1].id}">Continue: ${esc(next[1].title)}</a>` : ''}
        <a class="btn" href="#/practice">Practice drills</a> <a class="btn" href="#/play">Playground</a>
      </section>
      <div class="cards">${COURSE.map((ch, i) => {
        const s = chapterStats(ch);
        return `<a class="card" href="#/ch/${ch.id}"><div class="cardnum">${i}</div><h3>${esc(ch.title)}</h3><p>${MD.inline(ch.blurb || '')}</p>
          <div class="muted small">${s.done}/${s.total} exercises · ${s.qd}/${s.qt} quiz</div>
          <div class="progressbar thin"><div style="width:${s.total ? 100 * s.done / s.total : 0}%"></div></div></a>`;
      }).join('')}</div>`;
  }

  function quizHtml(q) {
    return `<div class="quiz" data-q="${q.id}">
      <div class="qtext">${MD.render(q.q || '')}</div>
      ${q.code ? `<pre class="qcode"><code>${MD.highlight(q.code)}</code></pre>` : ''}
      <div class="choices">${q.choices.map((c, i) => `<button class="choice" data-i="${i}"><pre>${esc(c)}</pre></button>`).join('')}</div>
      <div class="explain" hidden>${MD.render(q.explain || '')}</div>
      ${P.quiz[q.id] ? '<div class="muted small">✓ answered correctly before</div>' : ''}
    </div>`;
  }
  function wireQuiz(root, all) {
    root.querySelectorAll('.quiz').forEach(el => {
      const q = all.find(x => x.id === el.dataset.q);
      el.querySelectorAll('.choice').forEach(b => b.onclick = () => {
        const i = +b.dataset.i;
        el.querySelectorAll('.choice').forEach(x => { x.disabled = true; if (+x.dataset.i === q.answer) x.classList.add('right'); });
        if (i !== q.answer) b.classList.add('wrong'); else { P.quiz[q.id] = true; save(); }
        el.querySelector('.explain').hidden = false;
      });
    });
  }
  function wireTryIt(root) {
    root.querySelectorAll('.tryit').forEach(b => b.onclick = () => {
      sessionStorage.setItem('cpractice.play', MD.codeBlocks[+b.dataset.code]);
      location.hash = '#/play';
    });
  }

  function chapter(ch) {
    renderSide(ch);
    const idx = COURSE.indexOf(ch), prev = COURSE[idx - 1], next = COURSE[idx + 1];
    const body = MD.render(ch.body || '');
    const toc = [...(ch.body || '').matchAll(/^## (.*)$/gm)].map(m => m[1]);
    P.read[ch.id] = true; save();
    main.innerHTML = `
      <article class="chapter">
        <div class="muted small">Chapter ${idx}</div>
        <h1>${esc(ch.title)}</h1>
        <p class="lead">${MD.inline(ch.blurb || '')}</p>
        ${toc.length > 2 ? `<nav class="toc"><strong>In this chapter</strong><ul>${toc.map(t =>
          `<li><a href="javascript:void 0" data-h="h-${t.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}">${MD.inline(t)}</a></li>`).join('')}
          ${ch.quiz.length ? '<li><a href="javascript:void 0" data-h="quiz">Check yourself</a></li>' : ''}
          <li><a href="javascript:void 0" data-h="exercises">Exercises</a></li></ul></nav>` : ''}
        ${body}
        ${ch.quiz.length ? `<h2 id="quiz">Check yourself</h2>${ch.quiz.map(quizHtml).join('')}` : ''}
        <h2 id="exercises">Exercises</h2>
        <ol class="exercises">${ch.exercises.map(e => `<li><a href="#/ex/${ch.id}/${e.id}">${P.done[exKey(ch, e)] ? '✓' : '○'} ${esc(e.title)}</a>
          <span class="muted small">${e.harness ? 'function' : 'program'}</span></li>`).join('')}</ol>
        <div class="pager">${prev ? `<a class="btn" href="#/ch/${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="btn" href="#/ch/${next.id}">${esc(next.title)} →</a>` : ''}</div>
      </article>`;
    main.querySelectorAll('[data-h]').forEach(a => a.onclick = () => document.getElementById(a.dataset.h)?.scrollIntoView({ behavior: 'smooth' }));
    wireQuiz(main, ch.quiz); wireTryIt(main);
    window.scrollTo(0, 0);
  }

  function exercise(ch, ex) {
    renderSide(ch, ex);
    const key = exKey(ch, ex), list = ch.exercises, i = list.indexOf(ex);
    const nextEx = list[i + 1] ? `#/ex/${ch.id}/${list[i + 1].id}` : (COURSE[COURSE.indexOf(ch) + 1] ? `#/ch/${COURSE[COURSE.indexOf(ch) + 1].id}` : '#/');
    let hintsShown = 0;
    main.innerHTML = `
      <div class="exercise">
        <div class="crumbs muted small"><a href="#/ch/${ch.id}">${esc(ch.title)}</a> · exercise ${i + 1} of ${list.length} · ${ex.harness ? 'function exercise' : 'program exercise'}
          ${P.done[key] ? ' · <span class="ok">✓ solved</span>' : ''}</div>
        <h1>${esc(ex.title)}</h1>
        <div class="prompt">${MD.render(ex.prompt)}</div>
        <div class="hints"></div>
        <div class="editorhost"></div>
        <details class="stdinbox"><summary>stdin for Run</summary><textarea class="stdin" spellcheck="false">${esc(ex.tests ? ex.tests[0].stdin : '')}</textarea></details>
        <div class="toolbar">
          <button class="btn" id="run" title="Ctrl+Enter">▶ Run</button>
          <button class="btn primary" id="check" title="Ctrl+Shift+Enter">✓ Check</button>
          ${ex.hints.length ? `<button class="btn" id="hint">Hint (${ex.hints.length})</button>` : ''}
          <button class="btn" id="tests">Tests</button>
          <button class="btn" id="solution">Solution</button>
          <button class="btn" id="reset">Reset</button>
          <a class="btn" href="${nextEx}">Next →</a>
        </div>
        <div class="testsview" hidden></div>
        <div class="output"></div>
      </div>`;
    const out = $('.output', main), stdin = $('.stdin', main);
    const ed = makeEditor($('.editorhost', main), P.code[key] ?? ex.starter, v => { P.code[key] = v; save(); });
    const run = async () => {
      busy(out, 'Compiling and running…');
      try { showResult(out, await Runner.run(ed.get(), stdin.value)); } catch (e) { fail(out, e); }
    };
    const check = async () => {
      busy(out, 'Checking…');
      try {
        if (ex.harness) {
          const res = await Runner.run(Assemble.harness(ed.get(), ex), '');
          const ok = Assemble.passed(res);
          finish(ok, res, '');
        } else {
          let html = '', ok = true, last;
          for (const [n, t] of ex.tests.entries()) {
            last = await Runner.run(ed.get(), t.stdin);
            if (!last.didExecute) { ok = false; break; }
            const want = t.exit || 0;
            const pass = Assemble.norm(last.stdout) === Assemble.norm(t.out) && last.exit === want;
            ok &&= pass;
            html += `<div class="testcase ${pass ? 'pass' : 'failc'}"><div><strong>Test ${n + 1}: ${pass ? 'passed' : 'failed'}</strong></div>
              ${pass ? '' : `<div class="cols"><div><div class="label">stdin</div><pre>${esc(t.stdin) || '<span class="muted">(none)</span>'}</pre></div>
              <div><div class="label">expected${want ? ' (exit ' + want + ')' : ''}</div><pre>${esc(t.out)}</pre></div>
              <div><div class="label">got (exit ${last.exit})</div><pre>${esc(last.stdout)}</pre></div></div>
              ${last.stderr.trim() ? `<div class="label">stderr</div><pre class="stderr">${esc(last.stderr)}</pre>` : ''}`}</div>`;
            if (!pass) break;
          }
          if (!last.didExecute) return showResult(out, last);
          finish(ok, null, html, last);
        }
      } catch (e) { fail(out, e); }
    };
    const finish = (ok, res, html, last) => {
      if (ok) { P.done[key] = true; save(); renderSide(ch, ex); }
      const banner = ok ? `<div class="status good big">All tests passed. <a href="${nextEx}">Next →</a></div>` : `<div class="status bad big">Not yet.</div>`;
      if (res) showResult(out, res, banner); else out.innerHTML = banner + html + `<div class="backend muted">${esc(last.backend)}</div>`;
    };
    $('#run').onclick = run; $('#check').onclick = check;
    $('#reset').onclick = () => { if (confirm('Replace your code with the starter?')) ed.set(ex.starter); };
    $('#solution').onclick = () => {
      out.innerHTML = `<div class="label">reference solution</div><pre class="qcode"><code>${MD.highlight(ex.solution)}</code></pre>
        <button class="btn small" id="usesol">Load into editor</button>`;
      $('#usesol').onclick = () => { if (confirm('Replace your code with the solution?')) ed.set(ex.solution); };
    };
    $('#tests').onclick = () => {
      const tv = $('.testsview', main); tv.hidden = !tv.hidden;
      tv.innerHTML = ex.harness ? `<div class="label">test code (appended after yours)</div><pre class="qcode"><code>${MD.highlight(ex.harness)}</code></pre>`
        : ex.tests.map((t, n) => `<div class="cols"><div><div class="label">test ${n + 1} stdin</div><pre>${esc(t.stdin) || '(none)'}</pre></div>
          <div><div class="label">expected stdout${t.exit ? ' (exit ' + t.exit + ')' : ''}</div><pre>${esc(t.out)}</pre></div></div>`).join('');
    };
    if (ex.hints.length) $('#hint').onclick = () => {
      if (hintsShown >= ex.hints.length) return;
      $('.hints', main).insertAdjacentHTML('beforeend', `<div class="hint"><strong>Hint ${hintsShown + 1}.</strong> ${MD.render(ex.hints[hintsShown])}</div>`);
      hintsShown++;
      $('#hint').textContent = hintsShown < ex.hints.length ? `Hint (${ex.hints.length - hintsShown})` : 'No more hints';
    };
    keys = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.shiftKey ? check() : run(); }
    };
    wireTryIt(main);
    window.scrollTo(0, 0);
  }

  function play(q) {
    renderSide();
    const fromLink = q.get('c');
    let code = fromLink ? decodeURIComponent(escape(atob(fromLink))) : sessionStorage.getItem('cpractice.play') || localStorage.getItem('cpractice.playcode') ||
      '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, C!\\n");\n    return 0;\n}\n';
    sessionStorage.removeItem('cpractice.play');
    main.innerHTML = `<h1>Playground</h1>
      <p class="muted">Flags: <code>${esc(Runner.flags(Runner.Settings.get()).join(' '))}</code> (<a href="#/settings">change</a>)</p>
      <div class="editorhost"></div>
      <details class="stdinbox"><summary>stdin</summary><textarea class="stdin" spellcheck="false"></textarea></details>
      <div class="toolbar"><button class="btn primary" id="run" title="Ctrl+Enter">▶ Run</button> <button class="btn" id="share">Copy share link</button></div>
      <div class="output"></div>`;
    const out = $('.output', main), stdin = $('.stdin', main);
    const ed = makeEditor($('.editorhost', main), code, v => localStorage.setItem('cpractice.playcode', v));
    localStorage.setItem('cpractice.playcode', code);
    const run = async () => { busy(out, 'Compiling and running…'); try { showResult(out, await Runner.run(ed.get(), stdin.value)); } catch (e) { fail(out, e); } };
    $('#run').onclick = run;
    $('#share').onclick = () => {
      const url = location.href.split('#')[0] + '#/play?c=' + encodeURIComponent(btoa(unescape(encodeURIComponent(ed.get()))));
      navigator.clipboard.writeText(url).then(() => $('#share').textContent = 'Copied');
    };
    keys = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } };
  }

  function practice() {
    renderSide();
    const all = COURSE.flatMap(ch => ch.exercises.map(e => [ch, e]));
    const unsolved = all.filter(([c, e]) => !P.done[exKey(c, e)]);
    const quizzes = COURSE.flatMap(ch => ch.quiz);
    main.innerHTML = `<h1>Practice</h1>
      <div class="toolbar">
        ${unsolved.length ? '<button class="btn primary" id="rand">Random unsolved exercise</button>' : ''}
        <button class="btn" id="randsolved">Redo a random solved one</button>
        <button class="btn" id="drill">Quiz drill (10 random questions)</button>
      </div>
      <div id="drillhost"></div>
      <h2>All exercises</h2>
      ${COURSE.map(ch => `<h3><a href="#/ch/${ch.id}">${esc(ch.title)}</a></h3><ul class="exgrid">${ch.exercises.map(e =>
        `<li class="${P.done[exKey(ch, e)] ? 'solved' : ''}"><a href="#/ex/${ch.id}/${e.id}">${P.done[exKey(ch, e)] ? '✓' : '○'} ${esc(e.title)}</a></li>`).join('')}</ul>`).join('')}`;
    const pick = a => a[Math.floor(Math.random() * a.length)];
    if (unsolved.length) $('#rand').onclick = () => { const [c, e] = pick(unsolved); location.hash = `#/ex/${c.id}/${e.id}`; };
    $('#randsolved').onclick = () => {
      const solved = all.filter(([c, e]) => P.done[exKey(c, e)]);
      if (!solved.length) return alert('Nothing solved yet.');
      const [c, e] = pick(solved); delete P.code[exKey(c, e)]; save(); location.hash = `#/ex/${c.id}/${e.id}`;
    };
    $('#drill').onclick = () => {
      const qs = [...quizzes].sort(() => Math.random() - 0.5).slice(0, 10);
      const host = $('#drillhost');
      host.innerHTML = qs.map(q => `<div class="muted small">${esc(COURSE.find(c => c.quiz.includes(q)).title)}</div>` + quizHtml(q)).join('');
      wireQuiz(host, qs);
    };
  }

  function settings() {
    renderSide();
    const s = Runner.Settings.get();
    main.innerHTML = `<h1>Settings</h1>
      <form class="settings">
        <label>Compiler backend
          <select name="backend">
            <option value="auto">Compiler Explorer, falling back to Wandbox</option>
            <option value="godbolt">Compiler Explorer only</option>
            <option value="wandbox">Wandbox only</option>
          </select></label>
        <label><input type="checkbox" name="sanitize"> AddressSanitizer + UndefinedBehaviorSanitizer (recommended)</label>
        <label>Optimization <select name="opt"><option>-O0</option><option>-O1</option><option>-O2</option><option>-O3</option></select></label>
        <label>Extra flags <input name="extra" placeholder="e.g. -Werror -Wconversion"></label>
        <label>Compiler Explorer compiler id <input name="compiler"></label>
        <p class="muted small">Exercise checks always use the same flags as Run. Turning sanitizers off makes memory bugs silent, like normal C.</p>
      </form>
      <h2>Progress</h2>
      <div class="toolbar">
        <button class="btn" id="export">Copy progress to clipboard</button>
        <button class="btn" id="import">Import progress</button>
        <button class="btn danger" id="wipe">Reset all progress</button>
      </div>`;
    const f = $('form', main);
    f.backend.value = s.backend; f.sanitize.checked = s.sanitize; f.opt.value = s.opt; f.extra.value = s.extra; f.compiler.value = s.compiler;
    f.oninput = () => Runner.Settings.set({ backend: f.backend.value, sanitize: f.sanitize.checked, opt: f.opt.value, extra: f.extra.value, compiler: f.compiler.value.trim() || 'cg141' });
    $('#export').onclick = () => navigator.clipboard.writeText(JSON.stringify(P)).then(() => $('#export').textContent = 'Copied');
    $('#import').onclick = () => {
      const t = prompt('Paste exported progress JSON'); if (!t) return;
      try { localStorage.setItem(PKEY, JSON.stringify(JSON.parse(t))); location.reload(); } catch { alert('Invalid JSON'); }
    };
    $('#wipe').onclick = () => { if (confirm('Erase all progress and saved code?')) { localStorage.removeItem(PKEY); location.reload(); } };
  }

  // ---------- routing ----------
  let keys = null;
  document.addEventListener('keydown', e => keys && keys(e));
  function route() {
    keys = null;
    document.body.classList.remove('menu-open');
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').filter(Boolean), q = new URLSearchParams(qs || '');
    const ch = COURSE.find(c => c.id === parts[1]);
    if (parts[0] === 'ch' && ch) chapter(ch);
    else if (parts[0] === 'ex' && ch && ch.exercises.find(e => e.id === parts[2])) exercise(ch, ch.exercises.find(e => e.id === parts[2]));
    else if (parts[0] === 'play') play(q);
    else if (parts[0] === 'practice') practice();
    else if (parts[0] === 'settings') settings();
    else home();
  }
  $('#menu').onclick = () => document.body.classList.toggle('menu-open');
  Promise.all(CHAPTER_FILES.map(f => fetch(`content/${f}.txt`).then(r => r.ok ? r.text() : null).catch(() => null)))
    .then(texts => {
      COURSE = texts.filter(Boolean).map(t => Format.parseChapter(t));
      window.addEventListener('hashchange', route);
      route();
    });
})();
