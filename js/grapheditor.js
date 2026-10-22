/* DayZ Studio - node graph editor (DOM nodes + SVG wires), shared by the Quests view and the NPCs view.
   DS.GraphEditor.make(cfg) -> editor; cfg says which graph is open and how it behaves:
     view       'quests' | 'npcs' - the view the editor lives in (redraws only while it is shown)
     graph()    the open graph { nodes: [], links: [] } or null
     types()    node types { type: { cat, title, icon, desc, fields, sum, ... } }
     cats()     categories { cat: { name, color } }  (the order of the add menu)
     isStart(T) nodes of this type have no input (triggers / events)
     isEnd(n)   nodes without an output
     sel / selLink   selection kinds of nodes and wires in this graph ('node' / 'link', 'bnode' / 'blink')
     changed    S.changed() kind after moving nodes
     bar(el, g) fills the tool bar;  empty(el) fills the "nothing open" placeholder
     validate(g) -> { nodeId: [{ level, msg }] }   (optional)
     newGraph()  makes a graph when a node is added with none open (optional)
     addMenuExtra(menu, close)   extra add-menu entries (optional)
     onAdd(n, g)  after a node was added (optional)
     linkError   message when a wire isn't allowed */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const GE = (DS.GraphEditor = {});

  const NODE_W = 214;
  const HEAD_H = 34;

  /** default settings of a node type */
  GE.defaults = function (T) {
    const p = {};
    T.fields.forEach((f) => (p[f.k] = JSON.parse(JSON.stringify(f.def === undefined ? '' : f.def))));
    return p;
  };

  GE.make = function (cfg) {
    const E = {};
    let root, vp, world, svg, bar, empty;
    const v = { x: 40, y: 40, k: 1 };
    let drag = null;
    let ctxMenu = null;
    const T = (n) => cfg.types()[n.type];

    E.init = function (container) {
      root = container;
      root.innerHTML = '';
      bar = el('div', { class: 'ne-bar' });
      vp = el('div', { class: 'ne-viewport' });
      world = el('div', { class: 'ne-world' });
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ne-wires');
      svg.innerHTML =
        `<defs><marker id="arr-${cfg.view}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs><g class="ne-wire-layer"></g>`;
      empty = el('div', { class: 'ne-empty' });
      world.append(svg);
      vp.append(world, empty);
      root.append(bar, vp);
      vp.addEventListener('mousedown', onBgDown);
      vp.addEventListener('wheel', onWheel, { passive: false });
      vp.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!e.target.closest('.ne-node')) openAddMenu(e.clientX, e.clientY);
      });
      vp.addEventListener('dblclick', (e) => {
        if (!e.target.closest('.ne-node') && !e.target.closest('.ne-wire-hit')) openAddMenu(e.clientX, e.clientY);
      });
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('mousedown', (e) => {
        if (ctxMenu && !e.target.closest('.ctx-menu')) closeMenu();
      });
      S.on('structure', render);
      S.on('changed', render);
      S.on('selection', render);
      S.on('view', () => {
        if (S.shown(cfg.view)) render();
      });
      render();
    };

    function layer() {
      return svg.querySelector('.ne-wire-layer');
    }
    function applyView() {
      world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
      vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
      vp.style.backgroundSize = `${24 * v.k}px ${24 * v.k}px`;
    }
    function toWorld(cx, cy) {
      const r = vp.getBoundingClientRect();
      return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
    }
    const node = (g, id) => (g ? g.nodes.find((n) => n.id === id) || null : null);
    E.node = node;

    /* ---------- rendering ---------- */
    function render() {
      if (!root) return;
      const g = cfg.graph();
      bar.innerHTML = '';
      cfg.bar(bar, g, E);
      world.querySelectorAll('.ne-node').forEach((n) => n.remove());
      layer().innerHTML = '';
      applyView();
      if (!g) {
        empty.classList.remove('hidden');
        empty.innerHTML = '';
        cfg.empty(empty);
        return;
      }
      empty.classList.add('hidden');
      if (cfg.afterRender) setTimeout(() => cfg.afterRender(world), 0);
      const issues = cfg.validate ? cfg.validate(g) : {};
      const cats = cfg.cats();
      g.nodes.forEach((n) => {
        const t = T(n);
        if (!t) return;
        const sel = S.isSel(cfg.sel, n.id);
        const probs = issues[n.id] || [];
        const card = el(
          'div',
          { class: `ne-node cat-${t.cat}${n.p.optional ? ' optional' : ''}${sel ? ' selected' : ''}${probs.some((p) => p.level === 'error') ? ' has-error' : ''}`, 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px' } },
          el('div', { class: 'ne-head' }, el('span', { class: 'ne-icon' }, t.icon), el('span', { class: 'ne-title' }, t.title),
            probs.length ? el('span', { class: 'ne-warn', title: probs.map((p) => p.msg).join('\n') }, '⚠') : null),
          el('div', { class: 'ne-body' }, t.sum ? t.sum(n.p) : '')
        );
        if (!cfg.isStart(t)) card.append(el('div', { class: 'port in', 'data-port': 'in' }));
        if (!cfg.isEnd(n)) card.append(el('div', { class: 'port out', 'data-port': 'out' }));
        card.addEventListener('mousedown', (e) => onNodeDown(e, n, card));
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!S.isSel(cfg.sel, n.id)) S.select(cfg.sel, [n.id]);
          nodeMenu(e.clientX, e.clientY, n);
        });
        world.append(card);
      });
      drawWires(g);
    }
    E.render = render;

    function portPos(n, which) {
      return { x: n.x + (which === 'out' ? NODE_W : 0), y: n.y + HEAD_H / 2 };
    }
    function wirePath(a, b) {
      const dx = Math.max(50, Math.abs(b.x - a.x) / 2);
      return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
    }
    function drawWires(g) {
      const L = layer();
      L.innerHTML = '';
      g.links.forEach((l) => {
        const a = node(g, l.from), b = node(g, l.to);
        if (!a || !b) return;
        const d = wirePath(portPos(a, 'out'), portPos(b, 'in'));
        const sel = S.isSel(cfg.selLink, l.id);
        const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hit.setAttribute('d', d);
        hit.setAttribute('class', 'ne-wire-hit');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        p.setAttribute('class', 'ne-wire' + (sel ? ' selected' : ''));
        p.setAttribute('marker-end', `url(#arr-${cfg.view})`);
        grp.append(p, hit);
        hit.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          S.select(cfg.selLink, [l.id]);
        });
        hit.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          g.links = g.links.filter((x) => x.id !== l.id);
          S.select(null, []);
          S.structure();
          S.commit();
        });
        L.append(grp);
      });
    }

    /* ---------- graph operations ---------- */
    E.link = function (g, from, to) {
      if (from === to) return false;
      const tn = node(g, to);
      const fn = node(g, from);
      if (!tn || !fn || cfg.isStart(T(tn)) || cfg.isEnd(fn)) return false;
      if (g.links.some((l) => l.from === from && l.to === to)) return false;
      g.links.push({ id: U.uid('l'), from, to });
      S.structure();
      return true;
    };
    E.addRaw = function (g, type, x, y, params) {
      const n = { id: U.uid('n'), type, x: Math.round(x), y: Math.round(y), p: Object.assign(GE.defaults(cfg.types()[type]), params || {}) };
      g.nodes.push(n);
      S.structure();
      return n;
    };
    E.deleteNodes = function (g, ids) {
      const set = new Set(ids);
      g.nodes = g.nodes.filter((n) => !set.has(n.id));
      g.links = g.links.filter((l) => !set.has(l.from) && !set.has(l.to));
      S.structure();
    };

    /* ---------- interaction ---------- */
    function onNodeDown(e, n, card) {
      if (e.button !== 0) return;
      e.stopPropagation();
      closeMenu();
      const g = cfg.graph();
      if (e.target.dataset.port === 'out') {
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('class', 'ne-wire temp');
        layer().append(tmp);
        drag = { type: 'connect', from: n, tmp };
        return;
      }
      if (!S.isSel(cfg.sel, n.id)) {
        if (e.shiftKey && S.sel.kind === cfg.sel) S.select(cfg.sel, [...S.sel.ids, n.id]);
        else S.select(cfg.sel, [n.id]);
      }
      const ids = S.sel.kind === cfg.sel ? S.sel.ids : [n.id];
      drag = {
        type: 'move', sx: e.clientX, sy: e.clientY,
        items: ids.map((id) => node(g, id)).filter(Boolean).map((nn) => ({ n: nn, x: nn.x, y: nn.y })),
        moved: false,
      };
    }
    function onBgDown(e) {
      if (e.target.closest('.ne-node') || e.target.closest('.ne-bar') || e.target.closest('.ne-empty')) return;
      closeMenu();
      if (e.button === 0 || e.button === 1) {
        if (e.button === 0) S.select(null, []);
        drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      }
    }
    function onMove(e) {
      if (!drag) return;
      const g = cfg.graph();
      if (drag.type === 'pan') {
        v.x = drag.vx + (e.clientX - drag.sx);
        v.y = drag.vy + (e.clientY - drag.sy);
        applyView();
      } else if (drag.type === 'move') {
        const dx = (e.clientX - drag.sx) / v.k, dy = (e.clientY - drag.sy) / v.k;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true;
        drag.items.forEach((it) => {
          it.n.x = Math.round((it.x + dx) / 10) * 10;
          it.n.y = Math.round((it.y + dy) / 10) * 10;
          const c = world.querySelector(`.ne-node[data-id="${it.n.id}"]`);
          if (c) { c.style.left = it.n.x + 'px'; c.style.top = it.n.y + 'px'; }
        });
        if (g) drawWires(g);
      } else if (drag.type === 'connect') {
        const w = toWorld(e.clientX, e.clientY);
        drag.tmp.setAttribute('d', wirePath(portPos(drag.from, 'out'), w));
      }
    }
    function onUp(e) {
      if (!drag) return;
      const d = drag;
      drag = null;
      const g = cfg.graph();
      if (d.type === 'move' && d.moved) {
        S.changed(cfg.changed);
        S.commit();
      } else if (d.type === 'connect') {
        d.tmp.remove();
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const card = t && t.closest ? t.closest('.ne-node') : null;
        if (card && g) {
          const ok = E.link(g, d.from.id, card.dataset.id);
          if (ok) S.commit();
          else if (card.dataset.id !== d.from.id) DS.toast(cfg.linkError, 'warn');
        }
      }
    }
    function onWheel(e) {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const wx = (cx - v.x) / v.k, wy = (cy - v.y) / v.k;
      v.k = U.clamp(v.k * Math.exp(-e.deltaY * 0.0012), 0.3, 1.8);
      v.x = cx - wx * v.k;
      v.y = cy - wy * v.k;
      applyView();
    }

    E.fit = function () {
      const g = cfg.graph();
      if (!g || !g.nodes.length) return;
      const xs = g.nodes.map((n) => n.x), ys = g.nodes.map((n) => n.y);
      const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + NODE_W + 40;
      const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 120;
      const r = vp.getBoundingClientRect();
      v.k = U.clamp(Math.min(r.width / (x1 - x0), r.height / (y1 - y0)), 0.3, 1.2);
      v.x = -x0 * v.k + (r.width - (x1 - x0) * v.k) / 2;
      v.y = -y0 * v.k + (r.height - (y1 - y0) * v.k) / 2;
      applyView();
    };

    E.autoLayout = function () {
      const g = cfg.graph();
      if (!g) return;
      const incoming = {};
      g.nodes.forEach((n) => (incoming[n.id] = 0));
      g.links.forEach((l) => (incoming[l.to] = (incoming[l.to] || 0) + 1));
      const level = {};
      let frontier = g.nodes.filter((n) => !incoming[n.id]).map((n) => n.id);
      frontier.forEach((id) => (level[id] = 0));
      let guard = 0;
      while (frontier.length && guard++ < 60) {
        const nxt = [];
        frontier.forEach((id) =>
          g.links.filter((l) => l.from === id).forEach((l) => {
            if (level[l.to] === undefined || level[l.to] < level[id] + 1) {
              level[l.to] = level[id] + 1;
              nxt.push(l.to);
            }
          })
        );
        frontier = nxt;
      }
      const rows = {};
      g.nodes.forEach((n) => {
        const lv = level[n.id] === undefined ? 0 : level[n.id];
        rows[lv] = rows[lv] || 0;
        n.x = 40 + lv * (NODE_W + 70);
        n.y = 40 + rows[lv] * 120;
        rows[lv]++;
      });
      S.changed(cfg.changed);
      S.commit();
      E.fit();
    };

    /* ---------- menus ---------- */
    function closeMenu() {
      if (ctxMenu) ctxMenu.remove();
      ctxMenu = null;
    }
    function placeMenu(m, cx, cy) {
      document.body.append(m);
      const r = m.getBoundingClientRect();
      m.style.left = Math.min(cx, window.innerWidth - r.width - 8) + 'px';
      m.style.top = Math.min(cy, window.innerHeight - r.height - 8) + 'px';
      ctxMenu = m;
    }
    function openAddMenu(cx, cy, fromButton) {
      closeMenu();
      if (!cfg.graph() && !cfg.newGraph) return;
      let pos;
      if (fromButton) {
        const r = vp.getBoundingClientRect();
        pos = toWorld(r.left + r.width / 2 - 100, r.top + r.height / 2 - 40);
        cx = r.left + 120;
        cy = r.top + 80;
      } else pos = toWorld(cx, cy);
      const m = el('div', { class: 'ctx-menu' });
      const types = cfg.types(), cats = cfg.cats();
      Object.keys(cats).forEach((cat) => {
        const list = Object.keys(types).filter((t) => types[t].cat === cat && !types[t].missing && !types[t].hidden);
        if (!list.length) return;
        m.append(el('div', { class: 'ctx-head', style: { color: cats[cat].color } }, cats[cat].name));
        list.forEach((t) => {
          const Tt = types[t];
          m.append(el('div', { class: 'ctx-item', title: Tt.desc, onclick: () => { E.addNode(t, pos.x, pos.y); closeMenu(); } }, el('span', { class: 'ctx-ic' }, Tt.icon), Tt.title));
        });
      });
      if (cfg.addMenuExtra) cfg.addMenuExtra(m, closeMenu);
      placeMenu(m, cx, cy);
    }
    E.openAddMenu = () => openAddMenu(null, null, true);
    function nodeMenu(cx, cy, n) {
      closeMenu();
      const g = cfg.graph();
      const m = el('div', { class: 'ctx-menu' });
      m.append(
        el('div', { class: 'ctx-item', onclick: () => {
          const c = E.addRaw(g, n.type, n.x + 30, n.y + 30, JSON.parse(JSON.stringify(n.p)));
          S.select(cfg.sel, [c.id]); S.commit(); closeMenu();
        } }, 'Duplicate'),
        el('div', { class: 'ctx-item', onclick: () => {
          g.links = g.links.filter((l) => l.from !== n.id && l.to !== n.id);
          S.structure(); S.commit(); closeMenu();
        } }, 'Disconnect all wires'),
        el('div', { class: 'ctx-item danger', onclick: () => { DS.actions.deleteSelection(); closeMenu(); } }, 'Delete')
      );
      placeMenu(m, cx, cy);
    }

    /** add a node; map positions default to the map centre so it is visible straight away */
    E.addNode = function (type, x, y, params) {
      const g = cfg.graph() || (cfg.newGraph && cfg.newGraph());
      if (!g) return null;
      const c = DS.MapView.center();
      const n = E.addRaw(g, type, x === undefined ? 60 : x, y === undefined ? 60 : y, params);
      const t = cfg.types()[type];
      t.fields.forEach((f) => {
        if (f.t === 'pos' && !params) n.p[f.k] = { x: Math.round(c.x), y: 0, z: Math.round(c.z), ref: null };
      });
      // auto-connect to the selected node for fast chaining
      if (S.sel.kind === cfg.sel && S.sel.ids.length === 1 && !cfg.isStart(t)) {
        const from = node(g, S.sel.ids[0]);
        if (from && !cfg.isEnd(from)) E.link(g, from.id, n.id);
      }
      if (cfg.onAdd) cfg.onAdd(n, g);
      S.select(cfg.sel, [n.id]);
      S.commit();
      return n;
    };

    return E;
  };
})();
