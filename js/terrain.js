/* DayZ Studio - terrain heights + model bounds captured from the real game by the bridge mod
   (data/<world>/heights.bin, data/<world>/bounds.csv).  Needs the studio server or any http server. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const T = (DS.Terrain = {});
  const B = (DS.Bounds = {});

  T.state = 'idle'; // idle | loading | ok | none
  T.world = null;
  T.n = 0;
  T.step = 0;
  T.size = 0;
  T.h = null;

  T.has = () => T.state === 'ok' && T.world === S.project.meta.world;

  T.load = async function (world) {
    world = world || S.project.meta.world;
    T.state = 'loading';
    T.world = world;
    S.emit('terrain3d');
    try {
      const r = await fetch(`data/${world}/heights.bin?t=${Date.now()}`);
      if (!r.ok) throw new Error('no heights');
      const buf = await r.arrayBuffer();
      const dv = new DataView(buf);
      const n = dv.getInt32(0, true);
      if (n < 16 || buf.byteLength < 12 + n * n * 4) throw new Error('bad heights');
      T.n = n;
      T.step = dv.getFloat32(4, true);
      T.size = dv.getFloat32(8, true);
      T.h = new Float32Array(buf, 12, n * n);
      T.state = 'ok';
    } catch (e) {
      T.state = 'none';
      T.h = null;
    }
    S.emit('terrain3d');
    S.emit('changed', 'terrain');
  };

  /** bilinear terrain height in metres (0 when unknown) */
  T.heightAt = function (x, z) {
    if (!T.h) return 0;
    const n = T.n;
    let fx = x / T.step, fz = z / T.step;
    fx = Math.min(n - 1.001, Math.max(0, fx));
    fz = Math.min(n - 1.001, Math.max(0, fz));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h = T.h;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  /** first intersection of a ray with the heightfield (three.js coords: z = -north). returns [x,y,z] in DayZ coords */
  T.raycast = function (o, d, maxDist) {
    // march in world metres
    let t = 0;
    const size = T.size || S.project.meta.mapSize;
    const stepLen = Math.max(5, (T.step || 15) * 0.6);
    let prevT = 0, prevAbove = true;
    maxDist = maxDist || 60000;
    for (; t < maxDist; t += stepLen) {
      const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t;
      const zz = -pz; // back to DayZ z (north)
      if (px < -50 || zz < -50 || px > size + 50 || zz > size + 50) {
        if (!prevAbove) break;
        prevAbove = true; prevT = t;
        continue;
      }
      const gh = T.heightAt(px, zz);
      const above = py >= gh;
      if (!above && prevAbove && t > 0) {
        // bisect
        let lo = prevT, hi = t;
        for (let i = 0; i < 24; i++) {
          const m = (lo + hi) / 2;
          const mx = o[0] + d[0] * m, my = o[1] + d[1] * m, mz = o[2] + d[2] * m;
          if (my >= T.heightAt(mx, -mz)) lo = m; else hi = m;
        }
        const x = o[0] + d[0] * lo, z = -(o[2] + d[2] * lo);
        return [x, T.heightAt(x, z), z];
      }
      prevAbove = above;
      prevT = t;
    }
    return null;
  };

  /* ---------------- model bounds (ClippingInfo from the game) ---------------- */
  B.map = new Map();
  B.world = null;
  B.load = async function (world) {
    world = world || S.project.meta.world;
    B.world = world;
    B.map = new Map();
    try {
      const r = await fetch(`data/${world}/bounds.csv?t=${Date.now()}`);
      if (!r.ok) throw new Error();
      (await r.text()).split(/\r?\n/).forEach((ln) => {
        const p = ln.split(',');
        if (p.length >= 7) B.map.set(p[0], { min: [+p[1], +p[2], +p[3]], max: [+p[4], +p[5], +p[6]], model: p[7] || '' });
      });
    } catch (e) {}
    S.emit('terrain3d');
  };
  const DEFAULTS = {
    building: [14, 8, 12], prop: [1.2, 1, 1.2], loot: [1.5, 1, 1.5], item: [0.5, 0.3, 0.5], vehicle: [2.2, 2, 5],
    infected: [0.6, 1.8, 0.6], animal: [0.8, 1, 1.4], npc: [0.6, 1.8, 0.6], event: [4, 0.5, 4],
  };
  /** {min:[x,y,z], max:[x,y,z]} in model space; falls back to a plausible size */
  B.get = function (cls, kind) {
    const e = B.map.get(cls);
    if (e) return e;
    const d = DEFAULTS[kind] || [2, 2, 2];
    return { min: [-d[0] / 2, 0, -d[2] / 2], max: [d[0] / 2, d[1], d[2] / 2], guess: true };
  };
  B.has = (cls) => B.map.has(cls);

  /** Height an object stands at when its Y is 0 ("on the ground").  Buildings and props use the HIGHEST terrain point
   *  under their footprint so a building on a slope is never buried; everything else uses the point under its origin. */
  DS.groundY = function (o) {
    if (o.y) return o.y;
    if (!T.has()) return 0;
    const K = DS.KINDS[o.kind];
    if (!K || !K.isStatic) return T.heightAt(o.x, o.z);
    const b = B.get(o.c, o.kind);
    const sc = o.scale || 1;
    const hx = Math.min(30, Math.max(0.5, (b.max[0] - b.min[0]) * 0.5 * sc));
    const hz = Math.min(30, Math.max(0.5, (b.max[2] - b.min[2]) * 0.5 * sc));
    const cx = ((b.max[0] + b.min[0]) * 0.5) * sc, cz = ((b.max[2] + b.min[2]) * 0.5) * sc;
    const yaw = ((o.yaw || 0) * Math.PI) / 180;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let best = -1e9;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const lx = cx + (i / 2) * hx, lz = cz + (j / 2) * hz;
        const wx = o.x + lx * c + lz * s, wz = o.z - lx * s + lz * c;
        best = Math.max(best, T.heightAt(wx, wz));
      }
    }
    return best;
  };

  S.on('project', () => {
    if (S.project.meta.world !== T.world) { T.load(); B.load(); }
  });
})();
