/* DayZ Studio - docking workspace (v2): every tool is a panel that can be docked anywhere, tabbed with others,
   split side by side, minimized, maximized or moved into a window of its own - e.g. on a second monitor. A floating
   window is a docking area like the main window (tabs, splits); drag a tab onto the desktop to open a new one, onto
   another window to dock it there. js/workspace.js keeps the named layouts, presets and the ▦ menu on top of this.

   Layout tree: split { t: 's', dir: 'row' | 'col', kids: [...] }  /  group { t: 't', id, panels: [...], active }.
   Every node has size (px along its parent's direction) and grow (true: takes the space that is left).
   A root-level node can be min (collapsed to a slim strip). Panels: D.register(id, { title, icon, kind: 'view' |
   'tool', home: 'left' | 'right' | 'center' | 'bottom', float, make() -> element, onShow, onHide, onClose }).
   Layout: { root, floating: [{ key, x, y, w, h, root }] } - the main window's tree and one per floating window
   (screen position and size of the window).
   Panel elements are made once and moved between containers - and windows: a floating window is opened by this
   page (window.open), so the panels in it keep running here, with the same project - so canvases, listeners and
   scroll positions survive. Code that listens on its window or animates uses U.onWin / U.loop (js/util.js). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const D = (DS.Dock = {});
  const P = {};             // panel definitions
  let L = null;             // { root, floating: [{ key, x, y, w, h, root }] }
  let ws = null;            // #workspace
  let maxGroup = null;      // id of a maximized group (not saved)
  let shown = new Set();
  let started = false;
  let gid = 0;
  const wins = {};          // floating window key -> { w, box }
  let unloading = false;
  let onChange = () => {};
  const host = window.studioHost;

  const SIDE = { left: 280, right: 330, bottom: 230, top: 230 };
  const MIN_PX = 140, MINI = 28, GROW_MIN = 220;
  const elOf = new WeakMap();   // tree node -> its element in the current render

  D.register = (id, def) => { P[id] = Object.assign({ id, kind: 'tool', home: 'left', float: true }, def); };
  D.panels = () => Object.values(P);
  D.def = (id) => P[id];
  D.onChange = (fn) => { onChange = fn; };

  /* ---------------------------------------------------------------- tree helpers */
  const group = (panels, active) => ({ t: 't', id: 'g' + ++gid, panels: panels.slice(), active: active || panels[0], size: 0, grow: false });
  const split = (dir, kids) => ({ t: 's', dir, kids, size: 0, grow: true });
  D.group = group;
  D.split = split;

  function walk(n, fn, parent, idx, hidden) {
    fn(n, parent || null, idx === undefined ? -1 : idx, !!hidden);
    if (n.t === 's') n.kids.forEach((k, i) => walk(k, fn, n, i, hidden || n.min));
  }
  // the docking areas: the main window (holder L) and every floating window (holder = its entry in L.floating)
  const MAIN = { key: 'main' };
  function areas() {
    if (!L) return [];
    return [{ key: 'main', holder: L }].concat(L.floating.map((f) => ({ key: f.key, holder: f })));
  }
  function find(pred, onlyKey) {
    let r = null;
    areas().forEach((a) => {
      if (r || !a.holder.root || (onlyKey && a.key !== onlyKey)) return;
      walk(a.holder.root, (n, p, i, h) => { if (!r && pred(n)) r = { n, p, i, h, a }; });
    });
    return r;
  }
  const groupOf = (id) => find((n) => n.t === 't' && n.panels.includes(id));
  const groupById = (g) => find((n) => n.t === 't' && n.id === g);
  const parentOf = (node) => find((n) => n === node) || { p: null, i: -1, a: { key: 'main', holder: L } };
  const hasView = (n) => { let v = false; walk(n, (x) => { if (x.t === 't' && x.panels.some((id) => P[id] && P[id].kind === 'view')) v = true; }); return v; };
  const areaOf = (id) => { const g = groupOf(id); return g ? g.a.key : null; };
  const viewsIn = (key) => Object.values(P).filter((p) => p.kind === 'view' && areaOf(p.id) === key).length;
  D.isOpen = (id) => !!groupOf(id);
  /** 'main', a floating window's key, or null (closed) */
  D.areaOf = areaOf;

  /** drop empty groups, unwrap one-child splits, make sure every split has a growing child */
  function prune(n) {
    if (n.t === 't') { n.panels = n.panels.filter((id, i, a) => P[id] && a.indexOf(id) === i); if (!n.panels.includes(n.active)) n.active = n.panels[0]; return n.panels.length ? n : null; }
    n.kids = n.kids.map(prune).filter(Boolean);
    // a split inside a split of the same direction: its children belong to the outer one
    n.kids = n.kids.flatMap((k) => (k.t === 's' && k.dir === n.dir && !k.min ? k.kids.map((c) => (k.grow ? c : Object.assign(c, { grow: false }))) : [k]));
    if (!n.kids.length) return null;
    if (n.kids.length === 1) { const k = n.kids[0]; k.size = n.size; k.grow = n.grow; if (n.min) k.min = true; return k; }
    if (!n.kids.some((k) => k.grow)) (n.kids.find(hasView) || n.kids.reduce((a, b) => ((b.size || 0) > (a.size || 0) ? b : a))).grow = true;
    return n;
  }
  function tidy() {
    L.root = L.root && prune(L.root);
    L.floating.forEach((f) => { f.root = f.root && prune(f.root); });
    // at least one view in the main window, so its middle is never empty (taken from a floating window if need be)
    if (!viewsIn('main')) {
      const v = homeView();
      removeFromTree(v);
      if (L.root) insertHome(v); else L.root = group([v]);
      L.root = prune(L.root);
      L.floating.forEach((f) => { f.root = f.root && prune(f.root); });
    }
    if (L.root.t === 's') L.root.grow = true;
    L.root.min = false;
    // floating windows without panels close
    L.floating = L.floating.filter((f) => {
      if (f.root) { if (f.root.t === 's') f.root.grow = true; f.root.min = false; return true; }
      closeWin(f.key);
      return false;
    });
  }
  /** a view for the main window: one that is closed, else the map (taken from its floating window) */
  function homeView() {
    const closed = Object.values(P).find((p) => p.kind === 'view' && !groupOf(p.id));
    return closed ? closed.id : 'map';
  }

  function removeFromTree(id) {
    const g = groupOf(id);
    if (!g) return null;
    const at = g.n.panels.indexOf(id);
    g.n.panels.splice(at, 1);
    if (g.n.active === id) g.n.active = g.n.panels[Math.max(0, at - 1)];
    return g.n;
  }

  /** put a new group with panel id beside node (left / right / top / bottom) - in node's own window */
  function dockBeside(node, side, id) {
    const dir = side === 'left' || side === 'right' ? 'row' : 'col';
    const before = side === 'left' || side === 'top';
    const G = group([id]);
    // as wide (tall) as usual, but at most half of what it is docked beside
    const r = elOf.get(node) && elOf.get(node).getBoundingClientRect();
    const room = r ? (dir === 'row' ? r.width : r.height) : 0;
    G.size = Math.round(room ? Math.max(MIN_PX, Math.min(SIDE[side], room / 2)) : SIDE[side]);
    const pr = parentOf(node);
    const hold = pr.a.holder;
    if (node === hold.root && node.t === 's' && node.dir === dir) node.kids.splice(before ? 0 : node.kids.length, 0, G);   // a window edge
    else if (pr.p && pr.p.dir === dir) pr.p.kids.splice(pr.i + (before ? 0 : 1), 0, G);
    else {
      const wrap = split(dir, before ? [G, node] : [node, G]);
      wrap.size = node.size; wrap.grow = node.grow; wrap.min = node.min;
      node.min = false; node.size = 0; node.grow = true;
      if (pr.p) pr.p.kids[pr.i] = wrap; else hold.root = wrap;
    }
    return G;
  }

  /** open a closed panel in the main window where it belongs: next to panels with the same home, else on that side */
  function insertHome(id) {
    const home = (P[id] && P[id].home) || 'left';
    const mate = find((n) => n.t === 't' && n.panels.some((x) => P[x] && P[x].home === home), 'main');
    if (mate) { mate.n.panels.push(id); mate.n.active = id; mate.n.min = false; return mate.n; }
    if (!L.root) { L.root = group([id]); return L.root; }
    if (home === 'center') { const v = find((n) => n.t === 't' && n.panels.some((x) => P[x] && P[x].kind === 'view'), 'main'); if (v) { v.n.panels.push(id); v.n.active = id; return v.n; } }
    if (home === 'bottom') {   // under the views
      const v = find((n) => n.t === 't' && n.panels.some((x) => P[x] && P[x].kind === 'view'), 'main');
      if (v) return dockBeside(v.n, 'bottom', id);
    }
    return dockBeside(L.root, home === 'center' ? 'right' : home, id);
  }

  /* ---------------------------------------------------------------- public actions */
  D.open = function (id) {
    if (!P[id]) return;
    const g = groupOf(id);
    if (g) {
      g.n.active = id; g.n.min = false;
      walk(g.a.holder.root, (n) => { if (n.t === 's' && n.min && n !== g.a.holder.root) { let inside = false; walk(n, (x) => { if (x === g.n) inside = true; }); if (inside) n.min = false; } });
      if (maxGroup && maxGroup !== g.n.id) maxGroup = null;
      if (g.a.key !== 'main' && wins[g.a.key]) { try { wins[g.a.key].w.focus(); } catch (e) { /* gone */ } }
    } else insertHome(id);
    commit();
  };
  D.close = function (id) {
    if (!P[id]) return;
    if (P[id].kind === 'view' && Object.values(P).filter((p) => p.kind === 'view' && D.isOpen(p.id)).length <= 1) { DS.toast('Keep at least one view open (Map, Game, 3D, Quests or NPCs)', 'warn', 2500); return; }
    removeFromTree(id);
    if (P[id].onClose) P[id].onClose();
    commit();
  };
  D.toggle = (id) => (D.isOpen(id) ? D.close(id) : D.open(id));
  D.shown = (id) => shown.has(id);

  /** collapse / expand the outermost area on one side of the main window (Ctrl+B, Ctrl+Alt+B) */
  D.toggleSide = function (side) {
    const r = L.root;
    if (r.t !== 's' || r.dir !== 'row') return;
    const k = side === 'left' ? r.kids[0] : r.kids[r.kids.length - 1];
    if (!k || k.grow) return;
    k.min = !k.min;
    commit();
  };
  D.toggleMax = function (gidOrNull) {
    const g = gidOrNull || (groupOf(S.view) || {}).n;
    const id = typeof g === 'string' ? g : g && g.id;
    maxGroup = maxGroup === id ? null : id || null;
    render();
  };

  /* ---------------------------------------------------------------- state */
  D.state = () => JSON.parse(JSON.stringify({ root: L.root, floating: L.floating.map((f) => ({ key: f.key, x: f.x, y: f.y, w: f.w, h: f.h, root: f.root })) }));
  D.setState = function (st) {
    const s = JSON.parse(JSON.stringify(st || {}));
    if (!s.root) return false;
    // a floating window of older layouts held one panel: { id, x, y, w, h }
    const floating = (s.floating || []).map((f) => (f.root ? f : { key: newKey(), x: f.x, y: f.y, w: f.w, h: f.h, root: f.id ? group([f.id]) : null }))
      .filter((f) => f.root);
    const docked = new Set();
    const clean = (root) => walk(root, (n) => { if (n.t === 't') { n.id = 'g' + ++gid; n.panels = n.panels.filter((id) => P[id] && !docked.has(id) && docked.add(id)); } });
    clean(s.root);
    floating.forEach((f) => { f.key = f.key || newKey(); clean(f.root); });
    L = { root: s.root, floating };
    maxGroup = null;
    tidy();
    return true;
  };
  let keyN = 0;
  function newKey() { return 'w' + Date.now().toString(36) + (++keyN); }

  function commit() {
    tidy();
    render();
    onChange(D.state());
  }

  /* ---------------------------------------------------------------- rendering */
  function panelEl(id) {
    const p = P[id];
    if (!p.el) {
      p.el = p.make();
      p.el.classList.add('dk-panel');
      p.el.dataset.panel = id;
    }
    return p.el;
  }

  function sizeStyle(e, n, parentDir) {
    if (n.min) { e.style.flex = `0 0 ${MINI}px`; return; }
    if (n.grow) { e.style.flex = '1 1 0'; e.style[parentDir === 'row' ? 'minWidth' : 'minHeight'] = GROW_MIN + 'px'; return; }
    e.style.flex = `0 1 ${Math.max(MIN_PX, n.size || SIDE.left)}px`;
    e.style[parentDir === 'row' ? 'minWidth' : 'minHeight'] = Math.min(MIN_PX, n.size || MIN_PX) + 'px';
  }

  function build(n, parentDir, key) {
    let e;
    if (n.min) e = buildMini(n, parentDir);
    else if (n.t === 's') {
      e = el('div', { class: 'dk-split dk-' + n.dir });
      n.kids.forEach((k, i) => {
        if (i) e.append(sash(n, i, key));
        e.append(build(k, n.dir, key));
      });
    } else e = buildGroup(n, key);
    if (parentDir) sizeStyle(e, n, parentDir);
    else e.style.flex = '1 1 0';
    e._node = n;
    elOf.set(n, e);
    return e;
  }

  function title(id) { const p = P[id]; return (p.icon ? p.icon + ' ' : '') + p.title; }

  function buildGroup(n, key) {
    const tabs = el('div', { class: 'dk-tabs' });
    n.panels.forEach((id) => {
      const p = P[id];
      const t = el('div', { class: 'dk-tab' + (id === n.active ? ' active' : ''), title: p.title + '  •  drag to dock it somewhere else - or out of the window, e.g. onto a second monitor; right-click for more' },
        el('span', null, title(id)),
        el('span', { class: 'dk-x', title: 'Close', onpointerdown: (ev) => ev.stopPropagation(), onclick: (ev) => { ev.stopPropagation(); D.close(id); } }, '✕'));
      t.addEventListener('pointerdown', (ev) => tabDown(ev, n, id, t));
      t.addEventListener('auxclick', (ev) => { if (ev.button === 1) D.close(id); });
      t.addEventListener('contextmenu', (ev) => { ev.preventDefault(); tabMenu(t, n, id, key); });
      tabs.append(t);
    });
    tabs.append(el('div', { class: 'dk-tabs-fill', ondblclick: () => D.toggleMax(n.id) }),
      el('button', { class: 'dk-btn', title: maxGroup === n.id ? 'Restore' : 'Maximize this area (Ctrl+Shift+F)', onclick: () => D.toggleMax(n.id) }, maxGroup === n.id ? '❐' : '□'),
      el('button', { class: 'dk-btn', title: 'More', onclick: (ev) => tabMenu(ev.currentTarget, n, n.active, key) }, '⋯'));
    const body = el('div', { class: 'dk-body' });
    n.panels.forEach((id) => {
      const pe = panelEl(id);
      pe.style.display = id === n.active ? '' : 'none';
      body.append(pe);
    });
    body.addEventListener('pointerdown', () => { const p = P[n.active]; if (p && p.kind === 'view' && S.view !== n.active) S.setView(n.active); }, true);
    const g = el('div', { class: 'dk-group' + (n.panels.includes(S.view) && n.active === S.view ? ' dk-focus' : '') }, tabs, body);
    return g;
  }

  function buildMini(n, parentDir) {
    const ids = [];
    walk(n, (x) => { if (x.t === 't') ids.push(...x.panels); });
    const e = el('div', { class: 'dk-mini dk-mini-' + (parentDir === 'col' ? 'h' : 'v'), title: 'Collapsed - click to open' },
      el('button', { class: 'dk-btn', title: 'Expand', onclick: () => { n.min = false; commit(); } }, parentDir === 'col' ? '▴' : '▸'),
      ...ids.map((id) => el('button', { class: 'dk-mini-btn', title: P[id].title, onclick: () => D.open(id) }, P[id].icon || P[id].title.slice(0, 2))));
    return e;
  }

  function sash(n, i, key) {
    const s = el('div', { class: 'dk-sash' });
    s.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      s.classList.add('active');
      const a = n.kids[i - 1], b = n.kids[i];
      const ea = s.previousElementSibling, eb = s.nextElementSibling;
      const horiz = n.dir === 'row';
      const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
      const sa = horiz ? ra.width : ra.height, sb = horiz ? rb.width : rb.height;
      const start = horiz ? e.clientX : e.clientY;
      const mv = (ev) => {
        const d = Math.round((horiz ? ev.clientX : ev.clientY) - start);
        const na = Math.round(U.clamp(sa + d, MIN_PX, sa + sb - MIN_PX)), nb = Math.round(sa + sb - na);
        if (!a.grow) { a.size = na; ea.style.flex = `0 1 ${na}px`; }
        if (!b.grow) { b.size = nb; eb.style.flex = `0 1 ${nb}px`; }
        if (a.grow && b.grow) { a.grow = false; a.size = na; ea.style.flex = `0 1 ${na}px`; }
      };
      const up = () => { s.classList.remove('active'); s.removeEventListener('pointermove', mv); s.removeEventListener('pointerup', up); onChange(D.state()); S.emit('layout'); };
      s.addEventListener('pointermove', mv);
      s.addEventListener('pointerup', up);
    });
    s.addEventListener('dblclick', () => {   // double-click: collapse the smaller neighbour at the main window's edge
      const k = !n.kids[i - 1].grow ? n.kids[i - 1] : n.kids[i];
      if (key === 'main' && n === L.root && (k === n.kids[0] || k === n.kids[n.kids.length - 1])) { k.min = true; commit(); }
    });
    return s;
  }

  /** the node an area shows: its tree, or a maximized group in it */
  function shownRoot(a) {
    const g = maxGroup && groupById(maxGroup);
    return g && g.a.key === a.key ? g.n : a.holder.root;
  }

  function render() {
    if (!ws) return;
    if (maxGroup && !groupById(maxGroup)) maxGroup = null;
    // keep panel elements alive while the containers are rebuilt
    Object.values(P).forEach((p) => { if (p.el && p.el.parentNode) p.el.remove(); });
    areas().forEach((a) => {
      const box = a.key === 'main' ? ws : wins[a.key] && !wins[a.key].w.closed ? wins[a.key].box : null;
      if (!box) return;
      const root = shownRoot(a);
      box.replaceChildren(build(root, null, a.key));
      box.classList.toggle('dk-maxed', root !== a.holder.root);
      if (a.key !== 'main') wins[a.key].w.document.title = winTitle(a.holder) + ' - DayZ Studio';
    });
    updateShown();
  }
  function winTitle(f) {
    const ids = [];
    walk(f.root, (n) => { if (n.t === 't') ids.push(...n.panels); });
    return ids.map((id) => P[id].title).join(', ');
  }

  function updateShown() {
    const now = new Set();
    areas().forEach((a) => {
      if (a.key !== 'main' && !(wins[a.key] && !wins[a.key].w.closed)) return;   // a window that is not open (yet)
      const g0 = maxGroup && groupById(maxGroup);
      if (g0 && g0.a.key === a.key) now.add(g0.n.active);
      else walk(a.holder.root, (n, p, i, hid) => { if (n.t === 't' && !n.min && !hid) now.add(n.active); });
    });
    const prev = shown;
    shown = now;
    if (!started) return;
    let changed = false;
    prev.forEach((id) => { if (!now.has(id)) { changed = true; if (P[id] && P[id].onHide) P[id].onHide(); } });
    now.forEach((id) => { if (!prev.has(id)) { changed = true; if (P[id] && P[id].onShow) P[id].onShow(); } });
    if (changed) S.emit('view');
    S.emit('layout');
  }

  /* ---------------------------------------------------------------- tab drag & dock (across windows) */
  let drag = null;
  // where the windows are on the screen, asked of the desktop app when a drag starts: [{ win, x, y, w, h, zoom }]
  // (content area, screen DIPs; win '' = main window, else the floating window's name)
  let bounds = null;
  function tabDown(e, n, id, tabEl) {
    if (e.button !== 0) return;
    const sw = U.winOf(tabEl);   // the window the drag starts in gets every pointer event until the button is up
    const sx = e.clientX, sy = e.clientY;
    bounds = null;
    if (host && host.windowBounds) host.windowBounds().then((b) => { bounds = b; }).catch(() => {});
    const mv = (ev) => {
      if (!drag && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!drag) {
        drag = { id, from: n, ghost: el('div', { class: 'dk-ghost' }, title(id)), over: el('div', { class: 'dk-drop hidden' }), target: null, out: null };
        sw.document.body.append(drag.ghost);
      }
      drag.ghost.style.left = ev.clientX + 12 + 'px';
      drag.ghost.style.top = ev.clientY + 8 + 'px';
      const at = locate(ev, sw);
      drag.target = at.area ? dropTarget(at.area, at.x, at.y) : null;
      drag.out = at.out ? { x: ev.screenX, y: ev.screenY } : null;
      drag.ghost.classList.toggle('dk-ghost-out', !!drag.out);
      drag.ghost.textContent = title(id) + (drag.out ? '  ⧉ new window' : '');
      showDrop(drag.target, at.area);
    };
    const end = () => {
      sw.removeEventListener('pointermove', mv, true);
      sw.removeEventListener('pointerup', up, true);
      sw.removeEventListener('keydown', esc, true);
    };
    const up = () => {
      end();
      if (!drag) { if (n.active !== id) { n.active = id; render(); onChange(D.state()); } if (P[id].kind === 'view') S.setView(id); return; }
      const d = drag;
      drag = null;
      d.ghost.remove(); d.over.remove();
      if (d.target) drop(d.id, d.from, d.target);
      else if (d.out) D.float(d.id, { x: d.out.x - 40, y: d.out.y - 16 });   // dropped onto the desktop: a window of its own
    };
    const esc = (ev) => { if (ev.key === 'Escape' && drag) { drag.ghost.remove(); drag.over.remove(); drag = null; end(); } };
    sw.addEventListener('pointermove', mv, true);
    sw.addEventListener('pointerup', up, true);
    sw.addEventListener('keydown', esc, true);
  }

  /** the window under the pointer: { area, x, y } (client coordinates of that window), { out: true } over no window
      of Studio, {} over a part of a window that takes no panel */
  function locate(ev, sw) {
    const inside = (w, x, y) => x >= 0 && y >= 0 && x < w.innerWidth && y < w.innerHeight;
    const srcKey = keyOfWin(sw);
    if (inside(sw, ev.clientX, ev.clientY)) return { area: srcKey, x: ev.clientX, y: ev.clientY };
    // the other windows, the one used last first (where windows overlap, it is the one on top)
    const others = zOrder().filter((k) => k !== srcKey);
    for (const k of others) {
      const w = k === 'main' ? window : wins[k].w;
      const c = contentRect(w, k);
      const x = (ev.screenX - c.x) / c.z, y = (ev.screenY - c.y) / c.z;
      if (inside(w, x, y)) return { area: k, x, y };
    }
    return { out: true };
  }
  /** where a window's page is on the screen (DIPs) and its zoom: from the desktop app, else estimated */
  function contentRect(w, k) {
    const name = k === 'main' ? '' : w.name;
    const b = bounds && bounds.find((x) => x.win === name);
    if (b) return { x: b.x, y: b.y, z: b.zoom || 1 };
    const z = 1;
    const side = Math.max(0, (w.outerWidth - w.innerWidth * z) / 2);
    return { x: w.screenX + side, y: w.screenY + Math.max(0, w.outerHeight - w.innerHeight * z - side), z };
  }
  // the windows by when they were last focused (most recent first): 'main' and floating window keys
  let recent = ['main'];
  const touch = (k) => { recent = [k].concat(recent.filter((x) => x !== k)); };
  window.addEventListener('focus', () => touch('main'));
  function zOrder() {
    const open = Object.keys(wins).filter((k) => wins[k] && !wins[k].w.closed);
    return recent.filter((k) => k === 'main' || open.includes(k)).concat(open.filter((k) => !recent.includes(k)));
  }
  function keyOfWin(w) {
    if (w === window) return 'main';
    return Object.keys(wins).find((k) => wins[k].w === w) || 'main';
  }

  /** what is under the pointer in window `key`: a window edge, or a group (its tab strip = add as a tab; body edges = split) */
  function dropTarget(key, x, y) {
    const a = areas().find((x2) => x2.key === key);
    const box = key === 'main' ? ws : wins[key] && wins[key].box;
    if (!a || !box) return null;
    const doc = box.ownerDocument;
    const wr = box.getBoundingClientRect();
    if (x < wr.left || x > wr.right || y < wr.top || y > wr.bottom) return null;
    const EDGE = 22;
    const root = a.holder.root;
    if (shownRoot(a) === root) {
      if (x - wr.left < EDGE) return { key, node: root, side: 'left', rect: { l: wr.left, t: wr.top, w: Math.min(SIDE.left, wr.width / 2), h: wr.height } };
      if (wr.right - x < EDGE) return { key, node: root, side: 'right', rect: { l: wr.right - Math.min(SIDE.right, wr.width / 2), t: wr.top, w: Math.min(SIDE.right, wr.width / 2), h: wr.height } };
      if (wr.bottom - y < EDGE) return { key, node: root, side: 'bottom', rect: { l: wr.left, t: wr.bottom - Math.min(SIDE.bottom, wr.height / 2), w: wr.width, h: Math.min(SIDE.bottom, wr.height / 2) } };
    }
    const hit = doc.elementFromPoint(x, y);
    const g = hit && hit.closest('.dk-group');
    if (!g || !g._node) return null;
    const r = g.getBoundingClientRect();
    const tabs = g.querySelector('.dk-tabs').getBoundingClientRect();
    if (y <= tabs.bottom) return { key, node: g._node, side: 'center', rect: { l: r.left, t: r.top, w: r.width, h: r.height } };
    const fx = (x - r.left) / r.width, fy = (y - tabs.bottom) / (r.bottom - tabs.bottom);
    const half = (side) => ({
      left: { l: r.left, t: r.top, w: r.width / 2, h: r.height }, right: { l: r.left + r.width / 2, t: r.top, w: r.width / 2, h: r.height },
      top: { l: r.left, t: r.top, w: r.width, h: r.height / 2 }, bottom: { l: r.left, t: r.top + r.height / 2, w: r.width, h: r.height / 2 },
    })[side];
    const side = fx < 0.25 ? 'left' : fx > 0.75 ? 'right' : fy < 0.25 ? 'top' : fy > 0.75 ? 'bottom' : 'center';
    return { key, node: g._node, side, rect: side === 'center' ? { l: r.left, t: r.top, w: r.width, h: r.height } : half(side) };
  }

  /** the drop preview, in the window the pointer is over */
  function showDrop(t, key) {
    const o = drag.over;
    if (!t) { o.classList.add('hidden'); return; }
    const box = key === 'main' ? ws : wins[key].box;
    if (o.ownerDocument !== box.ownerDocument || !o.parentNode) box.ownerDocument.body.append(o);
    o.classList.remove('hidden');
    Object.assign(o.style, { left: t.rect.l + 'px', top: t.rect.t + 'px', width: t.rect.w + 'px', height: t.rect.h + 'px' });
  }

  /** the main window keeps a view: false (and a note) when moving id out of it would take its last one */
  function mayLeaveMain(id, toKey) {
    if (toKey === 'main' || P[id].kind !== 'view' || areaOf(id) !== 'main' || viewsIn('main') > 1) return true;
    DS.toast('The main window keeps at least one view (Map, Game, 3D, Quests or NPCs) - move another one there first.', 'warn', 4000);
    return false;
  }

  function drop(id, from, t) {
    if (!mayLeaveMain(id, t.key)) return;
    if (t.side === 'center') {
      if (t.node === from) return;
      removeFromTree(id);
      t.node.panels.push(id);
      t.node.active = id;
    } else {
      if (t.node === from && from.panels.length === 1) return;   // its own only tab next to itself: nothing to do
      removeFromTree(id);
      dockBeside(t.node, t.side, id);
    }
    maxGroup = null;
    commit();
    if (t.key !== 'main' && wins[t.key]) { try { wins[t.key].w.focus(); } catch (e) { /* gone */ } }
    if (P[id].kind === 'view') S.setView(id);
  }

  function tabMenu(anchor, n, id, key) {
    const p = P[id];
    if (!p) return;
    const items = [{ head: p.title }];
    if (p.float && window.open) items.push({ label: '⧉ Move to a new window (e.g. a second monitor)', run: () => D.float(id) });
    if (key !== 'main') items.push({ label: '⇱ Back to the main window', run: () => D.dockBack(id) });
    items.push({ label: maxGroup === n.id ? '❐ Restore' : '□ Maximize this area', key: 'Ctrl+Shift+F', run: () => D.toggleMax(n.id) });
    const pr = parentOf(n);
    if (key === 'main' && pr.p === L.root && !n.grow) items.push({ label: '⇤ Collapse this area', run: () => { n.min = true; commit(); } });
    items.push({ label: '✕ Close ' + p.title, run: () => D.close(id) });
    DS.app.dropdown(anchor, items);
  }

  /* ---------------------------------------------------------------- floating windows */
  /** move a panel into a new window of its own, at place {x, y[, w, h]} (screen) or next to the main window. The
      panel keeps running in this page (same scripts, same project), so it updates live; dialogs it opens still
      show in the main window. */
  D.float = function (id, place) {
    const p = P[id];
    if (!p || !p.float || !mayLeaveMain(id, 'new')) return;
    const view = p.kind === 'view';
    const pl = place || {};
    const f = { key: newKey(), x: pl.x != null ? pl.x : window.screenX + 80, y: pl.y != null ? pl.y : window.screenY + 80,
      w: pl.w || (view ? 960 : 420), h: pl.h || (view ? 680 : Math.min(720, window.outerHeight - 120)), root: group([id]) };
    const g = groupOf(id);
    const was = g ? { n: g.n, at: g.n.panels.indexOf(id) } : null;
    removeFromTree(id);
    L.floating.push(f);
    if (!openWin(f)) {   // blocked: put it back
      L.floating = L.floating.filter((x) => x !== f);
      if (was && groupById(was.n.id)) was.n.panels.splice(was.at, 0, id); else insertHome(id);
    }
    commit();
    if (view) S.setView(id);
  };
  /** a panel in a floating window back into the main window */
  D.dockBack = function (id) {
    if (!P[id] || areaOf(id) === 'main') return;
    removeFromTree(id);
    insertHome(id);
    commit();
  };
  /** the floating windows: [{ key, title, panels }] (for menus) */
  D.windows = () => L.floating.map((f) => { const ids = []; walk(f.root, (n) => { if (n.t === 't') ids.push(...n.panels); }); return { key: f.key, title: winTitle(f), panels: ids }; });
  /** bring a floating window to the front */
  D.focusWindow = (key) => { const W = wins[key]; if (W && !W.w.closed) W.w.focus(); };

  /** open (or reopen) the window of a floating area; false when the browser blocked it */
  function openWin(f) {
    const old = wins[f.key];
    if (old && !old.w.closed) return true;
    const w = window.open('', 'dzs-float-' + f.key, `popup=yes,width=${Math.round(f.w)},height=${Math.round(f.h)},left=${Math.round(f.x)},top=${Math.round(f.y)}`);
    if (!w) { DS.toast('The window was blocked - allow pop-ups for DayZ Studio to move panels into their own window', 'warn', 4000); return false; }
    const doc = w.document;
    doc.title = 'DayZ Studio';
    doc.documentElement.className = document.documentElement.className;
    doc.documentElement.style.cssText = document.documentElement.style.cssText;   // theme variables, interface size
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((s) => {
      if (s.tagName === 'LINK') doc.head.append(Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: s.href }));
      else doc.head.append(doc.importNode(s, true));
    });
    doc.body.className = 'dk-float-body';
    const box = doc.createElement('div');
    box.className = 'dk-float-ws';
    doc.body.append(box);
    wins[f.key] = { w, box };
    U.addWindow(w);
    touch(f.key);   // a new window opens on top
    w.addEventListener('focus', () => touch(f.key));
    // hotkeys pressed in the floating window work as in the main window (unless typing); key-ups too, so keys
    // held for flying the 3D camera are let go
    ['keydown', 'keyup'].forEach((type) => w.addEventListener(type, (ev) => {
      const t = ev.target;
      if (type === 'keydown' && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      window.dispatchEvent(new KeyboardEvent(type, { key: ev.key, code: ev.code, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey, bubbles: true, cancelable: true }));
    }));
    const born = Date.now();
    const remember = () => {
      // a new window reports the main window's place for a moment before it moves to its own: not that
      if (w.closed || !L.floating.includes(f) || Date.now() - born < 2500) return;
      const now = { x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight };
      if (now.x !== f.x || now.y !== f.y || now.w !== f.w || now.h !== f.h) { Object.assign(f, now); onChange(D.state()); }
    };
    const rememberSoon = U.debounce(remember, 400);
    w.addEventListener('resize', () => { S.emit('layout'); rememberSoon(); });
    const track = setInterval(() => { if (w.closed) clearInterval(track); else remember(); }, 2000);
    w.addEventListener('pagehide', () => {
      clearInterval(track);
      if (wins[f.key] && wins[f.key].w === w) delete wins[f.key];
      if (unloading || !L.floating.includes(f)) return;   // Studio closing / reloading, or closed by the layout itself
      // the user closed the window: its panels go back into the main window
      const ids = [];
      walk(f.root, (n) => { if (n.t === 't') ids.push(...n.panels); });
      L.floating = L.floating.filter((x) => x !== f);
      ids.forEach((id) => insertHome(id));
      setTimeout(commit, 0);
    });
    return true;
  }
  function closeWin(key) {
    const W = wins[key];
    delete wins[key];
    if (W && !W.w.closed) { try { W.w.close(); } catch (e) { /* gone */ } }
  }

  /* ---------------------------------------------------------------- start */
  D.init = function (container, st) {
    ws = container;
    if (!D.setState(st)) return false;
    render();
    D.ready = true;
    window.addEventListener('beforeunload', () => { unloading = true; });
    // leaving the page (reload, close): floating windows go with it; the layout keeps them for next time
    window.addEventListener('pagehide', () => { unloading = true; Object.keys(wins).forEach(closeWin); });
    // the focused view (keyboard shortcuts act on it) is always visible
    S.on('view', () => { if (P[S.view] && P[S.view].kind === 'view' && !shown.has(S.view)) D.open(S.view); else markFocus(); });
    return true;
  };
  /** after every module is ready: tell the visible panels they are shown, reopen the floating windows (desktop app -
      a browser only opens windows on a click, so there their panels come back into the main window) */
  D.start = function () {
    started = true;
    shown.forEach((id) => { if (P[id] && P[id].onShow) P[id].onShow(); });
    reopenFloating(!!(host && host.isDesktop));
    commit();
    S.emit('view');
  };
  function reopenFloating(open) {
    L.floating.slice().forEach((f) => {
      if (open && openWin(f)) return;
      const ids = [];
      walk(f.root, (n) => { if (n.t === 't') ids.push(...n.panels); });
      L.floating = L.floating.filter((x) => x !== f);
      ids.forEach((id) => insertHome(id));
    });
  }
  D.applyState = function (st) {
    Object.keys(wins).forEach(closeWin);
    D.setState(st);
    reopenFloating(true);   // chosen from a menu: a click, so a browser lets the windows open too
    commit();
  };

  function markFocus() {
    if (!ws) return;
    const boxes = [ws].concat(Object.values(wins).map((W) => W.box));
    boxes.forEach((b) => b.querySelectorAll('.dk-group').forEach((g) => g.classList.toggle('dk-focus', !!(g._node && g._node.active === S.view && P[S.view] && P[S.view].kind === 'view'))));
  }
})();
