/* DayZ Studio - docking workspace (v2): every tool is a panel that can be docked anywhere, tabbed with others,
   split side by side, minimized, maximized or (for the non-view panels) floated into its own window - e.g. on a
   second monitor. js/workspace.js keeps the named layouts, presets and the ▦ menu on top of this.

   Layout tree: split { t: 's', dir: 'row' | 'col', kids: [...] }  /  group { t: 't', id, panels: [...], active }.
   Every node has size (px along its parent's direction) and grow (true: takes the space that is left).
   A root-level node can be min (collapsed to a slim strip). Panels: D.register(id, { title, icon, kind: 'view' |
   'tool', home: 'left' | 'right' | 'center' | 'bottom', float, make() -> element, onShow, onHide, onClose }).
   Panel elements are made once and moved between containers, so canvases, listeners and scroll positions survive. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const D = (DS.Dock = {});
  const P = {};             // panel definitions
  let L = null;             // { root, floating: [{ id, x, y, w, h }] }
  let ws = null;            // #workspace
  let maxGroup = null;      // id of a maximized group (not saved)
  let shown = new Set();
  let started = false;
  let gid = 0;
  const popups = {};        // floating panel id -> window
  let unloading = false;
  let onChange = () => {};

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
  function find(pred) { let r = null; if (L && L.root) walk(L.root, (n, p, i, h) => { if (!r && pred(n)) r = { n, p, i, h }; }); return r; }
  const groupOf = (id) => find((n) => n.t === 't' && n.panels.includes(id));
  const groupById = (g) => find((n) => n.t === 't' && n.id === g);
  const parentOf = (node) => find((n) => n === node) || { p: null, i: -1 };
  const hasView = (n) => { let v = false; walk(n, (x) => { if (x.t === 't' && x.panels.some((id) => P[id] && P[id].kind === 'view')) v = true; }); return v; };
  D.isOpen = (id) => !!groupOf(id) || !!(L && L.floating.find((f) => f.id === id));

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
    L.root = prune(L.root) || group(['map']);
    if (L.root.t === 's') L.root.grow = true;
    L.root.min = false;
    // at least one view, so the middle of the window is never empty
    if (!Object.values(P).some((p) => p.kind === 'view' && groupOf(p.id))) insertHome('map');
  }

  function removeFromTree(id) {
    const g = groupOf(id);
    if (!g) return null;
    const at = g.n.panels.indexOf(id);
    g.n.panels.splice(at, 1);
    if (g.n.active === id) g.n.active = g.n.panels[Math.max(0, at - 1)];
    return g.n;
  }

  /** put a new group with panel id beside node (left / right / top / bottom) */
  function dockBeside(node, side, id) {
    const dir = side === 'left' || side === 'right' ? 'row' : 'col';
    const before = side === 'left' || side === 'top';
    const G = group([id]);
    // as wide (tall) as usual, but at most half of what it is docked beside
    const r = elOf.get(node) && elOf.get(node).getBoundingClientRect();
    const room = r ? (dir === 'row' ? r.width : r.height) : 0;
    G.size = Math.round(room ? Math.max(MIN_PX, Math.min(SIDE[side], room / 2)) : SIDE[side]);
    const pr = parentOf(node);
    if (node === L.root && node.t === 's' && node.dir === dir) node.kids.splice(before ? 0 : node.kids.length, 0, G);   // a window edge
    else if (pr.p && pr.p.dir === dir) pr.p.kids.splice(pr.i + (before ? 0 : 1), 0, G);
    else {
      const wrap = split(dir, before ? [G, node] : [node, G]);
      wrap.size = node.size; wrap.grow = node.grow; wrap.min = node.min;
      node.min = false; node.size = 0; node.grow = true;
      if (pr.p) pr.p.kids[pr.i] = wrap; else L.root = wrap;
    }
    return G;
  }

  /** open a closed panel where it belongs: next to panels with the same home, else on that side of the window */
  function insertHome(id) {
    const home = (P[id] && P[id].home) || 'left';
    const mate = find((n) => n.t === 't' && n.panels.some((x) => P[x] && P[x].home === home));
    if (mate) { mate.n.panels.push(id); mate.n.active = id; mate.n.min = false; return mate.n; }
    if (home === 'center') { const v = find((n) => n.t === 't' && n.panels.some((x) => P[x] && P[x].kind === 'view')); if (v) { v.n.panels.push(id); v.n.active = id; return v.n; } }
    if (home === 'bottom') {   // under the views
      const v = find((n) => n.t === 't' && n.panels.some((x) => P[x] && P[x].kind === 'view'));
      if (v) return dockBeside(v.n, 'bottom', id);
    }
    return dockBeside(L.root, home === 'center' ? 'right' : home, id);
  }

  /* ---------------------------------------------------------------- public actions */
  D.open = function (id) {
    if (!P[id]) return;
    if (popups[id] && !popups[id].closed) { popups[id].focus(); return; }
    const g = groupOf(id);
    if (g) {
      g.n.active = id; g.n.min = false;
      walk(L.root, (n) => { if (n.t === 's' && n.min && n !== L.root) { let inside = false; walk(n, (x) => { if (x === g.n) inside = true; }); if (inside) n.min = false; } });
      if (maxGroup && maxGroup !== g.n.id) maxGroup = null;
    } else insertHome(id);
    commit();
  };
  D.close = function (id) {
    if (!P[id]) return;
    if (P[id].kind === 'view' && Object.values(P).filter((p) => p.kind === 'view' && D.isOpen(p.id)).length <= 1) { DS.toast('Keep at least one view open (Map, Game, 3D or Quests)', 'warn', 2500); return; }
    if (popups[id]) { const w = popups[id]; delete popups[id]; L.floating = L.floating.filter((f) => f.id !== id); try { w.close(); } catch (e) { /* gone */ } }
    removeFromTree(id);
    if (P[id].onClose) P[id].onClose();
    commit();
  };
  D.toggle = (id) => (D.isOpen(id) ? D.close(id) : D.open(id));
  D.shown = (id) => shown.has(id);

  /** collapse / expand the outermost area on one side of the window (Ctrl+B, Ctrl+Alt+B) */
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
  D.state = () => JSON.parse(JSON.stringify({ root: L.root, floating: L.floating }));
  D.setState = function (st) {
    const s = JSON.parse(JSON.stringify(st || {}));
    if (!s.root) return false;
    walk(s.root, (n) => { if (n.t === 't') { n.id = 'g' + ++gid; } });
    const docked = new Set();
    walk(s.root, (n) => { if (n.t === 't') n.panels = n.panels.filter((id) => P[id] && !docked.has(id) && docked.add(id)); });
    L = { root: s.root, floating: (s.floating || []).filter((f) => P[f.id] && P[f.id].float && !docked.has(f.id)) };
    maxGroup = null;
    tidy();
    return true;
  };

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

  function build(n, parentDir) {
    let e;
    if (n.min) e = buildMini(n, parentDir);
    else if (n.t === 's') {
      e = el('div', { class: 'dk-split dk-' + n.dir });
      n.kids.forEach((k, i) => {
        if (i) e.append(sash(n, i));
        e.append(build(k, n.dir));
      });
    } else e = buildGroup(n);
    if (parentDir) sizeStyle(e, n, parentDir);
    else e.style.flex = '1 1 0';
    e._node = n;
    elOf.set(n, e);
    return e;
  }

  function title(id) { const p = P[id]; return (p.icon ? p.icon + ' ' : '') + p.title; }

  function buildGroup(n) {
    const tabs = el('div', { class: 'dk-tabs' });
    n.panels.forEach((id) => {
      const p = P[id];
      const t = el('div', { class: 'dk-tab' + (id === n.active ? ' active' : ''), title: p.title + (p.kind === 'view' ? '' : '  •  drag to dock it somewhere else, right-click for more') },
        el('span', null, title(id)),
        el('span', { class: 'dk-x', title: 'Close', onpointerdown: (ev) => ev.stopPropagation(), onclick: (ev) => { ev.stopPropagation(); D.close(id); } }, '✕'));
      t.addEventListener('pointerdown', (ev) => tabDown(ev, n, id, t));
      t.addEventListener('auxclick', (ev) => { if (ev.button === 1) D.close(id); });
      t.addEventListener('contextmenu', (ev) => { ev.preventDefault(); tabMenu(t, n, id); });
      tabs.append(t);
    });
    tabs.append(el('div', { class: 'dk-tabs-fill', ondblclick: () => D.toggleMax(n.id) }),
      el('button', { class: 'dk-btn', title: maxGroup === n.id ? 'Restore' : 'Maximize this area (Ctrl+Shift+F)', onclick: () => D.toggleMax(n.id) }, maxGroup === n.id ? '❐' : '□'),
      el('button', { class: 'dk-btn', title: 'More', onclick: (ev) => tabMenu(ev.currentTarget, n, n.active) }, '⋯'));
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

  function sash(n, i) {
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
    s.addEventListener('dblclick', () => {   // double-click: collapse the smaller neighbour at the window edge
      const k = !n.kids[i - 1].grow ? n.kids[i - 1] : n.kids[i];
      if (n === L.root && (k === n.kids[0] || k === n.kids[n.kids.length - 1])) { k.min = true; commit(); }
    });
    return s;
  }

  function render() {
    if (!ws) return;
    // keep panel elements alive while the containers are rebuilt
    Object.values(P).forEach((p) => { if (p.el && p.el.parentNode && !popupOf(p.id)) p.el.remove(); });
    let rootNode = L.root;
    if (maxGroup) { const g = groupById(maxGroup); if (g) rootNode = g.n; else maxGroup = null; }
    ws.replaceChildren(build(rootNode, null));
    ws.classList.toggle('dk-maxed', !!maxGroup);
    updateShown();
  }

  function popupOf(id) { const w = popups[id]; return w && !w.closed ? w : null; }

  function updateShown() {
    const now = new Set();
    const g0 = maxGroup && groupById(maxGroup);
    if (g0) now.add(g0.n.active);
    else walk(L.root, (n, p, i, hid) => { if (n.t === 't' && !n.min && !hid) now.add(n.active); });
    Object.keys(popups).forEach((id) => { if (popupOf(id)) now.add(id); });
    const prev = shown;
    shown = now;
    if (!started) return;
    let changed = false;
    prev.forEach((id) => { if (!now.has(id)) { changed = true; if (P[id] && P[id].onHide) P[id].onHide(); } });
    now.forEach((id) => { if (!prev.has(id)) { changed = true; if (P[id] && P[id].onShow) P[id].onShow(); } });
    if (changed) S.emit('view');
    S.emit('layout');
  }

  /* ---------------------------------------------------------------- tab drag & dock */
  let drag = null;
  function tabDown(e, n, id, tabEl) {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const mv = (ev) => {
      if (!drag && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!drag) {
        drag = { id, from: n, ghost: el('div', { class: 'dk-ghost' }, title(id)), over: el('div', { class: 'dk-drop hidden' }), target: null };
        document.body.append(drag.ghost, drag.over);
      }
      drag.ghost.style.left = ev.clientX + 12 + 'px';
      drag.ghost.style.top = ev.clientY + 8 + 'px';
      drag.target = dropTarget(ev.clientX, ev.clientY);
      showDrop(drag.target);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', esc, true);
      if (!drag) { if (n.active !== id) { n.active = id; render(); onChange(D.state()); } if (P[id].kind === 'view') S.setView(id); return; }
      const d = drag;
      drag = null;
      d.ghost.remove(); d.over.remove();
      if (d.target) drop(d.id, d.from, d.target);
    };
    const esc = (ev) => { if (ev.key === 'Escape' && drag) { drag.ghost.remove(); drag.over.remove(); drag = null; window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); } };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', esc, true);
  }

  /** what is under the pointer: a window edge, or a group (its tab strip = add as a tab; body edges = split) */
  function dropTarget(x, y) {
    const wr = ws.getBoundingClientRect();
    if (x < wr.left || x > wr.right || y < wr.top || y > wr.bottom) return null;
    const EDGE = 22;
    if (!maxGroup) {
      if (x - wr.left < EDGE) return { node: L.root, side: 'left', rect: { l: wr.left, t: wr.top, w: SIDE.left, h: wr.height } };
      if (wr.right - x < EDGE) return { node: L.root, side: 'right', rect: { l: wr.right - SIDE.right, t: wr.top, w: SIDE.right, h: wr.height } };
      if (wr.bottom - y < EDGE) return { node: L.root, side: 'bottom', rect: { l: wr.left, t: wr.bottom - SIDE.bottom, w: wr.width, h: SIDE.bottom } };
    }
    const hit = document.elementFromPoint(x, y);
    const g = hit && hit.closest('.dk-group');
    if (!g || !g._node) return null;
    const r = g.getBoundingClientRect();
    const tabs = g.querySelector('.dk-tabs').getBoundingClientRect();
    if (y <= tabs.bottom) return { node: g._node, side: 'center', rect: { l: r.left, t: r.top, w: r.width, h: r.height } };
    const fx = (x - r.left) / r.width, fy = (y - tabs.bottom) / (r.bottom - tabs.bottom);
    const half = (side) => ({
      left: { l: r.left, t: r.top, w: r.width / 2, h: r.height }, right: { l: r.left + r.width / 2, t: r.top, w: r.width / 2, h: r.height },
      top: { l: r.left, t: r.top, w: r.width, h: r.height / 2 }, bottom: { l: r.left, t: r.top + r.height / 2, w: r.width, h: r.height / 2 },
    })[side];
    const side = fx < 0.25 ? 'left' : fx > 0.75 ? 'right' : fy < 0.25 ? 'top' : fy > 0.75 ? 'bottom' : 'center';
    return { node: g._node, side, rect: side === 'center' ? { l: r.left, t: r.top, w: r.width, h: r.height } : half(side) };
  }

  function showDrop(t) {
    const o = drag.over;
    o.classList.toggle('hidden', !t);
    if (!t) return;
    Object.assign(o.style, { left: t.rect.l + 'px', top: t.rect.t + 'px', width: t.rect.w + 'px', height: t.rect.h + 'px' });
  }

  function drop(id, from, t) {
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
    if (P[id].kind === 'view') S.setView(id);
  }

  function tabMenu(anchor, n, id) {
    const p = P[id];
    if (!p) return;
    const items = [{ head: p.title }];
    if (p.float && window.open) items.push({ label: '⧉ Float in its own window (e.g. a second monitor)', run: () => D.float(id) });
    items.push({ label: maxGroup === n.id ? '❐ Restore' : '□ Maximize this area', key: 'Ctrl+Shift+F', run: () => D.toggleMax(n.id) });
    const pr = parentOf(n);
    if (pr.p === L.root && !n.grow) items.push({ label: '⇤ Collapse this area', run: () => { n.min = true; commit(); } });
    items.push({ label: '✕ Close ' + p.title, run: () => D.close(id) });
    DS.app.dropdown(anchor, items);
  }

  /* ---------------------------------------------------------------- floating windows */
  /** move a panel into its own window. The element keeps running in this page (same scripts, same project), so
      it updates live; dialogs it opens still show in the main window. */
  D.float = function (id, place) {
    const p = P[id];
    if (!p || !p.float) return;
    const f = place || { x: window.screenX + 80, y: window.screenY + 80, w: 420, h: Math.min(720, window.outerHeight - 120) };
    const w = window.open('', 'dzs-float-' + id, `popup=yes,width=${Math.round(f.w)},height=${Math.round(f.h)},left=${Math.round(f.x)},top=${Math.round(f.y)}`);
    if (!w) { DS.toast('The window was blocked - allow pop-ups for DayZ Studio to float panels', 'warn', 4000); return; }
    const doc = w.document;
    doc.title = p.title + ' - DayZ Studio';
    doc.documentElement.className = document.documentElement.className;
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((s) => {
      if (s.tagName === 'LINK') doc.head.append(Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: s.href }));
      else doc.head.append(doc.importNode(s, true));
    });
    doc.body.className = 'dk-float-body';
    removeFromTree(id);
    const pe = panelEl(id);
    pe.style.display = '';
    doc.body.append(pe);
    popups[id] = w;
    L.floating = L.floating.filter((x) => x.id !== id).concat([{ id, x: f.x, y: f.y, w: f.w, h: f.h }]);
    // hotkeys pressed in the floating window work as in the main window (unless typing)
    w.addEventListener('keydown', (ev) => {
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, code: ev.code, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey, bubbles: true, cancelable: true }));
    });
    const remember = () => {
      const e = L.floating.find((x) => x.id === id);
      if (e && !w.closed) { Object.assign(e, { x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight }); onChange(D.state()); }
    };
    w.addEventListener('resize', U.debounce(remember, 400));
    const track = setInterval(() => { if (w.closed) clearInterval(track); else remember(); }, 3000);
    w.addEventListener('pagehide', () => {
      if (unloading || popups[id] !== w) return;
      delete popups[id];
      L.floating = L.floating.filter((x) => x.id !== id);
      // back into the main window, where it came from
      if (!groupOf(id)) insertHome(id);
      setTimeout(commit, 0);
    });
    commit();
  };
  D.dockBack = (id) => { const w = popupOf(id); if (w) w.close(); };

  /* ---------------------------------------------------------------- start */
  D.init = function (container, st) {
    ws = container;
    if (!D.setState(st)) return false;
    render();
    D.ready = true;
    window.addEventListener('beforeunload', () => { unloading = true; });
    // leaving the page (reload, close): floating windows go with it; the layout keeps them for next time
    window.addEventListener('pagehide', () => { unloading = true; Object.values(popups).forEach((w) => { try { w.close(); } catch (e) { /* gone */ } }); });
    // the focused view (keyboard shortcuts act on it) is always visible
    S.on('view', () => { if (P[S.view] && P[S.view].kind === 'view' && !shown.has(S.view)) D.open(S.view); else markFocus(); });
    return true;
  };
  /** after every module is ready: tell the visible panels they are shown, reopen floating windows (desktop) */
  D.start = function () {
    started = true;
    shown.forEach((id) => { if (P[id] && P[id].onShow) P[id].onShow(); });
    const want = L.floating.slice();
    L.floating = [];
    want.forEach((f) => {
      if (window.studioHost && window.studioHost.isDesktop) D.float(f.id, f);
      else if (!groupOf(f.id)) insertHome(f.id);
    });
    commit();
    S.emit('view');
  };
  D.applyState = function (st) { Object.keys(popups).forEach((id) => { const w = popups[id]; delete popups[id]; try { w.close(); } catch (e) { /* gone */ } }); D.setState(st); const want = L.floating.slice(); L.floating = []; render(); want.forEach((f) => D.float(f.id, f)); commit(); };

  function markFocus() {
    if (!ws) return;
    ws.querySelectorAll('.dk-group').forEach((g) => g.classList.toggle('dk-focus', !!(g._node && g._node.active === S.view && P[S.view] && P[S.view].kind === 'view')));
  }
})();
