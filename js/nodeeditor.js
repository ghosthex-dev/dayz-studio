/* DayZ Studio - quest logic flow node editor (DOM nodes + SVG wires) */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const NE = (DS.NodeEditor = {});

  const NODE_W = 214;
  const HEAD_H = 34;
  let root, vp, world, svg, bar, empty;
  const v = { x: 40, y: 40, k: 1 };
  let drag = null;
  let ctxMenu = null;

  NE.init = function (container) {
    root = container;
    root.innerHTML = '';
    bar = el('div', { class: 'ne-bar' });
    vp = el('div', { class: 'ne-viewport' });
    world = el('div', { class: 'ne-world' });
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ne-wires');
    svg.innerHTML =
      '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs><g id="ne-wire-layer"></g>';
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
    S.on('changed', (k) => {
      if (k !== 'objects') render();
      else render();
    });
    S.on('selection', render);
    S.on('view', () => {
      if (S.view === 'quests') render();
    });
    render();
  };

  function applyView() {
    world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
    vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
    vp.style.backgroundSize = `${24 * v.k}px ${24 * v.k}px`;
  }

  function toWorld(cx, cy) {
    const r = vp.getBoundingClientRect();
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  }

  /* ---------- rendering ---------- */
  function renderBar(q) {
    bar.innerHTML = '';
    const sel = el('select', {
      class: 'inp', title: 'Active quest',
      onchange: (e) => {
        S.activeQuest = e.target.value;
        S.select(null, []);
        S.structure();
      },
    });
    S.project.quests.forEach((x) => sel.append(el('option', { value: x.id, selected: q && x.id === q.id }, x.name || '(unnamed)')));
    bar.append(
      el('span', { class: 'ne-bar-label' }, 'Quest'),
      S.project.quests.length ? sel : el('span', { class: 'muted' }, 'none'),
      el('button', { class: 'btn sm', onclick: () => { S.newQuest(); S.commit(); } }, '+ New Quest'),
      el('span', { class: 'sep' }),
      el('button', { class: 'btn sm', onclick: () => openAddMenu(null, null, true), disabled: !q }, '+ Add Node'),
      el('button', { class: 'btn sm', onclick: autoLayout, disabled: !q }, 'Auto-layout'),
      el('button', { class: 'btn sm', onclick: fit, disabled: !q }, 'Fit'),
      el('button', { class: 'btn sm', disabled: !q, title: 'Draw this quest inside the running game (areas, NPCs, crates, flow)', onclick: () => {
        DS.Link.setPreview(true);
        S.setView('game');
        if (!DS.Link.fresh && !DS.Link.launching) DS.Link.launch();
      } }, '🧭 Preview in game'),
      el('button', { class: 'btn sm primary', disabled: !q, title: 'Run this quest in the real game and play it as the character, starting at the quest start (F2 in the game switches back to the editor camera)', onclick: () => DS.Link.playTestQuest() }, '▶ Play-test'),
      el('span', { class: 'sep' }),
      el('span', { class: 'muted' }, 'Drag from a node’s right dot onto another node to connect. Double-click empty space to add nodes.')
    );
  }

  function applyLive() {
    if (!world) return;
    const m = DS.Link && DS.Link.pt && DS.Link.pt.on ? DS.Link.pt.nodes : null;
    world.querySelectorAll('.ne-node').forEach((c) => {
      const st = m ? m.get(c.dataset.id) : null;
      c.classList.toggle('live-run', !!st && st.status === 1);
      c.classList.toggle('live-done', !!st && st.status === 2);
      let b = c.querySelector('.ne-live');
      if (st && st.status > 0) {
        if (!b) { b = el('div', { class: 'ne-live' }); c.append(b); }
        b.textContent = st.status === 2 ? '✔ done' : '▶ active' + (st.progress > 0 ? ' · ' + Math.round(st.progress * 10) / 10 : '');
        b.onclick = null;
      } else if (b) b.remove();
    });
  }
  S.on('playtest', applyLive);

  function render() {
    if (!root) return;
    const q = S.activeQuestObj();
    renderBar(q);
    // clear nodes
    world.querySelectorAll('.ne-node').forEach((n) => n.remove());
    const layer = svg.querySelector('#ne-wire-layer');
    layer.innerHTML = '';
    applyView();
    if (!q) {
      empty.classList.remove('hidden');
      empty.innerHTML = '';
      empty.append(
        el('h3', null, 'No quest yet'),
        el('p', null, 'A quest is a flow of nodes: a trigger starts it, objectives are completed in order, then rewards are given.'),
        el('button', { class: 'btn primary', onclick: () => { S.newQuest(); S.commit(); } }, 'Create your first quest')
      );
      return;
    }
    empty.classList.add('hidden');
    setTimeout(applyLive, 0);
    const issues = DS.validateQuest ? DS.validateQuest(q) : {};
    q.nodes.forEach((n) => {
      const T = DS.NODE_TYPES[n.type];
      if (!T) return;
      const sel = S.isSel('node', n.id);
      const probs = issues[n.id] || [];
      const card = el(
        'div',
        { class: `ne-node cat-${T.cat}${n.p.optional ? ' optional' : ''}${sel ? ' selected' : ''}${probs.some((p) => p.level === 'error') ? ' has-error' : ''}`, 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px' } },
        el('div', { class: 'ne-head' }, el('span', { class: 'ne-icon' }, T.icon), el('span', { class: 'ne-title' }, T.title),
          probs.length ? el('span', { class: 'ne-warn', title: probs.map((p) => p.msg).join('\n') }, '⚠') : null),
        el('div', { class: 'ne-body' }, T.sum ? T.sum(n.p) : '')
      );
      if (T.cat !== 'trigger') card.append(el('div', { class: 'port in', 'data-port': 'in' }));
      if (n.type !== 'end') card.append(el('div', { class: 'port out', 'data-port': 'out' }));
      card.addEventListener('mousedown', (e) => onNodeDown(e, n, card));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!S.isSel('node', n.id)) S.select('node', [n.id]);
        nodeMenu(e.clientX, e.clientY, n);
      });
      world.append(card);
    });
    drawWires(q);
  }

  function portPos(n, which) {
    return { x: n.x + (which === 'out' ? NODE_W : 0), y: n.y + HEAD_H / 2 };
  }

  function wirePath(a, b) {
    const dx = Math.max(50, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  function drawWires(q) {
    const layer = svg.querySelector('#ne-wire-layer');
    layer.innerHTML = '';
    q.links.forEach((l) => {
      const a = S.node(q, l.from), b = S.node(q, l.to);
      if (!a || !b) return;
      const d = wirePath(portPos(a, 'out'), portPos(b, 'in'));
      const sel = S.isSel('link', l.id);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'ne-wire-hit');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', 'ne-wire' + (sel ? ' selected' : ''));
      p.setAttribute('marker-end', 'url(#arr)');
      g.append(p, hit);
      hit.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        S.select('link', [l.id]);
      });
      hit.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        q.links = q.links.filter((x) => x.id !== l.id);
        S.select(null, []);
        S.structure();
        S.commit();
      });
      layer.append(g);
    });
  }

  /* ---------- interaction ---------- */
  function onNodeDown(e, n, card) {
    if (e.button !== 0) return;
    e.stopPropagation();
    closeMenu();
    const q = S.activeQuestObj();
    if (e.target.dataset.port === 'out') {
      const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tmp.setAttribute('class', 'ne-wire temp');
      svg.querySelector('#ne-wire-layer').append(tmp);
      drag = { type: 'connect', from: n, tmp };
      return;
    }
    if (!S.isSel('node', n.id)) {
      if (e.shiftKey && S.sel.kind === 'node') S.select('node', [...S.sel.ids, n.id]);
      else S.select('node', [n.id]);
    }
    const ids = S.sel.kind === 'node' ? S.sel.ids : [n.id];
    drag = {
      type: 'move', sx: e.clientX, sy: e.clientY,
      items: ids.map((id) => S.node(q, id)).filter(Boolean).map((nn) => ({ n: nn, x: nn.x, y: nn.y })),
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
    const q = S.activeQuestObj();
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
      drawWires(q);
    } else if (drag.type === 'connect') {
      const w = toWorld(e.clientX, e.clientY);
      drag.tmp.setAttribute('d', wirePath(portPos(drag.from, 'out'), w));
    }
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    const q = S.activeQuestObj();
    if (d.type === 'move' && d.moved) {
      S.changed('quests');
      S.commit();
    } else if (d.type === 'connect') {
      d.tmp.remove();
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const card = t && t.closest ? t.closest('.ne-node') : null;
      if (card && q) {
        const ok = S.link(q, d.from.id, card.dataset.id);
        if (ok) S.commit();
        else if (card.dataset.id !== d.from.id) DS.toast('That connection isn’t allowed (triggers can’t have inputs, Quest Complete has no output).', 'warn');
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

  function fit() {
    const q = S.activeQuestObj();
    if (!q || !q.nodes.length) return;
    const xs = q.nodes.map((n) => n.x), ys = q.nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + NODE_W + 40;
    const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 120;
    const r = vp.getBoundingClientRect();
    v.k = U.clamp(Math.min(r.width / (x1 - x0), r.height / (y1 - y0)), 0.3, 1.2);
    v.x = -x0 * v.k + (r.width - (x1 - x0) * v.k) / 2;
    v.y = -y0 * v.k + (r.height - (y1 - y0) * v.k) / 2;
    applyView();
  }
  NE.fit = fit;

  function autoLayout() {
    const q = S.activeQuestObj();
    if (!q) return;
    const incoming = {};
    q.nodes.forEach((n) => (incoming[n.id] = 0));
    q.links.forEach((l) => (incoming[l.to] = (incoming[l.to] || 0) + 1));
    const level = {};
    let frontier = q.nodes.filter((n) => !incoming[n.id]).map((n) => n.id);
    frontier.forEach((id) => (level[id] = 0));
    let guard = 0;
    while (frontier.length && guard++ < 60) {
      const nxt = [];
      frontier.forEach((id) =>
        q.links.filter((l) => l.from === id).forEach((l) => {
          if (level[l.to] === undefined || level[l.to] < level[id] + 1) {
            level[l.to] = level[id] + 1;
            nxt.push(l.to);
          }
        })
      );
      frontier = nxt;
    }
    const rows = {};
    q.nodes.forEach((n) => {
      const lv = level[n.id] === undefined ? 0 : level[n.id];
      rows[lv] = (rows[lv] || 0);
      n.x = 40 + lv * (NODE_W + 70);
      n.y = 40 + rows[lv] * 120;
      rows[lv]++;
    });
    S.changed('quests');
    S.commit();
    fit();
  }

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
    const q = S.activeQuestObj();
    if (!q) return;
    let pos;
    if (fromButton) {
      const r = vp.getBoundingClientRect();
      pos = toWorld(r.left + r.width / 2 - 100, r.top + r.height / 2 - 40);
      cx = r.left + 120;
      cy = r.top + 80;
    } else pos = toWorld(cx, cy);
    const m = el('div', { class: 'ctx-menu' });
    Object.keys(DS.NODE_CATS).forEach((cat) => {
      m.append(el('div', { class: 'ctx-head', style: { color: DS.NODE_CATS[cat].color } }, DS.NODE_CATS[cat].name));
      Object.keys(DS.NODE_TYPES).filter((t) => DS.NODE_TYPES[t].cat === cat).forEach((t) => {
        const T = DS.NODE_TYPES[t];
        if (T.missing) return;
        m.append(el('div', { class: 'ctx-item', title: T.desc, onclick: () => { NE.addNode(t, pos.x, pos.y); closeMenu(); } }, el('span', { class: 'ctx-ic' }, T.icon), T.title));
      });
    });
    m.append(el('div', { class: 'ctx-sep' }), el('div', { class: 'ctx-item', title: 'Write a little Enforce Script and use it as a block', onclick: () => { closeMenu(); DS.CustomNodes.wizard(); } }, el('span', { class: 'ctx-ic' }, '🧩'), 'Make your own node…'));
    placeMenu(m, cx, cy);
  }
  function nodeMenu(cx, cy, n) {
    closeMenu();
    const q = S.activeQuestObj();
    const m = el('div', { class: 'ctx-menu' });
    m.append(
      el('div', { class: 'ctx-item', onclick: () => {
        const c = S.addNode(q, n.type, n.x + 30, n.y + 30, JSON.parse(JSON.stringify(n.p)));
        S.select('node', [c.id]); S.commit(); closeMenu();
      } }, 'Duplicate'),
      el('div', { class: 'ctx-item', onclick: () => {
        q.links = q.links.filter((l) => l.from !== n.id && l.to !== n.id);
        S.structure(); S.commit(); closeMenu();
      } }, 'Disconnect all wires'),
      el('div', { class: 'ctx-item danger', onclick: () => { DS.actions.deleteSelection(); closeMenu(); } }, 'Delete')
    );
    placeMenu(m, cx, cy);
  }

  /** Add a node; positional params default to the current map centre so it is visible straight away. */
  NE.addNode = function (type, x, y, params) {
    const q = S.activeQuestObj() || S.newQuest();
    const c = DS.MapView.center();
    const n = S.addNode(q, type, x === undefined ? 60 : x, y === undefined ? 60 : y, params);
    const T = DS.NODE_TYPES[type];
    if (T.custom && DS.CustomNodes) DS.CustomNodes.embed(type);   // the project keeps its own copy of the definition
    T.fields.forEach((f) => {
      if (f.t === 'pos' && !params) n.p[f.k] = { x: Math.round(c.x), y: 0, z: Math.round(c.z), ref: null };
    });
    // auto-connect to selected node for fast chaining
    if (S.sel.kind === 'node' && S.sel.ids.length === 1 && T.cat !== 'trigger') {
      const from = S.node(q, S.sel.ids[0]);
      if (from && from.type !== 'end') S.link(q, from.id, n.id);
    }
    S.select('node', [n.id]);
    S.commit();
    return n;
  };
})();
