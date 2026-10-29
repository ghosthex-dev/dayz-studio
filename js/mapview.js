/* DayZ Studio - interactive 2D map (canvas): pan/zoom, place, move, box-select, quest overlays, pick mode */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const M = (DS.MapView = {});

  let cv, ctx, W = 0, H = 0, dpr = 1;
  const view = { x: 7680, z: 7680, s: 0.06 }; // world centre + px per metre
  let dirty = true;
  const mouse = { sx: 0, sy: 0, wx: 0, wz: 0, inside: false };
  let drag = null;
  let spaceDown = false;
  let picking = null;
  let markers = []; // quest overlay hit targets
  let bgImg = null;
  let bgSrc = null;
  let placeYaw = 0;

  M.view = view;
  M.mouse = mouse;
  M.invalidate = () => (dirty = true);
  M.center = () => ({ x: view.x, z: view.z });
  M.placeYaw = (d) => {
    if (d !== undefined) placeYaw = U.wrap360(placeYaw + d);
    dirty = true;
    return placeYaw;
  };

  /* ---------- coordinate transforms (world metres <-> canvas px) ---------- */
  const w2s = (x, z) => [W / 2 + (x - view.x) * view.s, H / 2 - (z - view.z) * view.s];
  const s2w = (sx, sy) => [view.x + (sx - W / 2) / view.s, view.z - (sy - H / 2) / view.s];
  M.w2s = w2s;
  M.s2w = s2w;
  M.snap = (v) => snapV(v);
  M.placeAt = (x, z) => placeAt(x, z);
  const snapV = (v) => {
    const g = +S.project.meta.snap || 0;
    return g > 0 ? Math.round(v / g) * g : v;
  };

  M.init = function (canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    new ResizeObserver(resize).observe(cv.parentElement);
    resize();
    cv.addEventListener('mousedown', onDown);
    // the window the map is in (it can float into its own window, js/dock.js)
    U.onWin(cv, 'mousemove', onMove);
    U.onWin(cv, 'mouseup', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mouseleave', () => ((mouse.inside = false), (dirty = true)));
    cv.addEventListener('dblclick', onDbl);
    U.onWin(cv, 'keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) spaceDown = true;
    });
    U.onWin(cv, 'keyup', (e) => {
      if (e.code === 'Space') spaceDown = false;
    });
    ['changed', 'selection', 'tool', 'asset', 'view', 'project'].forEach((ev) => S.on(ev, () => (dirty = true)));
    S.on('project', () => M.fit());
    U.loop(() => {   // frames of the window the map is in
      if (dirty && S.shown('map')) {
        dirty = false;
        draw();
      }
    }, cv);
    M.fit();
  };
  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    dpr = U.winOf(cv).devicePixelRatio || 1;   // the monitor the map's window is on
    W = Math.max(50, r.width);
    H = Math.max(50, r.height);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    dirty = true;
  }
  M.resize = resize;

  M.fit = function (bounds) {
    const size = S.project.meta.mapSize;
    let b = bounds || { x0: 0, z0: 0, x1: size, z1: size };
    const pad = 1.15;
    const sx = W / Math.max(50, (b.x1 - b.x0) * pad);
    const sz = H / Math.max(50, (b.z1 - b.z0) * pad);
    view.s = Math.min(sx, sz, 6);
    view.x = (b.x0 + b.x1) / 2;
    view.z = (b.z0 + b.z1) / 2;
    dirty = true;
  };
  M.focusSelection = function () {
    const objs = DS.actions.selectedObjects();
    if (!objs.length) return M.fit();
    const xs = objs.map((o) => o.x), zs = objs.map((o) => o.z);
    const b = { x0: Math.min(...xs) - 40, x1: Math.max(...xs) + 40, z0: Math.min(...zs) - 40, z1: Math.max(...zs) + 40 };
    M.fit(b);
  };
  M.centerOn = function (x, z, zoom) {
    view.x = x;
    view.z = z;
    if (zoom) view.s = Math.max(view.s, zoom);
    dirty = true;
  };

  /* ---------- pick mode (used by the inspector: "pick on map") ---------- */
  M.pick = function (opts, cb) {
    picking = { opts: opts || {}, cb };
    const b = document.getElementById('pick-banner');
    b.textContent = (opts && opts.prompt) || 'Click on the map to choose a position  (Esc to cancel)';
    b.classList.remove('hidden');
    cv.style.cursor = 'crosshair';
    dirty = true;
  };
  M.cancelPick = function () {
    if (!picking) return;
    picking = null;
    document.getElementById('pick-banner').classList.add('hidden');
    cv.style.cursor = '';
    if (M.onPickEnd) M.onPickEnd();
  };
  M.isPicking = () => !!picking;

  /* ---------- background image ---------- */
  function syncBg() {
    const src = S.project.bg && S.project.bg.data;
    if (src === bgSrc) return;
    bgSrc = src;
    bgImg = null;
    if (src) {
      const im = new Image();
      im.onload = () => {
        bgImg = im;
        dirty = true;
      };
      im.src = src;
    }
  }

  /* ---------- game terrain imagery (maps/<world>/overview.jpg + t/XXX_YYY.jpg) ---------- */
  const terrain = {};
  function getTerrain() {
    const w = S.project.meta.world;
    let t = terrain[w];
    if (!t) {
      t = terrain[w] = { state: 'loading', tiles: new Map(), grid: 32, overview: null };
      const im = new Image();
      im.onload = () => { t.overview = im; t.state = 'ok'; dirty = true; S.emit('terrain'); };
      im.onerror = () => { t.state = 'none'; S.emit('terrain'); };
      im.src = `maps/${w}/overview.jpg`;
    }
    return t;
  }
  M.terrainState = () => getTerrain().state;
  M.reloadTerrain = () => { Object.keys(terrain).forEach((k) => delete terrain[k]); getTerrain(); dirty = true; };
  const pad3 = (n) => String(n).padStart(3, '0');
  function tileImg(t, xi, yi) {
    const k = xi + '_' + yi;
    let e = t.tiles.get(k);
    if (e) {
      t.tiles.delete(k);
      t.tiles.set(k, e); // LRU touch
    } else {
      if (t.tiles.size > 360) {
        let n = 0;
        for (const key of t.tiles.keys()) { t.tiles.delete(key); if (++n >= 80) break; }
      }
      const im = new Image();
      e = { im, ok: false };
      im.onload = () => { e.ok = true; dirty = true; };
      im.src = `maps/${S.project.meta.world}/t/${pad3(xi)}_${pad3(yi)}.jpg`;
      t.tiles.set(k, e);
    }
    return e.ok ? e.im : null;
  }
  function drawTerrain(x0, y0, x1, y1) {
    if (S.project.meta.showTerrain === false) return;
    const t = getTerrain();
    if (t.state !== 'ok') return;
    const size = S.project.meta.mapSize;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (S.project.meta.brighten !== false) ctx.filter = 'brightness(1.45) contrast(1.08) saturate(1.1)';
    ctx.drawImage(t.overview, x0, y0, x1 - x0, y1 - y0);
    const step = size / t.grid;
    if (step * view.s >= 150) {
      const [wx0, wz1] = s2w(0, 0);
      const [wx1, wz0] = s2w(W, H);
      const xa = Math.max(0, Math.floor(wx0 / step)), xb = Math.min(t.grid - 1, Math.floor(wx1 / step));
      const ya = Math.max(0, Math.floor((size - wz1) / step)), yb = Math.min(t.grid - 1, Math.floor((size - wz0) / step));
      for (let yi = ya; yi <= yb; yi++) {
        for (let xi = xa; xi <= xb; xi++) {
          const img = tileImg(t, xi, yi);
          if (!img) continue;
          const [tx, ty] = w2s(xi * step, size - yi * step);
          const tw = step * view.s;
          ctx.drawImage(img, Math.floor(tx), Math.floor(ty), Math.ceil(tw) + 1, Math.ceil(tw) + 1);
        }
      }
    }
    ctx.restore();
  }

  /* ---------- hit testing ---------- */
  function hit(sx, sy) {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      if (Math.hypot(m.sx - sx, m.sy - sy) <= 10) return { kind: 'node', id: m.node.id, marker: m };
    }
    const npcId = DS.Npcs ? DS.Npcs.hit(sx, sy) : null;
    if (npcId) return { kind: 'npc', id: npcId };
    const objs = S.project.objects;
    let best = null;
    let bd = 1e9;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.hidden) continue;
      const [x, y] = w2s(o.x, o.z);
      const rad = Math.max(9, o.kind === 'building' ? (7 * view.s) : 0);
      const d = Math.hypot(x - sx, y - sy);
      if (d <= rad && d < bd) {
        bd = d;
        best = { kind: 'object', id: o.id };
      }
    }
    if (!best && DS.Loot) {
      const id = DS.Loot.hit(sx, sy, w2s);
      if (id) return { kind: 'loot', id };
    }
    if (!best && DS.Zones) {
      const [wx, wz] = s2w(sx, sy);
      const id = DS.Zones.hit(wx, wz, view.s);
      if (id) return { kind: 'zone', id };
    }
    return best;
  }

  /* ---------- mouse ---------- */
  function onDown(e) {
    cv.focus();
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wz] = s2w(sx, sy);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (spaceDown || S.tool === 'pan'))) {
      drag = { type: 'pan', sx, sy, vx: view.x, vz: view.z };
      cv.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    if (picking) {
      const h = hit(sx, sy);
      const o = h && h.kind === 'object' ? S.obj(h.id) : null;
      const p = picking;
      if (!p.opts.multi) M.cancelPick();   // multi: every click adds one (e.g. patrol waypoints) until Esc
      else dirty = true;
      if (o && p.opts.allowRef) p.cb({ x: o.x, y: o.y, z: o.z, ref: o.id });
      else p.cb({ x: U.round(snapV(wx), 2), y: 0, z: U.round(snapV(wz), 2), ref: null });
      return;
    }

    if (S.tool === 'zone' && DS.Zones.pointer('down', wx, wz, e)) {
      drag = { type: 'zonedraw' };
      return;
    }
    if (S.tool === 'place' && S.asset) {
      placeAt(snapV(wx), snapV(wz));
      return;
    }
    if (S.tool === 'measure') {
      drag = { type: 'measure', a: [wx, wz], b: [wx, wz] };
      return;
    }

    if (e.altKey && e.shiftKey && DS.Link && DS.Link.fresh) {
      DS.Link.flyTo(wx, wz);
      return;
    }
    // select tool
    if (S.sel.kind === 'loot' && S.sel.ids.length === 1 && DS.Loot) {
      const inst = DS.Loot.byId.get(S.sel.ids[0]);
      const pt = inst && DS.Loot.hitPoint(inst, sx, sy, w2s);
      if (pt) {
        drag = { type: 'lootpt', inst, ci: pt.ci, k: pt.k, moved: false };
        return;
      }
    }
    if (S.sel.kind === 'zone' && S.sel.ids.length === 1 && DS.Zones) {
      const zs = DS.Zones.get(S.sel.ids[0]);
      const hi = zs ? DS.Zones.hitHandle(zs, sx, sy, w2s) : -1;
      if (hi >= 0) {
        drag = { type: 'zonept', s: zs, i: hi, moved: false };
        return;
      }
    }
    const h = hit(sx, sy);
    if (h && h.kind === 'zone') {
      const zs = DS.Zones.get(h.id);
      S.select('zone', [h.id]);
      drag = { type: 'zonemove', s: zs, start: [wx, wz], snap: DS.Zones.snapshot(zs), moved: false };
      return;
    }
    if (h) {
      let ids = [h.id];
      if (h.kind === 'object') {
        const o = S.obj(h.id);
        if (o && o.group && !e.altKey) ids = S.project.objects.filter((p) => p.group === o.group).map((p) => p.id);
      }
      if (e.shiftKey && S.sel.kind === h.kind) {
        const cur = new Set(S.sel.ids);
        const allIn = ids.every((i) => cur.has(i));
        ids.forEach((i) => (allIn ? cur.delete(i) : cur.add(i)));
        S.select(h.kind, [...cur]);
      } else if (!S.isSel(h.kind, h.id)) {
        S.select(h.kind, ids);
      }
      startMove(wx, wz);
    } else {
      if (!e.shiftKey) S.select(null, []);
      drag = { type: 'box', a: [wx, wz], b: [wx, wz], sx, sy, add: e.shiftKey, base: S.sel.kind === 'object' ? [...S.sel.ids] : [] };
    }
    dirty = true;
  }

  function startMove(wx, wz) {
    const items = [];
    if (S.sel.kind === 'object') {
      S.sel.ids.forEach((id) => {
        const o = S.obj(id);
        if (o && !o.locked) items.push({ o, x: o.x, z: o.z });
      });
    } else if (S.sel.kind === 'loot') {
      S.sel.ids.forEach((id) => {
        const l = DS.Loot.byId.get(id);
        if (!l) return;
        if (l.ref && S.obj(l.ref)) {
          const o = S.obj(l.ref);
          if (!items.some((i) => i.o === o)) items.push({ o, x: o.x, z: o.z });
        } else items.push({ l, x: l.x, z: l.z });
      });
    } else if (S.sel.kind === 'npc' && DS.Npcs) {
      S.sel.ids.forEach((id) => {
        const npc = DS.Npcs.get(id);
        if (!npc) return;
        if (npc.pos.ref && S.obj(npc.pos.ref)) {
          const o = S.obj(npc.pos.ref);
          if (!items.some((i) => i.o === o)) items.push({ o, x: o.x, z: o.z });
        } else items.push({ p: npc.pos, x: npc.pos.x, z: npc.pos.z });
      });
    } else if (S.sel.kind === 'node') {
      const q = S.activeQuestObj();
      S.sel.ids.forEach((id) => {
        const n = S.node(q, id);
        if (!n) return;
        S.nodePosFields(n).forEach(({ pos }) => {
          if (!pos) return;
          if (pos.ref && S.obj(pos.ref)) {
            const o = S.obj(pos.ref);
            if (!items.some((i) => i.o === o)) items.push({ o, x: o.x, z: o.z });
          } else if (!items.some((i) => i.p === pos)) items.push({ p: pos, x: pos.x, z: pos.z });
        });
      });
    }
    drag = { type: 'move', start: [wx, wz], items, moved: false };
  }

  function onMove(e) {
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wz] = s2w(sx, sy);
    mouse.sx = sx; mouse.sy = sy; mouse.wx = wx; mouse.wz = wz;
    mouse.inside = sx >= 0 && sy >= 0 && sx <= W && sy <= H;
    if (mouse.inside || drag) {
      const el = document.getElementById('st-coords');
      if (el) el.textContent = `X ${wx.toFixed(1)}   Z ${wz.toFixed(1)}`;
    }
    if (!drag) {
      if (S.tool === 'place' || picking) dirty = true;
      if (S.tool === 'zone' && DS.Zones.draft && mouse.inside) { DS.Zones.pointer('move', wx, wz, e); }
      return;
    }
    if (drag.type === 'pan') {
      view.x = drag.vx - (sx - drag.sx) / view.s;
      view.z = drag.vz + (sy - drag.sy) / view.s;
    } else if (drag.type === 'move') {
      let dx = wx - drag.start[0], dz = wz - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dz) * view.s < 3) return;
      drag.moved = true;
      const first = drag.items[0];
      if (first && !e.ctrlKey) {
        dx = snapV(first.x + dx) - first.x;
        dz = snapV(first.z + dz) - first.z;
      }
      drag.items.forEach((it) => {
        const nx = U.round(it.x + dx, 2), nz = U.round(it.z + dz, 2);
        if (it.o) { it.o.x = nx; it.o.z = nz; } else if (it.l) { it.l.x = nx; it.l.z = nz; } else { it.p.x = nx; it.p.z = nz; }
      });
      S.changed('objects');
    } else if (drag.type === 'zonedraw') {
      DS.Zones.pointer('move', wx, wz, e);
    } else if (drag.type === 'zonept') {
      drag.moved = true;
      DS.Zones.setHandle(drag.s, drag.i, snapV(wx), snapV(wz));
      DS.Zones.touch();
    } else if (drag.type === 'zonemove') {
      let dx = wx - drag.start[0], dz = wz - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dz) * view.s < 3) return;
      drag.moved = true;
      DS.Zones.moveFrom(drag.s, drag.snap, snapV(dx), snapV(dz));
      DS.Zones.touch();
    } else if (drag.type === 'lootpt') {
      drag.moved = true;
      DS.Loot.movePoint(drag.inst, drag.ci, drag.k, wx, wz);
    } else if (drag.type === 'box') {
      drag.b = [wx, wz];
    } else if (drag.type === 'measure') {
      drag.b = [wx, wz];
    }
    dirty = true;
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (cv) cv.style.cursor = picking ? 'crosshair' : '';
    if (d.type === 'zonedraw') {
      DS.Zones.pointer('up', mouse.wx, mouse.wz, e);
    } else if (d.type === 'zonept' || d.type === 'zonemove') {
      if (d.moved) { S.changed('zones'); S.commit(); S.emit('zones'); }
    } else if (d.type === 'lootpt') {
      if (d.moved) { S.emit('loot'); S.commit(); }
    } else if (d.type === 'move' && d.moved) {
      if (d.items.some((it) => it.l)) DS.Loot.sync();
      S.commit();
    } else if (d.type === 'box') {
      const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]);
      const z0 = Math.min(d.a[1], d.b[1]), z1 = Math.max(d.a[1], d.b[1]);
      if ((x1 - x0) * view.s > 4 || (z1 - z0) * view.s > 4) {
        const set = new Set(d.add ? d.base : []);
        S.project.objects.forEach((o) => {
          if (!o.hidden && o.x >= x0 && o.x <= x1 && o.z >= z0 && o.z <= z1) set.add(o.id);
        });
        S.select('object', [...set]);
      }
    }
    dirty = true;
  }

  function onWheel(e) {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wz] = s2w(sx, sy);
    const minS = Math.min(W, H) / (S.project.meta.mapSize * 2.2);
    view.s = U.clamp(view.s * Math.exp(-e.deltaY * 0.0014), minS, 12);
    view.x = wx - (sx - W / 2) / view.s;
    view.z = wz + (sy - H / 2) / view.s;
    dirty = true;
  }

  function onDbl(e) {
    if (S.tool === 'zone' && DS.Zones.draft && DS.Zones.draft.shape === 'poly') {
      DS.Zones.undoPoint(); // the dblclick's second click added a duplicate vertex
      DS.Zones.finish();
      return;
    }
    if (S.tool !== 'select') return;
    const r = cv.getBoundingClientRect();
    const h = hit(e.clientX - r.left, e.clientY - r.top);
    if (h && h.kind === 'node') {
      S.setView('quests');
    } else if (h && h.kind === 'npc') DS.Npcs.open(h.id);
  }

  function placeAt(x, z) {
    const a = S.asset;
    if (a.kind === 'lootgroup') {
      const inst = DS.Loot.addInstance(a.c, x, z, placeYaw);
      S.select('loot', [inst.id]);
      S.commit();
      return;
    }
    let created = [];
    if (a.prefab) {
      created = DS.Stamps.place(a.prefab, x, z, placeYaw);
    } else {
      created = [S.makeObject(a, x, z, { yaw: placeYaw })];
    }
    S.addObjects(created);
    S.select('object', created.map((o) => o.id));
    S.commit();
  }

  /* ---------- drawing ---------- */
  function niceStep() {
    const steps = [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000];
    for (const s of steps) if (s * view.s >= 70) return s;
    return 5000;
  }

  function glyph(kind, x, y, r, color, yaw, filled) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(U.deg2rad(yaw || 0));
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const shape = (DS.KINDS[kind] || DS.KINDS.prop).shape;
    if (shape === 'rect') ctx.rect(-r * 1.2, -r * 0.9, r * 2.4, r * 1.8);
    else if (shape === 'square') ctx.rect(-r, -r, r * 2, r * 2);
    else if (shape === 'diamond') { ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 1.1, 0); ctx.lineTo(0, r * 1.25); ctx.lineTo(-r * 1.1, 0); ctx.closePath(); }
    else if (shape === 'tri') { ctx.moveTo(0, -r * 1.3); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath(); }
    else if (shape === 'star') { for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.55 : r * 1.3; const a = (i * Math.PI) / 5; ctx.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr); } ctx.closePath(); }
    else if (shape === 'cross') { const t = r * 0.38; ctx.moveTo(-t, -r); ctx.lineTo(t, -r); ctx.lineTo(t, -t); ctx.lineTo(r, -t); ctx.lineTo(r, t); ctx.lineTo(t, t); ctx.lineTo(t, r); ctx.lineTo(-t, r); ctx.lineTo(-t, t); ctx.lineTo(-r, t); ctx.lineTo(-r, -t); ctx.lineTo(-t, -t); ctx.closePath(); }
    else ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // heading tick
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r * 1.9);
    ctx.strokeStyle = filled || '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    syncBg();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    const size = S.project.meta.mapSize;
    const [x0, y0] = w2s(0, size);
    const [x1, y1] = w2s(size, 0);
    ctx.fillStyle = '#12161d';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    drawTerrain(x0, y0, x1, y1);
    if (DS.Zones) DS.Zones.drawOverlay(ctx, x0, y0, x1, y1);
    if (bgImg) {
      ctx.globalAlpha = S.project.bg.opacity != null ? S.project.bg.opacity : 0.9;
      ctx.drawImage(bgImg, x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1;
    }

    // grid
    const step = niceStep();
    const [wx0, wz1] = s2w(0, 0);
    const [wx1, wz0] = s2w(W, H);
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    for (let gx = Math.max(0, Math.floor(wx0 / step) * step); gx <= Math.min(size, wx1); gx += step) {
      const [sx] = w2s(gx, 0);
      const major = gx % 1000 === 0;
      ctx.strokeStyle = major ? 'rgba(148,163,184,.30)' : 'rgba(148,163,184,.12)';
      ctx.beginPath(); ctx.moveTo(sx + 0.5, Math.max(0, y0)); ctx.lineTo(sx + 0.5, Math.min(H, y1)); ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,.65)';
      ctx.fillText(gx >= 1000 && gx % 1000 === 0 ? gx / 1000 + 'k' : String(gx), sx + 3, 3);
    }
    for (let gz = Math.max(0, Math.floor(wz0 / step) * step); gz <= Math.min(size, wz1); gz += step) {
      const [, sy] = w2s(0, gz);
      const major = gz % 1000 === 0;
      ctx.strokeStyle = major ? 'rgba(148,163,184,.30)' : 'rgba(148,163,184,.12)';
      ctx.beginPath(); ctx.moveTo(Math.max(0, x0), sy + 0.5); ctx.lineTo(Math.min(W, x1), sy + 0.5); ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,.65)';
      ctx.fillText(gz >= 1000 && gz % 1000 === 0 ? gz / 1000 + 'k' : String(gz), 3, sy + 3);
    }
    ctx.strokeStyle = 'rgba(148,163,184,.6)';
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);

    // towns (landmarks)
    const towns = DS.TOWNS[S.project.meta.world];
    if (towns && S.project.meta.showTowns !== false) {
      ctx.textBaseline = 'middle';
      ctx.font = '600 11px system-ui, sans-serif';
      towns.forEach((t) => {
        const [x, y] = w2s(t[1], t[2]);
        if (x < -80 || y < -20 || x > W + 80 || y > H + 20) return;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.strokeText(t[0], x + 6, y);
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.fillText(t[0], x + 6, y);
      });
    }

    // imported vanilla building reference layer
    if (DS.ref && DS.ref.x.length && S.project.meta.showRef !== false) {
      ctx.fillStyle = 'rgba(148,163,184,.55)';
      const n = DS.ref.x.length;
      const sz = view.s > 0.3 ? 3 : 1.6;
      for (let i = 0; i < n; i++) {
        const x = W / 2 + (DS.ref.x[i] - view.x) * view.s;
        const y = H / 2 - (DS.ref.z[i] - view.z) * view.s;
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
    }

    // performance heatmap (object density per network bubble)
    if (S.project.meta.showDensity && DS.Density) DS.Density.draw(ctx, w2s);

    // vanilla map objects removed in the project: red crosses
    const removed = S.project.removed || [];
    if (removed.length) {
      ctx.strokeStyle = 'rgba(248,82,82,.9)';
      ctx.lineWidth = 1.5;
      const k = U.clamp(view.s * 3, 2.5, 6);
      ctx.beginPath();
      removed.forEach((r) => {
        const x = W / 2 + (r.x - view.x) * view.s;
        const y = H / 2 - (r.z - view.z) * view.s;
        if (x < -8 || y < -8 || x > W + 8 || y > H + 8) return;
        ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
        ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
      });
      ctx.stroke();
    }

    // objects
    const q = S.activeQuestObj();
    const labelsOn = view.s > 0.18;
    const selSet = S.sel.kind === 'object' ? new Set(S.sel.ids) : null;
    ctx.textBaseline = 'middle';
    ctx.font = '10px system-ui, sans-serif';
    S.project.objects.forEach((o) => {
      if (o.hidden) return;
      const [x, y] = w2s(o.x, o.z);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) return;
      const K = DS.KINDS[o.kind] || DS.KINDS.prop;
      let r = U.clamp(3 + view.s * 6, 3.5, 9);
      if (o.kind === 'building') r = Math.max(r, 5 * view.s * (o.scale || 1));
      const sel = selSet && selSet.has(o.id);
      glyph(o.kind, x, y, r, K.color, o.yaw, sel ? '#22d3ee' : null);
      if (o.group) {
        ctx.strokeStyle = 'rgba(250,204,21,.8)';
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(x - r - 3, y - r - 3, r * 2 + 6, r * 2 + 6);
        ctx.setLineDash([]);
      }
      if (sel) {
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (labelsOn || sel) {
        const lt = o.label || U.pretty(o.c);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.8)';
        ctx.strokeText(lt, x + r + 5, y);
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(240,244,250,.95)';
        ctx.fillText(lt, x + r + 5, y);
      }
    });
    // range of selected effects
    if (selSet) S.project.objects.forEach((o) => {
      if (o.kind !== 'fx' || !selSet.has(o.id) || !o.fx) return;
      const [x, y] = w2s(o.x, o.z);
      ctx.strokeStyle = 'rgba(232,121,249,.7)';
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(x, y, (o.fx.range || 300) * view.s, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    });

    // faction territories (Player stats ▸ Factions)
    const facs = (S.project.factions && S.project.factions.list) || [];
    facs.forEach((f) => (f.territories || []).forEach((t) => {
      const [x, y] = w2s(+t.x, +t.z);
      const r = (+t.radius || 0) * view.s;
      ctx.strokeStyle = f.color || '#9ca3af';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      if (r > 18) {
        const lt = (t.name ? t.name + ' · ' : '') + (f.name || f.id);
        ctx.font = '12px system-ui, sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(lt, x - ctx.measureText(lt).width / 2, y - r - 6);
        ctx.lineWidth = 1; ctx.fillStyle = f.color || '#e5e7eb'; ctx.fillText(lt, x - ctx.measureText(lt).width / 2, y - r - 6);
      }
    }));

    // loot spawns (Central Economy)
    if (DS.Loot) DS.Loot.render(ctx, { w2s, s: view.s, W, Hh: H });
    if (DS.Zones) DS.Zones.drawShapes(ctx, { w2s, s: view.s });
    if (DS.Link) DS.Link.drawCamera(ctx, w2s, view.s);

    // NPCs (NPCs tab): every character with its name, the open / selected one with its routes
    if (DS.Npcs) DS.Npcs.drawMap(ctx, w2s, view.s);

    // quest overlay
    markers = [];
    if (q) drawQuestOverlay(q);

    // ghost for placement
    if (S.tool === 'place' && S.asset && mouse.inside && !drag) {
      const gx = snapV(mouse.wx), gz = snapV(mouse.wz);
      const [x, y] = w2s(gx, gz);
      ctx.globalAlpha = 0.65;
      const K = DS.KINDS[S.asset.kind] || DS.KINDS.prop;
      if (S.asset.kind === 'lootgroup') {
        ctx.globalAlpha = 1;
        DS.Loot.renderGhost(ctx, w2s, view.s, S.asset.c, gx, gz, placeYaw);
      } else if (S.asset.prefab) {
        const yawR = U.deg2rad(placeYaw);
        S.asset.prefab.parts.forEach((p) => {
          const dx = p[2] * Math.cos(yawR) + p[3] * Math.sin(yawR);
          const dz = -p[2] * Math.sin(yawR) + p[3] * Math.cos(yawR);
          const [px, py] = w2s(gx + dx, gz + dz);
          glyph(p[1], px, py, 5, (DS.KINDS[p[1]] || K).color, p[4] + placeYaw);
        });
      } else glyph(S.asset.kind, x, y, 6, K.color, placeYaw);
      ctx.globalAlpha = 1;
    }

    // box select / measure
    if (drag && drag.type === 'box') {
      const [ax, ay] = w2s(drag.a[0], drag.a[1]);
      const [bx, by] = w2s(drag.b[0], drag.b[1]);
      ctx.fillStyle = 'rgba(34,211,238,.10)';
      ctx.strokeStyle = 'rgba(34,211,238,.9)';
      ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
    }
    if (drag && drag.type === 'measure') {
      const [ax, ay] = w2s(drag.a[0], drag.a[1]);
      const [bx, by] = w2s(drag.b[0], drag.b[1]);
      ctx.strokeStyle = '#facc15';
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      const d = Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]);
      ctx.fillStyle = '#facc15';
      ctx.font = '600 12px system-ui';
      ctx.fillText(`${d.toFixed(1)} m`, (ax + bx) / 2 + 8, (ay + by) / 2 - 8);
    }

    // scale bar
    const bar = niceStep();
    const px = bar * view.s;
    ctx.fillStyle = 'rgba(10,12,16,.7)';
    ctx.fillRect(12, H - 34, px + 20, 24);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(22, H - 20, px, 2);
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(bar >= 1000 ? bar / 1000 + ' km' : bar + ' m', 22, H - 24);

    const zl = document.getElementById('st-zoom');
    if (zl) zl.textContent = `${(1 / view.s).toFixed(1)} m/px`;
  }

  const CAT_COLOR = { trigger: '#22c55e', objective: '#3b82f6', reward: '#f59e0b', logic: '#a78bfa' };

  // an NPC's patrol: from its position through the numbered waypoints, then back to the start (or the same way back)
  function drawPatrol(n, home, color) {
    const pts = [{ x: home.x, z: home.z }].concat(n.p.patrol);
    if (!n.p.pback) pts.push(pts[0]);
    ctx.strokeStyle = color + 'cc';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    pts.forEach((pt, i) => { const [x, y] = w2s(pt.x, pt.z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    n.p.patrol.forEach((pt, i) => {
      const [x, y] = w2s(pt.x, pt.z);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#0b0d10';
      ctx.fillText(String(i + 1), x, y + 0.5);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function drawQuestOverlay(q) {
    const posNodes = [];
    q.nodes.forEach((n) => {
      const T = DS.NODE_TYPES[n.type];
      if (!T) return;
      const color = CAT_COLOR[T.cat];
      S.nodePosFields(n).forEach(({ field, pos }) => {
        if (!pos) return;
        const r = DS.resolvePos(pos);
        const [sx, sy] = w2s(r.x, r.z);
        const radius = field.k === 'pos' && typeof n.p.radius === 'number' ? n.p.radius : 0;
        const m = { node: n, sx, sy, x: r.x, z: r.z, color, radius, T };
        markers.push(m);
        if (!posNodes.includes(n)) posNodes.push(n);
        if (radius > 0) {
          ctx.beginPath();
          ctx.arc(sx, sy, radius * view.s, 0, Math.PI * 2);
          ctx.fillStyle = color + '22';
          ctx.fill();
          ctx.strokeStyle = color + 'cc';
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (pos.ref) {
          // tether to the shared object
          ctx.strokeStyle = 'rgba(250,204,21,.7)';
          ctx.beginPath(); ctx.arc(sx, sy, 13, 0, 7); ctx.stroke();
        }
        if (field.k === 'pos' && Array.isArray(n.p.patrol) && n.p.patrol.length) drawPatrol(n, r, color);
      });
    });
    // flow lines between positional nodes (through non-positional ones)
    const byId = new Map(q.nodes.map((n) => [n.id, n]));
    const firstPos = (n) => markers.find((m) => m.node === n);
    function descend(from, id, depth, seen) {
      if (depth > 8 || seen.has(id)) return;
      seen.add(id);
      const t = byId.get(id);
      if (!t) return;
      const mt = firstPos(t);
      if (mt) {
        drawArrow(from.sx, from.sy, mt.sx, mt.sy);
        return;
      }
      q.links.filter((l) => l.from === id).forEach((l) => descend(from, l.to, depth + 1, seen));
    }
    posNodes.forEach((n) => {
      const m = firstPos(n);
      q.links.filter((l) => l.from === n.id).forEach((l) => descend(m, l.to, 0, new Set([n.id])));
    });
    // nodes without own position still reachable from a positional parent: handled above
    markers.forEach((m) => {
      const sel = S.sel.kind === 'node' && S.sel.ids.includes(m.node.id);
      ctx.save();
      ctx.translate(m.sx, m.sy);
      ctx.fillStyle = m.color;
      ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.8)';
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(8, 0); ctx.lineTo(0, 9); ctx.lineTo(-8, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.T.title, m.sx + 12, m.sy - 1);
    });
  }
  function drawArrow(ax, ay, bx, by) {
    ctx.strokeStyle = 'rgba(226,232,240,.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    const a = Math.atan2(by - ay, bx - ax);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    ctx.fillStyle = 'rgba(226,232,240,.8)';
    ctx.beginPath();
    ctx.moveTo(mx + Math.cos(a) * 7, my + Math.sin(a) * 7);
    ctx.lineTo(mx + Math.cos(a + 2.5) * 7, my + Math.sin(a + 2.5) * 7);
    ctx.lineTo(mx + Math.cos(a - 2.5) * 7, my + Math.sin(a - 2.5) * 7);
    ctx.fill();
  }
})();
