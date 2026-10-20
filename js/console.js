/* DayZ Studio - live script console: tails the local test server's script.log (or the game's / the server RPT),
   colours errors and warnings, explains them in plain English and points script errors in DSCustom.c back to the
   Custom Script node or custom node they came from. "Compile on the local server" builds the mod and (re)starts it. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const K = (DS.Console = {});

  const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'The studio server is not running.' }));
  const MAX_LINES = 3000;
  let panel = null, body, statusEl, srcSel, timer = null;
  let file = '', offset = 0, paused = false, onlyErr = false, lines = 0, errs = 0, warns = 0, state = '', stopOnFail = false;

  /** where a line of a generated file came from (exporters fill DS.exporters.lineMap when they build the mod) */
  function origin(info) {
    const map = DS.exporters && DS.exporters.lineMap;
    if (!info || !info.file || !map || !map[info.file]) return null;
    return map[info.file].find((e) => info.line >= e.from && info.line <= e.to) || null;
  }
  function goTo(t) {
    if (!t) return;
    if (t.kind === 'node') {
      S.activeQuest = t.quest; S.setView('quests'); S.structure(); S.select('node', [t.id]);
    } else if (t.kind === 'custom' && DS.CustomNodes) DS.CustomNodes.wizard(t.id);
    else if (t.kind === 'stats' && DS.Stats) DS.Stats.open();
  }

  function addLine(text) {
    if (!text.trim()) return;
    let info = DS.Code.explain(text);
    if (info && info.level === 'warn' && /@"scripts\//i.test(text)) info = null;   // the game's own scripts warn a lot - not yours
    if (onlyErr && !info) return;
    const studio = /\[DZStudio\]/.test(text);
    const row = el('div', { class: info ? (info.level === 'error' ? 'lg-e' : 'lg-w') : studio ? 'lg-s' : '' }, text);
    body.append(row);
    if (info) {
      if (info.level === 'error') errs++; else warns++;
      const o = origin(info);
      const parts = [];
      if (info.plain) parts.push(info.plain);
      if (o) parts.push(el('span', {}, ' → ', el('a', { onclick: () => goTo(o.target) }, o.label + (o.codeLine && info.line >= o.codeFrom ? ', line ' + (info.line - o.codeFrom + 1) + ' of your code' : ''))));
      else if (/dsquests\.c/.test(info.file)) parts.push(' (This is in the quest runtime Studio generates - please report it, with this line.)');
      if (parts.length) body.append(el('span', { class: 'lg-plain' + (info.level === 'error' ? '' : ' w') }, parts));
    }
    if (/\[DZStudio\] Loaded \d+ quest/.test(text)) setState('ok', 'Scripts compiled ✓ ' + text.replace(/^.*\[DZStudio\]\s*/, ''));
    if (/Can't compile/i.test(text)) {
      setState('bad', 'Scripts did not compile ✖');
      // the server now waits on a "Compile error" box (Abort / Retry / Ignore) - it is useless, close it for the user
      if (stopOnFail) {
        stopOnFail = false;
        api('/api/server/stop', {}).then(() => setState('bad', 'Scripts did not compile ✖ - server stopped (fix the error and compile again)'));
      }
    }
    lines++;
  }
  function setState(cls, t) {
    state = t;
    statusEl.className = 'dsconsole-status ' + cls;
    statusEl.textContent = t;
  }
  function trim() {
    while (body.childNodes.length > MAX_LINES) body.firstChild.remove();
  }

  async function poll() {
    timer = null;
    if (!panel) return;
    if (!paused) {
      const r = await api('/api/logs/tail?' + new URLSearchParams({ src: srcSel.value, file, offset }));
      if (r.ok) {
        if (r.reset) {
          body.replaceChildren();
          errs = warns = 0;
          if (r.file) body.append(el('div', { class: 'lg-s' }, '── ' + r.name + ' ──'));
          else body.append(el('div', { class: 'ins-help' }, srcSel.value.startsWith('server') ? 'No server log yet - start the local test server (button above).' : 'No game log yet.'));
        }
        file = r.file; offset = r.offset;
        const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
        if (r.text) r.text.split(/\r?\n/).forEach(addLine);
        trim();
        if (atEnd || r.reset) body.scrollTop = body.scrollHeight;
        const run = srcSel.value.startsWith('server') ? (r.serverRunning ? 'server running' : 'server stopped') : '';
        if (!state || !/compil/i.test(state)) setState('', [run, errs ? errs + ' error(s)' : '', warns ? warns + ' warning(s)' : ''].filter(Boolean).join(' · ') || 'waiting');
        K.counts = { errs, warns };
      }
    }
    timer = setTimeout(poll, 1000);
  }

  /** build the mod from the project and (re)start the local test server with it */
  K.compile = async function () {
    if (!DS.exporters || !DS.exporters.modPayload) return;
    srcSel.value = 'server';
    setState('', 'Building the mod…');
    let payload;
    try { payload = DS.exporters.modPayload(); } catch (e) { setState('bad', 'Export failed: ' + e.message); return; }
    const b = await api('/api/mod/build', payload);
    if (!b.ok) { setState('bad', 'Build failed: ' + (b.error || '')); return; }
    if (DS.app) DS.app.lastBuild = b.name;
    // stop a running server first and wait until it is really gone
    let st = await api('/api/server/status');
    if (st.running) {
      setState('', 'Stopping the running local server (compile)…');
      for (let i = 0; i < 20 && st.running; i++) {
        if (i % 5 === 0) await api('/api/server/stop', {});
        await new Promise((r) => setTimeout(r, 1000));
        st = await api('/api/server/status');
      }
      if (st.running) { setState('bad', 'The old server did not stop - close DayZServer_x64 in Task Manager (compile)'); return; }
    }
    setState('', 'Starting the local server - compiling scripts…');
    const s = await api('/api/server/start', { exportName: b.name, resetProgress: false, debug: true });
    if (!s.ok) { setState('bad', (s.error || 'Could not start the server') + ' (compile)'); return; }
    stopOnFail = true;
    file = ''; offset = 0; state = 'compiling';
    setState('', 'Compiling… (the server needs about 30 s)');
  };

  K.open = function () {
    if (panel) { panel.style.display = ''; return; }
    srcSel = el('select', { class: 'inp' },
      el('option', { value: 'server' }, 'Local server · script log'),
      el('option', { value: 'server-rpt' }, 'Local server · RPT'),
      el('option', { value: 'game' }, 'Game · script log'));
    srcSel.addEventListener('change', () => { file = ''; offset = 0; state = ''; });
    statusEl = el('span', { class: 'dsconsole-status' }, 'waiting');
    body = el('div', { class: 'dsconsole-body' });
    const pauseBtn = el('button', { class: 'btn sm', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause'; } }, '⏸ Pause');
    const errBtn = el('button', { class: 'btn sm', title: 'Show only errors and warnings', onclick: () => { onlyErr = !onlyErr; errBtn.classList.toggle('active', onlyErr); file = ''; offset = 0; } }, '⚠ Errors only');
    const head = el('div', { class: 'dsconsole-head' },
      el('strong', {}, '⌨ Script console'), srcSel, statusEl,
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'btn sm primary', title: 'Build the quest mod from this project and start the local test server with it', onclick: K.compile }, '▶ Compile on local server'),
      errBtn, pauseBtn,
      el('button', { class: 'btn sm', onclick: () => { body.replaceChildren(); errs = warns = 0; } }, 'Clear'),
      el('button', { class: 'btn sm icon', title: 'Close', onclick: K.close }, '✕'));
    panel = el('div', { class: 'dsconsole' }, head, body);
    // drag by the header
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, select')) return;
      const r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = (ev) => {
        panel.style.left = Math.max(0, r.left + ev.clientX - sx) + 'px';
        panel.style.top = Math.max(0, r.top + ev.clientY - sy) + 'px';
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    document.body.append(panel);
    poll();
  };
  K.close = function () {
    if (panel) panel.remove();
    panel = null;
    clearTimeout(timer);
    timer = null;
    file = ''; offset = 0; state = '';
  };
  K.toggle = () => (panel ? K.close() : K.open());
})();
