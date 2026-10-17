/* DayZ Studio - loot spawns (Central Economy): vanilla data viewer + editor.
   Model:
     proto  = building loot definition   {n, lm, u:[usage], v:[tier], c:[container], x:[raw xml]}
     container = {n, lm, cat:[], tag:[], p:[[x,y,z,range,height,flags]]}   (point coords are LOCAL to the object)
     inst   = a placed building that owns loot  {id, g(class), x,y,z, yw}   (world coords)
   Project overrides live in project.loot = {removed, moved, added, protos}. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const L = (DS.Loot = {});

  L.state = 'idle'; // idle | loading | ok | none
  L.loadedWorld = null;
  L.base = null;
  L.protos = new Map();
  L.list = [];
  L.byId = new Map();
  L.header = '';
  L.types = [];
  L.limits = { categories: [], tags: [], usages: [], values: [] };
  L.ui = { show: true, points: true, usages: new Set(), cats: new Set(), onlyMod: false, group: '' };

  const COLORS = {
    Military: '#ef4444', Police: '#3b82f6', Medic: '#ec4899', Firefighter: '#f97316', Industrial: '#a3a3a3', Farm: '#84cc16',
    Coast: '#06b6d4', Town: '#eab308', Village: '#22c55e', Hunting: '#b45309', Office: '#8b5cf6', School: '#f472b6',
    Prison: '#94a3b8', Lunapark: '#d946ef', SeasonalEvent: '#fde047', ContaminatedArea: '#a3e635', Historical: '#fb7185',
  };
  L.color = (u) => COLORS[u] || '#e2e8f0';
  const DEFAULT_LIMITS = {
    categories: ['tools', 'containers', 'clothes', 'food', 'weapons', 'books', 'explosives'],
    tags: ['floor', 'shelves', 'ground'],
    usages: Object.keys(COLORS),
    values: ['Tier1', 'Tier2', 'Tier3', 'Tier4', 'Unique'],
  };

  const P = () => {
    const p = S.project;
    if (!p.loot) p.loot = { removed: [], moved: {}, added: [], protos: {} };
    return p.loot;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmt6 = (n) => (Math.round(n * 1e6) / 1e6).toFixed(6);

  /* ============================== loading ============================== */
  L.load = function (world) {
    world = world || S.project.meta.world;
    if (L.loadedWorld === world && (L.state === 'ok' || L.state === 'none')) return Promise.resolve();
    L.state = 'loading';
    S.emit('loot');
    return new Promise((res) => {
      const done = (d) => {
        if (d) ingest(d, world, 'ok');
        else ingest({ header: '', protos: [], names: [], inst: [], types: [], limits: {} }, world, 'none');
        res();
      };
      if (window.DS_LOOT && window.DS_LOOT[world]) return done(window.DS_LOOT[world]);
      const sc = document.createElement('script');
      sc.src = `maps/${world}/loot.js`;
      sc.onload = () => done(window.DS_LOOT && window.DS_LOOT[world]);
      sc.onerror = () => done(null);
      document.head.append(sc);
    });
  };

  function ingest(d, world, state) {
    L.base = d;
    L.loadedWorld = world;
    L.state = state;
    L.header = d.header || '';
    L.protos = new Map((d.protos || []).map((p) => [p.n, p]));
    L.types = d.types || [];
    const lim = d.limits || {};
    L.limits = {};
    Object.keys(DEFAULT_LIMITS).forEach((k) => (L.limits[k] = lim[k] && lim[k].length ? lim[k] : DEFAULT_LIMITS[k]));
    L.list = (d.inst || []).map((r, i) => ({
      id: 'v' + i, i, v: true, g: d.names[r[0]], x: r[1], y: r[2], z: r[3], r: r[4], p: r[5], yw: r[6], a: r[7],
      ox: r[1], oy: r[2], oz: r[3], oyw: r[6], del: false, ref: null,
    }));
    L.apply();
    S.emit('loot');
    S.emit('changed', 'loot');
  }

  let lastRef = null;
  /** (re)apply project.loot overrides onto the base instance list */
  L.apply = function () {
    const lp = P();
    lastRef = lp;
    L.list = L.list.filter((i) => i.v);
    L.list.forEach((i) => { i.x = i.ox; i.y = i.oy; i.z = i.oz; i.yw = i.oyw; i.del = false; i.ref = null; });
    const map = new Map(L.list.map((i) => [i.id, i]));
    lp.removed.forEach((id) => { const i = map.get(id); if (i) i.del = true; });
    Object.keys(lp.moved).forEach((id) => {
      const i = map.get(id), m = lp.moved[id];
      if (i) { i.x = m.x; i.y = m.y; i.z = m.z; i.yw = m.yw; }
    });
    lp.added.forEach((a) => L.list.push({ id: a.id, v: false, g: a.g, x: a.x, y: a.y || 0, z: a.z, r: 0, p: 0, yw: a.yw || 0, del: false, ref: a.ref || null }));
    L.byId = new Map(L.list.map((i) => [i.id, i]));
  };

  // undo/redo/open replace project.loot -> re-apply
  S.on('structure', () => {
    if (L.base && S.project.loot !== lastRef) L.apply();
  });
  S.on('project', () => {
    if (S.project.meta.world !== L.loadedWorld) L.load(S.project.meta.world);
    else if (L.base) L.apply();
  });

  L.sync = function () {
    const lp = P();
    lp.removed = [];
    lp.moved = {};
    lp.added = [];
    L.list.forEach((i) => {
      if (i.v) {
        if (i.del) lp.removed.push(i.id);
        else if (Math.abs(i.x - i.ox) > 1e-3 || Math.abs(i.z - i.oz) > 1e-3 || Math.abs(i.y - i.oy) > 1e-3 || Math.abs(i.yw - i.oyw) > 1e-3)
          lp.moved[i.id] = { x: U.round(i.x, 3), y: U.round(i.y, 3), z: U.round(i.z, 3), yw: U.round(i.yw, 3) };
      } else lp.added.push({ id: i.id, g: i.g, x: U.round(i.x, 3), y: U.round(i.y, 3), z: U.round(i.z, 3), yw: U.round(i.yw, 3), ref: i.ref || null });
    });
    lastRef = lp;
    L.byId = new Map(L.list.map((i) => [i.id, i]));
    S.changed('loot');
    S.emit('loot');
  };

  /* ============================== queries ============================== */
  L.proto = (name) => P().protos[name] || L.protos.get(name) || null;
  L.isEdited = (name) => !!P().protos[name];
  L.isVanillaProto = (name) => L.protos.has(name);
  L.protoNames = () => [...new Set([...L.protos.keys(), ...Object.keys(P().protos)])].sort();
  L.countOf = (g) => L.list.reduce((n, i) => n + (i.g === g && !i.del ? 1 : 0), 0);
  L.xf = function (i) {
    if (i.ref) {
      const o = S.obj(i.ref);
      if (o) return { x: o.x, y: o.y, z: o.z, yw: o.yaw };
    }
    return i;
  };
  L.toWorld = (xf, px, pz) => {
    const a = U.deg2rad(xf.yw || 0), c = Math.cos(a), s = Math.sin(a);
    return [xf.x + px * c + pz * s, xf.z - px * s + pz * c];
  };
  L.toLocal = (xf, wx, wz) => {
    const a = U.deg2rad(xf.yw || 0), c = Math.cos(a), s = Math.sin(a);
    const dx = wx - xf.x, dz = wz - xf.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  /** placed project objects that own vanilla loot (buildings with a loot definition) */
  L.autoInstances = function () {
    const out = [];
    S.project.objects.forEach((o) => {
      if (o.noLoot || (o.kind !== 'building' && o.kind !== 'prop')) return;
      if (!L.proto(o.c)) return;
      out.push({ id: 'o:' + o.id, g: o.c, x: o.x, y: o.y, z: o.z, yw: o.yaw, auto: true, obj: o });
    });
    return out;
  };
  L.pointCount = (g) => {
    const p = L.proto(g);
    return p ? p.c.reduce((n, c) => n + c.p.length, 0) : 0;
  };
  L.stats = function () {
    const lp = P();
    return {
      instances: L.list.filter((i) => !i.del).length,
      points: L.list.reduce((n, i) => n + (i.del ? 0 : L.pointCount(i.g)), 0),
      added: lp.added.length, removed: lp.removed.length, moved: Object.keys(lp.moved).length, protos: Object.keys(lp.protos).length,
    };
  };
  L.modified = () => { const s = L.stats(); return s.added + s.removed + s.moved + s.protos > 0; };

  /** items the Central Economy may place in this group (usage + category match, nominal > 0) */
  L.itemsFor = function (proto) {
    if (!proto || !L.types.length) return [];
    const cats = new Set();
    proto.c.forEach((c) => c.cat.forEach((x) => cats.add(x)));
    const us = new Set(proto.u);
    return L.types
      .filter((t) => t[1] > 0 && cats.has(t[2]) && (t[3].length === 0 ? false : t[3].some((u) => us.has(u))))
      .sort((a, b) => b[1] - a[1]);
  };

  /* ============================== editing ============================== */
  L.defaultProto = (name) => ({ n: name, lm: 4, u: ['Town'], v: [], c: [{ n: 'lootFloor', lm: 3, cat: ['tools', 'food', 'clothes'], tag: ['floor'], p: [] }], x: [] });
  L.edit = function (name) {
    const lp = P();
    if (!lp.protos[name]) lp.protos[name] = clone(L.protos.get(name) || L.defaultProto(name));
    return lp.protos[name];
  };
  L.resetProto = function (name) {
    delete P().protos[name];
    S.changed('loot');
    S.emit('loot');
  };
  L.newProto = function (name, templateName) {
    const base = templateName && L.proto(templateName) ? clone(L.proto(templateName)) : L.defaultProto(name);
    base.n = name;
    P().protos[name] = base;
    S.changed('loot');
    S.emit('loot');
    return base;
  };
  L.addInstance = function (g, x, z, yaw, ref) {
    if (!L.proto(g)) L.newProto(g);
    const i = { id: U.uid('lt'), v: false, g, x: U.round(x, 2), y: 0, z: U.round(z, 2), r: 0, p: 0, yw: yaw || 0, del: false, ref: ref || null };
    L.list.push(i);
    L.sync();
    return i;
  };
  L.deleteInstances = function (ids) {
    const set = new Set(ids);
    L.list = L.list.filter((i) => !(set.has(i.id) && !i.v));
    L.list.forEach((i) => { if (set.has(i.id) && i.v) i.del = true; });
    L.sync();
  };
  L.rotate = function (ids, deg) {
    ids.forEach((id) => {
      const i = L.byId.get(id);
      if (i && !i.ref) i.yw = U.round(((i.yw + deg + 540) % 360) - 180, 2);
    });
    L.sync();
  };
  L.nudge = function (ids, dx, dz) {
    ids.forEach((id) => {
      const i = L.byId.get(id);
      if (i && !i.ref) { i.x = U.round(i.x + dx, 2); i.z = U.round(i.z + dz, 2); }
    });
    L.sync();
  };
  L.duplicate = function (ids) {
    const out = [];
    ids.forEach((id) => {
      const i = L.byId.get(id);
      if (i) out.push(L.addInstance(i.g, i.x + 5, i.z - 5, i.yw));
    });
    return out;
  };
  L.addPoint = function (inst, ci, wx, wz) {
    const pr = L.edit(inst.g);
    const c = pr.c[ci];
    if (!c) return;
    const [px, pz] = L.toLocal(L.xf(inst), wx, wz);
    const last = c.p[c.p.length - 1];
    const py = c.p.length ? c.p.reduce((a, q) => a + q[1], 0) / c.p.length : 0;
    c.p.push([U.round(px, 3), U.round(py, 3), U.round(pz, 3), last ? last[3] : 1, last ? last[4] : 1.5, last ? last[5] : null]);
    S.changed('loot');
  };

  /* ============================== visibility / filter ============================== */
  function visibleProto(pr) {
    if (!pr) return L.ui.usages.size === 0 && L.ui.cats.size === 0;
    if (L.ui.usages.size && !pr.u.some((u) => L.ui.usages.has(u))) return false;
    if (L.ui.cats.size && !pr.c.some((c) => c.cat.some((x) => L.ui.cats.has(x)))) return false;
    return true;
  }
  const isMod = (i) => !i.v || i.del || i.x !== i.ox || i.z !== i.oz || i.yw !== i.oyw || L.isEdited(i.g);
  function visible(i, pr) {
    if (L.ui.group && i.g !== L.ui.group) return false;
    if (L.ui.onlyMod && !isMod(i)) return false;
    return visibleProto(pr);
  }
  L.layerOn = () => L.ui.show && S.project.meta.showLoot !== false && L.base;

  /* ============================== rendering ============================== */
  L.render = function (ctx, H) {
    if (!L.layerOn()) return;
    const { w2s, s, W, Hh } = H;
    const sel = S.sel.kind === 'loot' ? new Set(S.sel.ids) : null;
    const showPts = L.ui.points && s >= 0.3;
    const dotR = s > 0.1 ? 3 : s > 0.04 ? 2.2 : 1.5;
    const cache = new Map();
    const protoOf = (g) => {
      let p = cache.get(g);
      if (p === undefined) { p = L.proto(g); cache.set(g, p); }
      return p;
    };
    const all = L.auto === false ? L.list : L.list.concat(L.autoInstances());
    ctx.save();
    for (let n = 0; n < all.length; n++) {
      const i = all[n];
      if (i.del) continue;
      const xf = i.auto ? i : L.xf(i);
      const [sx, sy] = w2s(xf.x, xf.z);
      if (sx < -60 || sy < -60 || sx > W + 60 || sy > Hh + 60) continue;
      const pr = protoOf(i.g);
      if (!visible(i, pr)) continue;
      const isSel = sel && sel.has(i.id);
      const col = pr && pr.u.length ? L.color(pr.u[0]) : '#e2e8f0';
      if (showPts || isSel) {
        if (!pr) continue;
        pr.c.forEach((c) => {
          c.p.forEach((pt) => {
            const [wx, wz] = L.toWorld(xf, pt[0], pt[2]);
            const [px, py] = w2s(wx, wz);
            const rr = Math.max(2.5, (pt[3] || 0.5) * s);
            ctx.fillStyle = col + '55';
            ctx.strokeStyle = col;
            ctx.lineWidth = isSel ? 1.5 : 1;
            ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832); ctx.fill(); ctx.stroke();
            ctx.fillStyle = isSel ? '#fff' : col;
            ctx.fillRect(px - 1, py - 1, 2, 2);
          });
        });
      } else {
        ctx.fillStyle = col;
        ctx.globalAlpha = i.auto ? 1 : 0.85;
        ctx.beginPath(); ctx.arc(sx, sy, dotR, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (isMod(i) && !i.auto) {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, dotR + 3, 0, 6.2832); ctx.stroke();
      }
      if (isSel) {
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, 10, 0, 6.2832); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.sin(U.deg2rad(xf.yw)) * 18, sy - Math.cos(U.deg2rad(xf.yw)) * 18); ctx.stroke();
        ctx.font = '600 11px system-ui';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(i.g, sx + 14, sy - 12);
        ctx.fillStyle = '#fff'; ctx.fillText(i.g, sx + 14, sy - 12);
      }
    }
    ctx.restore();
  };

  /** preview of a group's points at the cursor while placing */
  L.renderGhost = function (ctx, w2s, s, g, x, z, yaw) {
    const pr = L.proto(g);
    if (!pr) return;
    const col = pr.u.length ? L.color(pr.u[0]) : '#fff';
    ctx.save();
    ctx.globalAlpha = 0.8;
    pr.c.forEach((c) => c.p.forEach((pt) => {
      const [wx, wz] = L.toWorld({ x, z, yw: yaw }, pt[0], pt[2]);
      const [px, py] = w2s(wx, wz);
      ctx.strokeStyle = col; ctx.fillStyle = col + '44';
      ctx.beginPath(); ctx.arc(px, py, Math.max(3, (pt[3] || 0.5) * s), 0, 6.2832); ctx.fill(); ctx.stroke();
    }));
    const [cx, cy] = w2s(x, z);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 6.2832); ctx.fill();
    ctx.restore();
  };

  /* ============================== hit testing ============================== */
  L.hit = function (sx, sy, w2s) {
    if (!L.layerOn()) return null;
    let best = null, bd = 11;
    const cache = new Map();
    for (let n = 0; n < L.list.length; n++) {
      const i = L.list[n];
      if (i.del) continue;
      const xf = L.xf(i);
      const [px, py] = w2s(xf.x, xf.z);
      const d = Math.hypot(px - sx, py - sy);
      if (d >= bd) continue;
      let pr = cache.get(i.g);
      if (pr === undefined) { pr = L.proto(i.g); cache.set(i.g, pr); }
      if (!visible(i, pr)) continue;
      bd = d;
      best = i.id;
    }
    return best;
  };
  L.hitPoint = function (inst, sx, sy, w2s) {
    const pr = L.proto(inst.g);
    if (!pr) return null;
    const xf = L.xf(inst);
    let best = null, bd = 9;
    pr.c.forEach((c, ci) => c.p.forEach((pt, k) => {
      const [wx, wz] = L.toWorld(xf, pt[0], pt[2]);
      const [px, py] = w2s(wx, wz);
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = { ci, k }; }
    }));
    return best;
  };
  L.movePoint = function (inst, ci, k, wx, wz) {
    const pr = L.edit(inst.g);
    const [px, pz] = L.toLocal(L.xf(inst), wx, wz);
    const pt = pr.c[ci].p[k];
    pt[0] = U.round(px, 3);
    pt[2] = U.round(pz, 3);
    S.changed('loot');
  };

  /* ============================== import (user's own mission files) ============================== */
  L.importXml = function (kind, text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('Not valid XML');
    if (!L.base) ingest({ header: '', protos: [], names: [], inst: [], types: [], limits: {} }, S.project.meta.world, 'ok');
    const d = L.base;
    if (kind === 'proto') {
      d.header = (text.match(/<defaults>[\s\S]*?<\/defaults>/) || [''])[0];
      const ser = new XMLSerializer();
      d.protos = [...doc.getElementsByTagName('group')].map((g) => {
        const p = { n: g.getAttribute('name'), lm: g.hasAttribute('lootmax') ? +g.getAttribute('lootmax') : null, u: [], v: [], c: [], x: [] };
        [...g.children].forEach((ch) => {
          if (ch.tagName === 'usage') p.u.push(ch.getAttribute('name'));
          else if (ch.tagName === 'value') p.v.push(ch.getAttribute('name'));
          else if (ch.tagName === 'container') {
            const c = { n: ch.getAttribute('name'), lm: ch.hasAttribute('lootmax') ? +ch.getAttribute('lootmax') : null, cat: [], tag: [], p: [] };
            [...ch.children].forEach((k) => {
              if (k.tagName === 'category') c.cat.push(k.getAttribute('name'));
              else if (k.tagName === 'tag') c.tag.push(k.getAttribute('name'));
              else if (k.tagName === 'point') {
                const q = k.getAttribute('pos').trim().split(/\s+/).map(Number);
                c.p.push([q[0], q[1], q[2], k.hasAttribute('range') ? +k.getAttribute('range') : null, k.hasAttribute('height') ? +k.getAttribute('height') : null, k.hasAttribute('flags') ? +k.getAttribute('flags') : null]);
              }
            });
            p.c.push(c);
          } else p.x.push(ser.serializeToString(ch).replace(/\s*xmlns="[^"]*"/, ''));
        });
        return p;
      });
    } else if (kind === 'pos') {
      const names = [], idx = {}, inst = [];
      [...doc.getElementsByTagName('group')].forEach((g) => {
        const n = g.getAttribute('name');
        if (!(n in idx)) { idx[n] = names.length; names.push(n); }
        const p = g.getAttribute('pos').trim().split(/\s+/).map(Number);
        const r = (g.getAttribute('rpy') || '0 0 0').trim().split(/\s+/).map(Number);
        inst.push([idx[n], p[0], p[1], p[2], r[0], r[1], r[2], g.hasAttribute('a') ? +g.getAttribute('a') : 90 - r[2]]);
      });
      d.names = names;
      d.inst = inst;
    } else if (kind === 'types') {
      d.types = [...doc.getElementsByTagName('type')].map((t) => {
        const q = (tag) => t.getElementsByTagName(tag);
        return [t.getAttribute('name'), q('nominal')[0] ? +q('nominal')[0].textContent : 0, q('category')[0] ? q('category')[0].getAttribute('name') : '',
          [...q('usage')].map((u) => u.getAttribute('name')), [...q('value')].map((u) => u.getAttribute('name'))];
      });
    }
    S.project.loot = { removed: [], moved: {}, added: [], protos: {} };
    ingest(d, S.project.meta.world, 'ok');
    S.commit();
  };

  /* ============================== export serialisation ============================== */
  L.exportPos = function () {
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>', '<map>'];
    const all = L.list.filter((i) => !i.del).concat(L.autoInstances());
    all.forEach((i) => {
      const xf = i.auto ? i : L.xf(i);
      const roll = i.r || 0, pitch = i.p || 0;
      const yaw = xf.yw || 0;
      out.push(`    <group name="${U.xml(i.g)}" pos="${fmt6(xf.x)} ${fmt6(xf.y || 0)} ${fmt6(xf.z)}" rpy="${fmt6(roll)} ${fmt6(pitch)} ${fmt6(yaw)}" a="${fmt6(90 - yaw)}" />`);
    });
    out.push('</map>');
    return out.join('\n') + '\n';
  };
  L.exportProto = function () {
    const names = new Set();
    const groups = [];
    const emit = (p) => {
      if (names.has(p.n)) return;
      names.add(p.n);
      const L2 = [`\t\t<group name="${U.xml(p.n)}"${p.lm != null ? ` lootmax="${p.lm}"` : ''}>`];
      p.u.forEach((u) => L2.push(`\t\t\t<usage name="${U.xml(u)}" />`));
      p.v.forEach((v) => L2.push(`\t\t\t<value name="${U.xml(v)}" />`));
      p.c.forEach((c) => {
        L2.push(`\t\t\t<container name="${U.xml(c.n)}"${c.lm != null ? ` lootmax="${c.lm}"` : ''}>`);
        c.cat.forEach((x) => L2.push(`\t\t\t\t<category name="${U.xml(x)}" />`));
        c.tag.forEach((x) => L2.push(`\t\t\t\t<tag name="${U.xml(x)}" />`));
        c.p.forEach((q) => L2.push(`\t\t\t\t<point pos="${fmt6(q[0])} ${fmt6(q[1])} ${fmt6(q[2])}"${q[3] != null ? ` range="${fmt6(q[3])}"` : ''}${q[4] != null ? ` height="${fmt6(q[4])}"` : ''}${q[5] != null ? ` flags="${q[5]}"` : ''} />`));
        L2.push('\t\t\t</container>');
      });
      (p.x || []).forEach((raw) => L2.push('\t\t\t' + raw));
      L2.push('\t\t</group>');
      groups.push(L2.join('\n'));
    };
    // vanilla order first (edited versions substituted), then brand-new groups
    L.protos.forEach((p, n) => emit(P().protos[n] || p));
    Object.keys(P().protos).forEach((n) => emit(P().protos[n]));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<prototype>\n\t${L.header || '<defaults />'}\n${groups.join('\n')}\n</prototype>\n`;
  };
  L.changeLog = function () {
    const lp = P();
    const s = L.stats();
    const out = [`Loot changes (${S.project.meta.world})`, `added: ${s.added}  removed: ${s.removed}  moved: ${s.moved}  edited groups: ${s.protos}`, ''];
    lp.added.forEach((a) => out.push(`+ ${a.g} @ ${a.x}, ${a.z}  yaw ${a.yw}${a.ref ? '  (follows a placed object)' : ''}`));
    lp.removed.forEach((id) => { const i = L.byId.get(id); out.push(`- ${i ? i.g + ' @ ' + Math.round(i.ox) + ', ' + Math.round(i.oz) : id}`); });
    Object.keys(lp.moved).forEach((id) => { const i = L.byId.get(id); out.push(`~ ${i ? i.g : id} -> ${lp.moved[id].x}, ${lp.moved[id].z}`); });
    Object.keys(lp.protos).forEach((n) => out.push(`* group definition ${L.protos.has(n) ? 'edited' : 'created'}: ${n}`));
    return out.join('\n') + '\n';
  };

  /* ============================== small UI helpers ============================== */
  const numI = (v, fn, step) => {
    const i = el('input', { class: 'inp', type: 'number', value: v == null ? '' : v, step: step || 'any' });
    i.addEventListener('input', () => { if (i.value !== '' && i.value !== '-') fn(U.num(i.value)); });
    i.addEventListener('change', () => S.commit());
    return i;
  };
  const textI = (v, fn, list) => {
    const i = el('input', { class: 'inp', type: 'text', value: v == null ? '' : v });
    if (list) i.setAttribute('list', list);
    i.addEventListener('input', () => fn(i.value));
    i.addEventListener('change', () => S.commit());
    return i;
  };
  function chips(options, selected, onToggle, colorFn) {
    return el('div', { class: 'chips' }, options.map((o) => {
      const on = selected.includes(o);
      const c = colorFn ? colorFn(o) : null;
      return el('button', { class: 'chip' + (on ? ' on' : ''), style: on && c ? { background: c + '33', borderColor: c } : {}, onclick: () => onToggle(o, !on) }, o);
    }));
  }

  /* ============================== inspector (selected loot spawn) ============================== */
  L.inspector = function (inst) {
    const box = el('div', { class: 'ins-body' });
    const ch = () => { S.changed('loot'); S.emit('loot'); };
    function draw() {
      box.innerHTML = '';
      const pr = L.proto(inst.g);
      const n = L.countOf(inst.g);
      const xf = L.xf(inst);
      box.append(el('div', { class: 'ins-head' },
        el('span', { class: 'dot', style: { background: pr && pr.u[0] ? L.color(pr.u[0]) : '#e2e8f0' } }),
        el('div', null, el('div', { class: 'ins-title' }, inst.g), el('div', { class: 'ins-sub' }, inst.v ? 'Vanilla loot spawn' + (isMod(inst) ? ' (modified)' : '') : 'Custom loot spawn'))));

      // --- position
      const sec1 = el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, 'This spawn'));
      if (inst.ref) {
        sec1.append(el('div', { class: 'ins-help' }, 'Follows a placed object — move or rotate that object to move this loot.'));
      } else {
        sec1.append(el('div', { class: 'posw-row' },
          el('div', { class: 'posw-c' }, el('span', null, 'X'), numI(U.round(inst.x, 2), (v) => { inst.x = v; L.sync(); })),
          el('div', { class: 'posw-c' }, el('span', null, 'Y'), numI(U.round(inst.y, 2), (v) => { inst.y = v; L.sync(); })),
          el('div', { class: 'posw-c' }, el('span', null, 'Z'), numI(U.round(inst.z, 2), (v) => { inst.z = v; L.sync(); })),
          el('div', { class: 'posw-c' }, el('span', null, 'Yaw'), numI(U.round(inst.yw, 1), (v) => { inst.yw = v; L.sync(); }))));
      }
      const objSel = el('select', { class: 'inp' }, el('option', { value: '' }, '— not linked —'));
      S.project.objects.forEach((o) => objSel.append(el('option', { value: o.id, selected: inst.ref === o.id }, `${o.label || U.pretty(o.c)} (${Math.round(o.x)}, ${Math.round(o.z)})`)));
      objSel.addEventListener('change', () => {
        if (!inst.v) { inst.ref = objSel.value || null; if (inst.ref) { const o = S.obj(inst.ref); if (o) { inst.g = inst.g; inst.x = o.x; inst.z = o.z; inst.yw = o.yaw; } } L.sync(); S.commit(); draw(); }
      });
      if (!inst.v) sec1.append(el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Attach to placed object'), objSel));
      sec1.append(el('div', { class: 'btn-row' },
        el('button', { class: 'btn sm', onclick: () => DS.MapView.centerOn(xf.x, xf.z, 0.6) }, '⌖ Show'),
        el('button', { class: 'btn sm', onclick: () => { const c = L.duplicate([inst.id]); S.select('loot', c.map((x) => x.id)); S.commit(); } }, 'Duplicate'),
        inst.v && (inst.x !== inst.ox || inst.z !== inst.oz || inst.yw !== inst.oyw) ? el('button', { class: 'btn sm', onclick: () => { inst.x = inst.ox; inst.y = inst.oy; inst.z = inst.oz; inst.yw = inst.oyw; L.sync(); S.commit(); draw(); } }, 'Reset position') : null,
        el('button', { class: 'btn sm danger', onclick: () => { L.deleteInstances([inst.id]); S.select(null, []); S.commit(); } }, 'Delete spawn')));
      box.append(sec1);

      if (!pr) {
        box.append(el('div', { class: 'ins-sec' }, el('div', { class: 'issue warn' }, `No loot definition exists for “${inst.g}”. Items can’t spawn until it has one.`),
          el('button', { class: 'btn primary', onclick: () => { L.newProto(inst.g); S.commit(); draw(); } }, 'Create loot definition')));
        return;
      }

      // --- group definition
      const edited = L.isEdited(inst.g);
      const sec2 = el('div', { class: 'ins-sec' },
        el('div', { class: 'ins-sec-title' }, 'Loot definition (applies to all ' + n + ' “' + inst.g + '”)'),
        n > 1 ? el('div', { class: 'ins-help' }, `Editing this changes the loot at every ${inst.g} on the map (that is how DayZ stores it).`) : null,
        el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Max loot items in the building (lootmax)'),
          numI(pr.lm == null ? '' : pr.lm, (v) => { L.edit(inst.g).lm = Math.max(0, Math.round(v)); ch(); }, 1)),
        el('div', { class: 'ins-label' }, 'Usage (which loot tables apply)'),
        chips(L.limits.usages, pr.u, (u, on) => {
          const p = L.edit(inst.g);
          p.u = on ? [...p.u, u] : p.u.filter((x) => x !== u);
          ch(); draw();
        }, L.color),
        el('div', { class: 'ins-label' }, 'Tier values (optional)'),
        chips(L.limits.values, pr.v, (u, on) => {
          const p = L.edit(inst.g);
          p.v = on ? [...p.v, u] : p.v.filter((x) => x !== u);
          ch(); draw();
        }));
      box.append(sec2);

      // --- containers + points
      pr.c.forEach((c, ci) => {
        const sec = el('div', { class: 'ins-sec' });
        sec.append(el('div', { class: 'ins-sec-title' }, `Container ${ci + 1}`),
          el('div', { class: 'item-row cont' },
            textI(c.n, (v) => { L.edit(inst.g).c[ci].n = v; ch(); }),
            numI(c.lm == null ? '' : c.lm, (v) => { L.edit(inst.g).c[ci].lm = Math.max(0, Math.round(v)); ch(); }, 1),
            el('button', { class: 'btn icon', title: 'Remove container', onclick: () => { L.edit(inst.g).c.splice(ci, 1); ch(); S.commit(); draw(); } }, '✕')),
          el('div', { class: 'ins-help' }, 'name  •  max items in this container'),
          el('div', { class: 'ins-label' }, 'Item categories'),
          chips(L.limits.categories, c.cat, (x, on) => {
            const cc = L.edit(inst.g).c[ci];
            cc.cat = on ? [...cc.cat, x] : cc.cat.filter((y) => y !== x);
            ch(); draw();
          }),
          el('div', { class: 'ins-label' }, 'Placement tags'),
          chips(L.limits.tags, c.tag, (x, on) => {
            const cc = L.edit(inst.g).c[ci];
            cc.tag = on ? [...cc.tag, x] : cc.tag.filter((y) => y !== x);
            ch(); draw();
          }));
        const tbl = el('div', { class: 'pt-table' }, el('div', { class: 'pt-row pt-head' }, ['x', 'y', 'z', 'range', 'height', ''].map((h) => el('span', null, h))));
        c.p.forEach((pt, k) => {
          const set = (idx) => (v) => { L.edit(inst.g).c[ci].p[k][idx] = v; S.changed('loot'); };
          tbl.append(el('div', { class: 'pt-row' },
            numI(U.round(pt[0], 3), set(0)), numI(U.round(pt[1], 3), set(1)), numI(U.round(pt[2], 3), set(2)),
            numI(pt[3] == null ? '' : U.round(pt[3], 3), set(3)), numI(pt[4] == null ? '' : U.round(pt[4], 3), set(4)),
            el('button', { class: 'btn icon', title: 'Delete point', onclick: () => { L.edit(inst.g).c[ci].p.splice(k, 1); ch(); S.commit(); draw(); } }, '✕')));
        });
        sec.append(tbl,
          el('div', { class: 'btn-row' },
            el('button', { class: 'btn sm primary', title: 'Click the map repeatedly to add points; Esc to finish', onclick: () => {
              const again = () => DS.pickPosition({ prompt: `Click the map to add loot points to “${inst.g}” — Esc to finish` }, (r) => {
                L.addPoint(inst, ci, r.x, r.z); S.commit(); draw(); again();
              });
              again();
            } }, '＋ Add points on map'),
            el('button', { class: 'btn sm', onclick: () => { L.addPoint(inst, ci, xf.x, xf.z); ch(); S.commit(); draw(); } }, '＋ Point at centre')));
        box.append(sec);
      });
      box.append(el('div', { class: 'ins-sec' },
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn sm', onclick: () => {
            const p = L.edit(inst.g);
            p.c.push({ n: 'lootFloor' + (p.c.length + 1), lm: 2, cat: ['tools'], tag: ['floor'], p: [] });
            ch(); S.commit(); draw();
          } }, '＋ Add container'),
          edited && L.isVanillaProto(inst.g) ? el('button', { class: 'btn sm', onclick: () => { L.resetProto(inst.g); S.commit(); draw(); } }, 'Reset definition to vanilla') : null,
          !L.isVanillaProto(inst.g) ? el('button', { class: 'btn sm danger', onclick: () => { L.resetProto(inst.g); S.commit(); draw(); } }, 'Delete custom definition') : null)));

      // --- what can spawn
      const items = L.itemsFor(pr);
      const sec3 = el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, 'What can spawn here'));
      if (!L.types.length) sec3.append(el('div', { class: 'ins-help' }, 'Load types.xml (File ▸ Import) to see matching items.'));
      else {
        sec3.append(el('div', { class: 'ins-help' }, `${items.length} item types match this group’s usage + categories (ordered by nominal count).`));
        const list = el('div', { class: 'spawn-list' });
        items.slice(0, 60).forEach((t) => list.append(el('div', { class: 'spawn-item' }, el('span', null, t[0]), el('span', { class: 'muted' }, `${t[2]} · ${t[1]}`))));
        sec3.append(list);
      }
      box.append(sec3);
    }
    draw();
    return box;
  };

  /* ============================== left panel tab ============================== */
  L.panel = function (body, search, redraw) {
    const world = S.project.meta.world;
    if (L.loadedWorld !== world && L.state !== 'loading') L.load(world).then(redraw);
    const st = L.stats();
    const head = el('div', { class: 'loot-head' });
    if (L.state === 'loading') head.append(el('div', { class: 'muted' }, 'Loading loot data…'));
    else if (L.state === 'none')
      head.append(el('div', { class: 'hint-box' }, 'No built-in loot data for this map. Import your mission’s mapgroupproto.xml and mapgrouppos.xml to view and edit its loot, or create loot groups from scratch.'));
    else head.append(el('div', { class: 'loot-stat' }, el('b', null, st.instances.toLocaleString()), ' spawn buildings · ', el('b', null, st.points.toLocaleString()), ' points'));
    body.append(head);

    body.append(el('div', { class: 'ins-sec' },
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: L.ui.show, onchange: (e) => { L.ui.show = e.target.checked; S.emit('changed', 'loot'); } }), el('span', null, 'Show loot spawns on the map')),
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: L.ui.points, onchange: (e) => { L.ui.points = e.target.checked; S.emit('changed', 'loot'); } }), el('span', null, 'Show individual points when zoomed in')),
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: L.ui.onlyMod, onchange: (e) => { L.ui.onlyMod = e.target.checked; S.emit('changed', 'loot'); } }), el('span', null, 'Only show changes'))));

    const leg = el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, 'Filter by usage (click to isolate)'));
    leg.append(chips(L.limits.usages, [...L.ui.usages], (u, on) => { on ? L.ui.usages.add(u) : L.ui.usages.delete(u); S.emit('changed', 'loot'); redraw(); }, L.color));
    leg.append(el('div', { class: 'ins-sec-title' }, 'Filter by item category'));
    leg.append(chips(L.limits.categories, [...L.ui.cats], (u, on) => { on ? L.ui.cats.add(u) : L.ui.cats.delete(u); S.emit('changed', 'loot'); redraw(); }));
    body.append(leg);

    body.append(el('div', { class: 'btn-row pad' },
      el('button', { class: 'btn sm primary', onclick: () => newGroupDialog() }, '＋ New loot group'),
      el('button', { class: 'btn sm', disabled: !L.modified(), onclick: () => { if (confirm('Discard ALL loot changes in this project?')) { S.project.loot = { removed: [], moved: {}, added: [], protos: {} }; L.apply(); S.changed('loot'); S.commit(); redraw(); } } }, 'Reset changes')));
    if (L.modified()) body.append(el('div', { class: 'ins-help', style: { padding: '0 12px 8px' } }, `Changes: +${st.added} added · −${st.removed} removed · ~${st.moved} moved · ${st.protos} group definitions`));

    body.append(el('div', { class: 'mini-title' }, 'Loot groups (click to place on map)'));
    const names = L.protoNames().filter((n) => !search || n.toLowerCase().includes(search));
    const counts = new Map();
    L.list.forEach((i) => { if (!i.del) counts.set(i.g, (counts.get(i.g) || 0) + 1); });
    names.slice(0, 250).forEach((n) => {
      const pr = L.proto(n);
      const active = S.asset && S.asset.kind === 'lootgroup' && S.asset.c === n && S.tool === 'place';
      body.append(el('div', { class: 'asset' + (active ? ' active' : ''), title: `${(pr.u || []).join(', ')}`,
        onclick: () => { S.setView('map'); S.select(null, []); S.setAsset({ c: n, kind: 'lootgroup', label: n + ' (loot)' }); DS.toast(`Placing loot spawn: ${n} — click the map`, 'info', 2200); } },
        el('span', { class: 'dot', style: { background: pr.u[0] ? L.color(pr.u[0]) : '#e2e8f0' } }),
        el('span', { class: 'asset-name' }, n + (L.isEdited(n) ? ' ✎' : '')),
        el('span', { class: 'asset-sub' }, `${counts.get(n) || 0}× · ${pr.c.reduce((a, c) => a + c.p.length, 0)} pts`),
        el('button', { class: 'btn icon', title: 'Select every spawn of this group', onclick: (e) => {
          e.stopPropagation();
          const ids = L.list.filter((i) => i.g === n && !i.del).map((i) => i.id);
          S.setView('map'); S.select('loot', ids);
          if (ids.length) { const f = L.byId.get(ids[0]); DS.MapView.centerOn(f.x, f.z); }
        } }, '◎')));
    });
    if (names.length > 250) body.append(el('div', { class: 'ins-help', style: { padding: '6px 12px' } }, `Showing 250 of ${names.length} — use the search box.`));
  };

  function newGroupDialog() {
    let name = '', template = '';
    const dl = el('datalist', { id: 'loot-names' });
    L.protoNames().forEach((n) => dl.append(el('option', { value: n })));
    const body = el('div', { class: 'ins-sec' }, dl,
      el('div', { class: 'ins-help' }, 'A loot group is the loot definition for one object class (building model). Use the exact class name of the object the loot should belong to — e.g. a custom building you placed.'),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Object class name'), el('input', { class: 'inp', list: 'dz-classes', oninput: (e) => (name = e.target.value.trim()) })),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Start from existing group (optional)'), el('input', { class: 'inp', list: 'loot-names', placeholder: 'e.g. Land_Mil_Barracks1', oninput: (e) => (template = e.target.value.trim()) })));
    let close;
    close = DS.app.modal({
      title: 'New loot group', body,
      buttons: (c) => [
        el('button', { class: 'btn primary', onclick: () => {
          if (!name) return DS.toast('Enter a class name.', 'warn');
          if (L.proto(name)) return DS.toast('That group already exists — find it in the list.', 'warn');
          L.newProto(name, template);
          S.commit();
          c();
          S.setView('map');
          S.setAsset({ c: name, kind: 'lootgroup', label: name + ' (loot)' });
          DS.toast('Created. Click the map to place it, then add points.', 'ok');
        } }, 'Create & place'),
        el('button', { class: 'btn', onclick: c }, 'Cancel'),
      ],
    });
  }
  L.newGroupDialog = newGroupDialog;
})();
