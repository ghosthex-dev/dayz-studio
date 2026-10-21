/* DayZ Studio - projects on disk: autosave next to the browser copy, rolling backups, recent projects.
   Files live in  Documents/DayZStudio/Projects/<id>.dzstudio.json  and  Documents/DayZStudio/Backups/ (written by the studio server). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const D = (DS.Disk = {});

  D.ok = false;       // the studio server answered
  D.lastSaved = 0;
  D.error = '';
  let timer = null;
  let inflight = false;
  let dirty = false;

  const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  function ensureId() {
    if (!S.project.meta.id) S.project.meta.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return S.project.meta.id;
  }

  function status() {
    const s = document.getElementById('st-save');
    if (!s) return;
    if (D.error) { s.textContent = 'Saved in the app · disk save failed: ' + D.error; s.className = 'warn-text'; return; }
    if (D.lastSaved) { s.textContent = 'Saved ✓ (also on disk ' + new Date(D.lastSaved).toLocaleTimeString() + ')'; s.className = 'muted'; }
  }

  // ?nodisk in the address: a scratch / test tab that never writes project files (Documents/DayZStudio/Projects)
  const NO_DISK = /[?&]nodisk(&|=|$)/.test(location.search);

  async function write(force) {
    if (NO_DISK) return;
    if (inflight) { dirty = true; return; }
    const empty = !S.project.objects.length && !S.project.quests.length && !(S.project.zones || []).length;
    if (empty && !force) return;
    inflight = true;
    dirty = false;
    try {
      const id = ensureId();
      const r = await api('/api/project/save', { id, name: S.project.meta.name || 'Untitled', data: JSON.stringify(S.project), force: !!force });
      if (r.ok) { D.ok = true; D.error = ''; D.lastSaved = Date.now(); } else D.error = r.error || 'unknown error';
    } catch (e) {
      D.ok = false; // no studio server (plain file://) - the browser copy still works
    }
    inflight = false;
    status();
    if (dirty) schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => write(false), 2500);
  }
  D.saveNow = (force) => write(force);

  // S.save runs ~0.6 s after every edit; piggy-back on it
  S.on('saved', () => schedule());
  window.addEventListener('beforeunload', () => {
    try {
      if (NO_DISK || !D.ok || (!S.project.objects.length && !S.project.quests.length)) return;
      navigator.sendBeacon('/api/project/save', new Blob([JSON.stringify({ id: ensureId(), name: S.project.meta.name || 'Untitled', data: JSON.stringify(S.project) })], { type: 'application/json' }));
    } catch (e) { /* ignore */ }
  });

  /* ---------------------------------------------------------------- recent projects + backups */
  const when = (t) => new Date(t * 1000).toLocaleString();

  D.openDialog = async function () {
    let list;
    try { list = await api('/api/project/list'); } catch (e) { list = null; }
    if (!list || !list.ok) { DS.toast('The studio server is not running, so there are no disk projects to show.', 'warn', 4000); return; }
    const body = el('div', { class: 'disk' });
    let close;
    const open = async (url, label) => {
      const r = await api(url);
      if (!r.ok) { DS.toast('Could not read that file', 'error'); return; }
      try {
        const p = JSON.parse(r.data);
        close();
        S.setProject(p);
        if (DS.MapView) DS.MapView.fit();
        DS.toast('Opened ' + label, 'ok');
      } catch (e) { DS.toast('That file is damaged: ' + e.message, 'error', 5000); }
    };
    body.append(el('div', { class: 'mini-title' }, 'Projects saved automatically'));
    if (!list.projects.length) body.append(el('div', { class: 'hint-box' }, 'Nothing saved to disk yet — projects are written a few seconds after you edit them.'));
    list.projects.forEach((p) => body.append(el('div', { class: 'asset', onclick: () => open('/api/project/load?id=' + encodeURIComponent(p.id), p.name || p.id) },
      el('span', { class: 'asset-name' }, p.name || '(unnamed)'), el('span', { class: 'asset-sub' }, `${p.objects} objects · ${p.quests} quests · ${when(p.saved)}`))));
    body.append(el('div', { class: 'mini-title' }, 'Backups (newest first — restoring replaces the open project)'));
    list.backups.slice(0, 40).forEach((b) => body.append(el('div', { class: 'asset', onclick: () => open('/api/project/load?backup=' + encodeURIComponent(b.file), 'backup ' + when(b.saved)) },
      el('span', { class: 'asset-name' }, when(b.saved)), el('span', { class: 'asset-sub' }, b.file.split('_')[0] + ' · ' + Math.round(b.bytes / 1024) + ' KB'))));
    body.append(el('div', { class: 'ins-help' }, 'Folder: ' + list.dir));
    close = DS.app.modal({ title: 'Recent projects and backups', body, wide: true, buttons: (c) => el('button', { class: 'btn', onclick: c }, 'Close') });
  };

  /** the browser copy may be older than the disk copy of the same project (the app was killed before its storage
      was written): then the disk copy wins */
  D.preferNewer = async function () {
    try {
      const id = S.project.meta.id;
      if (!id) return false;
      const list = await api('/api/project/list');
      if (!list.ok) return false;
      D.ok = true;
      const p = list.projects.find((x) => x.id === id);
      if (!p || p.saved * 1000 <= (S.project.meta.savedAt || 0) + 5000) return false;
      const r = await api('/api/project/load?id=' + encodeURIComponent(id));
      if (!r.ok) return false;
      S.setProject(JSON.parse(r.data));
      if (DS.MapView) DS.MapView.fit();
      DS.toast('Loaded the newer copy of this project from disk (' + when(p.saved) + ')', 'ok', 4000);
      return true;
    } catch (e) {
      return false;
    }
  };

  /** first start with an empty browser copy but projects on disk: offer the last one */
  /** auto: open it straight away (right after an update the app's storage can come back empty) */
  D.offerRestore = async function (auto) {
    try {
      const list = await api('/api/project/list');
      if (!list.ok) return false;
      D.ok = true;
      const empty = !S.project.objects.length && !S.project.quests.length;
      if (empty && list.last && list.projects.some((p) => p.id === list.last.id)) {
        const p = list.projects.find((x) => x.id === list.last.id);
        if (p.objects || p.quests) {
          if (auto) {
            const r = await api('/api/project/load?id=' + encodeURIComponent(p.id));
            if (r.ok) { S.setProject(JSON.parse(r.data)); if (DS.MapView) DS.MapView.fit(); DS.toast('Reopened your last project "' + (p.name || 'Untitled') + '"', 'ok', 5000); return true; }
          }
          const body = el('div', null, el('p', null, `Your last project "${p.name || 'Untitled'}" (${p.objects} objects, ${p.quests} quests, saved ${when(p.saved)}) was found on disk.`));
          DS.app.modal({
            title: 'Open your last project?', body,
            buttons: (close) => [
              el('button', { class: 'btn', onclick: close }, 'Start empty'),
              el('button', { class: 'btn primary', onclick: async () => {
                close();
                const r = await api('/api/project/load?id=' + encodeURIComponent(p.id));
                if (r.ok) { S.setProject(JSON.parse(r.data)); if (DS.MapView) DS.MapView.fit(); DS.toast('Restored ' + (p.name || 'project'), 'ok'); }
              } }, 'Open it'),
            ],
          });
          return true;
        }
      }
    } catch (e) { D.ok = false; }
    return false;
  };
})();
