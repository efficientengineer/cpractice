(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const main = $('#main'), side = $('#side');
  const PKEY = 'cpractice.progress';
  let COURSE = [], CUR = null; // CUR: current course object, COURSE: its chapters
  const P = (() => { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } })();
  P.done ||= {}; P.code ||= {}; P.quiz ||= {}; P.read ||= {};
  const save = () => localStorage.setItem(PKEY, JSON.stringify(P));
  const exKey = (ch, ex) => ch.course + '/' + ch.id + '/' + ex.id;
  const isC = () => CUR.lang === 'c';
  const R = p => `#/${CUR.id}/${p}`;
  const esc = MD.esc;

  // ---------- editor ----------
  function makeEditor(host, value, onChange) {
    if (window.CodeMirror) {
      const cm = CodeMirror(host, {
        value, mode: isC() ? 'text/x-csrc' : 'javascript', lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
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
  // Runs code for the current course. For WebGPU a fresh canvas is created in canvasHost.
  // Runs code for the current course. JS/WebGPU code that mentions `canvas` gets a fresh canvas
  // in canvasHost with keyboard/mouse forwarded to the worker; later console output streams into out.
  function execute(code, stdin, canvasHost, out) {
    if (isC()) return Runner.run(code, stdin);
    let canvas;
    if (canvasHost) canvasHost.hidden = true;
    if (canvasHost && /\bcanvas\b/.test(code)) {
      canvasHost.innerHTML = '<div class="muted small">Click the canvas to give it keyboard focus.</div>';
      const c = document.createElement('canvas'); c.width = 512; c.height = 512; c.tabIndex = 0; canvasHost.appendChild(c);
      canvasHost.hidden = false;
      const key = down => e => {
        if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
        if (!e.repeat) JSRunner.send({ t: 'key', code: e.code, down });
      };
      c.addEventListener('keydown', key(true)); c.addEventListener('keyup', key(false));
      c.addEventListener('blur', () => JSRunner.send({ t: 'key', code: '*blur', down: false }));
      const m = down => e => {
        const r = c.getBoundingClientRect();
        JSRunner.send({ t: 'mouse', m: { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height, ...(down === null ? {} : { down }) } });
      };
      c.addEventListener('mousemove', m(null)); c.addEventListener('mousedown', e => { c.focus(); m(true)(e); }); window.addEventListener('mouseup', m(false), { once: false });
      canvas = c.transferControlToOffscreen();
    }
    const onLate = (kind, line) => {
      if (!out) return;
      let pre = out.querySelector(kind === 'out' ? '.stdout' : '.stderr');
      if (!pre) { out.insertAdjacentHTML('afterbegin', `<pre class="${kind === 'out' ? 'stdout' : 'stderr'}"></pre>`); pre = out.querySelector(kind === 'out' ? '.stdout' : '.stderr'); }
      if (pre.querySelector('.muted')) pre.textContent = '';
      pre.textContent = (pre.textContent ? pre.textContent + '\n' : '') + line;
      const lines = pre.textContent.split('\n'); if (lines.length > 200) pre.textContent = lines.slice(-200).join('\n');
    };
    return JSRunner.run(code, { canvas, keepAlive: true, timeout: CUR.lang === 'webgpu' ? 15000 : 5000, onLate });
  }
  const assemble = (code, ex) => isC() ? Assemble.harness(code, ex) : JSRunner.harness(code, ex);
  const busy = (out, msg) => { out.innerHTML = `<div class="muted spin">${msg}</div>`; };
  const fail = (out, e) => { out.innerHTML = `<div class="status bad">Could not reach the compiler service: ${esc(String(e.message || e))}</div><p class="muted">Check your connection, or switch backend in <a href="#/settings">Settings</a>.</p>`; };

  // ---------- sidebar ----------
  function chapterStats(ch) {
    const total = ch.exercises.length, done = ch.exercises.filter(e => P.done[exKey(ch, e)]).length;
    const qt = ch.quiz.length, qd = ch.quiz.filter(q => P.quiz[q.id]).length;
    return { total, done, qt, qd };
  }
  function renderSide(curCh, curEx) {
    if (!CUR) {
      side.innerHTML = '<ol class="chapters">' + COURSES.map(c => `<li><a href="#/${c.id}"><span class="num">›</span> ${esc(c.title)}</a></li>`).join('') + '</ol>';
      return;
    }
    side.innerHTML = `<div class="coursehead"><a href="#/${CUR.id}">${esc(CUR.title)}</a></div>` + '<ol class="chapters">' + COURSE.map((ch, i) => {
      const s = chapterStats(ch), cur = ch === curCh;
      const exs = cur ? '<ul class="exlist">' + ch.exercises.map(e =>
        `<li class="${e === curEx ? 'cur' : ''}"><a href="${R('ex/' + ch.id + '/' + e.id)}">${P.done[exKey(ch, e)] ? '✓' : '○'} ${esc(e.title)}</a></li>`).join('') + '</ul>' : '';
      return (ch.section ? `<li class="section">${esc(ch.section)}</li>` : '') + `<li class="${cur ? 'cur' : ''}"><a href="${R('ch/' + ch.id)}"><span class="num">${i}</span> ${esc(ch.title)}
        <span class="pct">${s.done}/${s.total}</span></a>${exs}</li>`;
    }).join('') + '</ol>';
  }

  // ---------- pages ----------
  function siteHome() {
    CUR = null; renderSide(); nav();
    main.innerHTML = `
      <section class="hero">
        <h1>Learn by writing code</h1>
        <p>Three courses for working programmers. Each chapter has runnable examples, quizzes, and exercises checked against tests right here in the browser. Progress is saved in this browser.</p>
      </section>
      <div class="cards">${COURSES.map(c => {
        const all = c.chapters.flatMap(ch => ch.exercises.map(e => [ch, e])), done = all.filter(([ch, e]) => P.done[exKey(ch, e)]).length;
        return `<a class="card course" href="#/${c.id}"><h3>${esc(c.title)}</h3><p>${esc(c.blurb)}</p>
          <div class="muted small">${c.chapters.length} chapters · ${done}/${all.length} exercises</div>
          <div class="progressbar thin"><div style="width:${all.length ? 100 * done / all.length : 0}%"></div></div></a>`;
      }).join('')}</div>`;
  }

  const INTRO = {
    c: 'A course for people who already program in C#, JavaScript or similar, and want real C: pointers, memory, strings, undefined behavior and all. Exercises are compiled with gcc on a remote service and checked against tests, with AddressSanitizer catching your memory bugs.',
    js: 'Modern JavaScript properly: scope and closures, this and prototypes, the event loop, iterators and generators, typed arrays, metaprogramming. Everything runs in a Web Worker in your browser, so console.log output appears below your code.',
    webgpu: 'GPU programming with WebGPU and WGSL: buffers, compute shaders, render pipelines, textures, 3D and particles. Code runs in your browser, so you need a WebGPU-capable one (recent Chrome or Edge; Safari 26+; Firefox 141+ on Windows). Rendering appears on the canvas under the editor.'
  };
  function home() {
    renderSide();
    const all = COURSE.flatMap(ch => ch.exercises.map(e => [ch, e]));
    const done = all.filter(([c, e]) => P.done[exKey(c, e)]).length;
    const next = all.find(([c, e]) => !P.done[exKey(c, e)]);
    main.innerHTML = `
      <section class="hero">
        <h1>${esc(CUR.title)}</h1>
        <p>${INTRO[CUR.id]}</p>
        ${CUR.id === 'webgpu' && !navigator.gpu ? '<blockquote>This browser does not expose <code>navigator.gpu</code>. You can read the chapters, but the code will not run here.</blockquote>' : ''}
        <div class="progressbar"><div style="width:${all.length ? 100 * done / all.length : 0}%"></div></div>
        <p class="muted">${done} of ${all.length} exercises solved. Progress is saved in this browser.</p>
        ${next ? `<a class="btn primary" href="${R('ex/' + next[0].id + '/' + next[1].id)}">Continue: ${esc(next[1].title)}</a>` : ''}
        <a class="btn" href="${R('practice')}">Practice drills</a> <a class="btn" href="${R('play')}">Playground</a>
      </section>
      <div class="cards">${COURSE.map((ch, i) => {
        const s = chapterStats(ch);
        return `<a class="card" href="${R('ch/' + ch.id)}"><div class="cardnum">${i}</div><h3>${esc(ch.title)}</h3><p>${MD.inline(ch.blurb || '')}</p>
          <div class="muted small">${s.done}/${s.total} exercises · ${s.qd}/${s.qt} quiz</div>
          <div class="progressbar thin"><div style="width:${s.total ? 100 * s.done / s.total : 0}%"></div></div></a>`;
      }).join('')}</div>`;
  }

  function quizHtml(q) {
    return `<div class="quiz" data-q="${q.id}">
      <div class="qtext">${MD.render(q.q || '')}</div>
      ${q.code ? `<pre class="qcode"><code>${MD.highlight(q.code, CUR.lang)}</code></pre>` : ''}
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
      sessionStorage.setItem('cpractice.play.' + CUR.id, MD.codeBlocks[+b.dataset.code]);
      location.hash = R('play');
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
        <ol class="exercises">${ch.exercises.map(e => `<li><a href="${R('ex/' + ch.id + '/' + e.id)}">${P.done[exKey(ch, e)] ? '✓' : '○'} ${esc(e.title)}</a>
          <span class="muted small">${e.harness ? 'function' : 'program'}</span></li>`).join('')}</ol>
        <div class="pager">${prev ? `<a class="btn" href="${R('ch/' + prev.id)}">← ${esc(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="btn" href="${R('ch/' + next.id)}">${esc(next.title)} →</a>` : ''}</div>
      </article>`;
    main.querySelectorAll('[data-h]').forEach(a => a.onclick = () => document.getElementById(a.dataset.h)?.scrollIntoView({ behavior: 'smooth' }));
    wireQuiz(main, ch.quiz); wireTryIt(main);
    window.scrollTo(0, 0);
  }

  function exercise(ch, ex) {
    renderSide(ch, ex);
    const key = exKey(ch, ex), list = ch.exercises, i = list.indexOf(ex);
    const nextEx = list[i + 1] ? R(`ex/${ch.id}/${list[i + 1].id}`) : (COURSE[COURSE.indexOf(ch) + 1] ? R('ch/' + COURSE[COURSE.indexOf(ch) + 1].id) : R(''));
    let hintsShown = 0;
    main.innerHTML = `
      <div class="exercise">
        <div class="crumbs muted small"><a href="${R('ch/' + ch.id)}">${esc(ch.title)}</a> · exercise ${i + 1} of ${list.length} · ${ex.harness ? 'function exercise' : 'program exercise'}
          ${P.done[key] ? ' · <span class="ok">✓ solved</span>' : ''}</div>
        <h1>${esc(ex.title)}</h1>
        <div class="prompt">${MD.render(ex.prompt)}</div>
        <div class="hints"></div>
        <div class="editorhost"></div>
        ${isC() ? `<details class="stdinbox"><summary>stdin for Run</summary><textarea class="stdin" spellcheck="false">${esc(ex.tests ? ex.tests[0].stdin : '')}</textarea></details>` : ''}
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
        <div class="canvashost" hidden></div>
        <div class="output"></div>
      </div>`;
    const out = $('.output', main), stdin = $('.stdin', main) || { value: '' }, canvasHost = isC() ? null : $('.canvashost', main);
    // Project steps start from the learner's own code for the previous step, plus this step's stubs.
    const prev = ex.continues && list.find(e => e.id === ex.continues), prevKey = prev && exKey(ch, prev);
    const fromPrev = prev && P.done[prevKey] && P.code[prevKey] != null ? P.code[prevKey].replace(/\s+$/, '') + (ex.stubs ? '\n\n' + ex.stubs : '') + '\n' : null;
    const ed = makeEditor($('.editorhost', main), P.code[key] ?? fromPrev ?? ex.starter, v => { P.code[key] = v; save(); });
    if (prev) $('.prompt', main).insertAdjacentHTML('afterbegin', `<blockquote class="small">Builds on <a href="${R('ex/' + ch.id + '/' + prev.id)}">${esc(prev.title)}</a>.
      ${fromPrev ? 'Your code from that step is loaded, with this step\'s new stubs added at the end.' : 'The starter contains the reference solution of that step plus new stubs.'}</blockquote>`);
    const run = async () => {
      busy(out, 'Compiling and running…');
      try { showResult(out, await execute(ed.get(), stdin.value, canvasHost, out)); } catch (e) { fail(out, e); }
    };
    const check = async () => {
      busy(out, 'Checking…');
      try {
        if (ex.harness) {
          const res = await execute(assemble(ed.get(), ex), '', canvasHost, out);
          const ok = Assemble.passed(res);
          finish(ok, res, '');
        } else {
          let html = '', ok = true, last;
          for (const [n, t] of ex.tests.entries()) {
            last = await execute(ed.get(), t.stdin, canvasHost);
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
    $('#reset').onclick = () => { if (confirm('Replace your code with the starter?')) ed.set(fromPrev ?? ex.starter); };
    $('#solution').onclick = () => {
      out.innerHTML = `<div class="label">reference solution</div><pre class="qcode"><code>${MD.highlight(ex.solution, CUR.lang)}</code></pre>
        <button class="btn small" id="usesol">Load into editor</button>`;
      $('#usesol').onclick = () => { if (confirm('Replace your code with the solution?')) ed.set(ex.solution); };
    };
    $('#tests').onclick = () => {
      const tv = $('.testsview', main); tv.hidden = !tv.hidden;
      tv.innerHTML = ex.harness ? `<div class="label">test code (appended after yours)</div><pre class="qcode"><code>${MD.highlight(ex.harness, CUR.lang)}</code></pre>`
        : ex.tests.map((t, n) => `<div class="cols"><div><div class="label">test ${n + 1} stdin</div><pre>${esc(t.stdin) || '(none)'}</pre></div>
          <div><div class="label">expected ${isC() ? 'stdout' : 'console output'}${t.exit ? ' (exit ' + t.exit + ')' : ''}</div><pre>${esc(t.out)}</pre></div></div>`).join('');
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

  const PLAY_DEFAULT = {
    c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, C!\\n");\n    return 0;\n}\n',
    js: 'const greet = name => `Hello, ${name}!`;\nconsole.log(greet("JavaScript"));\nconsole.log([1, 2, 3].map(x => x * x));\n',
    webgpu: `const device = await getDevice();
const ctx = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format });

const module = device.createShaderModule({ code: \`
  @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = array(vec2f(0, 0.6), vec2f(-0.6, -0.5), vec2f(0.6, -0.5));
    return vec4f(p[i], 0, 1);
  }
  @fragment fn fs() -> @location(0) vec4f { return vec4f(1, 0.5, 0.2, 1); }
\` });
const pipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: { module },
  fragment: { module, targets: [{ format }] },
});
const enc = device.createCommandEncoder();
const pass = enc.beginRenderPass({ colorAttachments: [{
  view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.1, 0.1, 0.15, 1],
}] });
pass.setPipeline(pipeline);
pass.draw(3);
pass.end();
device.queue.submit([enc.finish()]);
console.log('drew a triangle');
`
  };
  function play(q) {
    renderSide();
    const fromLink = q.get('c'), pk = 'cpractice.playcode.' + CUR.id;
    let code = fromLink ? decodeURIComponent(escape(atob(fromLink))) : sessionStorage.getItem('cpractice.play.' + CUR.id) || localStorage.getItem(pk) || PLAY_DEFAULT[CUR.id];
    sessionStorage.removeItem('cpractice.play.' + CUR.id);
    main.innerHTML = `<h1>${esc(CUR.title)} playground</h1>
      ${isC() ? `<p class="muted">Flags: <code>${esc(Runner.flags(Runner.Settings.get()).join(' '))}</code> (<a href="#/settings">change</a>)</p>`
        : `<p class="muted">Runs in a Web Worker in your browser. Top-level <code>await</code> works.${CUR.lang === 'webgpu' ? ' <code>canvas</code> is an OffscreenCanvas; <code>getDevice()</code> returns a shared GPUDevice.' : ''}</p>`}
      <div class="editorhost"></div>
      ${isC() ? '<details class="stdinbox"><summary>stdin</summary><textarea class="stdin" spellcheck="false"></textarea></details>' : ''}
      <div class="toolbar"><button class="btn primary" id="run" title="Ctrl+Enter">▶ Run</button> <button class="btn" id="share">Copy share link</button>
        <button class="btn" id="resetplay">Reset to example</button></div>
      <div class="canvashost" hidden></div>
      <div class="output"></div>`;
    const out = $('.output', main), stdin = $('.stdin', main) || { value: '' }, canvasHost = isC() ? null : $('.canvashost', main);
    const ed = makeEditor($('.editorhost', main), code, v => localStorage.setItem(pk, v));
    localStorage.setItem(pk, code);
    const run = async () => { busy(out, isC() ? 'Compiling and running…' : 'Running…'); try { showResult(out, await execute(ed.get(), stdin.value, canvasHost, out)); } catch (e) { fail(out, e); } };
    $('#run').onclick = run;
    $('#resetplay').onclick = () => ed.set(PLAY_DEFAULT[CUR.id]);
    $('#share').onclick = () => {
      const url = location.href.split('#')[0] + '#/' + CUR.id + '/play?c=' + encodeURIComponent(btoa(unescape(encodeURIComponent(ed.get()))));
      navigator.clipboard.writeText(url).then(() => $('#share').textContent = 'Copied');
    };
    keys = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } };
  }

  function practice() {
    renderSide();
    const all = COURSE.flatMap(ch => ch.exercises.map(e => [ch, e]));
    const unsolved = all.filter(([c, e]) => !P.done[exKey(c, e)]);
    const quizzes = COURSE.flatMap(ch => ch.quiz);
    main.innerHTML = `<h1>${esc(CUR.title)} practice</h1>
      <div class="toolbar">
        ${unsolved.length ? '<button class="btn primary" id="rand">Random unsolved exercise</button>' : ''}
        <button class="btn" id="randsolved">Redo a random solved one</button>
        <button class="btn" id="drill">Quiz drill (10 random questions)</button>
      </div>
      <div id="drillhost"></div>
      <h2>All exercises</h2>
      ${COURSE.map(ch => `<h3><a href="${R('ch/' + ch.id)}">${esc(ch.title)}</a></h3><ul class="exgrid">${ch.exercises.map(e =>
        `<li class="${P.done[exKey(ch, e)] ? 'solved' : ''}"><a href="${R('ex/' + ch.id + '/' + e.id)}">${P.done[exKey(ch, e)] ? '✓' : '○'} ${esc(e.title)}</a></li>`).join('')}</ul>`).join('')}`;
    const pick = a => a[Math.floor(Math.random() * a.length)];
    if (unsolved.length) $('#rand').onclick = () => { const [c, e] = pick(unsolved); location.hash = R(`ex/${c.id}/${e.id}`); };
    $('#randsolved').onclick = () => {
      const solved = all.filter(([c, e]) => P.done[exKey(c, e)]);
      if (!solved.length) return alert('Nothing solved yet.');
      const [c, e] = pick(solved); delete P.code[exKey(c, e)]; save(); location.hash = R(`ex/${c.id}/${e.id}`);
    };
    $('#drill').onclick = () => {
      const qs = [...quizzes].sort(() => Math.random() - 0.5).slice(0, 10);
      const host = $('#drillhost');
      host.innerHTML = qs.map(q => `<div class="muted small">${esc(COURSE.find(c => c.quiz.includes(q)).title)}</div>` + quizHtml(q)).join('');
      wireQuiz(host, qs);
    };
  }

  function settings() {
    CUR = null; renderSide(); nav();
    const s = Runner.Settings.get();
    main.innerHTML = `<h1>Settings</h1><h2>C compiler</h2>
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
  function nav() {
    $('#coursenav').innerHTML = COURSES.map(c => `<a href="#/${c.id}" class="${CUR === c ? 'cur' : ''}">${esc(c.title)}</a>`).join('');
    $('#coursetools').innerHTML = CUR ? `<a href="${R('practice')}">Practice</a><a href="${R('play')}">Playground</a>` : '';
  }
  function route() {
    keys = null;
    JSRunner.stop();
    document.body.classList.remove('menu-open');
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    let parts = path.split('/').filter(Boolean);
    const q = new URLSearchParams(qs || '');
    if (parts[0] === 'settings') return settings();
    CUR = COURSES.find(c => c.id === parts[0]);
    if (!CUR) return siteHome();
    COURSE = CUR.chapters; parts = parts.slice(1);
    nav();
    const ch = COURSE.find(c => c.id === parts[1]);
    if (parts[0] === 'ch' && ch) chapter(ch);
    else if (parts[0] === 'ex' && ch && ch.exercises.find(e => e.id === parts[2])) exercise(ch, ch.exercises.find(e => e.id === parts[2]));
    else if (parts[0] === 'play') play(q);
    else if (parts[0] === 'practice') practice();
    else home();
  }
  $('#menu').onclick = () => document.body.classList.toggle('menu-open');
  // A files entry starting with '#' is a section heading for the chapters after it.
  Promise.all(COURSES.map(c => Promise.all(c.files.map(f => f[0] === '#' ? f : fetch(`${c.dir}/${f}.txt`).then(r => r.ok ? r.text() : null).catch(() => null)))
    .then(texts => {
      let section = null;
      c.chapters = texts.filter(Boolean).flatMap(t => {
        if (t[0] === '#') { section = t.slice(1).trim(); return []; }
        let ch;
        try { ch = Format.parseChapter(t); } catch (e) { console.error(e); return []; }
        if (section) { ch.section = section; section = null; }
        ch.course = c.id;
        ch.quiz.forEach(q => q.id = c.id + '/' + q.id);
        return [ch];
      });
    })))
    .then(() => {
      window.addEventListener('hashchange', route);
      route();
    });
})();
