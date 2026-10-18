// Compiles and runs C remotely: Compiler Explorer first, Wandbox as fallback.
(function () {
  const SKEY = 'cpractice.settings';
  const defaults = { backend: 'auto', sanitize: true, compiler: 'cg141', opt: '-O0', extra: '' };
  const Settings = {
    get() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { return { ...defaults }; } },
    set(s) { localStorage.setItem(SKEY, JSON.stringify(s)); }
  };
  const ansi = s => (s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const join = a => ansi((a || []).map(x => x.text).join('\n'));

  function flags(s) {
    const f = ['-std=c17', '-Wall', '-Wextra', '-g', s.opt];
    if (s.sanitize) f.push('-fsanitize=address,undefined', '-fno-omit-frame-pointer');
    if (s.extra.trim()) f.push(...s.extra.trim().split(/\s+/));
    f.push('-lm');
    return f;
  }

  async function pickGcc() {
    const r = await fetch('https://godbolt.org/api/compilers/c?fields=id,name,semver', { headers: { Accept: 'application/json' } });
    const list = (await r.json()).filter(c => /^x86-64 gcc \d+(\.\d+)*$/.test(c.name));
    const v = c => c.semver.split('.').map(Number);
    list.sort((a, b) => { const x = v(a), y = v(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; });
    return list[0].id;
  }

  async function godbolt(src, stdin, s) {
    let id = s.compiler;
    const req = id => fetch(`https://godbolt.org/api/compiler/${id}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        source: src, compiler: id, lang: 'c', allowStoreCodeDebug: false,
        options: {
          userArguments: flags(s).join(' '),
          executeParameters: { args: [], stdin },
          compilerOptions: { executorRequest: true, skipAsm: true },
          filters: { execute: true }, tools: [], libraries: []
        }
      })
    });
    let r = await req(id);
    if (r.status === 404) {
      id = await pickGcc();
      Settings.set({ ...Settings.get(), compiler: id });
      r = await req(id);
    }
    if (!r.ok) throw new Error(`Compiler Explorer HTTP ${r.status}`);
    const j = await r.json();
    const b = j.buildResult || {};
    return {
      backend: 'Compiler Explorer (' + id + ')',
      build: [join(b.stdout), join(b.stderr)].filter(Boolean).join('\n'),
      didExecute: !!j.didExecute,
      stdout: join(j.stdout), stderr: join(j.stderr),
      exit: j.didExecute ? j.code : (b.code ?? j.code), timedOut: !!j.timedOut
    };
  }

  async function wandbox(src, stdin, s) {
    const r = await fetch('https://wandbox.org/api/compile.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: src, compiler: 'gcc-head-c', stdin, 'compiler-option-raw': flags(s).join('\n'), save: false })
    });
    if (!r.ok) throw new Error(`Wandbox HTTP ${r.status}`);
    const j = await r.json();
    const build = ansi((j.compiler_output || '') + (j.compiler_error || ''));
    const failed = /\berror\b/.test(build) && !j.program_output && !j.program_error;
    return {
      backend: 'Wandbox (gcc-head)', build, didExecute: !failed,
      stdout: ansi(j.program_output || ''), stderr: ansi(j.program_error || ''),
      exit: j.signal ? 128 : Number(j.status), timedOut: /killed/i.test(j.signal || '')
    };
  }

  async function run(src, stdin = '') {
    const s = Settings.get();
    if (s.backend === 'wandbox') return wandbox(src, stdin, s);
    if (s.backend === 'godbolt') return godbolt(src, stdin, s);
    try { return await godbolt(src, stdin, s); }
    catch (e) { console.warn('godbolt failed, trying wandbox', e); return wandbox(src, stdin, s); }
  }

  window.Runner = { run, Settings, flags };
})();
