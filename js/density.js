/* DayZ Studio - performance heatmap: how much the project packs into one area of the network bubble.
   Score of a spot = weighted objects within ~150 m (DayZ's near network range). A rule of thumb, not a measurement:
   buildings (complex collision) weigh most, small props least, every loot point adds a little. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const D = (DS.Density = {});

  D.CELL = 25;                 // m
  D.RADIUS = 150;              // m - near network range
  D.WARN = 150;                // yellow
  D.HIGH = 300;                // orange: expect lower FPS / slower syncing here
  D.DANGER = 600;              // red: likely desync / server lag
  const W = { building: 6, vehicle: 4, npc: 3, prop: 2, infected: 1.5, animal: 1.5, loot: 1, item: 1, event: 1, fx: 1 };

  let cache = null;            // { ver, x0, z0, nx, nz, score: Float32Array, max, spots }

  D.weight = (o) => (W[o.kind] || 1) * (o.kind === 'building' ? Math.max(1, (o.scale || 1) ** 2) : 1) + (o.loot ? o.loot.length * 0.25 : 0);

  D.compute = function () {
    if (cache && cache.ver === S.ver) return cache;
    const objs = S.project.objects.filter((o) => !o.hidden);
    // loot points of spawns you added (Loot tab) count too
    const extra = [];
    if (DS.Loot && DS.Loot.list) DS.Loot.list.filter((i) => !i.v && !i.del).forEach((i) => { const pr = DS.Loot.proto(i.g); const n = pr ? pr.c.reduce((a, c) => a + c.p.length, 0) : 0; if (n) extra.push({ x: i.x, z: i.z, w: n * 0.25 }); });
    if (!objs.length && !extra.length) { cache = { ver: S.ver, nx: 0, nz: 0, max: 0, spots: [] }; return cache; }
    const pts = objs.map((o) => ({ x: o.x, z: o.z, w: D.weight(o) })).concat(extra);
    const pad = D.RADIUS + D.CELL;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); });
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    const nx = Math.max(1, Math.ceil((x1 - x0) / D.CELL)), nz = Math.max(1, Math.ceil((z1 - z0) / D.CELL));
    const raw = new Float32Array(nx * nz);
    pts.forEach((p) => { const cx = Math.floor((p.x - x0) / D.CELL), cz = Math.floor((p.z - z0) / D.CELL); raw[cz * nx + cx] += p.w; });
    // sum over a circle of RADIUS around every cell (via a summed-area table, square approximated by the circle's area)
    const sat = new Float64Array((nx + 1) * (nz + 1));
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) sat[(z + 1) * (nx + 1) + x + 1] = raw[z * nx + x] + sat[z * (nx + 1) + x + 1] + sat[(z + 1) * (nx + 1) + x] - sat[z * (nx + 1) + x];
    const r = Math.round(D.RADIUS / D.CELL * 0.886);   // square with the same area as the circle
    const score = new Float32Array(nx * nz);
    let max = 0;
    for (let z = 0; z < nz; z++) {
      const za = Math.max(0, z - r), zb = Math.min(nz, z + r + 1);
      for (let x = 0; x < nx; x++) {
        const xa = Math.max(0, x - r), xb = Math.min(nx, x + r + 1);
        const v = sat[zb * (nx + 1) + xb] - sat[za * (nx + 1) + xb] - sat[zb * (nx + 1) + xa] + sat[za * (nx + 1) + xa];
        score[z * nx + x] = v;
        if (v > max) max = v;
      }
    }
    // hotspots: the highest cells at least 2 * RADIUS apart
    const order = [];
    for (let i = 0; i < score.length; i++) if (score[i] >= D.WARN) order.push(i);
    order.sort((a, b) => score[b] - score[a]);
    const spots = [];
    for (const i of order) {
      const x = x0 + ((i % nx) + 0.5) * D.CELL, z = z0 + (Math.floor(i / nx) + 0.5) * D.CELL;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < D.RADIUS * 2)) continue;
      const near = objs.filter((o) => Math.hypot(o.x - x, o.z - z) <= D.RADIUS);
      spots.push({ x, z, score: Math.round(score[i]), count: near.length, buildings: near.filter((o) => o.kind === 'building').length, near: near[0] || null });
      if (spots.length >= 8) break;
    }
    cache = { ver: S.ver, x0, z0, nx, nz, score, max, spots };
    return cache;
  };

  D.level = (v) => (v >= D.DANGER ? 'danger' : v >= D.HIGH ? 'high' : v >= D.WARN ? 'warn' : 'ok');
  D.label = (v) => ({ danger: 'very high - risk of desync / server lag', high: 'high - lower FPS, slower syncing', warn: 'busy', ok: 'fine' })[D.level(v)];

  let img = null, imgVer = -1;
  function image(c) {
    if (img && imgVer === c.ver) return img;
    img = document.createElement('canvas');
    img.width = c.nx; img.height = c.nz;
    const g = img.getContext('2d');
    const d = g.createImageData(c.nx, c.nz);
    for (let z = 0; z < c.nz; z++) {
      for (let x = 0; x < c.nx; x++) {
        const v = c.score[z * c.nx + x];
        const o = ((c.nz - 1 - z) * c.nx + x) * 4;   // canvas rows run north -> south
        if (v < D.WARN * 0.35) { d.data[o + 3] = 0; continue; }
        let r, gg, b;
        if (v < D.WARN) { r = 80; gg = 200; b = 120; } else if (v < D.HIGH) { r = 250; gg = 214; b = 60; } else if (v < D.DANGER) { r = 251; gg = 146; b = 60; } else { r = 239; gg = 68; b = 68; }
        d.data[o] = r; d.data[o + 1] = gg; d.data[o + 2] = b;
        d.data[o + 3] = Math.round(Math.min(0.62, 0.18 + 0.44 * Math.min(1, v / D.DANGER)) * 255);
      }
    }
    g.putImageData(d, 0, 0);
    imgVer = c.ver;
    return img;
  }

  /** draw onto the 2D map (called by the map view when the layer is on) */
  D.draw = function (ctx, w2s) {
    const c = D.compute();
    if (!c.nx) return;
    const [ax, ay] = w2s(c.x0, c.z0 + c.nz * D.CELL);
    const [bx, by] = w2s(c.x0 + c.nx * D.CELL, c.z0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image(c), ax, ay, bx - ax, by - ay);
    ctx.restore();
  };
})();
