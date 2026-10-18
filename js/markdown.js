// Small markdown renderer for chapter text, plus a regex C highlighter.
(function () {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const KW = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Static_assert _Generic _Alignof _Alignas _Noreturn bool true false NULL size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t uintptr_t intptr_t ptrdiff_t FILE';
  const KWS = new Set(KW.split(' '));
  const TOK = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#[^\n]*)|(\b(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)[uUlLfF]*\b)|([A-Za-z_]\w*)/gm;
  function highlight(code) {
    let out = '', last = 0, m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(code))) {
      out += esc(code.slice(last, m.index));
      const t = esc(m[0]);
      if (m[1]) out += `<span class="t-com">${t}</span>`;
      else if (m[2]) out += `<span class="t-str">${t}</span>`;
      else if (m[3]) out += `<span class="t-pre">${t}</span>`;
      else if (m[4]) out += `<span class="t-num">${t}</span>`;
      else if (KWS.has(m[5])) out += `<span class="t-kw">${t}</span>`;
      else out += t;
      last = TOK.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }
  const codeBlocks = [];
  function render(md) {
    const lines = md.replace(/\r/g, '').split('\n');
    let html = '', i = 0;
    while (i < lines.length) {
      const l = lines[i];
      let m;
      if ((m = l.match(/^```(\w*)/))) {
        const lang = m[1] || 'text', buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        const code = buf.join('\n');
        const runnable = lang === 'c' && /\bmain\s*\(/.test(code);
        codeBlocks.push(code);
        html += `<div class="codeblock"><pre><code>${lang === 'c' ? highlight(code) : esc(code)}</code></pre>` +
          (runnable ? `<button class="small tryit" data-code="${codeBlocks.length - 1}">▶ Open in playground</button>` : '') + '</div>';
      } else if ((m = l.match(/^(#{1,4})\s+(.*)/))) {
        const n = m[1].length + 1, id = m[2].toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
        html += `<h${n} id="h-${id}">${inline(m[2])}</h${n}>`; i++;
      } else if (/^\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = r => r.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(c => inline(c.trim().replace(/\\\|/g, '|')));
        const head = cells(rows[0]), body = rows.slice(/^\|[\s:|-]+\|?$/.test(rows[1] || '') ? 2 : 1);
        html += '<div class="tablewrap"><table><thead><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
          body.map(r => '<tr>' + cells(r).map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
      } else if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        const ordered = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          if (/^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
          else items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
        const t = ordered ? 'ol' : 'ul';
        html += `<${t}>` + items.map(x => `<li>${inline(x)}</li>`).join('') + `</${t}>`;
      } else if (/^>\s?/.test(l)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        html += `<blockquote>${render(buf.join('\n'))}</blockquote>`;
      } else if (!l.trim()) i++;
      else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\||>|\s*([-*]|\d+\.)\s+)/.test(lines[i])) buf.push(lines[i++]);
        html += `<p>${inline(buf.join(' '))}</p>`;
      }
    }
    return html;
  }
  window.MD = { render, inline, highlight, esc, codeBlocks };
})();
