/* DayZ Studio - application shell: toolbar, hotkeys, dialogs, imports, export wizard, templates, help */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const A = (DS.app = {});

  /* ---------- toast + modal ---------- */
  DS.toast = function (msg, type, ms) {
    const t = el('div', { class: 'toast ' + (type || 'info') }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.classList.add('out'), (ms || 3500) - 300);
    setTimeout(() => t.remove(), ms || 3500);
  };

  function modal(opts) {
    const root = document.getElementById('modal-root');
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') });
    const close = () => {
      back.remove();
      if (opts.onClose) opts.onClose();
    };
    box.append(
      el('div', { class: 'modal-head' }, el('div', { class: 'modal-title' }, opts.title), el('button', { class: 'btn icon', onclick: close }, '✕')),
      el('div', { class: 'modal-body' }, opts.body)
    );
    if (opts.buttons) box.append(el('div', { class: 'modal-foot' }, opts.buttons(close)));
    back.append(box);
    back.addEventListener('mousedown', (e) => e.target === back && close());
    root.append(back);
    return close;
  }
  A.modal = modal;

  /* ---------- dropdown menu ---------- */
  function dropdown(anchor, items) {
    document.querySelectorAll('.ctx-menu.dd').forEach((m) => m.remove());
    const m = el('div', { class: 'ctx-menu dd' });
    items.forEach((it) => {
      if (it === '-') return m.append(el('div', { class: 'ctx-sep' }));
      if (it.head) return m.append(el('div', { class: 'ctx-head' }, it.head));
      m.append(el('div', { class: 'ctx-item', onclick: () => { m.remove(); it.run(); } }, it.label, it.key ? el('span', { class: 'kbd' }, it.key) : null));
    });
    const r = anchor.getBoundingClientRect();
    m.style.left = r.left + 'px';
    m.style.top = r.bottom + 4 + 'px';
    document.body.append(m);
    const off = (e) => {
      if (!m.contains(e.target)) { m.remove(); window.removeEventListener('mousedown', off, true); }
    };
    setTimeout(() => window.addEventListener('mousedown', off, true), 0);
  }

  A.dropdown = dropdown;

  /* ---------- project file ops ---------- */
  A.newProject = function () {
    if ((S.project.objects.length || S.project.quests.length) && !confirm('Start a new project? Unsaved changes are lost (use File ▸ Save project first).')) return;
    S.setProject(S.blank());
    DS.MapView.fit();
    DS.toast('New project created');
  };
  A.saveProject = function () {
    U.download(U.safeName(S.project.meta.name) + '.dzstudio.json', JSON.stringify(S.project, null, 2), 'application/json');
  };
  A.openProject = async function () {
    const f = await U.pickFile('.json,application/json');
    if (!f) return;
    try {
      const p = JSON.parse(await U.readFile(f));
      if (p && p.Objects && !p.objects) return importSpawnerJson(p, f.name);
      if (!p.objects || !p.quests) throw new Error('Not a DayZ Studio project file.');
      S.setProject(p);
      DS.MapView.fit();
      DS.toast('Opened ' + f.name, 'ok');
    } catch (e) {
      DS.toast('Could not open file: ' + e.message, 'error', 5000);
    }
  };

  function importSpawnerJson(p, name) {
    const kindOf = (c) => (/^Land_/.test(c) ? 'building' : 'prop');
    const list = (p.Objects || []).filter((o) => o.name && o.pos).map((o) =>
      S.makeObject({ c: o.name, kind: kindOf(o.name) }, o.pos[0], o.pos[2], {
        y: o.pos[1] || 0, yaw: (o.ypr || [])[0] || 0, pitch: (o.ypr || [])[1] || 0, roll: (o.ypr || [])[2] || 0, scale: o.scale || 1, snap: !o.pos[1],
      })
    );
    S.addObjects(list);
    S.commit();
    DS.MapView.fit();
    DS.toast(`Imported ${list.length} objects from ${name}`, 'ok');
  }

  A.loadBackground = async function () {
    const f = await U.pickFile('image/*');
    if (!f) return;
    const url = await U.readFile(f, 'dataurl');
    const im = new Image();
    im.onload = () => {
      const max = 2048;
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * k);
      c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      S.project.bg = { data: c.toDataURL('image/jpeg', 0.85), opacity: 0.9, name: f.name };
      S.changed('meta');
      S.commit();
      DS.Inspector.render();
      DS.toast('Background loaded (stretched over the whole map)', 'ok');
    };
    im.src = url;
  };

  /* ---------- game-file imports ---------- */
  async function importXml(kind) {
    const f = await U.pickFile('.xml,text/xml');
    if (!f) return;
    const doc = new DOMParser().parseFromString(await U.readFile(f), 'text/xml');
    if (doc.querySelector('parsererror')) return DS.toast('That file is not valid XML.', 'error');
    const text = await U.readFile(f);
    if (kind === 'types') {
      if (DS.Loot) DS.Loot.importXml('types', text);
      const names = [...doc.querySelectorAll('type')].map((t) => t.getAttribute('name')).filter(Boolean);
      DS.imported.items = [...new Set(names)].sort();
      DS.toast(`Loaded ${names.length} item classes from types.xml`, 'ok');
    } else if (kind === 'proto') {
      const names = [...doc.querySelectorAll('group')].map((g) => g.getAttribute('name')).filter(Boolean);
      DS.imported.buildings = [...new Set([...names, ...DS.imported.buildings])].sort();
      if (DS.Loot) DS.Loot.importXml('proto', text);
      DS.toast(`Loaded ${names.length} loot/building groups from mapgroupproto.xml`, 'ok');
    } else if (kind === 'pos') {
      const names = new Set(DS.imported.buildings);
      const gs = [...doc.querySelectorAll('group')];
      gs.forEach((g) => g.getAttribute('name') && names.add(g.getAttribute('name')));
      DS.imported.buildings = [...names].sort();
      if (DS.Loot) DS.Loot.importXml('pos', text);
      S.project.meta.showLoot = true;
      DS.toast(`Loaded ${gs.length} loot spawn buildings from mapgrouppos.xml`, 'ok');
      DS.MapView.invalidate();
    }
    DS.refreshClassList();
    S.emit('asset');
  }

  A.importAreaflags = async function () {
    const f = await U.pickFile('.map');
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      await DS.Zones.importMap(buf);
      DS.toast('Loaded areaflags.map — zones are drawn on top of it', 'ok');
      DS.MapView.invalidate();
    } catch (e) {
      DS.toast('Could not read areaflags.map: ' + e.message, 'error', 5000);
    }
  };

  /* ---------- hotkeys ---------- */
  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  /** keyboard shortcuts: commands with default keys the user can change (DS.Keys, ▦ ▸ Keyboard shortcuts…) */
  function hotkeys() {
    const R = (id, label, group, keys, run) => DS.Keys.register({ id, label, group, keys, run });
    const rotate = (d) => {
      if (S.view === 'map') { if (!DS.actions.rotate(d)) DS.MapView.placeYaw(d); }
      else if (S.view === 'view3d') DS.actions.rotate(d);
    };
    const paste = () => {
      const m = DS.MapView.mouse;
      const c = S.view === 'view3d' && DS.View3D.cursor;
      if (c) DS.actions.paste(c[0], c[2]);
      else DS.actions.paste(m.inside ? m.wx : DS.MapView.view.x, m.inside ? m.wz : DS.MapView.view.z);
    };
    R('save', 'Save project', 'File', ['Ctrl+S'], () => A.saveProject());
    R('undo', 'Undo', 'Edit', ['Ctrl+Z'], () => S.undo());
    R('redo', 'Redo', 'Edit', ['Ctrl+Y', 'Ctrl+Shift+Z'], () => S.redo());
    R('copy', 'Copy', 'Edit', ['Ctrl+C'], () => { if (DS.actions.copy()) DS.toast('Copied', 'info', 900); });
    R('paste', 'Paste at the mouse', 'Edit', ['Ctrl+V'], paste);
    R('duplicate', 'Duplicate', 'Edit', ['Ctrl+D'], () => DS.actions.duplicate());
    R('selectAll', 'Select all', 'Edit', ['Ctrl+A'], () => DS.actions.selectAll());
    R('delete', 'Delete the selection', 'Edit', ['Delete', 'Backspace'], () => DS.actions.deleteSelection());
    R('group', 'Group', 'Edit', ['Ctrl+G'], () => DS.actions.group());
    R('ungroup', 'Ungroup', 'Edit', ['Ctrl+Shift+G'], () => DS.actions.ungroup());
    R('rotL', 'Rotate left 15°', 'Edit', ['Q'], () => rotate(-15));
    R('rotR', 'Rotate right 15°', 'Edit', ['E'], () => rotate(15));
    R('rotLf', 'Rotate left 1°', 'Edit', ['Shift+Q'], () => rotate(-1));
    R('rotRf', 'Rotate right 1°', 'Edit', ['Shift+E'], () => rotate(1));
    R('toolSelect', 'Select / move tool', 'Tools', ['V'], () => S.setTool('select'));
    R('toolPan', 'Pan tool', 'Tools', ['H'], () => S.setTool('pan'));
    R('toolMeasure', 'Measure tool', 'Tools', ['M'], () => S.setTool('measure'));
    R('snap', 'Next grid snap size', 'Tools', ['G'], () => {
      const steps = [0, 1, 5, 10, 25, 50];
      const i = steps.indexOf(+S.project.meta.snap);
      S.project.meta.snap = steps[(i + 1) % steps.length];
      syncToolbar();
      DS.toast('Snap: ' + (S.project.meta.snap || 'off'), 'info', 900);
    });
    R('focus', 'Frame the selection', 'Views', ['F'], () => { if (S.view === 'map') DS.MapView.focusSelection(); else if (S.view === 'quests') DS.NodeEditor.fit(); else if (S.view === 'npcs') DS.Npcs.fit(); else if (S.view === 'game') DS.Link.focusSelection(); });
    R('nextView', 'Next view', 'Views', ['Tab'], () => S.setView(({ map: 'game', game: 'view3d', view3d: 'quests', quests: 'npcs', npcs: 'map' })[S.view] || 'map'));
    R('viewMap', 'Go to the Map', 'Views', ['Alt+1'], () => S.setView('map'));
    R('viewGame', 'Go to the Game', 'Views', ['Alt+2'], () => S.setView('game'));
    R('view3d', 'Go to the 3D view', 'Views', ['Alt+3'], () => S.setView('view3d'));
    R('viewQuests', 'Go to Quests', 'Views', ['Alt+4'], () => S.setView('quests'));
    R('viewNpcs', 'Go to NPCs', 'Views', ['Alt+5'], () => S.setView('npcs'));
    R('maximize', 'Maximize / restore the focused area', 'Workspace', ['Ctrl+Shift+F'], () => DS.Dock.toggleMax());
    R('sideLeft', 'Collapse / expand the left side', 'Workspace', ['Ctrl+B'], () => DS.Dock.toggleSide('left'));
    R('sideRight', 'Collapse / expand the right side', 'Workspace', ['Ctrl+Alt+B'], () => DS.Dock.toggleSide('right'));
    R('console', 'Show / hide the script console', 'Workspace', ['Ctrl+`'], () => DS.Dock.toggle('console'));
    R('workspaceMenu', 'Workspace menu', 'Workspace', ['Ctrl+Shift+W'], () => DS.Workspace.menu(document.querySelector('[data-act=workspace]')));
    R('help', 'Help & shortcuts', 'Help', ['F1', 'Shift+?'], () => A.help());

    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (document.querySelector('.modal-back')) {
        if (e.key === 'Escape') document.querySelector('.modal-back').remove();
        return;
      }
      const k = e.key.toLowerCase();
      // fixed keys: drawing a zone, Esc, nudging with the arrows
      if (S.tool === 'zone' && DS.Zones.draft) {
        if (k === 'enter') { DS.Zones.finish(); return; }
        if (k === 'backspace' || k === 'delete') { e.preventDefault(); DS.Zones.undoPoint(); return; }
        if (k === 'escape') { DS.Zones.cancel(); return; }
      }
      if (k === 'escape') {
        if (DS.MapView.isPicking()) DS.MapView.cancelPick();
        else if (S.tool === 'place') { S.asset = null; S.setTool('select'); }
        else S.select(null, []);
        return;
      }
      if (DS.Keys.handle(e)) return;
      if (k.startsWith('arrow') && S.view === 'map' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const st = e.shiftKey ? 10 : 1;
        const d = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, st], arrowdown: [0, -st] }[k];
        DS.actions.nudge(d[0], d[1]);
      }
    });
  }

  /* ---------- toolbar ---------- */
  function syncToolbar() {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
    document.getElementById('snap-sel').value = String(S.project.meta.snap);
    const pn = document.getElementById('proj-name');
    if (document.activeElement !== pn) pn.value = S.project.meta.name;
    document.querySelector('[data-act=undo]').disabled = !S.canUndo();
    document.querySelector('[data-act=redo]').disabled = !S.canRedo();
    const hint = document.getElementById('tool-hint');
    if (S.view === 'map') {
      if (S.tool === 'place' && S.asset) hint.textContent = `Placing: ${S.asset.label || S.asset.c}  •  click to place  •  Q/E rotate (${Math.round(DS.MapView.placeYaw())}°)  •  Esc to stop`;
      else if (S.tool === 'zone') hint.textContent = 'Drawing a loot zone: ' + ({ poly: 'click points, double-click or Enter to close, Backspace undoes a point', circle: 'click-drag from the centre', rect: 'click-drag a rectangle' }[(DS.Zones.draft || {}).shape] || '') + '  •  Esc stops';
      else if (S.tool === 'pan') hint.textContent = 'Pan tool: drag to move the map';
      else if (S.tool === 'measure') hint.textContent = 'Measure: click-drag between two points';
      else hint.textContent = 'Click to select  •  drag to move  •  drag empty space to box-select  •  Space/middle-drag pans  •  wheel zooms';
    }
    hint.classList.toggle('hidden', !S.shown('map'));
  }

  function updateCounts() {
    const P = S.project;
    document.getElementById('st-counts').textContent = `${P.objects.length} objects  •  ${P.quests.length} quests  •  ${P.quests.reduce((a, q) => a + q.nodes.length, 0)} nodes  •  ${S.world().name} ${P.meta.mapSize}m`;
    const n = DS.validateAll().filter((i) => i.level !== 'info').length;
    const b = document.getElementById('problem-badge');
    b.textContent = n;
    b.classList.toggle('hidden', !n);
  }

  function bindToolbar() {
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => S.setView(b.dataset.view)));
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { if (S.tool === 'place') S.asset = null; DS.Zones.draft = null; S.setTool(b.dataset.tool); }));
    document.getElementById('snap-sel').addEventListener('change', (e) => { S.project.meta.snap = +e.target.value; S.changed('meta'); });
    document.getElementById('proj-name').addEventListener('input', (e) => { S.project.meta.name = e.target.value; S.changed('meta'); });
    document.getElementById('proj-name').addEventListener('change', () => S.commit());
    const act = {
      undo: () => S.undo(), redo: () => S.redo(), validate: () => A.problems(), export: () => A.exportDialog(), help: () => A.help(),
      workspace: (btn) => DS.Workspace.menu(btn),
      file: (btn) => dropdown(btn, [
        { label: 'New project', run: A.newProject },
        { label: 'Open project / spawner JSON…', run: A.openProject },
        { label: 'Import from DayZ Editor (.dze) / Expansion (.map) / init.c…', run: () => DS.Import.run() },
        { label: 'Save project (download)', key: 'Ctrl+S', run: A.saveProject },
        { label: 'Recent projects and backups…', run: () => DS.Disk.openDialog() },
        { label: 'Save a backup copy now', run: () => DS.Disk.saveNow(true).then(() => DS.toast('Backup written to Documents/DayZStudio/Backups', 'ok', 2500)) },
        '-', { head: 'Quest mod' },
        { label: 'Build installable mod (PBO)…', run: () => A.buildMod() },
        { label: 'Test on a local server (multiplayer)…', run: () => A.serverDialog() },
        { label: '☁ Publish to Steam Workshop…', run: () => DS.Workshop.open() },
        { label: '📊 Player stats, item requirements & HUD…', run: () => DS.Stats.open() },
        { label: '🛒 Traders & money…', run: () => DS.Stats.open('traders') },
        '-', { head: 'Server' },
        { label: '⚙ Server settings (serverDZ.cfg)…', run: () => DS.ServerTools.cfgEditor() },
        { label: '⚖ Loot economy multipliers (types.xml)…', run: () => DS.ServerTools.economy() },
        { label: '📦 PBO tools (unpack, pack, use mods)…', run: () => DS.ServerTools.pbo() },
        '-', { head: 'Scripting' },
        { label: '⌨ Script console (live script.log)…', run: () => DS.Console.open() },
        { label: '🧩 Custom nodes…', run: () => DS.CustomNodes.manager() },
        '-', { head: 'Import game files' },
        { label: 'types.xml → item classes + loot preview…', run: () => importXml('types') },
        { label: 'mapgroupproto.xml → loot definitions…', run: () => importXml('proto') },
        { label: 'mapgrouppos.xml → loot spawn positions…', run: () => importXml('pos') },
        { label: 'areaflags.map → loot zones (tiers/usage)…', run: A.importAreaflags },
        { label: 'Map background image…', run: A.loadBackground },
        '-', { label: 'Templates & examples…', run: A.templates },
        { label: 'Welcome guide', run: A.welcome },
        { label: '⟳ Check for updates…', run: () => DS.Updates.open() },
      ]),
    };
    document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act[b.dataset.act](b)));
  }

  /* ---------- problems dialog ---------- */
  A.problems = function () {
    const list = DS.validateAll();
    const body = el('div', { class: 'problems' });
    if (!list.length) body.append(el('div', { class: 'ok-box' }, '✔ No problems found. Your project looks ready to export.'));
    list.forEach((i) =>
      body.append(el('div', { class: 'problem ' + i.level, onclick: () => {
        if (!i.target) return;
        document.querySelector('.modal-back') && document.querySelector('.modal-back').remove();
        if (i.target.kind === 'object') { S.setView('map'); S.select('object', [i.target.id]); const o = S.obj(i.target.id); if (o) DS.MapView.centerOn(o.x, o.z, 0.5); }
        else if (i.target.kind === 'node') { S.activeQuest = i.target.quest; S.setView('quests'); S.structure(); S.select('node', [i.target.id]); }
        else if (i.target.kind === 'quest') { S.activeQuest = i.target.id; S.setView('quests'); S.select(null, []); S.structure(); }
        else if ((i.target.kind === 'npc' || i.target.kind === 'bnode') && DS.Npcs) DS.Npcs.show(i.target);
        else if (i.target.kind === 'stats') DS.Stats.open(i.target.tab);
        else if (i.target.kind === 'custom') DS.CustomNodes.wizard(i.target.id);
      } }, el('span', { class: 'p-ic' }, { error: '✖', warn: '⚠', info: 'ℹ' }[i.level]), i.msg))
    );
    modal({ title: `Project check — ${list.filter((i) => i.level === 'error').length} errors, ${list.filter((i) => i.level === 'warn').length} warnings`, body, buttons: (close) => el('button', { class: 'btn primary', onclick: close }, 'Close') });
  };

  /* ---------- installable mod ---------- */
  A.buildMod = async function () {
    const status = el('div', { class: 'ins-help' }, 'Packing the mod…');
    const body = el('div', null, status);
    let close;
    close = modal({ title: 'Build installable mod', body, buttons: (c) => el('button', { class: 'btn', onclick: c }, 'Close') });
    let r;
    try {
      const payload = DS.exporters.modPayload();
      const bad = DS.exporters.checkScripts ? DS.exporters.checkScripts(payload) : [];
      if (bad.length) {
        status.remove();
        body.append(el('div', { class: 'problem error' }, 'The scripts would not compile in DayZ, so nothing was built:'),
          ...bad.slice(0, 12).map((e) => el('div', { class: 'problem error', style: { cursor: e.origin ? 'pointer' : '' }, onclick: () => { if (e.origin && DS.Console) { close(); DS.Console.goTo(e.origin.target); } } }, e.text)));
        return;
      }
      r = await fetch('/api/mod/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((x) => x.json());
      A.lastBuild = r.ok ? payload.name : null;
    } catch (e) {
      r = { ok: false, error: 'The studio server is not running (start run_desktop.bat or run_studio.bat).' };
    }
    status.remove();
    if (!r.ok) { body.append(el('div', { class: 'problem error' }, 'Build failed: ' + (r.error || 'unknown error'))); return; }
    body.append(
      el('div', { class: 'ok-box' }, `✔ @${r.name} built (${Math.round(r.pboBytes / 1024)} KB PBO${r.sounds ? ', ' + r.sounds + ' voice file(s)' : ''}${r.binarized ? '' : ', config not binarized — DayZ Tools not found'})`),
      r.signed
        ? el('p', null, `🔏 Signed with your key “${r.name}”. Server owners copy @${r.name}/keys/${r.name}.bikey into the server’s keys folder and keep verifySignatures = 2. Your private key is in ${r.keysDir} — keep it safe and back it up: it is what lets future versions of this mod keep working with the same .bikey.`)
        : el('p', { class: 'warn-text' }, `Not signed (${r.signNote || 'unknown reason'}): servers must set verifySignatures = 0. Install DayZ Tools from Steam to sign automatically.`),
      el('p', null, 'The ZIP contains the mod folder, the profile files (quests.json) and an INSTALL.txt with the steps for your server.'),
      el('div', { class: 'btn-row' },
        el('a', { class: 'btn primary', href: r.zip, download: r.name + '_ready.zip' }, '⇩ Download ZIP'),
        el('button', { class: 'btn', onclick: async () => {
          close();
          S.setView('game');
          const l = await DS.Link.launch({ exportName: r.name });
        } }, '▶ Test this exact mod in the game'),
        el('button', { class: 'btn', title: 'Run a real DayZ server on this PC with the mod and join it — tests the multiplayer side', onclick: () => { close(); A.serverDialog(r.name); } }, '🖧 Test on a local server'),
        el('button', { class: 'btn', title: 'Upload the mod to the Steam Workshop so players get it automatically', onclick: () => { close(); DS.Workshop.open(); } }, '☁ Publish to Steam Workshop')),
      el('div', { class: 'ins-help' }, 'Folder on disk: ' + r.folder));
  };

  /* ---------- local dedicated server (multiplayer test) ---------- */
  A.serverDialog = function (name) {
    if (!name) {
      try { name = A.lastBuild || DS.exporters.modPayload().name; } catch (e) { name = A.lastBuild; }
    }
    const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    const info = el('div', { class: 'srv-info' }, 'Checking…');
    const log = el('div', { class: 'srv-log' });
    const reset = el('input', { type: 'checkbox', checked: true });
    const verify = el('input', { type: 'checkbox', checked: false });
    const msg = (t, kind) => DS.toast(t, kind || 'info', 4000);
    const act = async (path, body, ok) => { const r = await api(path, body).catch(() => ({ ok: false, error: 'studio server not running' })); if (!r.ok) msg(r.error || 'failed', 'error'); else if (ok) msg(ok, 'ok'); refresh(); };
    const flag = (f, lines) => act('/api/server/flag', { flag: f, lines }, null);
    const btns = {
      start: el('button', { class: 'btn primary', onclick: () => act('/api/server/start', { exportName: name, world: S.project.meta.world || 'chernarusplus', resetProgress: reset.checked, verify: verify.checked }, 'Server starting — about a minute') }, '① Start server'),
      join: el('button', { class: 'btn primary', onclick: () => act('/api/server/join', { exportName: name }, 'Game starting — it connects by itself') }, '② Join with the game'),
      talk: el('button', { class: 'btn sm', title: 'Teleport next to the first quest NPC and open the conversation', onclick: () => flag('talk') }, '💬 Go talk to the first NPC'),
      kill: el('button', { class: 'btn sm', title: 'Count one infected kill for active kill objectives', onclick: () => flag('simkill', ['@infected']) }, '☠ Simulate kill'),
      give: el('button', { class: 'btn sm', title: 'Put items into your inventory, e.g. to test replies that take items', onclick: () => {
        const v = prompt('Give which item? Class name and amount, e.g.  Rag 4', 'Rag 4');
        if (v && v.trim()) flag('give', [v.trim()]);
      } }, '🎒 Give item…'),
      setvar: el('button', { class: 'btn sm', title: 'Change a server variable on the running server, e.g. to unlock a quest chain or make an NPC appear', onclick: () => {
        const v = prompt('Set which server variable? Name and value, e.g.  bandits_defeated 1', (DS.Cond.varNames()[0] || 'my_flag') + ' 1');
        if (v && v.trim()) flag('setvar', [v.trim()]);
      } }, '⚑ Set server variable…'),
      resetp: el('button', { class: 'btn sm', title: 'Forget all quest progress and server variables', onclick: () => flag('reset') }, '⟲ Reset progress'),
      stop: el('button', { class: 'btn sm', onclick: () => act('/api/server/stop', {}, 'Server stopped') }, '■ Stop server'),
    };
    const body = el('div', { class: 'srv' },
      el('p', null, `Runs DayZ Server on this PC with @${name || '?'} (BattlEye on, unsigned mods allowed) and connects your game to it, exactly as players would. Use it to check the multiplayer side before you upload the mod.`),
      info,
      el('div', { class: 'btn-row' }, btns.start, el('label', { class: 'chk' }, reset, ' start with fresh quest progress'),
        el('label', { class: 'chk', title: 'Installs the mod’s .bikey on the test server and turns signature checks on, like a real server' }, verify, ' check signatures'), btns.join),
      el('div', { class: 'mini-title' }, 'Test helpers (work while you are on the server)'),
      el('div', { class: 'btn-row' }, btns.talk, btns.kill, btns.give, btns.setvar, btns.resetp, btns.stop),
      el('div', { class: 'mini-title' }, 'Quest log on the server'), log,
      el('div', { class: 'ins-help' }, 'The server opens its own console window. Its logs and per-player progress are in the _game/server/profile folder.'));
    let alive = true;
    const close = modal({ title: 'Local server test', body, wide: true, buttons: (c) => el('button', { class: 'btn', onclick: () => { alive = false; c(); } }, 'Close') });
    async function refresh() {
      let s;
      try { s = await api('/api/server/status'); } catch (e) { info.textContent = 'The studio server is not running.'; return; }
      if (!s.installed) {
        info.replaceChildren(el('div', { class: 'problem warn' }, 'DayZ Server is not installed. In Steam: Library ▸ Tools ▸ DayZ Server ▸ Install (free for DayZ owners), then reopen this window.'));
        Object.values(btns).forEach((b) => (b.disabled = true));
        return;
      }
      const lines = [];
      lines.push(s.running ? (s.loaded != null ? `● Running — ${s.loaded} quest(s) loaded${s.mod ? ' from @' + s.mod : ''}` : '◌ Starting… (about a minute)') : '○ Not running');
      if (s.players && s.players.length) lines.push('Players: ' + s.players.join(', ') + (s.progress && s.progress.hasPlayer ? ' (in game)' : ''));
      (s.kicks || []).forEach((k) => lines.push('Kicked: ' + k));
      info.replaceChildren(...lines.map((t) => el('div', null, t)), ...(s.errors || []).map((e) => el('div', { class: 'problem error' }, e)));
      btns.start.disabled = s.running;
      btns.join.disabled = !s.running || s.loaded == null;
      [btns.talk, btns.kill, btns.give, btns.setvar, btns.resetp].forEach((b) => (b.disabled = !(s.progress && s.progress.hasPlayer)));
      btns.stop.disabled = !s.running;
      const pl = ((s.progress && s.progress.vars) || []).map((v) => '⚑ ' + v).concat((s.progress && s.progress.log) || []);
      log.replaceChildren(...(pl.length ? pl.map((t) => el('div', null, t)) : [el('div', { class: 'muted' }, 'Nothing yet.')]));
    }
    refresh();
    const timer = setInterval(() => { if (!alive || !body.isConnected) { clearInterval(timer); return; } refresh(); }, 3000);
    return close;
  };

  /* ---------- export wizard ---------- */
  A.exportDialog = function () {
    const opts = { objects: true, quests: true, loot: !!(DS.Loot && DS.Loot.modified()), zones: !!(DS.Zones && (S.project.zones || []).length), expansion: false, project: true };
    const errs = DS.validateAll().filter((i) => i.level === 'error');
    let files = [];
    let curIdx = 0;
    const preview = el('textarea', { class: 'inp code preview', readonly: true, spellcheck: 'false' });
    const list = el('div', { class: 'file-list' });
    const info = el('div', { class: 'file-desc' });

    function rebuild() {
      files = DS.exporters.build(opts);
      curIdx = Math.min(curIdx, Math.max(0, files.length - 1));
      list.innerHTML = '';
      files.forEach((f, i) => list.append(el('div', { class: 'file' + (i === curIdx ? ' active' : ''), onclick: () => { curIdx = i; rebuild(); } }, el('span', { class: 'mono' }, f.path))));
      const f = files[curIdx];
      preview.value = f ? (typeof f.data === 'function' ? `(binary file, about ${f.size || '?'} — generated when you download)` : f.data) : '(nothing selected)';
      info.textContent = f ? f.desc : '';
    }
    const chk = (key, label, help) => el('label', { class: 'chk big' }, el('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; rebuild(); } }), el('div', null, el('b', null, label), el('div', { class: 'ins-help' }, help)));
    const body = el('div', { class: 'export' },
      errs.length ? el('div', { class: 'problem error', onclick: () => { document.querySelector('.modal-back').remove(); A.problems(); } }, `✖ ${errs.length} error(s) in the project — click to review before exporting.`) : null,
      el('div', { class: 'export-opts' },
        chk('objects', 'Map objects (vanilla)', 'Object spawner JSON, init.c spawner, event files'),
        chk('quests', 'Quest framework (vanilla, no mods)', 'Enforce script mod + quests.json + install guide'),
        chk('loot', 'Loot spawns (Central Economy)', 'mapgrouppos.xml + mapgroupproto.xml (full files, large)'),
        chk('zones', 'Loot zones (areaflags.map)', 'Tier / usage zones you drew, ~80 MB binary file + zones.json'),
        chk('expansion', 'DayZ Expansion formats (optional)', 'Only if your server uses Expansion Quests / Expansion objects'),
        chk('project', 'Editable project file', 'Re-open this in DayZ Studio later')),
      el('div', { class: 'export-main' }, list, el('div', { class: 'export-prev' }, info, preview))
    );
    modal({
      title: 'Export server files', wide: true, body,
      buttons: (close) => [
        el('button', { class: 'btn', onclick: () => { const f = files[curIdx]; if (f) U.download(f.path.split('/').pop(), typeof f.data === 'function' ? f.data() : f.data); } }, 'Download this file'),
        el('button', { class: 'btn', onclick: () => { const f = files[curIdx]; if (f && typeof f.data === 'string') navigator.clipboard.writeText(f.data).then(() => DS.toast('Copied to clipboard', 'ok', 1200)); } }, 'Copy'),
        el('span', { class: 'tb-spacer' }),
        el('button', { class: 'btn', title: 'Packs quests and removed map objects into a ready-to-install mod (PBO) + profile files, no DayZ Tools needed', disabled: !S.project.quests.length && !(S.project.removed || []).length && !(S.project.itemReqs || []).length && !(S.project.hud || []).length && !S.project.objects.some((o) => o.kind === 'fx'), onclick: () => A.buildMod() }, '🧰 Build installable mod (PBO)…'),
        (S.project.removed || []).length ? el('div', { class: 'ins-help' }, `${S.project.removed.length} removed map object(s) are hidden by this mod — on the server and for every player (players need the mod).`) : null,
        el('button', { class: 'btn primary', onclick: () => { if (!files.length) return DS.toast('Nothing to export yet.', 'warn'); U.download(DS.exporters.zipName(), U.zip(files.map((f) => ({ path: f.path, data: typeof f.data === 'function' ? f.data() : f.data })))); DS.toast(`Exported ${files.length} files as ZIP`, 'ok'); } }, '⇩ Download ZIP'),
        el('button', { class: 'btn', onclick: close }, 'Close'),
      ],
    });
    rebuild();
  };

  /* ---------- help ---------- */
  A.help = function () {
    // the user's own shortcuts (DS.Keys), so this table is right after they change them
    const k = (...ids) => ids.map((id) => DS.Keys.label(id)).filter(Boolean).join('  •  ');
    const keys = [
      ['Select / move', k('toolSelect') + '  •  drag objects, drag empty space = box select (Shift adds)'],
      ['Pan / zoom', 'Hold Space or middle-mouse drag  •  mouse wheel  •  pan tool ' + k('toolPan')],
      ['Rotate', k('rotL', 'rotR') + ' (15°)  •  ' + k('rotLf', 'rotRf') + ' (1°)'],
      ['Delete', k('delete')],
      ['Duplicate / copy / paste', k('duplicate', 'copy', 'paste') + ' (at the mouse)'],
      ['Group / ungroup', k('group', 'ungroup')],
      ['Nudge', 'Arrow keys 1 m  •  Shift+Arrow 10 m'],
      ['Undo / redo', k('undo', 'redo')],
      ['Grid snap', k('snap') + ' cycles  •  hold Ctrl while dragging to ignore snap'],
      ['Frame selection', k('focus')],
      ['Views', k('nextView') + ' next  •  ' + k('viewMap', 'viewGame', 'view3d', 'viewQuests') + ' Map / Game / 3D / Quests'],
      ['Workspace', k('sideLeft') + ' / ' + k('sideRight') + ' collapse a side  •  ' + k('maximize') + ' maximize  •  ' + k('console') + ' console'],
      ['Stop placing / cancel pick', 'Esc'],
      ['Measure', k('toolMeasure') + ', then click-drag'],
      ['Save project', k('save')],
    ];
    const body = el('div', { class: 'help' },
      el('h3', null, 'Quick start'),
      el('ol', null,
        el('li', null, el('b', null, 'Place things. '), 'Open the Assets tab, click an item, then click on the map. Use Prefabs for ready-made camps and checkpoints.'),
        el('li', null, el('b', null, 'Tweak them. '), 'Select an object to change its position, rotation, loot table or init script in the right panel.'),
        el('li', null, el('b', null, 'Build a quest. '), 'Switch to Quests (Tab). Add a Trigger, then Objectives, then Rewards — drag from a node’s right dot to the next node.'),
        el('li', null, el('b', null, 'Point quests at your map. '), 'In any location field press “Pick on map”, or link it to an object you placed — it follows the object if you move it.'),
        el('li', null, el('b', null, 'Check & export. '), 'Press ✔ Check for plain-English problems, then ⇩ Export. The ZIP contains a README with copy-paste install steps.')),
      el('h3', null, 'Coordinates'),
      el('p', null, 'DayZ maps are square. X runs west→east, Z runs south→north, Y is height. Yaw 0° faces north and increases clockwise. Y = 0 on an object means “place on the ground” in the init.c and quest-framework exports.'),
      el('h3', null, 'Shortcuts'),
      el('table', { class: 'keys' }, keys.map((k) => el('tr', null, el('td', null, k[0]), el('td', { class: 'mono' }, k[1])))),
      el('p', null, el('a', { href: '#', onclick: (e) => { e.preventDefault(); const m = document.querySelector('.modal-back'); if (m) m.remove(); DS.Keys.open(); } }, 'Change the keyboard shortcuts…')),
      el('h3', null, 'About class names'),
      el('p', null, 'The built-in catalogue is a convenience list. For your exact game version use File ▸ Import ▸ types.xml / mapgroupproto.xml so every class on your server is searchable. You can also type any class name manually.')
    );
    modal({ title: 'DayZ Studio — help', body, wide: true, buttons: (close) => el('button', { class: 'btn primary', onclick: close }, 'Got it') });
  };

  /* ---------- templates ---------- */
  function buildQuest(name, desc, specs, links, extra) {
    const q = S.newQuest(name);
    q.description = desc;
    Object.assign(q, extra || {});
    const c = DS.MapView.center();
    const ids = {};
    specs.forEach((s, i) => {
      const params = {};
      Object.keys(s.p || {}).forEach((k) => (params[k] = s.p[k]));
      // positions given as [dx, dz] relative to the map centre
      Object.keys(params).forEach((k) => {
        const v = params[k];
        if (v && v.__rel) params[k] = { x: Math.round(c.x + v.dx), y: 0, z: Math.round(c.z + v.dz), ref: null };
      });
      const n = S.addNode(q, s.t, 40 + (i % 5) * 250, 40 + Math.floor(i / 5) * 140, params);
      ids[s.k] = n.id;
    });
    links.forEach((l) => S.link(q, ids[l[0]], ids[l[1]]));
    return q;
  }
  const rel = (dx, dz) => ({ __rel: true, dx, dz });

  const TEMPLATES = [
    { name: 'Showcase: camp, factions & RPG', desc: 'Every system in one small area: a Survivor camp with a trader and a quest, a supply container you can search with enough XP, a Bandit checkpoint with an armed guard and a car as reward, XP, faction standings, a HUD and custom nodes.', run() {
      DS.Showcase.addTo(S.project, DS.MapView.center());
      S.structure();
      S.setView('map');
      S.commit();
      DS.toast('Build it with File ▸ Build installable mod, or try it with ⌨ Console ▸ Compile on local server', 'ok', 6000);
    } },
    { name: 'Survivor camp + checkpoint', desc: 'Map example: a camp and a military checkpoint made from prefabs.', run() {
      const c = DS.MapView.center();
      const place = (pf, dx, dz, yaw) => {
        const g = U.uid('g');
        return pf.parts.map((p) => {
          const r = U.deg2rad(yaw);
          return S.makeObject({ c: p[0], kind: p[1] }, c.x + dx + p[2] * Math.cos(r) + p[3] * Math.sin(r), c.z + dz - p[2] * Math.sin(r) + p[3] * Math.cos(r), { yaw: U.wrap360(p[4] + yaw), group: g });
        });
      };
      S.addObjects([...place(DS.PREFABS[0], -40, 0, 0), ...place(DS.PREFABS[1], 40, 0, 90)]);
      S.setView('map');
      S.commit();
    } },
    { name: 'Quest: Clear the Infected', desc: 'Talk to Boris, kill 10 infected near the camp, get a medical reward.', run() {
      buildQuest('Clear the Infected', 'The camp is overrun. Thin out the infected nearby.', [
        { k: 'a', t: 'trg_npc', p: { npc: 'SurvivorM_Boris', name: 'Boris', pos: rel(0, 0), text: 'We keep getting swarmed. Kill ten of them and I will make it worth your while.' } },
        { k: 'b', t: 'obj_kill', p: { classes: ['@infected'], count: 10, area: true, pos: rel(0, 0), radius: 250 } },
        { k: 'c', t: 'rew_item', p: { items: [{ c: 'BandageDressing', n: 4, chance: 1 }, { c: 'Morphine', n: 1, chance: 1 }, { c: 'SodaCan_Cola', n: 2, chance: 1 }] } },
        { k: 'd', t: 'end', p: { text: 'Boris nods. “Good work.”' } },
      ], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
      S.setView('quests');
      S.commit();
    } },
    { name: 'Quest: Courier Run', desc: 'Receive a notebook, deliver it across the map, earn a supply crate.', run() {
      buildQuest('Courier Run', 'Carry the notebook to the drop-off point.', [
        { k: 'a', t: 'trg_npc', p: { npc: 'SurvivorF_Eva', name: 'Eva', pos: rel(0, 0), text: 'Please take this notebook to my friend. It is urgent.' } },
        { k: 'b', t: 'rew_item', p: { items: [{ c: 'Notebook', n: 1, chance: 1 }] } },
        { k: 'c', t: 'obj_deliver', p: { item: 'Notebook', count: 1, pos: rel(600, 400), radius: 10 } },
        { k: 'd', t: 'rew_crate', p: { crate: 'SeaChest', pos: rel(600, 410), items: [{ c: 'TunaCan', n: 3, chance: 1 }, { c: 'WaterBottle', n: 1, chance: 1 }, { c: 'Ammo_762x39', n: 20, chance: 0.5 }], text: 'A supply chest was left for you nearby.' } },
        { k: 'e', t: 'end', p: { text: 'Delivery complete.' } },
      ], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']]);
      S.setView('quests');
      S.commit();
    } },
    { name: 'Quest: Hold the Line', desc: 'Enter an area, survive a wave of soldiers for 3 minutes, loot the crate.', run() {
      buildQuest('Hold the Line', 'Enter the marked area and survive.', [
        { k: 'a', t: 'trg_zone', p: { pos: rel(0, 0), radius: 40, text: 'Something is coming. Hold your ground!' } },
        { k: 'b', t: 'rew_spawn', p: { cls: 'ZmbM_SoldierNormal', count: 8, pos: rel(0, 0), radius: 60, text: 'They are here!' } },
        { k: 'c', t: 'obj_survive', p: { seconds: 180 } },
        { k: 'd', t: 'rew_crate', p: { crate: 'WoodenCrate', pos: rel(0, 5), items: [{ c: 'AKM', n: 1, chance: 1 }, { c: 'Mag_AKM_30Rnd', n: 3, chance: 1 }, { c: 'PlateCarrierVest', n: 1, chance: 0.5 }], text: 'Supplies dropped for the survivors.' } },
        { k: 'e', t: 'rew_modifier', p: { stat: 'heal' } },
        { k: 'f', t: 'end', p: { text: 'You held the line.' } },
      ], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['c', 'e'], ['d', 'f'], ['e', 'f']], { failOnDeath: true });
      S.setView('quests');
      S.commit();
    } },
  ];

  A.templates = function () {
    const body = el('div', { class: 'tpl-list' });
    let close;
    TEMPLATES.forEach((t) =>
      body.append(el('div', { class: 'tpl', onclick: () => { close(); t.run(); DS.toast('Added: ' + t.name, 'ok'); } }, el('b', null, t.name), el('div', { class: 'ins-help' }, t.desc)))
    );
    body.append(el('div', { class: 'ins-help' }, 'Templates are added to your current project, positioned at the centre of the map view. Use “Pick on map” to move quest locations.'));
    close = modal({ title: 'Templates & examples', body, buttons: (c) => el('button', { class: 'btn', onclick: c }, 'Close') });
  };

  A.welcome = function () {
    const body = el('div', { class: 'welcome' },
      el('p', { class: 'lead' }, 'Build DayZ maps and quests visually — no scripting required. Exports are plain files for a vanilla server.'),
      el('div', { class: 'wel-grid' },
        el('div', { class: 'wel-card' }, el('div', { class: 'wel-ic' }, '🗺'), el('b', null, 'Design the map'), el('p', null, 'Place buildings, camps, loot and events on a to-scale grid. Export object spawner JSON or init.c.')),
        el('div', { class: 'wel-card' }, el('div', { class: 'wel-ic' }, '⎇'), el('b', null, 'Script the story'), el('p', null, 'Wire triggers, objectives and rewards together. Quests point at the things you placed.')),
        el('div', { class: 'wel-card' }, el('div', { class: 'wel-ic' }, '⇩'), el('b', null, 'Ship it'), el('p', null, 'One ZIP with the files and a step-by-step install guide. Press ✔ Check first.'))),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary', onclick: () => { document.querySelector('.modal-back').remove(); A.templates(); } }, 'Browse examples'),
        el('button', { class: 'btn', onclick: () => { document.querySelector('.modal-back').remove(); A.help(); } }, 'How it works')));
    modal({ title: 'Welcome to DayZ Studio', body, wide: true, buttons: (c) => el('button', { class: 'btn', onclick: c }, 'Start with an empty project') });
  };

  /* ---------- boot ---------- */
  function boot() {
    const had = S.load();
    if (!had) S.resetHistory();
    // the docking workspace first, so every panel already sits where it will be shown when its module starts
    DS.Browser.init();
    if (DS.Workspace) DS.Workspace.init();
    DS.MapView.init(document.getElementById('map'));
    DS.NodeEditor.init(document.getElementById('quest-wrap'));
    DS.Npcs.init(document.getElementById('npc-wrap'));
    DS.View3D.init(document.getElementById('view3d-wrap'));
    DS.Link.initView(document.getElementById('game-wrap'));
    DS.Terrain.load();
    DS.Bounds.load();
    DS.Inspector.init(document.getElementById('right'));
    // the maps on this PC (new DLC maps included) - the Map list updates once the server answered
    DS.loadWorlds().then((ok) => { if (ok) { DS.Inspector.render(); updateCounts(); } });
    if (DS.Loot) DS.Loot.load(S.project.meta.world).then(() => S.emit('loot'));
    if (DS.Zones) DS.Zones.load(S.project.meta.world).then(() => DS.MapView.invalidate());
    bindToolbar();
    hotkeys();
    ['view', 'tool', 'asset', 'history', 'project', 'meta', 'changed', 'selection'].forEach((ev) => S.on(ev, syncToolbar));
    S.on('changed', U.debounce(updateCounts, 300));
    S.on('structure', updateCounts);
    S.on('saved', (ok) => {
      const s = document.getElementById('st-save');
      s.textContent = ok === true ? 'Saved ✓' : ok === 'nobg' ? 'Saved (background image too large to keep — reload it next time)' : 'Could not save to browser storage — use File ▸ Save project';
      s.className = ok ? 'muted' : 'warn-text';
    });
    window.addEventListener('beforeunload', () => S.save());
    syncToolbar();
    updateCounts();
    if (DS.Workspace) DS.Workspace.start();
    const welcome = () => {
      if (!had && !localStorage.getItem('dzstudio.welcomed')) {
        try { localStorage.setItem('dzstudio.welcomed', '1'); } catch (e) {}
        A.welcome();
      }
    };
    // a blank (or emptied) browser copy but a project on disk: offer that first. The browser copy can come back
    // empty when the app's storage could not be opened, e.g. right after an update restarted it
    const blank = !had || (!S.project.objects.length && !S.project.quests.length && !S.project.meta.id);
    const host = window.studioHost && window.studioHost.update;
    if (blank && DS.Disk) {
      (host ? host.state().catch(() => ({})) : Promise.resolve({}))
        .then((st) => DS.Disk.offerRestore(!!st.updated))
        .then((shown) => { if (!shown) welcome(); });
    }
    else {
      if (DS.Disk) DS.Disk.preferNewer();
      welcome();
    }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
