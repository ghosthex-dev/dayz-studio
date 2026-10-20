/* DayZ Studio - left panel: asset browser, scene tree, quest hierarchy */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const B = (DS.Browser = {});
  let root, body, tab = 'assets', search = '';
  const open = new Set(['buildings', 'props']);

  B.init = function (container) {
    root = container;
    root.innerHTML = '';
    const tabs = el('div', { class: 'tabs' });
    [['assets', 'Assets'], ['loot', 'Loot'], ['zones', 'Zones'], ['game', 'Game'], ['scene', 'Scene'], ['quests', 'Quests']].forEach(([id, label]) =>
      tabs.append(el('button', { class: 'tab', 'data-tab': id, onclick: () => { tab = id; draw(); } }, label))
    );
    const q = el('input', { class: 'inp search', type: 'search', placeholder: 'Search…', oninput: (e) => { search = e.target.value.toLowerCase(); draw(); } });
    body = el('div', { class: 'pane-scroll' });
    root.append(tabs, q, body);
    ['structure', 'selection', 'tool', 'asset', 'loot', 'zones', 'game', 'terrain3d', 'classes', 'stamps'].forEach((ev) => S.on(ev, draw));
    S.on('changed', U.debounce(draw, 250));
    draw();
  };

  B.show = function (t) { tab = t; draw(); };

  function draw() {
    if (!body) return;
    root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    const st = body.scrollTop;
    body.innerHTML = '';
    if (tab === 'assets') drawAssets();
    else if (tab === 'loot') DS.Loot.panel(body, search, draw);
    else if (tab === 'zones') DS.Zones.panel(body, search, draw);
    else if (tab === 'game') DS.Game.panel(body, search, draw);
    else if (tab === 'scene') drawScene();
    else drawQuests();
    body.scrollTop = st;
  }

  function useAsset(a) {
    if (S.view !== 'view3d') S.setView('map');
    S.select(null, []);
    S.setAsset(a);
    DS.toast(`Placing ${a.label || a.c} — click the ${S.view === 'view3d' ? 'terrain' : 'map'}. Q/E rotate, Esc to stop.`, 'info', 2500);
  }

  function drawAssets() {
    // custom class box
    const inp = el('input', { class: 'inp', type: 'text', placeholder: 'Any classname, e.g. Land_Wall_Gate_Fen', list: 'dz-classes' });
    const kind = el('select', { class: 'inp' });
    Object.keys(DS.KINDS).forEach((k) => kind.append(el('option', { value: k }, DS.KINDS[k].name)));
    body.append(el('div', { class: 'custom-box' },
      el('div', { class: 'mini-title' }, 'Custom class'),
      inp, kind,
      el('button', { class: 'btn sm', onclick: () => { if (inp.value.trim()) useAsset({ c: inp.value.trim(), kind: kind.value, label: inp.value.trim() }); } }, 'Place this class')));

    // your own prefab stamps (library shared by every project)
    const mine = (DS.Stamps ? DS.Stamps.list : []).filter((p) => !search || p.name.toLowerCase().includes(search));
    if (mine.length || !search)
      body.append(group('stamps', 'My prefab stamps', mine.length, mine.length ? mine.map((p) =>
        el('div', { class: 'asset' + (S.asset && S.asset.prefab && S.asset.prefab.id === p.id ? ' active' : ''), title: 'Click, then click the map to stamp it (R / wheel rotates). In 3D, the brushes paint it.', onclick: () => useAsset({ c: p.name, kind: 'prop', label: p.name, prefab: p }) },
          el('span', { class: 'dot', style: { background: '#f59e0b' } }), el('span', { class: 'asset-name' }, p.name), el('span', { class: 'asset-sub' }, p.parts.length + ' parts'),
          el('button', { class: 'btn icon', title: 'Delete this stamp from your library', onclick: (e) => { e.stopPropagation(); DS.Stamps.remove(p.id); } }, '✕'))) :
        [el('div', { class: 'hint-box' }, 'Select a group of placed objects and use “⭐ Save as prefab stamp…” to make your own reusable layouts.')]));

    // placed effects: sounds, particles, lights (played by the quest mod)
    const fx = DS.FX_PRESETS.filter((p) => !search || p.name.toLowerCase().includes(search) || 'effect sound particle light'.includes(search));
    if (fx.length)
      body.append(group('fx', 'Effects & sounds', fx.length, fx.map((p) =>
        el('div', { class: 'asset' + (S.asset && S.asset.kind === 'fx' && S.asset.label === p.name ? ' active' : ''), title: 'Click, then click the map to place it. Edit the sound, particles and light in the inspector.', onclick: () => useAsset({ c: 'DZS_Effect', kind: 'fx', label: p.name, fx: p.fx }) },
          el('span', { class: 'dot', style: { background: DS.KINDS.fx.color } }), el('span', { class: 'asset-name' }, p.name), el('span', { class: 'asset-sub' }, 'effect')))));

    // prefabs
    const pf = DS.PREFABS.filter((p) => !search || p.name.toLowerCase().includes(search));
    if (pf.length)
      body.append(group('prefabs', 'Prefabs (grouped sets)', pf.length, pf.map((p) =>
        el('div', { class: 'asset' + (S.asset && S.asset.prefab === p ? ' active' : ''), title: p.desc, onclick: () => useAsset({ c: p.name, kind: 'prop', label: p.name, prefab: p }) },
          el('span', { class: 'dot', style: { background: '#facc15' } }), el('span', { class: 'asset-name' }, p.name), el('span', { class: 'asset-sub' }, p.parts.length + ' parts')))));

    DS.CATALOG.forEach((cat) => {
      const items = cat.items.filter((i) => !search || i[0].toLowerCase().includes(search) || i[1].toLowerCase().includes(search));
      if (!items.length) return;
      body.append(group(cat.id, cat.name, items.length, items.map((i) => assetRow(i[0], i[1], cat.kind))));
    });
    // the game's full class list (captured from the running game): searchable, grouped by kind + model folder
    if (DS.Classes && DS.Classes.state === 'ok') {
      const total = DS.Classes.list.length;
      if (search) {
        const hit = DS.Classes.list.filter((e) => e.c.toLowerCase().includes(search) || e.grp.includes(search));
        const by = new Map();
        hit.slice(0, 600).forEach((e) => { if (!by.has(e.kind)) by.set(e.kind, []); by.get(e.kind).push(e); });
        by.forEach((arr, k) => body.append(group('cl_s_' + k, 'Game classes · ' + DS.KINDS[k].name, arr.length + (hit.length > 600 ? '+' : ''), arr.map((e) => assetRow(e.c, e.c, e.kind)))));
      } else {
        body.append(el('div', { class: 'mini-title' }, `Game class library (${total}) — expand a group or search`));
        DS.Classes.groups.forEach((g) => body.append(group(g.id, g.title, g.items.length, g.items.slice(0, 500).map((e) => assetRow(e.c, e.c, e.kind)))));
      }
    } else if (DS.Classes && DS.Classes.state === 'none' && !search) {
      body.append(el('div', { class: 'hint-box' }, 'Game ▸ "Capture class list" adds every class in the game to this panel.'));
    }
    // imported
    const imp = DS.imported.items.filter((c) => !search || c.toLowerCase().includes(search)).slice(0, 400);
    if (imp.length) body.append(group('imp_items', 'Imported items (types.xml)', DS.imported.items.length, imp.map((c) => assetRow(c, c, 'item'))));
    const impB = DS.imported.buildings.filter((c) => !search || c.toLowerCase().includes(search)).slice(0, 400);
    if (impB.length) body.append(group('imp_b', 'Imported buildings (mapgroupproto)', DS.imported.buildings.length, impB.map((c) => assetRow(c, c, 'building'))));
    if (!DS.imported.items.length && !search)
      body.append(el('div', { class: 'hint-box' }, 'Tip: use File ▸ Import ▸ types.xml / mapgroupproto.xml from your server mission to load your exact class names here.'));
  }
  function assetRow(c, label, kind) {
    const K = DS.KINDS[kind];
    const active = S.asset && !S.asset.prefab && S.asset.c === c && S.tool === 'place';
    return el('div', { class: 'asset' + (active ? ' active' : ''), title: c, onclick: () => useAsset({ c, kind, label }) },
      el('span', { class: 'dot', style: { background: K.color } }), el('span', { class: 'asset-name' }, label), el('span', { class: 'asset-sub' }, label !== c ? c : ''));
  }
  function group(id, title, count, children) {
    const isOpen = open.has(id) || !!search;
    const g = el('div', { class: 'grp' },
      el('div', { class: 'grp-head', onclick: () => { open.has(id) ? open.delete(id) : open.add(id); draw(); } }, el('span', { class: 'caret' }, isOpen ? '▾' : '▸'), title, el('span', { class: 'count' }, count)));
    if (isOpen) g.append(el('div', { class: 'grp-body' }, children));
    return g;
  }

  function drawScene() {
    const objs = S.project.objects.filter((o) => !search || o.c.toLowerCase().includes(search) || (o.label || '').toLowerCase().includes(search));
    body.append(el('div', { class: 'mini-title' }, `${S.project.objects.length} objects in scene`));
    if (!objs.length) {
      body.append(el('div', { class: 'hint-box' }, 'Nothing here yet. Pick something from the Assets tab and click on the map to place it.'));
      return;
    }
    Object.keys(DS.KINDS).forEach((k) => {
      const list = objs.filter((o) => o.kind === k);
      if (!list.length) return;
      body.append(group('sc_' + k, DS.KINDS[k].name, list.length, list.slice(0, 300).map((o) =>
        el('div', { class: 'asset' + (S.isSel('object', o.id) ? ' active' : '') + (o.hidden ? ' dim' : ''),
          onclick: (e) => { S.setView('map'); S.select('object', e.shiftKey && S.sel.kind === 'object' ? [...S.sel.ids, o.id] : [o.id]); DS.MapView.centerOn(o.x, o.z, 0.5); } },
          el('span', { class: 'dot', style: { background: DS.KINDS[k].color } }),
          el('span', { class: 'asset-name' }, o.label || U.pretty(o.c)),
          el('span', { class: 'asset-sub' }, `${Math.round(o.x)}, ${Math.round(o.z)}`),
          el('button', { class: 'btn icon', title: o.hidden ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); o.hidden = !o.hidden; S.changed('objects'); S.commit(); draw(); } }, o.hidden ? '○' : '●')))));
    });
  }

  function drawQuests() {
    body.append(el('div', { class: 'btn-row pad' },
      el('button', { class: 'btn sm primary', onclick: () => { S.setView('quests'); S.newQuest(); S.commit(); } }, '+ New quest'),
      el('button', { class: 'btn sm', onclick: () => DS.app.templates() }, 'Templates…'),
      el('button', { class: 'btn sm', title: 'XP, reputation, skills - item requirements - HUD and character sheet', onclick: () => DS.Stats.open() }, '📊 Player stats'),
      el('button', { class: 'btn sm', title: 'Your own node blocks made from Enforce Script', onclick: () => DS.CustomNodes.manager() }, '🧩 Custom nodes'),
      el('button', { class: 'btn sm', title: 'Live script.log of the local test server, errors explained', onclick: () => DS.Console.open() }, '⌨ Console')));
    if (!S.project.quests.length)
      body.append(el('div', { class: 'hint-box' }, 'Quests are built from nodes: a Trigger starts it, Objectives are the tasks, Rewards pay out. Create a quest or start from a template.'));
    S.project.quests.forEach((q) => {
      const act = q.id === S.activeQuest;
      const head = el('div', { class: 'grp-head q' + (act ? ' active' : ''), onclick: () => { S.activeQuest = q.id; S.select(null, []); S.setView('quests'); S.structure(); } },
        el('span', { class: 'caret' }, act ? '▾' : '▸'), q.name || '(unnamed)', el('span', { class: 'count' }, q.nodes.length));
      const g = el('div', { class: 'grp' }, head);
      if (act) {
        const kids = el('div', { class: 'grp-body' });
        Object.keys(DS.NODE_CATS).forEach((cat) => {
          const ns = q.nodes.filter((n) => DS.NODE_TYPES[n.type] && DS.NODE_TYPES[n.type].cat === cat && (!search || DS.NODE_TYPES[n.type].title.toLowerCase().includes(search)));
          if (!ns.length) return;
          kids.append(el('div', { class: 'mini-title', style: { color: DS.NODE_CATS[cat].color } }, DS.NODE_CATS[cat].name));
          ns.forEach((n) => {
            const T = DS.NODE_TYPES[n.type];
            kids.append(el('div', { class: 'asset' + (S.isSel('node', n.id) ? ' active' : ''), onclick: () => { S.setView('quests'); S.select('node', [n.id]); } },
              el('span', { class: 'ne-icon sm' }, T.icon), el('span', { class: 'asset-name' }, T.title), el('span', { class: 'asset-sub' }, T.sum ? T.sum(n.p).slice(0, 26) : '')));
          });
        });
        g.append(kids);
      }
      body.append(g);
    });
    // palette
    body.append(el('div', { class: 'mini-title pad' }, 'Add node'));
    Object.keys(DS.NODE_CATS).forEach((cat) => {
      const row = el('div', { class: 'palette' });
      Object.keys(DS.NODE_TYPES).filter((t) => DS.NODE_TYPES[t].cat === cat).forEach((t) => {
        const T = DS.NODE_TYPES[t];
        row.append(el('button', { class: 'pal-btn cat-' + cat, title: T.desc, onclick: () => { S.setView('quests'); DS.NodeEditor.addNode(t, 60 + Math.random() * 40, 60 + Math.random() * 40); } }, el('span', { class: 'ne-icon sm' }, T.icon), T.title));
      });
      body.append(el('div', { class: 'mini-title', style: { color: DS.NODE_CATS[cat].color } }, DS.NODE_CATS[cat].name), row);
    });
  }
})();
