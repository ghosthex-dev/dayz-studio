/* DayZ Studio - workspaces (v2): the panels of the docking workspace (js/dock.js), built-in layouts, the user's
   own saved layouts, interface size, toolbar customization and the ▦ menu. Kept per user in local storage:
   'dzstudio.workspace' = { v: 2, layout: { root, floating }, name, modified, scale, toolbar: { hidden, order } }
   'dzstudio.workspaces' = { name: { v: 2, layout, view } }. v1 layouts ({ left, right, leftOpen, rightOpen, swap })
   are converted when they are loaded. */
(function () {
  const DS = (window.DS = window.DS || {});
  const U = DS.util;
  const el = U.el;
  const S = DS.store;
  const W = (DS.Workspace = {});
  const KEY = 'dzstudio.workspace';
  const KEY_SAVED = 'dzstudio.workspaces';
  const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
  const host = window.studioHost;
  const LEFT = ['assets', 'loot', 'zones', 'gamedata', 'scene', 'outline', 'npclist'];
  const VIEWS = ['map', 'game', 'view3d', 'quests', 'npcs'];

  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off: lasts this session */ } };

  let st = {};
  let D;

  /* ---------------------------------------------------------------- panels */
  function registerPanels() {
    const wrap = (id) => () => { const e = document.getElementById(id); e.classList.remove('hidden'); return e; };
    D.register('map', { title: 'Map', icon: '🗺', kind: 'view', home: 'center', make: wrap('map-wrap') });
    D.register('game', { title: 'Game', icon: '🎮', kind: 'view', home: 'center', make: wrap('game-wrap') });
    D.register('view3d', { title: '3D', icon: '🧊', kind: 'view', home: 'center', make: wrap('view3d-wrap'), onShow: () => DS.View3D && DS.View3D.show() });
    D.register('quests', { title: 'Quests', icon: '⎇', kind: 'view', home: 'center', make: wrap('quest-wrap') });
    D.register('npcs', { title: 'NPCs', icon: '👤', kind: 'view', home: 'center', make: wrap('npc-wrap') });
    D.register('npclist', { title: 'NPC list', icon: '👥', home: 'left', make: () => DS.Npcs.listPanel() });
    D.register('inspector', { title: 'Inspector', icon: '☰', home: 'right', make: wrap('right') });
    [['assets', 'Assets', '▤'], ['loot', 'Loot', '🎁'], ['zones', 'Zones', '⬡'], ['gamedata', 'Game setup', '⚙', 'game'], ['scene', 'Scene', '≣'], ['outline', 'Quest list', '☷', 'quests']]
      .forEach(([id, title, icon, tab]) => D.register(id, { title, icon, home: 'left', make: () => DS.Browser.mount(tab || id) }));
    D.register('console', { title: 'Script console', icon: '⌨', home: 'bottom', make: () => DS.Console.element(), onShow: () => DS.Console.resume(), onClose: () => DS.Console.stop() });
  }

  /* ---------------------------------------------------------------- layouts */
  const G = (panels, active) => D.group(panels, active);
  const fixed = (n, size, min) => Object.assign(n, { size, grow: false, min: !!min });
  const grow = (n) => Object.assign(n, { grow: true });
  const row = (kids) => D.split('row', kids);
  const col = (kids) => D.split('col', kids);
  const PRESETS = {
    Default: () => ({ root: row([fixed(G(LEFT), 290), grow(G(VIEWS, 'map')), fixed(G(['inspector']), 330)]) }),
    Mapping: () => ({ root: row([fixed(G(LEFT), 340), grow(G(VIEWS, 'map')), fixed(G(['inspector']), 300)]), view: 'map' }),
    'Quest writing': () => ({ root: row([fixed(G(LEFT, 'outline'), 260, true), grow(G(VIEWS, 'quests')), fixed(G(['inspector']), 420)]), view: 'quests' }),
    'Map + Quests side by side': () => ({ root: row([fixed(G(LEFT), 250), grow(G(['map', 'game', 'view3d'], 'map')), fixed(G(['quests']), 560), fixed(G(['inspector']), 320)]), view: 'map' }),
    'NPC design': () => ({ root: row([fixed(G(LEFT, 'npclist'), 260, true), grow(G(VIEWS, 'npcs')), fixed(G(['inspector']), 420)]), view: 'npcs' }),
    Scripting: () => ({ root: row([fixed(G(LEFT), 270), grow(col([grow(G(VIEWS, 'quests')), fixed(G(['console']), 240)])), fixed(G(['inspector']), 340)]), view: 'quests' }),
    Focus: () => ({ root: row([fixed(G(LEFT), 290, true), grow(G(VIEWS, 'map')), fixed(G(['inspector']), 330, true)]) }),
  };

  /** a v1 layout (fixed left / middle / right) as a v2 tree */
  function fromV1(o) {
    const L = fixed(G(LEFT), o.left || 290, o.leftOpen === false), R = fixed(G(['inspector']), o.right || 330, o.rightOpen === false);
    const kids = [L, grow(G(VIEWS, o.view && VIEWS.includes(o.view) ? o.view : 'map')), R];
    return { root: row(o.swap ? kids.reverse() : kids) };
  }
  /* ---------------------------------------------------------------- profiles
     A profile is the user's whole workspace setup: panel layout, the view it opens, keyboard shortcuts, toolbar and
     interface size. Saved as files in Documents/DayZStudio/Workspaces (studio server) so they survive updates and
     can be backed up, exported and imported; without the studio server (or in a ?nodisk test tab) they live in local
     storage. Older saved workspaces (local storage, v1 or v2) move to disk the first time. */
  const NO_DISK = /[?&]nodisk(&|=|$)/.test(location.search);
  let profiles = {};        // name -> profile
  let profDir = '';         // where they are on disk ('' = local storage only)
  const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  /** the current setup as a profile */
  function snapshot(name) {
    return { kind: 'dzstudio-workspace', v: 2, name, layout: D.state(), view: S.view, keys: DS.Keys.getCustom(), toolbar: JSON.parse(JSON.stringify(st.toolbar || {})), scale: st.scale || 1 };
  }
  function writeLocal() { write(KEY_SAVED, profiles); }
  async function storeProfile(p) {
    profiles[p.name] = p;
    if (profDir) {
      const r = await api('/api/workspaces/save', { profile: p }).catch(() => ({ ok: false, error: 'studio server not running' }));
      if (!r.ok) { DS.toast('Could not save the profile to disk: ' + (r.error || 'unknown error') + ' - kept in this app only', 'warn', 5000); writeLocal(); }
    } else writeLocal();
  }
  async function dropProfile(name) {
    delete profiles[name];
    if (profDir) await api('/api/workspaces/delete', { name }).catch(() => null);
    else writeLocal();
  }
  async function loadProfiles() {
    const local = read(KEY_SAVED, {});
    profiles = Object.assign({}, local);
    if (NO_DISK) return;
    const r = await api('/api/workspaces').catch(() => null);
    if (!r || !r.ok) return;
    profDir = r.dir;
    profiles = {};
    r.profiles.forEach((p) => { profiles[p.name] = p; });
    // saved workspaces from before profiles were files: write them to disk once
    const moved = Object.keys(local).filter((n) => !profiles[n]);
    for (const n of moved) {
      const o = local[n];
      await storeProfile(Object.assign({ kind: 'dzstudio-workspace', v: 2, name: n }, o.v === 2 ? { layout: o.layout, view: o.view } : { layout: Object.assign(fromV1(o), { floating: [] }), view: o.view }, o.keys ? { keys: o.keys, toolbar: o.toolbar, scale: o.scale } : {}));
    }
    try { localStorage.removeItem(KEY_SAVED); } catch (e) { /* ignore */ }
  }

  /** a preset or profile -> what to apply */
  function resolve(name) {
    if (PRESETS[name]) { const p = PRESETS[name](); return { layout: { root: p.root, floating: [] }, view: p.view }; }
    const p = profiles[name];
    if (!p) return null;
    if (p.v === 2) return p;
    return { layout: fromV1(p), view: p.view };   // a v1 layout kept in local storage
  }

  function save() { write(KEY, st); }

  W.use = function (name) {
    const r = resolve(name);
    if (!r) return;
    D.applyState(r.layout);
    if (r.view && VIEWS.includes(r.view)) S.setView(r.view);
    // a profile also brings its shortcuts, toolbar and interface size (built-in layouts only change the panels)
    if (r.keys) DS.Keys.setCustom(r.keys);
    if (r.toolbar) { st.toolbar = JSON.parse(JSON.stringify(r.toolbar)); applyToolbar(); }
    if (r.scale) { st.scale = r.scale; applyScale(); }
    st.name = name;
    st.modified = false;
    st.layout = D.state();
    save();
    DS.toast((PRESETS[name] ? 'Workspace: ' : 'Profile: ') + name, 'ok', 1500);
  };

  W.saveAs = async function () {
    const suggest = st.name && !PRESETS[st.name] ? st.name : '';
    const name = (prompt('Name for this profile - it keeps the panel layout, keyboard shortcuts, toolbar and interface size (e.g. "Quests on two screens"):', suggest) || '').trim();
    if (!name) return;
    if (PRESETS[name]) { DS.toast('"' + name + '" is a built-in workspace - pick another name', 'warn', 3500); return; }
    if (profiles[name] && name !== st.name && !confirm('There is already a profile called "' + name + '". Replace it?')) return;
    await storeProfile(snapshot(name));
    st.name = name;
    st.modified = false;
    save();
    DS.toast('Saved profile "' + name + '"' + (profDir ? ' (Documents\\DayZStudio\\Workspaces)' : ''), 'ok', 3500);
  };

  W.update = async function () {
    if (!profiles[st.name]) return;
    await storeProfile(snapshot(st.name));
    st.modified = false;
    save();
    DS.toast('Updated profile "' + st.name + '"', 'ok');
  };

  function download(p) {
    const blob = new Blob([JSON.stringify(Object.assign({}, p, { saved: undefined }), null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: p.name.replace(/[<>:"/\\|?*]/g, '_') + '.dzworkspace.json' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  W.importFile = function (done) {
    const inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      inp.remove();
      if (!f) return;
      let p;
      try { p = JSON.parse(await f.text()); } catch (e) { DS.toast('That file is not a workspace profile', 'error', 4000); return; }
      if (!p || typeof p !== 'object' || (!p.layout && !p.left)) { DS.toast('That file is not a workspace profile', 'error', 4000); return; }
      if (!p.layout) p = { layout: Object.assign(fromV1(p), { floating: [] }), view: p.view };   // a v1 layout file
      let name = String(p.name || f.name.replace(/\.dzworkspace\.json$|\.json$/i, '')).trim() || 'Imported';
      while (PRESETS[name] || (profiles[name] && !confirm('A profile called "' + name + '" already exists. Replace it?'))) {
        name = (prompt('Name for the imported profile:', name + ' (imported)') || '').trim();
        if (!name) return;
      }
      await storeProfile({ kind: 'dzstudio-workspace', v: 2, name, layout: p.layout, view: p.view, keys: p.keys, toolbar: p.toolbar, scale: p.scale });
      DS.toast('Imported profile "' + name + '"', 'ok');
      if (done) done();
      if (confirm('Switch to "' + name + '" now?')) W.use(name);
    });
    document.body.append(inp);
    inp.click();
  };

  W.manage = function () {
    const body = el('div');
    const draw = () => {
      const names = Object.keys(profiles).sort((x, y) => x.localeCompare(y));
      const what = (p) => [p.keys && Object.keys(p.keys).length ? 'own shortcuts' : '', p.toolbar && (p.toolbar.hidden || []).length ? 'own toolbar' : '', p.scale && p.scale !== 1 ? Math.round(p.scale * 100) + '%' : '', (p.layout && p.layout.floating || []).length ? 'floating panels' : ''].filter(Boolean).join(' · ');
      body.replaceChildren(
        el('p', { class: 'ins-help' }, 'A profile keeps your panel layout, the view it opens, your keyboard shortcuts, the toolbar and the interface size. ' +
          (profDir ? 'Profiles are files in ' + profDir + ' - back them up, or export one to share it.' : 'Without the studio server they are kept in this app only - export them to keep a copy.')),
        names.length ? el('div', { class: 'ws-list' }, names.map((n) => el('div', { class: 'ws-row' },
          el('span', { class: 'ws-name' }, el('b', null, n), n === st.name ? el('span', { class: 'muted' }, st.modified ? '  (in use, changed)' : '  (in use)') : null,
            what(profiles[n]) ? el('div', { class: 'ins-help' }, what(profiles[n])) : null),
          el('button', { class: 'btn sm', title: 'Switch to this profile', onclick: () => { W.use(n); draw(); } }, 'Use'),
          el('button', { class: 'btn sm', title: 'Save it as a file to share or keep', onclick: () => download(profiles[n]) }, '⇩ Export'),
          el('button', { class: 'btn sm', onclick: async () => {
            const nn = (prompt('New name for "' + n + '":', n) || '').trim();
            if (!nn || nn === n) return;
            if (PRESETS[nn] || profiles[nn]) { DS.toast('"' + nn + '" is already taken', 'warn'); return; }
            const p = Object.assign({}, profiles[n], { name: nn });
            await storeProfile(p);
            await dropProfile(n);
            if (st.name === n) { st.name = nn; save(); }
            draw();
          } }, 'Rename'),
          el('button', { class: 'btn sm danger', onclick: async () => {
            if (!confirm('Delete the profile "' + n + '"?' + (profDir ? ' Its file is removed from ' + profDir + '.' : ''))) return;
            await dropProfile(n);
            if (st.name === n) { st.name = 'Default'; st.modified = true; save(); }
            draw();
          } }, 'Delete')))) : el('div', { class: 'hint-box' }, 'No profiles yet - arrange the panels (and shortcuts, toolbar…) the way you like, then use “Save as a new profile…”.'));
    };
    draw();
    DS.app.modal({ title: 'Workspace profiles', wide: true, body, buttons: (c) => [
      el('button', { class: 'btn', onclick: () => { c(); W.saveAs(); } }, '＋ Save current setup as a new profile…'),
      el('button', { class: 'btn', onclick: () => W.importFile(draw) }, '⇧ Import a profile…'),
      profDir ? el('button', { class: 'btn', title: profDir, onclick: () => api('/api/fs/open', { path: profDir }).catch(() => null) }, '📂 Open the folder') : null,
      el('span', { style: { flex: 1 } }), el('button', { class: 'btn primary', onclick: c }, 'Done')] });
  };

  /* ---------------------------------------------------------------- interface size + toolbar */
  function applyScale() { if (host && host.setZoom) host.setZoom(st.scale || 1); }

  // toolbar items that can be hidden; the first three can also be moved
  const TB = [
    { id: 'file', label: 'File menu, undo and redo', sel: '#tbg-file', move: true, keep: true },
    { id: 'undo', label: 'Undo / redo buttons', sel: '[data-act=undo], [data-act=redo]' },
    { id: 'views', label: 'View buttons (Map, Game, 3D, Quests)', sel: '#view-seg', move: true },
    { id: 'tools', label: 'Tools and grid snap', sel: '#tool-group', move: true },
    { id: 'project', label: 'Project name', sel: '#proj-name' },
    { id: 'check', label: '✔ Check', sel: '[data-act=validate]' },
    { id: 'export', label: '⇩ Export', sel: '[data-act=export]' },
    { id: 'help', label: '? Help', sel: '[data-act=help]' },
  ];
  function applyToolbar() {
    const t = st.toolbar || {};
    const hidden = new Set(t.hidden || []);
    TB.forEach((it) => document.querySelectorAll(it.sel).forEach((e) => { e.style.display = hidden.has(it.id) && !it.keep ? 'none' : ''; }));
    const order = (t.order && t.order.length ? t.order : ['file', 'views', 'tools']);
    order.forEach((id, i) => { const it = TB.find((x) => x.id === id); const e = it && document.querySelector(it.sel); if (e) e.style.order = String(10 + i); });
    const fixedOrder = { '.brand': 0, '.tb-spacer': 50, '#proj-name': 60, '#tbg-actions': 70 };
    Object.keys(fixedOrder).forEach((s) => { const e = document.querySelector('#topbar ' + s); if (e) e.style.order = String(fixedOrder[s]); });
  }
  W.customizeToolbar = function () {
    st.toolbar = st.toolbar || { hidden: [], order: ['file', 'views', 'tools'] };
    if (!st.toolbar.order || !st.toolbar.order.length) st.toolbar.order = ['file', 'views', 'tools'];
    const body = el('div');
    const draw = () => {
      const t = st.toolbar;
      body.replaceChildren(el('p', { class: 'ins-help' }, 'Hide the toolbar buttons you don\'t use, and change the order of the groups on the left. The ▦ workspace button always stays.'),
        ...TB.map((it) => {
          const i = t.order.indexOf(it.id);
          const box = el('input', { type: 'checkbox', checked: !t.hidden.includes(it.id), disabled: !!it.keep, onchange: () => {
            t.hidden = box.checked ? t.hidden.filter((x) => x !== it.id) : t.hidden.concat([it.id]);
            st.modified = true; save(); applyToolbar();
          } });
          const mv = (d) => { const j = i + d; if (j < 0 || j >= t.order.length) return; [t.order[i], t.order[j]] = [t.order[j], t.order[i]]; st.modified = true; save(); applyToolbar(); draw(); };
          return el('div', { class: 'ws-row' }, el('label', { class: 'chk', style: { flex: 1 } }, box, it.label),
            it.move ? el('button', { class: 'btn sm icon', title: 'Move left', disabled: i <= 0, onclick: () => mv(-1) }, '◀') : null,
            it.move ? el('button', { class: 'btn sm icon', title: 'Move right', disabled: i >= t.order.length - 1, onclick: () => mv(1) }, '▶') : null);
        }));
    };
    draw();
    DS.app.modal({ title: 'Customize the toolbar', body, buttons: (c) => [
      el('button', { class: 'btn', onclick: () => { st.toolbar = { hidden: [], order: ['file', 'views', 'tools'] }; save(); applyToolbar(); draw(); } }, 'Reset'),
      el('span', { style: { flex: 1 } }), el('button', { class: 'btn primary', onclick: c }, 'Done')] });
  };

  /* ---------------------------------------------------------------- the ▦ menu */
  W.menu = function (anchor) {
    const names = Object.keys(profiles).sort((x, y) => x.localeCompare(y));
    const mark = (on, t) => (on ? '✓ ' : '\u2003 ') + t;
    const cur = (n) => st.name === n;
    const items = [{ head: 'Workspaces' + (st.modified ? '  (changed)' : '') }];
    Object.keys(PRESETS).forEach((n) => items.push({ label: mark(cur(n), n), run: () => W.use(n) }));
    if (names.length) items.push({ head: 'My profiles' });
    names.forEach((n) => items.push({ label: mark(cur(n), '★ ' + n), run: () => W.use(n) }));
    if (st.modified && profiles[st.name]) items.push({ label: '\u2003 Update “' + st.name + '” with the current setup', run: W.update });
    if (st.modified && st.name && (profiles[st.name] || PRESETS[st.name])) items.push({ label: '\u2003 Undo my changes to “' + st.name + '”', run: () => W.use(st.name) });
    items.push({ label: '\u2003 Save as a new profile…', run: W.saveAs },
      { label: '\u2003 Profiles: manage, import, export…', run: W.manage });
    items.push('-', { head: 'Panels' });
    D.panels().forEach((p) => items.push({ label: mark(D.isOpen(p.id), (p.icon ? p.icon + ' ' : '') + p.title + (D.areaOf(p.id) && D.areaOf(p.id) !== 'main' ? '  ⧉' : '')), run: () => D.toggle(p.id) }));
    // windows: drag a tab out of a window (e.g. onto a second monitor) to give it a window of its own
    const fw = D.windows();
    items.push('-', { head: fw.length ? 'Windows' : 'Windows (drag a tab out of the window to open one)' });
    fw.forEach((w) => items.push({ label: '  ⧉ ' + w.title, run: () => D.focusWindow(w.key) }));
    if (fw.length) items.push({ label: '  ⇱ Bring every panel back into the main window', run: () => fw.forEach((w) => w.panels.forEach((id) => D.dockBack(id))) });
    items.push('-', { head: 'Layout' },
      { label: '  Maximize / restore the focused area', key: DS.Keys.label('maximize'), run: () => D.toggleMax() },
      { label: '  Collapse / expand the left side', key: DS.Keys.label('sideLeft'), run: () => D.toggleSide('left') },
      { label: '  Collapse / expand the right side', key: DS.Keys.label('sideRight'), run: () => D.toggleSide('right') },
      { label: '  Keyboard shortcuts…', run: () => DS.Keys.open() },
      { label: '  Customize the toolbar…', run: W.customizeToolbar },
      '-', { head: host && host.setZoom ? 'Interface size' : 'Interface size (use Ctrl + / Ctrl − in the browser)' });
    if (host && host.setZoom) SCALES.forEach((s) => items.push({ label: mark(Math.abs((st.scale || 1) - s) < 0.01, Math.round(s * 100) + '%'), run: () => { st.scale = s; st.modified = true; save(); applyScale(); } }));
    DS.app.dropdown(anchor, items);
  };

  /* ---------------------------------------------------------------- start */
  W.init = function () {
    D = DS.Dock;
    registerPanels();
    st = read(KEY, {});
    if (st.v !== 2) {   // first start, or a v1 layout
      const old = st;
      st = { v: 2, name: old.name && old.name !== 'Custom' ? old.name : 'Default', modified: old.name === 'Custom', scale: old.scale || 1, toolbar: { hidden: [], order: ['file', 'views', 'tools'] } };
      st.layout = old.left ? Object.assign(fromV1(old), { floating: [] }) : { root: PRESETS.Default().root, floating: [] };
      if (st.name && !PRESETS[st.name] && !read(KEY_SAVED, {})[st.name]) st.name = 'Default';
      profiles = read(KEY_SAVED, {});
    }
    // group ids are made fresh on every load, so compare layouts without them
    const sig = (lay) => JSON.stringify(lay, (k, v) => (k === 'id' ? undefined : v));
    D.onChange((lay) => { if (sig(lay) !== sig(st.layout)) st.modified = true; st.layout = lay; save(); });
    if (!D.init(document.getElementById('workspace'), st.layout)) D.init(document.getElementById('workspace'), { root: PRESETS.Default().root, floating: [] });
    st.layout = D.state();
    save();
    applyScale();
    applyToolbar();
    DS.Keys.onChange = () => { st.modified = true; save(); };
    loadProfiles();
  };
  W.start = function () { D.start(); };
  W.state = () => JSON.parse(JSON.stringify(st));
})();
