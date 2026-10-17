/* DayZ Studio - streamed map scene for the 3D tab: every tree, rock, wall, lamp and building of the world.
   Data: data/<world>/scene.json (low-detail models) + scene.bin + scene_objects.bin (all instances, sorted by 250 m cell),
   produced by tools/build_scene.py from the in-game object scan.  Chunks around the camera are merged into a few
   textured meshes each and thrown away again when the camera moves on. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const SC = (DS.Scene = {});

  SC.state = 'idle'; // idle | loading | ok | none
  SC.world = null;
  SC.visible = true;
  SC.group = null;
  SC.count = 0;
  SC.loaded = 0;
  SC.tris = 0;
  SC.onChange = null; // redraw callback

  let meta = null;
  let models = null;
  let mbin = null;
  let obin = null;
  let ncell = 0, cell = 250, total = 0;
  let starts = null, counts = null, recOff = 0;
  const chunks = new Map();   // cell id -> {group, tris}
  const decoded = new Map();  // model index -> [{key, pos, uv}]
  let skip = null;            // model index -> true when drawn by the vanilla building layer
  let lastKey = '';

  const getJson = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(); return r.json(); });
  const getBin = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); });

  SC.load = async function (world) {
    world = world || S.project.meta.world;
    if (SC.world === world && (SC.state === 'ok' || SC.state === 'loading')) return;
    SC.world = world;
    SC.state = 'loading';
    SC.clear();
    try {
      const t = Date.now();
      const [j, mb, ob] = await Promise.all([getJson(`data/${world}/scene.json?t=${t}`), getBin(`data/${world}/scene.bin?t=${t}`), getBin(`data/${world}/scene_objects.bin?t=${t}`)]);
      meta = j; models = j.models; mbin = mb; obin = ob;
      const dv = new DataView(ob);
      ncell = dv.getUint32(4, true); cell = dv.getUint32(8, true); total = dv.getUint32(12, true);
      starts = new Uint32Array(ob, 16, ncell * ncell);
      counts = new Uint32Array(ob, 16 + ncell * ncell * 4, ncell * ncell);
      recOff = 16 + ncell * ncell * 8;
      SC.count = total;
      SC.state = 'ok';
    } catch (e) {
      SC.state = 'none';
    }
    skip = null;
    if (SC.onChange) SC.onChange();
  };

  SC.clear = function () {
    chunks.forEach((c) => disposeChunk(c));
    chunks.clear();
    decoded.clear();
    SC.loaded = 0;
    SC.tris = 0;
    lastKey = '';
  };

  function disposeChunk(c) {
    if (c.group.parent) c.group.parent.remove(c.group);
    c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  /** model-space triangle soup per material key, cached per model */
  function decode(mi) {
    let d = decoded.get(mi);
    if (d) return d;
    d = [];
    const m = models[mi];
    const L = m.lods[0];
    const nv = L.nv, nt = L.nt;
    const q = new Uint16Array(mbin, L.o, nv * 3);
    const tri = new Uint16Array(mbin, L.o + nv * 6, nt * 3);
    const hasUv = !!(L.uv && L.g);
    const uvq = hasUv ? new Uint16Array(mbin, L.o + nv * 6 + nt * 6, nv * 2) : null;
    const mn = m.min, mx = m.max;
    const sx = (mx[0] - mn[0]) / 65535, sy = (mx[1] - mn[1]) / 65535, sz = (mx[2] - mn[2]) / 65535;
    const groups = L.g && L.g.length ? L.g : [[null, 0, nt]];
    groups.forEach((g) => {
      const [k, s, n] = g;
      let key;
      if (Array.isArray(k)) key = 't' + k[0];
      else if (typeof k === 'string') key = 'c' + k;
      else key = 'c' + (m.wall || '#8a8a80');
      const pos = new Float32Array(n * 9);
      const uv = hasUv && Array.isArray(k) ? new Float32Array(n * 6) : null;
      const u0 = hasUv ? L.uv[0] : 0, v0 = hasUv ? L.uv[1] : 0;
      const us = hasUv ? (L.uv[2] - L.uv[0]) / 65535 : 0, vs = hasUv ? (L.uv[3] - L.uv[1]) / 65535 : 0;
      for (let t = 0; t < n; t++) {
        for (let c = 0; c < 3; c++) {
          const vi = tri[(s + t) * 3 + c];
          const o = t * 9 + c * 3;
          pos[o] = mn[0] + q[vi * 3] * sx;
          pos[o + 1] = mn[1] + q[vi * 3 + 1] * sy;
          pos[o + 2] = -(mn[2] + q[vi * 3 + 2] * sz);
          if (uv) {
            uv[t * 6 + c * 2] = u0 + uvq[vi * 2] * us;
            uv[t * 6 + c * 2 + 1] = v0 + uvq[vi * 2 + 1] * vs;
          }
        }
      }
      d.push({ key, pos, uv });
    });
    decoded.set(mi, d);
    return d;
  }

  function skipSet() {
    if (skip) return skip;
    const sk = new Set();
    const M = DS.Models;
    if (M && M.state === 'ok' && M.paths) {
      const have = M.paths();
      models.forEach((m, i) => { if (have.has(m.path)) sk.add(i); });
      skip = sk;   // only cache once the detailed pack is known
    }
    return sk;
  }

  const e = new THREE.Euler();
  const qt = new THREE.Quaternion();
  const mat = new THREE.Matrix4();
  const vp = new THREE.Vector3();
  const one = new THREE.Vector3();

  function buildChunk(id) {
    const st = starts[id], cn = counts[id];
    const group = new THREE.Group();
    let tris = 0;
    if (cn === 0) return { group, tris };
    const dv = new DataView(obin);
    const sk = skipSet();
    const gone = DS.MapEdits ? DS.MapEdits.keys() : null;   // removed in the project
    // pass 1: sizes per material key
    const need = new Map();
    const recs = [];
    for (let r = 0; r < cn; r++) {
      const o = recOff + (st + r) * 13;
      const s = dv.getUint16(o, true);
      if (sk.has(s)) continue;
      if (gone && gone.size && gone.has(models[s].path.toLowerCase() + '|' + dv.getUint16(o + 2, true) + '|' + dv.getUint16(o + 4, true))) continue;
      recs.push(o);
      decode(s).forEach((g) => need.set(g.key, (need.get(g.key) || 0) + g.pos.length));
    }
    const bufs = new Map();
    need.forEach((len, key) => bufs.set(key, { pos: new Float32Array(len), uv: key[0] === 't' ? new Float32Array((len / 9) * 6) : null, n: 0, u: 0 }));
    // pass 2: transform instances into the merged buffers
    for (let i = 0; i < recs.length; i++) {
      const o = recs[i];
      const s = dv.getUint16(o, true);
      const x = dv.getUint16(o + 2, true) / 4, z = dv.getUint16(o + 4, true) / 4, y = dv.getUint16(o + 6, true) / 100 - 100;
      const yaw = (dv.getUint16(o + 8, true) / 65536) * 360;
      const pitch = dv.getInt8(o + 10), roll = dv.getInt8(o + 11), sc = dv.getUint8(o + 12) / 50;
      e.set(U.deg2rad(pitch), -U.deg2rad(yaw), -U.deg2rad(roll), 'YXZ');
      qt.setFromEuler(e);
      vp.set(x, y, -z);
      one.set(sc, sc, sc);
      mat.compose(vp, qt, one);
      const me = mat.elements;
      decode(s).forEach((g) => {
        const b = bufs.get(g.key);
        const p = g.pos;
        for (let k = 0; k < p.length; k += 3) {
          const px = p[k], py = p[k + 1], pz = p[k + 2];
          b.pos[b.n++] = me[0] * px + me[4] * py + me[8] * pz + me[12];
          b.pos[b.n++] = me[1] * px + me[5] * py + me[9] * pz + me[13];
          b.pos[b.n++] = me[2] * px + me[6] * py + me[10] * pz + me[14];
        }
        if (b.uv && g.uv) {
          b.uv.set(g.uv, b.u);
          b.u += g.uv.length;
        }
      });
    }
    bufs.forEach((b, key) => {
      if (!b.n) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
      let material;
      if (key[0] === 't') {
        g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
        material = DS.Models.textureMaterial(+key.slice(1));
      } else material = DS.Models.colorMaterial(key.slice(1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      group.add(mesh);
      tris += b.n / 9;
    });
    return { group, tris };
  }

  /** keep the chunks around (tx, tz) [three.js x / -z coordinates] loaded */
  SC.update = function (tx, tz, dist, force) {
    if (SC.state !== 'ok' || !SC.group) return false;
    SC.group.visible = SC.visible;
    if (!SC.visible) return false;
    const wz = -tz;
    const radius = U.clamp(dist * 1.1, 260, 1000);
    const key = [Math.round(tx / 60), Math.round(wz / 60), Math.round(radius / 50)].join('|');
    if (!force && key === lastKey && !pendingBuild) return false;
    lastKey = key;
    const r = Math.ceil(radius / cell);
    const ccx = Math.floor(tx / cell), ccz = Math.floor(wz / cell);
    const want = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = ccx + dx, z = ccz + dz;
        if (x < 0 || z < 0 || x >= ncell || z >= ncell) continue;
        const cxm = (x + 0.5) * cell, czm = (z + 0.5) * cell;
        if (Math.hypot(cxm - tx, czm - wz) > radius + cell * 0.75) continue;
        want.push([z * ncell + x, Math.hypot(cxm - tx, czm - wz)]);
      }
    }
    const wanted = new Set(want.map((w) => w[0]));
    let changed = false;
    chunks.forEach((c, id) => {
      if (!wanted.has(id)) {
        SC.tris -= c.tris;
        disposeChunk(c);
        chunks.delete(id);
        changed = true;
      }
    });
    want.sort((a, b) => a[1] - b[1]);
    let built = 0;
    pendingBuild = false;
    for (const [id] of want) {
      if (chunks.has(id)) continue;
      if (built >= 2) { pendingBuild = true; break; } // spread the work over a few frames
      const c = buildChunk(id);
      chunks.set(id, c);
      SC.group.add(c.group);
      SC.tris += c.tris;
      built++;
      changed = true;
    }
    SC.loaded = chunks.size;
    return changed || pendingBuild;
  };
  let pendingBuild = false;
  SC.busy = () => pendingBuild;

  /** the removed-objects list changed: rebuild the loaded chunks without them */
  SC.refreshRemoved = function () {
    SC.clear();
    if (SC.onChange) SC.onChange();
  };

  /** which scene instance is at world point (wx, wy, wz)? The smallest one whose box contains the point.
      -> { mi, path, x, y, z, yaw, pitch, roll, sc, min, max } or null */
  SC.pick = function (wx, wy, wz) {
    if (SC.state !== 'ok') return null;
    const dv = new DataView(obin);
    const sk = skipSet();
    const gone = DS.MapEdits ? DS.MapEdits.keys() : null;
    const ccx = Math.floor(wx / cell), ccz = Math.floor(wz / cell);
    const inv = new THREE.Matrix4();
    const pt = new THREE.Vector3();
    let best = null, bestVol = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x0 = ccx + dx, z0 = ccz + dz;
        if (x0 < 0 || z0 < 0 || x0 >= ncell || z0 >= ncell) continue;
        const id = z0 * ncell + x0;
        const st = starts[id], cn = counts[id];
        for (let r = 0; r < cn; r++) {
          const o = recOff + (st + r) * 13;
          const s = dv.getUint16(o, true);
          if (sk.has(s)) continue;
          const xr = dv.getUint16(o + 2, true), zr = dv.getUint16(o + 4, true);
          const m = models[s];
          const sc = dv.getUint8(o + 12) / 50;
          const x = xr / 4, z = zr / 4;
          const reach = Math.hypot(Math.max(Math.abs(m.min[0]), Math.abs(m.max[0])), Math.max(Math.abs(m.min[2]), Math.abs(m.max[2]))) * sc + 0.5;
          if (Math.abs(x - wx) > reach || Math.abs(z - wz) > reach) continue;
          if (gone && gone.size && gone.has(m.path.toLowerCase() + '|' + xr + '|' + zr)) continue;
          const y = dv.getUint16(o + 6, true) / 100 - 100;
          const yaw = (dv.getUint16(o + 8, true) / 65536) * 360;
          const pitch = dv.getInt8(o + 10), roll = dv.getInt8(o + 11);
          e.set(U.deg2rad(pitch), -U.deg2rad(yaw), -U.deg2rad(roll), 'YXZ');
          qt.setFromEuler(e);
          vp.set(x, y, -z);
          one.set(sc, sc, sc);
          mat.compose(vp, qt, one);
          inv.copy(mat).invert();
          pt.set(wx, wy, -wz).applyMatrix4(inv);
          const lx = pt.x, ly = pt.y, lz = -pt.z;
          const pad = 0.3 / Math.max(0.05, sc);
          if (lx < m.min[0] - pad || lx > m.max[0] + pad || ly < m.min[1] - pad || ly > m.max[1] + pad || lz < m.min[2] - pad || lz > m.max[2] + pad) continue;
          const vol = (m.max[0] - m.min[0]) * (m.max[1] - m.min[1]) * (m.max[2] - m.min[2]) * sc * sc * sc;
          if (vol < bestVol) {
            bestVol = vol;
            best = { mi: s, path: m.path, x, y, z, yaw, pitch, roll, sc, min: m.min, max: m.max };
          }
        }
      }
    }
    return best;
  };

  SC.attach = function (scene) {
    if (SC.group) return;
    SC.group = new THREE.Group();
    scene.add(SC.group);
  };

  S.on('project', () => { if (S.project.meta.world !== SC.world && SC.state !== 'idle') SC.load(); });
})();
