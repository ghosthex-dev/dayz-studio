/* DayZ Studio - Report a bug (File menu, Help). A short form; then the studio server zips the logs (its own log, the
   errors recorded on this page, the newest DayZ game / DayZ Server logs, system info - the Windows user name
   replaced) into Documents/DayZStudio/BugReports, and the project's GitHub "New issue" page opens with the bug
   template filled in. The reporter drags the zip into the issue and presses Submit there: Studio sends nothing itself. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const B = (DS.BugReport = {});
  const REPO = 'ghosthex-dev/dayz-studio';
  const MAX_URL = 7600;   // GitHub refuses much longer new-issue links

  // ---- errors on this page (the desktop app has no visible console): the last 80, newest last
  const recent = [];
  const str = (x) => {
    if (x && x.stack) return String(x.stack);
    if (x && typeof x === 'object') { try { return JSON.stringify(x).slice(0, 1500); } catch (e) { return String(x); } }
    return String(x);
  };
  const keep = (kind, text) => {
    recent.push(new Date().toTimeString().slice(0, 8) + '  ' + kind + '  ' + String(text).slice(0, 3000));
    if (recent.length > 80) recent.shift();
  };
  window.addEventListener('error', (e) => keep('error', (e.message || '') + (e.filename ? '  @ ' + String(e.filename).split('/').pop() + ':' + e.lineno : '') + (e.error && e.error.stack ? '\n' + e.error.stack : '')));
  window.addEventListener('unhandledrejection', (e) => keep('promise', str(e.reason)));
  ['error', 'warn'].forEach((level) => {
    const orig = console[level].bind(console);
    console[level] = (...a) => { keep(level, a.map(str).join(' ')); orig(...a); };
  });
  B.recent = () => recent.slice();

  async function appVersion() {
    try {
      const st = window.studioHost && window.studioHost.update ? await window.studioHost.update.state() : null;
      if (st && st.version) return st.version;
    } catch (e) { /* the browser */ }
    try {
      const r = await fetch('desktop/package.json', { cache: 'no-store' });
      if (r.ok) return (await r.json()).version + ' (from the source)';
    } catch (e) { /* not served */ }
    return 'unknown';
  }

  function summary() {
    const P = S.project;
    return `${S.world().name} · ${P.objects.length} objects · ${P.quests.length} quests · ${(P.npcs || []).length} NPCs`;
  }

  /** the issue text, following the repo's bug_report.md template */
  function issueBody(rep, r, version, withExcerpt) {
    const block = (t, empty) => (String(t || '').trim() || empty);
    const lines = [
      '**Describe the bug**', block(rep.what, '_(not given)_'), '',
      '**To Reproduce**', block(rep.steps, '_(not given)_'), '',
      '**Expected behavior**', block(rep.expected, '_(not given)_'), '',
      '**Screenshots**', '<!-- Drag screenshots here if you have any. -->', '',
      '**Desktop (please complete the following information):**',
      ` - OS: ${r.os || navigator.platform}`,
      ` - App: DayZ Studio ${version} (${window.studioHost ? 'desktop app' : 'browser: ' + navigator.userAgent.replace(/^.*?(Chrome|Firefox|Edg)\//, '$1/').slice(0, 40)})`,
      ` - Project: ${summary()}`, '',
      '**Additional context**',
      `Logs: **drag \`${r.file}\` into this box** (the folder with it just opened; it is in Documents\\DayZStudio\\BugReports).`,
    ];
    if (withExcerpt && r.excerpt && r.excerpt.length) {
      lines.push('', '<details><summary>Recent errors from the logs</summary>', '', '```', ...r.excerpt, '```', '</details>');
    }
    lines.push('', '<sub>Sent from DayZ Studio’s Report a bug.</sub>');
    return lines.join('\n');
  }

  const issueUrl = (title, body) => `https://github.com/${REPO}/issues/new?template=bug_report.md&labels=bug&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

  B.open = function () {
    const rep = { title: '', what: '', steps: '', expected: '' };
    let withProject = false;
    const inp = (k, ph) => { const i = el('input', { class: 'inp', type: 'text', placeholder: ph }); i.addEventListener('input', () => (rep[k] = i.value)); return i; };
    const area = (k, ph, rows) => { const i = el('textarea', { class: 'inp', rows: rows || 3, placeholder: ph }); i.addEventListener('input', () => (rep[k] = i.value)); return i; };
    const proj = el('input', { type: 'checkbox' });
    proj.addEventListener('change', () => (withProject = proj.checked));
    const status = el('div', { class: 'ins-help' });
    const body = el('div', { class: 'bug-form' },
      el('div', { class: 'hint-box' }, 'Found something broken? Describe it here. Studio saves its logs in a zip and opens a new GitHub issue in your browser with your report filled in - ',
        el('b', {}, 'sign in to GitHub, drag the zip into the issue and press Submit.'), ' Nothing is sent by Studio itself, and your Windows user name is removed from the logs.'),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Title'), inp('title', 'e.g. Patrol NPC walks through walls')),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'What happened?'), area('what', 'What went wrong? Any error message?', 4)),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'How to make it happen'), area('steps', '1. Open the NPCs tab\n2. ...', 4)),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'What did you expect?'), area('expected', 'What should have happened instead?', 2)),
      el('label', { class: 'chk' }, proj, el('span', {}, 'Include my project file in the zip (helps reproduce it - only if you are fine sharing your map and quests)')),
      status);
    let close = null;
    const send = el('button', { class: 'btn primary', onclick: async () => {
      if (!rep.title.trim() || !rep.what.trim()) { DS.toast('Give it a title and say what happened.', 'warn', 3500); return; }
      send.disabled = true;
      status.textContent = 'Collecting logs…';
      const version = await appVersion();
      const r = await fetch('/api/bugreport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        report: rep, version, desktop: !!window.studioHost, ua: navigator.userAgent, screen: `${screen.width}x${screen.height} @${devicePixelRatio}`,
        summary: summary(), console: B.recent(), project: withProject ? JSON.stringify(S.project) : null,
      }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'the studio server is not running' }));
      if (!r.ok) {
        send.disabled = false;
        status.textContent = '';
        DS.toast('Could not collect the logs: ' + (r.error || 'unknown error'), 'error', 6000);
        return;
      }
      // the issue: the whole report in the link when it fits; otherwise without the log excerpt; otherwise via the clipboard
      let text = issueBody(rep, r, version, true);
      let url = issueUrl(rep.title, text);
      if (url.length > MAX_URL) { text = issueBody(rep, r, version, false); url = issueUrl(rep.title, text); }
      if (url.length > MAX_URL) {
        try { await navigator.clipboard.writeText(text); } catch (e) { /* no clipboard */ }
        url = issueUrl(rep.title, '_(The report is in your clipboard - press Ctrl+V here.)_');
        DS.toast('Your report is long, so it is in the clipboard: press Ctrl+V in the issue.', 'ok', 9000);
      }
      window.open(url, '_blank');
      fetch('/api/bugreport/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: r.path }) }).catch(() => {});
      status.textContent = `Saved ${r.file} (${r.logs.length ? 'with ' + r.logs.join(', ') : 'Studio logs only'}). GitHub opened in your browser - drag the zip into the issue, then Submit.`;
      send.textContent = 'Open the issue again';
      send.disabled = false;
      send.onclick = () => window.open(url, '_blank');
    } }, '🐞 Open GitHub issue');
    close = DS.app.modal({ title: '🐞 Report a bug', body, wide: true, buttons: (c) => [el('button', { class: 'btn', onclick: c }, 'Close'), send] });
  };
})();
