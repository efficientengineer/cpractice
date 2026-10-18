// Parses content/*.txt chapter files. Shared by the browser and tools/verify.mjs.
// "=== chapter|exercise|quiz [id]" starts a block, "key: value" header lines follow,
// "--- field" starts a multi-line field. Repeated test/out, choice/answer, hint fields collect into arrays.
(function (g) {
  function trimBlank(lines) {
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join('\n');
  }
  function parseChapter(text) {
    const blocks = []; let blk = null, field = null, buf = [];
    const flush = () => {
      if (!blk || !field) return;
      const v = trimBlank(buf); buf = [];
      if (field === 'test') blk.tests.push({ stdin: v, out: '' });
      else if (field === 'out') { if (!blk.tests.length) blk.tests.push({ stdin: '' }); blk.tests[blk.tests.length - 1].out = v; }
      else if (field === 'exit') blk.tests[blk.tests.length - 1].exit = +v;
      else if (field === 'choice') blk.choices.push(v);
      else if (field === 'answer') { blk.answer = blk.choices.length; blk.choices.push(v); }
      else if (field === 'hint') blk.hints.push(v);
      else blk[field] = v;
    };
    for (const line of text.replace(/\r/g, '').split('\n')) {
      let m;
      if ((m = line.match(/^=== (\w+)\s*(\S*)\s*$/))) {
        flush(); field = null;
        blk = { kind: m[1], id: m[2], tests: [], choices: [], hints: [] }; blocks.push(blk);
      } else if (blk && (m = line.match(/^--- (\w+)\s*$/))) {
        flush(); field = m[1]; buf = [];
      } else if (blk && !field) {
        if ((m = line.match(/^(\w+):\s*(.*)$/))) blk[m[1]] = m[2];
      } else if (field) buf.push(line);
    }
    flush();
    const ch = blocks.find(b => b.kind === 'chapter');
    if (!ch) throw new Error('no chapter block');
    ch.exercises = blocks.filter(b => b.kind === 'exercise').map(e => {
      if (!e.tests.length) delete e.tests;
      if (e.tests) for (const t of e.tests) if (t.exit === undefined && e.exit) t.exit = +e.exit;
      return e;
    });
    // "continues: ID" builds on an earlier step: the starter is that step's solution plus this step's stubs.
    for (const e of ch.exercises) {
      if (!e.continues) continue;
      const prev = ch.exercises.find(x => x.id === e.continues);
      if (!prev) throw new Error(`${e.id}: continues unknown exercise ${e.continues}`);
      e.stubs ||= '';
      if (!e.starter) e.starter = prev.solution + (e.stubs ? '\n\n' + e.stubs : '') + '\n';
    }
    ch.quiz = blocks.filter(b => b.kind === 'quiz').map((q, i) => ({ ...q, id: ch.id + '-q' + i, run: q.run === 'yes', flags: q.flags ? q.flags.split(/\s+/) : [] }));
    return ch;
  }
  g.Format = { parseChapter };
})(typeof window !== 'undefined' ? window : globalThis);
