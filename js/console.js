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
  let file = '', offset = 0, paused = false, onlyErr = false, lines = 0, errs = 0, warns = 0, state = '', stopOnFail = false, sticky = false;

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
  function setState(cls, t, idle) {
    if (idle && sticky) return;
    sticky = !idle;
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
        setState('', [run, errs ? errs + ' error(s)' : '', warns ? warns + ' warning(s)' : ''].filter(Boolean).join(' · ') || 'waiting', true);
        K.counts = { errs, warns };
      }
    }
    timer = setTimeout(poll, 1000);
  }

  /** build the mod from the project and (re)start the local test server with it */
  K.compile = async function () {
    if (!DS.exporters || !DS.exporters.modPayload) return;
    K.element();
    K.open();
    srcSel.value = 'server';
    let payload;
    try { payload = DS.exporters.modPayload(); } catch (e) { setState('bad', 'Export failed: ' + e.message); return; }
    const bad = DS.exporters.checkScripts ? DS.exporters.checkScripts(payload) : [];
    if (bad.length) {
      setState('bad', `${bad.length} script error(s) - not built (see below)`);
      bad.slice(0, 20).forEach((e) => body.append(el('div', { class: 'lg-e' }, '✖ ' + e.text),
        e.origin ? el('span', { class: 'lg-plain' }, el('a', { onclick: () => goTo(e.origin.target) }, 'Open ' + e.origin.label)) : null));
      body.scrollTop = body.scrollHeight;
      return;
    }
    // stop a running server first and wait until it is really gone: it keeps the mod's PBO open
    let st = await api('/api/server/status');
    if (st.running) {
      setState('', 'Stopping the running local server…');
      for (let i = 0; i < 20 && st.running; i++) {
        if (i % 5 === 0) await api('/api/server/stop', {});
        await new Promise((r) => setTimeout(r, 1000));
        st = await api('/api/server/status');
      }
      if (st.running) { setState('bad', 'The old server did not stop - close DayZServer_x64 in Task Manager and compile again.'); return; }
      await new Promise((r) => setTimeout(r, 1500));   // Windows lets go of the file a moment later
    }
    setState('', 'Building the mod…');
    const b = await api('/api/mod/build', payload);
    if (!b.ok) { setState('bad', 'Build failed: ' + (b.error || '')); return; }
    if (DS.app) DS.app.lastBuild = b.name;
    setState('', 'Starting the local server - compiling scripts…');
    const s = await api('/api/server/start', { exportName: b.name, resetProgress: false, debug: true });
    if (!s.ok) { setState('bad', s.error || 'Could not start the server'); return; }
    stopOnFail = true;
    file = ''; offset = 0; state = 'compiling';
    setState('', 'Compiling… (the server needs about 30 s)');
  };

  /** the console's element: a panel of the docking workspace (js/dock.js, docked under the views by default) */
  K.element = function () {
    if (panel) return panel;
    srcSel = el('select', { class: 'inp' },
      el('option', { value: 'server' }, 'Local server · script log'),
      el('option', { value: 'server-rpt' }, 'Local server · RPT'),
      el('option', { value: 'game' }, 'Game · script log'));
    srcSel.addEventListener('change', () => { file = ''; offset = 0; state = ''; sticky = false; });
    statusEl = el('span', { class: 'dsconsole-status' }, 'waiting');
    body = el('div', { class: 'dsconsole-body' });
    const pauseBtn = el('button', { class: 'btn sm', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause'; } }, '⏸ Pause');
    const errBtn = el('button', { class: 'btn sm', title: 'Show only errors and warnings', onclick: () => { onlyErr = !onlyErr; errBtn.classList.toggle('active', onlyErr); file = ''; offset = 0; } }, '⚠ Errors only');
    const head = el('div', { class: 'dsconsole-head' },
      srcSel, statusEl,
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'btn sm primary', title: 'Build the quest mod from this project and start the local test server with it', onclick: K.compile }, '▶ Compile on local server'),
      errBtn, pauseBtn,
      el('button', { class: 'btn sm', onclick: () => { body.replaceChildren(); errs = warns = 0; sticky = false; } }, 'Clear'));
    panel = el('div', { class: 'dsconsole docked' }, head, body);
    return panel;
  };
  K.open = function () {
    if (DS.Dock && DS.Dock.ready) DS.Dock.open('console');
    if (!timer) poll();
  };
  K.goTo = goTo;
  /** follow the log again (the panel is on screen) */
  K.resume = function () { if (!timer) poll(); };
  /** stop following the log (the panel was closed) */
  K.stop = function () {
    clearTimeout(timer);
    timer = null;
    file = ''; offset = 0; state = '';
  };
  K.close = function () {
    if (DS.Dock && DS.Dock.ready && DS.Dock.isOpen('console')) DS.Dock.close('console');
    else K.stop();
  };
  K.toggle = () => (DS.Dock && DS.Dock.isOpen('console') ? K.close() : K.open());
})();
