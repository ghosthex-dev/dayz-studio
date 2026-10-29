/* DayZ Studio - loot zones (Central Economy area flags).
   The game stores "where do which loot tiers / usages apply" in areaflags.map:
     header 24 bytes [cellsX, cellsZ, mapW, mapH, usage bits, 0]
     usage-flag grid, 32 bits per cell (16 on some mod maps, e.g. Deer Isle; bit order = cfglimitsdefinition usageflags)
     tier grid, 8 bits (Tier1..Tier4, Unique), 4 bits, or 16 bits (mod maps with more tiers, e.g. Deer Isle's Tier1..Tier15)
     rows start at the SOUTH edge. An exported file keeps the map's own layout.
   Zones are vector shapes (polygon / circle) painted over the vanilla raster in order. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const Z = (DS.Zones = {});

  const TIERS = ['Tier1', 'Tier2', 'Tier3', 'Tier4', 'Unique'];
  const TIER_COL = ['#3cc83c', '#e6dc3c', '#f08c28', '#e63232', '#ffffff'];
  const USAGES = ['Military', 'Police', 'Medic', 'Firefighter', 'Industrial', 'Farm', 'Coast', 'Town', 'Village', 'Hunting', 'Office', 'School', 'Prison', 'Lunapark', 'SeasonalEvent', 'ContaminatedArea', 'Historical'];

  Z.state = 'idle'; // idle | loading | ok | none
  Z.loadedWorld = null;
  Z.base = null; // {usage:Uint32Array, value:Uint8Array (Uint16Array with 16-bit tiers)}
  Z.work = null;
  Z.N = 4096;
  Z.size = 15360;
  Z.ubits = 32;
  Z.vbits = 8;
  Z.mode = 'off'; // tier | usage | off  (opt-in so the terrain stays visible)
  Z.opacity = 0.55;
  Z.ui = { layer: 'tier', op: 'set', flags: ['Tier1'], shape: 'poly' };
  Z.draft = null;

  // the map's own usage and tier names (cfglimitsdefinition.xml), as many as its grids have bits for
  const usageNames = () => (DS.Loot && DS.Loot.limits && DS.Loot.limits.usages.length ? DS.Loot.limits.usages : USAGES).slice(0, Z.ubits);
  const tierNames = () => (DS.Loot && DS.Loot.limits && DS.Loot.limits.values.length ? DS.Loot.limits.values : TIERS).slice(0, Z.vbits);
  const valueArray = (n) => (Z.vbits === 16 ? new Uint16Array(n) : new Uint8Array(n));
  // the vanilla colours for up to Tier4 + Unique; a green-to-red ramp for maps with more tiers
  const tierColorAt = (i, count) => {
    if (count <= TIER_COL.length) return TIER_COL[i] || '#ffffff';
    const h = Math.round(120 - (120 * i) / Math.max(1, count - 1)), c = (n) => { const k = (n + h / 30) % 12, v = 0.5 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, '0'); };
    return '#' + c(0) + c(8) + c(4);
  };
  const zones = () => S.project.zones || (S.project.zones = []);
  const invalidate = () => DS.MapView && DS.MapView.invalidate();
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const usageColor = (name) => (DS.Loot ? DS.Loot.color(name) : '#e2e8f0');

  /* ============================== loading ============================== */
  async function inflate(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function ingest(d) {
    const buf = d.raw ? new Uint8Array(d.raw) : await inflate(d.gz); // copy raw so we own the memory
    const N = d.n;
    const ubits = d.ubits || 32;
    const voff = buf.byteOffset + N * N * (ubits / 8);
    // a 16-bit usage grid is widened to 32 bits (export writes it back as 16 bits); the 16-bit grids are copied
    // out, since a typed-array view needs an aligned offset
    const usage = ubits === 32 ? new Uint32Array(buf.buffer, buf.byteOffset, N * N) : Uint32Array.from(new Uint16Array(buf.slice(0, N * N * 2).buffer));
    let value;
    if (d.vbits === 16) value = new Uint16Array(buf.buffer.slice(voff, voff + N * N * 2));
    else if (d.vbits === 8) value = new Uint8Array(buf.buffer, voff, N * N);
    else {
      const packed = new Uint8Array(buf.buffer, voff, (N * N) >> 1);
      value = new Uint8Array(N * N);
      for (let i = 0; i < packed.length; i++) {
        value[2 * i] = packed[i] & 15;
        value[2 * i + 1] = packed[i] >> 4;
      }
    }
    Z.N = N;
    Z.size = d.size;
    Z.ubits = ubits;
    Z.vbits = d.vbits;
    Z.base = { usage, value };
  }

  Z.load = function (world) {
    world = world || S.project.meta.world;
    if (Z.loadedWorld === world && Z.state !== 'idle') return Promise.resolve();
    Z.loadedWorld = world;
    Z.state = 'loading';
    Z.base = null;
    Z.work = null;
    S.emit('zones');
    return new Promise((res) => {
      const fin = async (d) => {
        if (d && typeof DecompressionStream !== 'undefined') {
          try { await ingest(d); Z.state = 'ok'; } catch (e) { console.warn('areaflags', e); Z.state = 'none'; }
        } else Z.state = 'none';
        if (Z.state === 'none') { Z.N = 4096; Z.size = S.project.meta.mapSize; Z.ubits = 32; Z.vbits = 8; }
        Z.rebuild();
        S.emit('zones');
        res();
      };
      if (window.DS_AREAFLAGS && window.DS_AREAFLAGS[world]) return fin(window.DS_AREAFLAGS[world]);
      const sc = document.createElement('script');
      sc.src = `maps/${world}/areaflags.js`;
      sc.onload = () => fin(window.DS_AREAFLAGS && window.DS_AREAFLAGS[world]);
      sc.onerror = () => fin(null);
      document.head.append(sc);
    });
  };

  /** user's own mission areaflags.map */
  Z.importMap = async function (arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const n = dv.getUint32(0, true), nz = dv.getUint32(4, true), mw = dv.getUint32(8, true);
    const ubits = dv.getUint32(16, true) === 16 ? 16 : 32;
    const rest = arrayBuffer.byteLength - 24 - n * nz * (ubits / 8);
    const vbits = rest === n * nz * 2 ? 16 : rest === n * nz ? 8 : rest * 2 === n * nz ? 4 : 0;
    if (n !== nz || !vbits) throw new Error('Unexpected areaflags.map layout');
    await ingest({ n, size: mw, ubits, vbits, raw: new Uint8Array(arrayBuffer, 24) });
    Z.state = 'ok';
    Z.loadedWorld = S.project.meta.world;
    Z.rebuild();
    S.emit('zones');
  };

  /* ============================== rasterising ============================== */
  function maskOf(s) {
    const names = s.layer === 'tier' ? tierNames() : usageNames();
    let m = 0;
    (s.flags || []).forEach((f) => {
      const i = names.indexOf(f);
      if (i >= 0) m |= 1 << i;
    });
    return m >>> 0;
  }

  function eachSpan(s, fn) {
    const N = Z.N, cell = Z.size / N;
    if (s.shape === 'circle') {
      const cx = s.c[0], cz = s.c[1], R = s.r;
      const r0 = Math.max(0, Math.floor((cz - R) / cell)), r1 = Math.min(N - 1, Math.floor((cz + R) / cell));
      for (let r = r0; r <= r1; r++) {
        const dz = (r + 0.5) * cell - cz;
        if (Math.abs(dz) > R) continue;
        const dx = Math.sqrt(R * R - dz * dz);
        const c0 = Math.max(0, Math.ceil((cx - dx) / cell - 0.5)), c1 = Math.min(N - 1, Math.floor((cx + dx) / cell - 0.5));
        if (c1 >= c0) fn(r, c0, c1);
      }
      return;
    }
    const p = s.pts;
    if (!p || p.length < 3) return;
    let zmin = Infinity, zmax = -Infinity;
    p.forEach((q) => { zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1]); });
    const r0 = Math.max(0, Math.floor(zmin / cell)), r1 = Math.min(N - 1, Math.floor(zmax / cell));
    for (let r = r0; r <= r1; r++) {
      const zc = (r + 0.5) * cell;
      const xs = [];
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const a = p[j], b = p[i];
        if ((a[1] <= zc && b[1] > zc) || (b[1] <= zc && a[1] > zc)) xs.push(a[0] + ((zc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] / cell - 0.5)), c1 = Math.min(N - 1, Math.floor(xs[k + 1] / cell - 0.5));
        if (c1 >= c0) fn(r, c0, c1);
      }
    }
  }

  function applyShape(s) {
    const mask = maskOf(s);
    const arr = s.layer === 'tier' ? Z.work.value : Z.work.usage;
    const N = Z.N;
    const inv = ~mask;
    if (s.op === 'set') eachSpan(s, (r, c0, c1) => { for (let i = r * N + c0, e = r * N + c1; i <= e; i++) arr[i] = mask; });
    else if (s.op === 'add') eachSpan(s, (r, c0, c1) => { for (let i = r * N + c0, e = r * N + c1; i <= e; i++) arr[i] |= mask; });
    else eachSpan(s, (r, c0, c1) => { for (let i = r * N + c0, e = r * N + c1; i <= e; i++) arr[i] &= inv; });
  }

  let pending = false;
  Z.touch = function () {
    if (pending) return;
    pending = true;
    U.raf(() => { pending = false; Z.rebuild(); invalidate(); });   // a window that is not minimized
  };

  Z.rebuild = function () {
    const shapes = zones().filter((s) => s.visible !== false);
    if (!Z.base && !shapes.length) { Z.work = null; Z.overlayDirty = true; return; }
    if (!Z.base) {
      // map without shipped data: start from an empty raster
      Z.base = { usage: new Uint32Array(Z.N * Z.N), value: valueArray(Z.N * Z.N) };
    }
    if (!shapes.length) Z.work = Z.base;
    else {
      if (!Z.work || Z.work === Z.base || Z.work.value.constructor !== Z.base.value.constructor) Z.work = { usage: new Uint32Array(Z.N * Z.N), value: valueArray(Z.N * Z.N) };
      Z.work.usage.set(Z.base.usage);
      Z.work.value.set(Z.base.value);
      shapes.forEach(applyShape);
    }
    Z.overlayDirty = true;
  };

  S.on('structure', () => { if (Z.loadedWorld) Z.touch(); });
  // the tier and usage names (and so the colours and zone masks) come from the map's loot data: redo the raster
  // when they change (the map's loot arrived), not on every loot edit
  let namesSig = '';
  S.on('loot', () => {
    const sig = tierNames().join() + '|' + usageNames().join();
    if (sig === namesSig) return;
    namesSig = sig;
    if (Z.loadedWorld) Z.touch();
  });
  S.on('project', () => {
    if (S.project.meta.world !== Z.loadedWorld) Z.load(S.project.meta.world);
    else Z.touch();
  });

  /* ============================== overlay ============================== */
  let ovCanvas = null;
  function buildOverlay() {
    const W = Z.work || Z.base;
    if (!W) return null;
    const M = 2048;
    if (!ovCanvas) { ovCanvas = document.createElement('canvas'); ovCanvas.width = ovCanvas.height = M; }
    const ctx = ovCanvas.getContext('2d');
    const img = ctx.createImageData(M, M);
    const d = img.data;
    const N = Z.N, stride = N / M;
    const tn = tierNames();
    const tcol = tn.map((t, i) => hex(tierColorAt(i, tn.length)));
    const names = usageNames();
    const ucol = names.map((n) => hex(usageColor(n).length === 7 ? usageColor(n) : '#e2e8f0'));
    if (Z.mode === 'tier') {
      for (let y = 0; y < M; y++) {
        const row = N - 1 - Math.floor(y * stride);
        for (let x = 0; x < M; x++) {
          const v = W.value[row * N + Math.floor(x * stride)];
          if (!v) continue;
          // the highest tier of the cell (vanilla: Tier1..Tier4 before Unique)
          const b = tn.length <= TIER_COL.length ? (v & 8 ? 3 : v & 4 ? 2 : v & 2 ? 1 : v & 1 ? 0 : 4) : 31 - Math.clz32(v);
          if (!tcol[b]) continue;
          const o = (y * M + x) * 4;
          d[o] = tcol[b][0]; d[o + 1] = tcol[b][1]; d[o + 2] = tcol[b][2]; d[o + 3] = 255;
        }
      }
    } else {
      for (let y = 0; y < M; y++) {
        const row = N - 1 - Math.floor(y * stride);
        for (let x = 0; x < M; x++) {
          const u = W.usage[row * N + Math.floor(x * stride)];
          if (!u) continue;
          let b = 0;
          while (!((u >>> b) & 1) && b < 31) b++;
          const c = ucol[b] || [226, 232, 240];
          const o = (y * M + x) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return ovCanvas;
  }

  Z.getOverlay = function () {
    if (!Z.work && !Z.base) return null;
    if (Z.overlayDirty || !ovCanvas) { buildOverlay(); Z.overlayDirty = false; }
    return ovCanvas;
  };

  Z.drawOverlay = function (ctx, x0, y0, x1, y1) {
    if (Z.mode === 'off') return;
    if (!Z.work && !Z.base) return;
    if (Z.overlayDirty || !ovCanvas) { buildOverlay(); Z.overlayDirty = false; }
    if (!ovCanvas) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Z.opacity;
    ctx.drawImage(ovCanvas, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  };

  /* ============================== shapes: geometry helpers ============================== */
  function shapeColor(s) {
    if (s.layer === 'tier') {
      const tn = tierNames();
      let b = -1;
      tn.forEach((t, i) => { if ((s.flags || []).includes(t)) b = i; });
      return b >= 0 ? tierColorAt(b, tn.length) : '#ffffff';
    }
    return usageColor((s.flags || [])[0]);
  }
  Z.handles = (s) => (s.shape === 'circle' ? [[s.c[0], s.c[1]], [s.c[0] + s.r, s.c[1]]] : s.pts.map((p) => [p[0], p[1]]));
  Z.setHandle = function (s, i, x, z) {
    if (s.shape === 'circle') {
      if (i === 0) s.c = [x, z];
      else s.r = Math.max(2, Math.hypot(x - s.c[0], z - s.c[1]));
    } else s.pts[i] = [x, z];
  };
  Z.snapshot = (s) => JSON.parse(JSON.stringify({ pts: s.pts, c: s.c }));
  Z.moveFrom = function (s, snap, dx, dz) {
    if (s.shape === 'circle') s.c = [snap.c[0] + dx, snap.c[1] + dz];
    else s.pts = snap.pts.map((p) => [p[0] + dx, p[1] + dz]);
  };
  Z.add = function (s) {
    zones().push(s);
    S.structure();
    return s;
  };
  Z.remove = function (id) {
    S.project.zones = zones().filter((s) => s.id !== id);
    S.structure();
  };
  Z.get = (id) => zones().find((s) => s.id === id) || null;

  Z.hit = function (wx, wz, scale) {
    if (Z.mode === 'off' && !zones().length) return null;
    const tol = 8 / scale;
    const list = zones();
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.visible === false) continue;
      if (s.shape === 'circle') {
        if (Math.abs(Math.hypot(wx - s.c[0], wz - s.c[1]) - s.r) <= tol) return s.id;
      } else {
        const p = s.pts;
        for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
          const [x1, z1] = p[b], [x2, z2] = p[a];
          const dx = x2 - x1, dz = z2 - z1;
          const t = U.clamp(((wx - x1) * dx + (wz - z1) * dz) / (dx * dx + dz * dz || 1), 0, 1);
          if (Math.hypot(wx - (x1 + t * dx), wz - (z1 + t * dz)) <= tol) return s.id;
        }
      }
    }
    return null;
  };
  Z.hitHandle = function (s, sx, sy, w2s) {
    const h = Z.handles(s);
    for (let i = 0; i < h.length; i++) {
      const [px, py] = w2s(h[i][0], h[i][1]);
      if (Math.hypot(px - sx, py - sy) <= 9) return i;
    }
    return -1;
  };

  /* ============================== drawing tool ============================== */
  Z.start = function (shape) {
    Z.ui.shape = shape;
    Z.draft = { shape, pts: [], c: null, r: 0, a: null, b: null, cur: null };
    S.setView('map');
    S.select(null, []);
    S.setTool('zone');
    invalidate();
    S.emit('zones');
  };
  Z.cancel = function () {
    Z.draft = null;
    if (S.tool === 'zone') S.setTool('select');
    invalidate();
  };
  function make(shape, geo) {
    const n = zones().length + 1;
    const s = Object.assign({
      id: U.uid('z'), name: `Zone ${n}`, shape, layer: Z.ui.layer, op: Z.ui.op, flags: [...Z.ui.flags], visible: true,
    }, geo);
    Z.add(s);
    S.select('zone', [s.id]);
    S.commit();
    return s;
  }
  Z.finish = function () {
    const d = Z.draft;
    if (!d) return false;
    if (d.shape === 'poly' && d.pts.length >= 3) {
      make('poly', { pts: d.pts.map((p) => [...p]) });
      d.pts = [];
      invalidate();
      return true;
    }
    return false;
  };
  Z.undoPoint = function () {
    if (Z.draft && Z.draft.pts.length) { Z.draft.pts.pop(); invalidate(); return true; }
    return false;
  };
  /** pointer protocol from the map view; returns true when consumed */
  Z.pointer = function (type, wx, wz, e) {
    const d = Z.draft;
    if (!d) return false;
    const sn = DS.MapView.snap;
    const x = sn(wx), z = sn(wz);
    d.cur = [x, z];
    if (d.shape === 'poly') {
      if (type === 'down') {
        if (d.pts.length >= 3) {
          const [fx, fz] = d.pts[0];
          const [sx, sy] = DS.MapView.w2s(fx, fz);
          const [mx, my] = DS.MapView.w2s(x, z);
          if (Math.hypot(sx - mx, sy - my) < 10) { Z.finish(); return true; }
        }
        d.pts.push([x, z]);
      }
    } else if (d.shape === 'circle') {
      if (type === 'down') { d.c = [x, z]; d.r = 0; d.active = true; }
      else if (type === 'move' && d.active) d.r = Math.hypot(x - d.c[0], z - d.c[1]);
      else if (type === 'up' && d.active) {
        d.active = false;
        if (d.r > Z.size / Z.N) make('circle', { c: [...d.c], r: U.round(d.r, 1) });
        d.c = null;
      }
    } else if (d.shape === 'rect') {
      if (type === 'down') { d.a = [x, z]; d.b = [x, z]; d.active = true; }
      else if (type === 'move' && d.active) d.b = [x, z];
      else if (type === 'up' && d.active) {
        d.active = false;
        if (Math.abs(d.b[0] - d.a[0]) > 1 && Math.abs(d.b[1] - d.a[1]) > 1)
          make('poly', { pts: [[d.a[0], d.a[1]], [d.b[0], d.a[1]], [d.b[0], d.b[1]], [d.a[0], d.b[1]]] });
        d.a = d.b = null;
      }
    }
    invalidate();
    return true;
  };

  /** outlines, handles and the in-progress draft */
  Z.drawShapes = function (ctx, H) {
    const { w2s, s } = H;
    const list = zones();
    ctx.save();
    ctx.lineWidth = 2;
    list.forEach((sh) => {
      if (sh.visible === false) return;
      const col = shapeColor(sh);
      const sel = S.isSel('zone', sh.id);
      ctx.strokeStyle = col;
      ctx.setLineDash(sh.op === 'remove' ? [4, 4] : sh.op === 'add' ? [10, 4] : []);
      ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath();
      if (sh.shape === 'circle') {
        const [cx, cy] = w2s(sh.c[0], sh.c[1]);
        ctx.arc(cx, cy, sh.r * s, 0, Math.PI * 2);
      } else {
        sh.pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath();
      }
      if (sel) { ctx.fillStyle = col + '22'; ctx.fill(); }
      ctx.stroke();
      ctx.setLineDash([]);
      // label
      let lx, ly;
      if (sh.shape === 'circle') [lx, ly] = w2s(sh.c[0], sh.c[1]);
      else {
        const cx = sh.pts.reduce((a, p) => a + p[0], 0) / sh.pts.length, cz = sh.pts.reduce((a, p) => a + p[1], 0) / sh.pts.length;
        [lx, ly] = w2s(cx, cz);
      }
      ctx.font = '600 11px system-ui';
      ctx.textBaseline = 'middle';
      const txt = `${sh.name}  ${sh.op === 'set' ? '=' : sh.op === 'add' ? '+' : '−'} ${(sh.flags || []).join(',')}`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(txt, lx - 20, ly);
      ctx.fillStyle = '#fff'; ctx.fillText(txt, lx - 20, ly);
      if (sel) {
        Z.handles(sh).forEach((h, i) => {
          const [x, y] = w2s(h[0], h[1]);
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.rect(x - 5, y - 5, 10, 10); ctx.fill(); ctx.stroke();
        });
      }
    });
    // draft
    const d = Z.draft;
    if (d) {
      const col = Z.ui.layer === 'tier' ? shapeColor({ layer: 'tier', flags: Z.ui.flags }) : usageColor(Z.ui.flags[0]);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (d.shape === 'poly') {
        d.pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        if (d.cur && d.pts.length) { const [x, y] = w2s(d.cur[0], d.cur[1]); ctx.lineTo(x, y); }
        ctx.stroke();
        d.pts.forEach((p) => { const [x, y] = w2s(p[0], p[1]); ctx.fillStyle = col; ctx.fillRect(x - 3, y - 3, 6, 6); });
      } else if (d.shape === 'circle' && d.c) {
        const [cx, cy] = w2s(d.c[0], d.c[1]);
        ctx.arc(cx, cy, d.r * s, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '600 12px system-ui';
        ctx.fillText(`r ${Math.round(d.r)} m`, cx + 8, cy - 8);
      } else if (d.shape === 'rect' && d.a) {
        const [ax, ay] = w2s(d.a[0], d.a[1]), [bx, by] = w2s(d.b[0], d.b[1]);
        ctx.strokeRect(ax, ay, bx - ax, by - ay);
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
  };

  /* ============================== export ============================== */
  Z.exportMap = function () {
    Z.rebuild();
    const W = Z.work || Z.base;
    if (!W) return null;
    const N = Z.N;
    const ubytes = N * N * (Z.ubits / 8);
    const vbytes = Z.vbits === 16 ? N * N * 2 : Z.vbits === 8 ? N * N : (N * N) >> 1;
    const out = new Uint8Array(24 + ubytes + vbytes);
    const dv = new DataView(out.buffer);
    const mw = Math.round(Z.size);
    [N, N, mw, mw, Z.ubits, 0].forEach((v, i) => dv.setUint32(i * 4, v, true));
    if (Z.ubits === 32) out.set(new Uint8Array(W.usage.buffer, W.usage.byteOffset, ubytes), 24);
    else out.set(new Uint8Array(Uint16Array.from(W.usage).buffer), 24);
    const off = 24 + ubytes;
    if (Z.vbits === 16) out.set(new Uint8Array(W.value.buffer, W.value.byteOffset, vbytes), off);
    else if (Z.vbits === 8) out.set(W.value, off);
    else for (let i = 0; i < vbytes; i++) out[off + i] = (W.value[2 * i] & 15) | ((W.value[2 * i + 1] & 15) << 4);
    return out;
  };
  Z.exportJson = () => JSON.stringify({ world: S.project.meta.world, cell: Z.size / Z.N, zones: zones() }, null, 2);
  Z.hasData = () => !!(Z.base || zones().length);

  /* ============================== inspector ============================== */
  function chips(options, selected, onToggle, colorFn) {
    return el('div', { class: 'chips' }, options.map((o) => {
      const on = selected.includes(o);
      const c = colorFn ? colorFn(o) : null;
      return el('button', { class: 'chip' + (on ? ' on' : ''), style: on && c ? { background: c + '33', borderColor: c } : {}, onclick: () => onToggle(o, !on) }, o);
    }));
  }
  const tierOpts = tierNames;
  Z.tierNames = tierNames;
  const tierColor = (t) => { const tn = tierNames(); return tierColorAt(tn.indexOf(t), tn.length); };

  Z.inspector = function (sh) {
    const box = el('div', { class: 'ins-body' });
    const ch = () => { S.changed('zones'); Z.touch(); };
    function draw() {
      box.innerHTML = '';
      const names = sh.layer === 'tier' ? tierOpts() : usageNames();
      box.append(
        el('div', { class: 'ins-head' }, el('span', { class: 'dot', style: { background: shapeColor(sh) } }), el('div', null, el('div', { class: 'ins-title' }, sh.name), el('div', { class: 'ins-sub' }, `${sh.shape === 'circle' ? 'Circle r=' + Math.round(sh.r) + ' m' : 'Polygon, ' + sh.pts.length + ' points'}`))),
        el('div', { class: 'ins-sec' },
          el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Name'),
            (() => { const i = el('input', { class: 'inp', value: sh.name }); i.addEventListener('input', () => { sh.name = i.value; S.changed('zones'); }); i.addEventListener('change', () => { S.commit(); S.emit('zones'); }); return i; })()),
          el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'What it controls'),
            (() => { const s = el('select', { class: 'inp' }, el('option', { value: 'tier' }, 'Loot tier (' + tierNames()[0] + '–' + tierNames().slice(-1)[0] + ')'), el('option', { value: 'usage' }, 'Usage (Military, Coast, …)')); s.value = sh.layer; s.addEventListener('change', () => { sh.layer = s.value; sh.flags = sh.layer === 'tier' ? ['Tier1'] : ['Military']; ch(); S.commit(); draw(); }); return s; })()),
          el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Operation'),
            (() => { const s = el('select', { class: 'inp' }, el('option', { value: 'set' }, 'Set — replace what is there'), el('option', { value: 'add' }, 'Add — keep existing and add these'), el('option', { value: 'remove' }, 'Remove — clear these from the area')); s.value = sh.op; s.addEventListener('change', () => { sh.op = s.value; ch(); S.commit(); draw(); }); return s; })()),
          el('div', { class: 'ins-label' }, sh.layer === 'tier' ? 'Tiers' : 'Usages'),
          chips(names, sh.flags, (f, on) => { sh.flags = on ? [...sh.flags, f] : sh.flags.filter((x) => x !== f); ch(); S.commit(); draw(); }, sh.layer === 'tier' ? tierColor : usageColor),
          el('div', { class: 'ins-help' }, sh.layer === 'tier'
            ? 'Items only spawn at a place if one of their tier values matches the tier of the ground there.'
            : 'Usage flags in the ground layer; loot points use their building’s usage, ground/dynamic loot uses these.'),
          el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: sh.visible !== false, onchange: (e) => { sh.visible = e.target.checked; ch(); S.commit(); } }), el('span', null, 'Enabled (included in export)'))),
        el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, 'Order'),
          el('div', { class: 'ins-help' }, 'Zones are painted from top to bottom of the list; later zones win.'),
          el('div', { class: 'btn-row' },
            el('button', { class: 'btn sm', onclick: () => { move(sh, -1); } }, '↑ Earlier'),
            el('button', { class: 'btn sm', onclick: () => { move(sh, 1); } }, '↓ Later'),
            el('button', { class: 'btn sm', onclick: () => { const c = JSON.parse(JSON.stringify(sh)); c.id = U.uid('z'); c.name += ' copy'; if (c.shape === 'circle') c.c = [c.c[0] + 60, c.c[1] - 60]; else c.pts = c.pts.map((p) => [p[0] + 60, p[1] - 60]); Z.add(c); S.select('zone', [c.id]); S.commit(); } }, 'Duplicate'),
            el('button', { class: 'btn sm danger', onclick: () => DS.actions.deleteSelection() }, 'Delete'))));
    }
    draw();
    return box;
  };
  function move(sh, dir) {
    const l = zones();
    const i = l.indexOf(sh), j = i + dir;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    S.structure();
    S.commit();
  }

  /* ============================== left panel ============================== */
  Z.panel = function (body, search, redraw) {
    const world = S.project.meta.world;
    if (Z.loadedWorld !== world) Z.load(world).then(redraw);
    const list = zones();
    const note = Z.state === 'loading' ? 'Loading zone data…' : Z.state === 'ok' ? '✔ Vanilla loot zones loaded for this map.' : 'No built-in zone data for this map — import its areaflags.map (File ▸ Import) or draw zones from scratch.';
    body.append(el('div', { class: 'loot-head' }, el('div', { class: Z.state === 'ok' ? 'loot-stat' : 'hint-box' }, note)));

    body.append(el('div', { class: 'ins-sec' },
      el('div', { class: 'ins-sec-title' }, 'Show on map'),
      el('div', { class: 'chips' }, [['tier', 'Tiers'], ['usage', 'Usage'], ['off', 'Off']].map(([m, t]) =>
        el('button', { class: 'chip' + (Z.mode === m ? ' on' : ''), onclick: () => { Z.mode = m; Z.overlayDirty = true; invalidate(); redraw(); } }, t))),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Overlay opacity'),
        (() => { const i = el('input', { type: 'range', min: 10, max: 90, value: Math.round(Z.opacity * 100) }); i.addEventListener('input', () => { Z.opacity = i.value / 100; invalidate(); }); return i; })()),
      Z.mode === 'tier'
        ? el('div', { class: 'legend' }, tierOpts().map((t) => el('span', { class: 'lg' }, el('i', { style: { background: tierColor(t) } }), t)))
        : Z.mode === 'usage'
          ? el('div', { class: 'legend' }, usageNames().map((t) => el('span', { class: 'lg' }, el('i', { style: { background: usageColor(t) } }), t)))
          : null));

    // drawing settings
    const ui = Z.ui;
    const names = ui.layer === 'tier' ? tierOpts() : usageNames();
    body.append(el('div', { class: 'ins-sec' },
      el('div', { class: 'ins-sec-title' }, 'Draw a loot zone'),
      el('div', { class: 'ins-help' }, 'Pick what the zone does, then choose a shape and draw on the map.'),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Controls'),
        (() => { const s = el('select', { class: 'inp' }, el('option', { value: 'tier' }, 'Loot tier'), el('option', { value: 'usage' }, 'Usage')); s.value = ui.layer; s.addEventListener('change', () => { ui.layer = s.value; ui.flags = ui.layer === 'tier' ? ['Tier1'] : ['Military']; Z.mode = ui.layer; Z.overlayDirty = true; invalidate(); redraw(); }); return s; })()),
      el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Operation'),
        (() => { const s = el('select', { class: 'inp' }, el('option', { value: 'set' }, 'Set (replace)'), el('option', { value: 'add' }, 'Add'), el('option', { value: 'remove' }, 'Remove')); s.value = ui.op; s.addEventListener('change', () => { ui.op = s.value; }); return s; })()),
      chips(names, ui.flags, (f, on) => { ui.flags = on ? [...ui.flags, f] : ui.flags.filter((x) => x !== f); redraw(); }, ui.layer === 'tier' ? tierColor : usageColor),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn sm primary' + (S.tool === 'zone' && Z.draft && Z.draft.shape === 'poly' ? ' active' : ''), onclick: () => Z.start('poly') }, '⬠ Polygon'),
        el('button', { class: 'btn sm' + (S.tool === 'zone' && Z.draft && Z.draft.shape === 'circle' ? ' active' : ''), onclick: () => Z.start('circle') }, '◯ Circle'),
        el('button', { class: 'btn sm' + (S.tool === 'zone' && Z.draft && Z.draft.shape === 'rect' ? ' active' : ''), onclick: () => Z.start('rect') }, '▭ Rectangle')),
      el('div', { class: 'ins-help' }, 'Polygon: click points, double-click / Enter / click the first point to close, Backspace removes the last point. Circle & rectangle: click-drag. Esc stops drawing.')));

    body.append(el('div', { class: 'mini-title' }, `Your zones (${list.length})`));
    if (!list.length) body.append(el('div', { class: 'hint-box' }, 'No zones yet. The coloured overlay is the vanilla layout; your zones are painted on top of it.'));
    list.forEach((sh) => {
      body.append(el('div', { class: 'asset' + (S.isSel('zone', sh.id) ? ' active' : '') + (sh.visible === false ? ' dim' : ''),
        onclick: () => { S.setView('map'); S.select('zone', [sh.id]); const h = Z.handles(sh)[0]; DS.MapView.centerOn(h[0], h[1]); } },
        el('span', { class: 'dot', style: { background: shapeColor(sh) } }),
        el('span', { class: 'asset-name' }, sh.name),
        el('span', { class: 'asset-sub' }, `${sh.op} ${(sh.flags || []).join(',')}`),
        el('button', { class: 'btn icon', title: 'Delete', onclick: (e) => { e.stopPropagation(); Z.remove(sh.id); S.select(null, []); S.commit(); } }, '✕')));
    });
    body.append(el('div', { class: 'btn-row pad' },
      el('button', { class: 'btn sm', disabled: !list.length, onclick: () => { if (confirm('Delete all zones?')) { S.project.zones = []; S.structure(); S.commit(); } } }, 'Clear all'),
      el('button', { class: 'btn sm primary', onclick: () => DS.app.exportDialog() }, '⇩ Export areaflags.map…')));
  };
})();
