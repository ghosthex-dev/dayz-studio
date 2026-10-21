/* DayZ Studio - Enforce Script editing: syntax highlighting, a plain-English checker for the mistakes that stop
   DayZ from loading scripts, and explanations for the errors the game writes into script.log.
   DS.Code.editor({ value, onInput, rows, mode: 'action' | 'check' | 'init', vars: [[name, type, what]] }) -> element */
(function () {
  const DS = (window.DS = window.DS || {});
  const U = DS.util;
  const el = U.el;
  const C = (DS.Code = {});

  const KW = new Set(('if else for foreach while do break continue return switch case default new delete null NULL true false this super ' +
    'class extends modded override static ref autoptr const private protected sealed typedef enum out inout notnull local proto native ' +
    'external owned volatile event thread func').split(' '));
  const TYPES = new Set('void int float bool string vector auto typename array map set Class Managed'.split(' '));
  // words that can never be used as a variable name
  const RESERVED = new Set(('out inout local notnull ref autoptr private protected static const class typename null this super new delete return ' +
    'thread override modded sealed volatile event proto native external owned func void int float bool string vector auto if else for ' +
    'foreach while switch case default break continue enum typedef extends').split(' '));

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?)|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+)|([\s\S])/g;

  /** code -> highlighted HTML (one string; lines stay intact) */
  C.highlight = function (code) {
    let out = '';
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(code))) {
      const [t, com, str, num, id] = m;
      if (com) out += '<span class="c-com">' + esc(t) + '</span>';
      else if (str) out += '<span class="c-str">' + esc(t) + '</span>';
      else if (num) out += '<span class="c-num">' + t + '</span>';
      else if (id) {
        const next = code.slice(TOKEN.lastIndex).match(/^\s*(\(|<)?/)[1];
        if (KW.has(id)) out += '<span class="c-kw">' + id + '</span>';
        else if (TYPES.has(id)) out += '<span class="c-type">' + id + '</span>';
        else if (next === '(') out += '<span class="c-fn">' + id + '</span>';
        else if (/^[A-Z]/.test(id)) out += '<span class="c-type">' + id + '</span>';
        else out += id;
      } else out += esc(t);
    }
    return out;
  };

  /** strings and comments replaced by spaces (positions and line breaks kept) */
  function mask(code) {
    return code.replace(/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"?/g, (t) => t.replace(/[^\n]/g, (ch, i) => (t[0] === '"' && (i === 0 || i === t.length - 1) ? '"' : ' ')));
  }
  const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;

  /** -> [{ line, level: 'error' | 'warn' | 'info', msg }] */
  C.lint = function (code, opts) {
    opts = opts || {};
    const out = [];
    const add = (line, level, msg) => out.push({ line, level, msg });
    code = String(code || '');
    // brackets, quotes and comments
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    const names = { '(': 'round bracket (', '[': 'square bracket [', '{': 'curly bracket {' };
    let line = 1;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '\n') { line++; continue; }
      if (ch === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; i--; continue; }
      if (ch === '/' && code[i + 1] === '*') {
        const e = code.indexOf('*/', i + 2);
        if (e < 0) { add(line, 'error', `The comment started with /* on line ${line} is never closed - add */.`); break; }
        line += code.slice(i, e).split('\n').length - 1;
        i = e + 1;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < code.length && code[j] !== '"' && code[j] !== '\n') { if (code[j] === '\\') j++; j++; }
        if (code[j] !== '"') add(line, 'error', `Line ${line}: a text in "quotes" is not closed - add the missing ".`);
        i = j;
        if (code[j] === '\n') { line++; }
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line });
      else if (pairs[ch]) {
        const top = stack[stack.length - 1];
        if (!top) add(line, 'error', `Line ${line}: there is an extra "${ch}" - nothing was opened that it could close.`);
        else if (top.ch !== pairs[ch]) {
          add(line, 'error', `Line ${line}: "${ch}" closes the ${names[top.ch]} opened on line ${top.line} - a bracket is missing in between.`);
          stack.pop();
        } else stack.pop();
      }
    }
    stack.forEach((s) => add(s.line, 'error', `The ${names[s.ch]} on line ${s.line} is never closed - add "${{ '(': ')', '[': ']', '{': '}' }[s.ch]}".`));

    const m = mask(code);
    const lines = m.split('\n');
    // reserved words used as a name
    const TYPE = '(?:int|float|bool|string|vector|auto|typename|(?:array|map|set)<[^;()]*?>|[A-Z]\\w*(?:<[^;()]*?>)?)';
    let rx = new RegExp('\\b' + TYPE + '\\s+([A-Za-z_]\\w*)\\s*(?==|;|,|\\))', 'g');
    let r;
    const seen = new Map();
    while ((r = rx.exec(m))) {
      const name = r[1];
      const ln = lineOf(m, r.index);
      if (RESERVED.has(name)) { add(ln, 'error', `Line ${ln}: "${name}" is a reserved word in Enforce Script and can't be a variable name - rename it (e.g. "${name}Value").`); continue; }
      if (opts.file) continue;   // whole files: only reserved words here, duplicates per function (C.checkFile)
      if (opts.params && opts.params.includes(name)) add(ln, 'error', `Line ${ln}: "${name}" is already one of this node's settings - pick another name for the new variable.`);
      if ((opts.vars || []).some((v) => v[0] === name) || ['args'].includes(name)) add(ln, 'error', `Line ${ln}: "${name}" is already given to your code - pick another name.`);
      if (opts.mode === 'init' && ['ent', 'pos', 'k'].includes(name)) add(ln, 'error', `Line ${ln}: "${name}" is already a variable of the generated init.c - pick another name.`);
      if (seen.has(name)) add(ln, 'error', `Line ${ln}: "${name}" is declared a second time (first on line ${seen.get(name)}). Enforce Script doesn't allow the same name twice in one function - not even in separate { } blocks or two for-loops. Rename one.`);
      else seen.set(name, ln);
    }
    if (!opts.file) lines.forEach((l, i) => {
      const n = i + 1;
      const t = l.trim();
      if (!t) return;
      if (/\bbool\s+\w+\s*=\s*[^;]*(&&|\|\|)/.test(t)) add(n, 'warn', `Line ${n}: Enforce can get "a && b" / "a || b" wrong when it is stored straight into a bool. Use if-blocks instead: bool ok = false; if (a) { if (b) ok = true; }`);
      if (/\b(if|while)\s*\((?:[^()]|\([^()]*\))*[^=!<>]=[^=](?:[^()]|\([^()]*\))*\)/.test(t)) add(n, 'warn', `Line ${n}: a single "=" inside if( ) changes the value. To compare use "==".`);
      // missing ;
      if (!/[;{}(,[:=+\-*/<>!?&|]$/.test(t) && !/^(if|else|for|foreach|while|switch|case|default|class|modded|#|override|static|protected|private)\b/.test(t)) {
        let k = i + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        const nx = k < lines.length ? lines[k].trim() : '';
        const header = /\)$/.test(t) && /^\{/.test(nx);
        if (!header && !/^[.)\]&|+\-*/?:,{]/.test(nx) && !/^(else)\b/.test(nx)) add(n, 'error', `Line ${n} doesn't end with ";" - every statement needs one.`);
      }
    });
    if (opts.mode === 'check' && !/\breturn\b/.test(m)) add(lines.length, 'error', 'A check must answer with "return true;" (done) or "return false;" (not yet).');
    if (opts.mode === 'check' && /\breturn\s*;/.test(m)) add(lineOf(m, m.search(/\breturn\s*;/)), 'error', 'A check must return true or false, not just "return;".');
    if (opts.mode === 'action' && /\breturn\s+[^;\s]/.test(m)) add(lineOf(m, m.search(/\breturn\s+[^;\s]/)), 'error', 'Action code can stop early with "return;" but can\'t return a value.');
    return out.sort((a, b) => a.line - b.line);
  };

  /** local variables a snippet declares -> [{ name, line }] */
  C.declared = function (code) {
    const m = mask(String(code || ''));
    const rx = /\b(?:int|float|bool|string|vector|auto|typename|(?:array|map|set)<[^;()]*?>|[A-Z]\w*(?:<[^;()]*?>)?)\s+([A-Za-z_]\w*)\s*(?==|;|,|\))/g;
    const out = [];
    let r;
    while ((r = rx.exec(m))) out.push({ name: r[1], line: lineOf(m, r.index) });
    return out;
  };

  /** a whole generated script file (DSQuests.c, DSCustom.c, ...): only the checks that never misfire on long files -
      control characters, brackets / quotes / comments, reserved words as names, and the same local declared twice in
      one function (Enforce refuses that even in separate blocks). -> [{ line, level, msg }] */
  C.checkFile = function (code) {
    code = String(code || '');
    const out = [];
    const lines = code.split('\n');
    lines.forEach((l, i) => {
      const cc = l.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
      if (cc) out.push({ line: i + 1, level: 'error', msg: `Line ${i + 1} contains an invisible control character (code ${cc[0].charCodeAt(0)}) - DayZ can't compile it.` });
    });
    C.lint(code, { file: true }).forEach((i) => out.push(i));
    // duplicate locals, per function: a function starts at a ")" line one brace deep and ends when the depth drops back
    const m = mask(code).split('\n');
    const TYPE = /^\s+(?:ref\s+|autoptr\s+|const\s+)?(int|float|bool|string|vector|auto|typename|(?:array|map|set)<[^;()]*?>|[A-Z]\w*(?:<[^;()]*?>)?)\s+([A-Za-z_]\w*)\s*(=|;)/;
    let depth = 0, fn = '', decl = new Map();
    m.forEach((t, i) => {
      const n = i + 1;
      if (depth === 1 && /\)\s*$/.test(t.trim()) && !/;\s*$/.test(t)) { fn = t.trim(); decl = new Map(); }
      if (depth >= 2) {
        const d = t.match(TYPE);
        const f = t.match(/\bfor\s*\(\s*(int|float)\s+(\w+)/);
        [d && d[2], f && f[2]].filter(Boolean).forEach((name) => {
          if (decl.has(name)) out.push({ line: n, level: 'error', msg: `Line ${n}: "${name}" is declared twice in ${fn.replace(/\s*\(.*$/, '')}() (first on line ${decl.get(name)}).` });
          else decl.set(name, n);
        });
      }
      for (const ch of t) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    });
    return out.sort((a, b) => a.line - b.line);
  };

  /* ---------------- log lines from the game in plain English ---------------- */
  const EXPLAIN = [
    [/Broken expression \(missing ';'\?\)/i, () => 'A statement isn\'t finished - usually a missing ";" at the end of this line or the one before, or a bracket that isn\'t closed.'],
    [/(?:Undefined variable|Can't find variable) '([^']+)'/i, (r) => `"${r[1]}" is used but never declared here - a typo, or it was declared inside another { } block or function.`],
    [/Multiple declaration of variable '([^']+)'/i, (r) => `"${r[1]}" is declared twice in one function. Enforce doesn't allow that, even in separate { } blocks or two for-loops - rename one.`],
    [/Unknown type '([^']+)'/i, (r) => `There's no class or type called "${r[1]}" - check the spelling and the capital letters, or the mod that adds it isn't loaded.`],
    [/Undefined function '([^']+)'/i, (r) => `There's no function "${r[1]}" here - check the spelling, or call it on an object (player.${r[1].replace(/^\w+\./, '')}(...)).`],
    [/(?:Unknown|Undefined) (?:method|member) '([^']+)'/i, (r) => `"${r[1]}" doesn't exist on that kind of object - check the spelling or cast the object to the right class first.`],
    [/Can't find (?:matching|closing) '\}'|Missing '\}'|Unexpected end of file|end of file/i, () => 'The file ends while a { block } is still open - a "}" is missing somewhere above.'],
    [/Can't compile "(\w+)" script module/i, (r) => `DayZ stopped loading the scripts (${r[1]} module) because of the error just above. Nothing from this mod runs until it's fixed.`],
    [/Possible variable name conflict '([^']+)'/i, (r) => `Warning only: "${r[1]}" hides another variable or class member with the same name. Renaming it avoids surprises.`],
    [/Types '([^']+)' and '([^']+)' are unrelated|Can't convert|Incompatible parameter/i, () => 'A value of the wrong type is used here (e.g. text where a number is expected). Convert it (ToInt(), ToFloat(), ToString()) or cast it.'],
    [/is not a function|Function '([^']+)' is not/i, () => 'Something that isn\'t a function is called with ( ).'],
    [/Variable '([^']+)' is not used/i, (r) => `Info: "${r[1]}" is declared but never used.`],
    [/NULL pointer to instance|Null pointer/i, () => 'At run time something was empty (null) - e.g. the player left or an object wasn\'t found. Check it with "if (x)" before using it.'],
    [/Index out of bounds|out of range/i, () => 'At run time a list was read past its end - check Count() first.'],
    [/Division by zero/i, () => 'At run time a number was divided by 0.'],
    [/Unexpected '([^']+)'|Unexpected token/i, (r) => `Something unexpected${r[1] ? ' ("' + r[1] + '")' : ''} - often a missing bracket or ";" just before it.`],
  ];
  /** a log line -> { level, plain, file, line } or null when it is ordinary output */
  C.explain = function (text) {
    const err = (/\(E\)|SCRIPT\s+ERROR|Can't compile|error/i.test(text) && !/\berrors?:?\s*0\b/i.test(text)) || /\.c\s*\(\d+\)\s*:/.test(text);
    const warn = /\(W\)|warning/i.test(text);
    if (!err && !warn) return null;
    let plain = '';
    for (const [re, fn] of EXPLAIN) {
      const r = text.match(re);
      if (r) { plain = fn(r); break; }
    }
    const f = text.match(/([A-Za-z0-9_\-./\\]+\.c)\s*[(,:]\s*(\d+)/i);
    return { level: err ? 'error' : 'warn', plain, file: f ? f[1].replace(/\\/g, '/').split('/').pop().toLowerCase() : '', line: f ? +f[2] : 0 };
  };

  /* ---------------- the editor ---------------- */
  C.editor = function (opts) {
    const rows = opts.rows || 8;
    const wrap = el('div', { class: 'code-ed', style: { height: (rows * 18 + 14) + 'px' } });
    const gutter = el('div', { class: 'code-gutter' });
    const area = el('div', { class: 'code-area' });
    const hl = el('pre', { class: 'code-hl', 'aria-hidden': 'true' });
    const ta = el('textarea', { class: 'code-ta', spellcheck: 'false', autocomplete: 'off', wrap: 'off' });
    ta.value = opts.value || '';
    area.append(hl, ta);
    wrap.append(gutter, area);
    const issuesBox = el('div', { class: 'code-issues' });
    const box = el('div', { class: 'code-box' },
      opts.vars && opts.vars.length ? el('div', { class: 'code-vars' }, 'Your code can use: ', opts.vars.map((v, i) => el('span', { title: v[2] || '' }, (i ? ', ' : ''), el('code', {}, v[1] + ' ' + v[0])))) : null,
      wrap, issuesBox);
    let issues = [];
    function render() {
      const v = ta.value;
      issues = C.lint(v, opts);
      const bad = new Map();
      issues.forEach((i) => { if (!bad.has(i.line) || i.level === 'error') bad.set(i.line, i.level); });
      const lines = C.highlight(v).split('\n');
      hl.innerHTML = lines.map((l, i) => '<span class="cl' + (bad.has(i + 1) ? ' cl-' + bad.get(i + 1) : '') + '">' + (l || ' ') + '</span>').join('');
      gutter.textContent = lines.map((_, i) => i + 1).join('\n');
      issuesBox.replaceChildren(...issues.slice(0, 8).map((i) => el('div', { class: 'code-issue ' + i.level, onclick: () => goLine(i.line) }, i.level === 'error' ? '✖ ' : '⚠ ', i.msg)));
      if (issues.length > 8) issuesBox.append(el('div', { class: 'ins-help' }, `…and ${issues.length - 8} more`));
      sync();
    }
    function sync() {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    }
    function goLine(n) {
      const lines = ta.value.split('\n');
      const pos = lines.slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
      ta.scrollTop = Math.max(0, (n - 3) * 18);
      sync();
    }
    const insert = (s) => {
      // keeps the browser's undo history (execCommand), falls back to a plain replace
      if (!document.execCommand || !document.execCommand('insertText', false, s)) {
        const a = ta.selectionStart, b = ta.selectionEnd;
        ta.value = ta.value.slice(0, a) + s + ta.value.slice(b);
        ta.selectionStart = ta.selectionEnd = a + s.length;
        ta.dispatchEvent(new Event('input'));
      }
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { e.preventDefault(); insert('\t'); }
      else if (e.key === 'Enter') {
        // keep the indentation, one more after "{"
        const before = ta.value.slice(0, ta.selectionStart);
        const cur = before.slice(before.lastIndexOf('\n') + 1);
        let ind = cur.match(/^[\t ]*/)[0];
        if (/\{\s*$/.test(cur)) ind += '\t';
        e.preventDefault();
        insert('\n' + ind);
      } else if (e.key === '}') {
        const before = ta.value.slice(0, ta.selectionStart);
        const cur = before.slice(before.lastIndexOf('\n') + 1);
        if (/^\t+$/.test(cur)) { e.preventDefault(); ta.selectionStart = ta.selectionStart - 1; insert('}'); }
      }
      e.stopPropagation();   // Studio's hotkeys (Delete, Ctrl+Z, WASD…) stay out of the editor
    });
    ta.addEventListener('keyup', (e) => e.stopPropagation());
    ta.addEventListener('input', () => { render(); if (opts.onInput) opts.onInput(ta.value); });
    ta.addEventListener('change', () => { if (opts.onChange) opts.onChange(ta.value); });
    ta.addEventListener('scroll', sync);
    render();
    box.getValue = () => ta.value;
    box.setValue = (v) => { ta.value = v; render(); };
    box.issues = () => issues;
    box.goLine = goLine;
    box.focus = () => ta.focus();
    return box;
  };

  /** a small editor with an "⤢" button that opens the same code in a big window */
  C.field = function (opts) {
    let small;
    const make = () => C.editor(Object.assign({}, opts, { onInput: (v) => { opts.value = v; if (opts.onInput) opts.onInput(v); } }));
    small = make();
    const wrap = el('div', { class: 'code-field' }, small,
      el('button', { class: 'btn sm code-big', title: 'Open in a big editor', onclick: () => {
        const big = C.editor(Object.assign({}, opts, { rows: 26, value: opts.value, onInput: (v) => { opts.value = v; if (opts.onInput) opts.onInput(v); } }));
        DS.app.modal({ title: opts.title || 'Enforce Script', wide: true, body: big,
          buttons: (c) => [el('button', { class: 'btn', onclick: () => DS.Console && DS.Console.open() }, '⌨ Console'), el('button', { class: 'btn primary', onclick: c }, 'Done')],
          onClose: () => { small.setValue(opts.value || ''); if (opts.onChange) opts.onChange(opts.value); } });
        setTimeout(() => big.focus(), 50);
      } }, '⤢'));
    return wrap;
  };
})();
