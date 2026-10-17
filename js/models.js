/* DayZ Studio - real building/prop meshes extracted from the game (data/<world>/models.json + models.bin) and, when
   present, their diffuse textures (textures.json + textures.bin, written by tools/extract_models.py).
   Faces without a texture fall back to wall/roof colours guessed from texture names. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const M = (DS.Models = {});

  M.state = 'idle'; // idle | loading | ok | none
  M.world = null;
  M.textured = false;
  M.onTexture = null; // callback when a texture finished loading (view should redraw)
  let index = null;
  let bin = null;
  let texMeta = null;
  let texBin = null;
  const cache = new Map();
  const texCache = new Map();
  const matCache = new Map();

  M.has = (cls) => M.state === 'ok' && index && index.classes[cls] !== undefined;
  M.count = () => (index ? index.models.length : 0);

  const getJson = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(); return r.json(); });
  const getBin = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); });

  M.load = async function (world) {
    world = world || S.project.meta.world;
    if (M.world === world && (M.state === 'ok' || M.state === 'loading')) return;
    M.world = world;
    M.state = 'loading';
    cache.clear();
    texCache.clear();
    matCache.clear();
    texMeta = texBin = null;
    M.textured = false;
    S.emit('terrain3d');
    try {
      const t = Date.now();
      const [j, b] = await Promise.all([getJson(`data/${world}/models.json?t=${t}`), getBin(`data/${world}/models.bin?t=${t}`)]);
      index = j;
      bin = b;
      if (j.textured) {
        try {
          const [tm, tb] = await Promise.all([getJson(`data/${world}/textures.json?t=${t}`), getBin(`data/${world}/textures.bin?t=${t}`)]);
          texMeta = tm;
          texBin = tb;
          M.textured = true;
        } catch (e) { /* geometry only */ }
      }
      M.state = 'ok';
    } catch (e) {
      index = null;
      bin = null;
      M.state = 'none';
    }
    S.emit('terrain3d');
  };

  M.reload = function () {
    M.world = null;
    return M.load();
  };

  function texture(i) {
    let t = texCache.get(i);
    if (t) return t;
    const [o, l, a] = texMeta[i];
    const url = URL.createObjectURL(new Blob([new Uint8Array(texBin, o, l)], { type: a ? 'image/png' : 'image/jpeg' }));
    const img = new Image();
    t = new THREE.Texture(img);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false; // DayZ UVs have their origin at the top-left
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    img.onload = () => {
      t.needsUpdate = true;
      URL.revokeObjectURL(url);
      if (M.onTexture) M.onTexture();
    };
    img.src = url;
    texCache.set(i, t);
    return t;
  }

  const lodOf = (m, lod) => (lod === 'lo' ? m.lods[0] : m.lods[m.lods.length - 1]);

  /** three.js BufferGeometry (non-indexed) in DayZ model space with z negated.
   *  lod: 'hi' = most detailed, 'lo' = light version for crowds.  Carries geometry groups when the model is textured
   *  (use M.materials with the same arguments). */
  M.geometry = function (cls, lod) {
    const mi = M.has(cls) ? index.classes[cls] : undefined;
    if (mi === undefined) return null;
    const key = mi + ':' + lod;
    if (cache.has(key)) return cache.get(key);
    const m = index.models[mi];
    const L = lodOf(m, lod);
    const nv = L.nv, nt = L.nt;
    const q = new Uint16Array(bin, L.o, nv * 3);
    const tri = new Uint16Array(bin, L.o + nv * 6, nt * 3);
    const hasUv = !!(L.uv && M.textured);
    const uvq = hasUv ? new Uint16Array(bin, L.o + nv * 6 + nt * 6, nv * 2) : null;
    const mn = m.min, mx = m.max;
    const sx = (mx[0] - mn[0]) / 65535, sy = (mx[1] - mn[1]) / 65535, sz = (mx[2] - mn[2]) / 65535;
    const pos = new Float32Array(nt * 9);
    const col = new Float32Array(nt * 9);
    const uv = hasUv ? new Float32Array(nt * 6) : null;
    const wall = new THREE.Color(m.wall), roof = new THREE.Color(m.roof);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    let u0 = 0, v0 = 0, us = 0, vs = 0;
    if (hasUv) {
      u0 = L.uv[0]; v0 = L.uv[1];
      us = (L.uv[2] - L.uv[0]) / 65535; vs = (L.uv[3] - L.uv[1]) / 65535;
    }
    for (let t = 0; t < nt; t++) {
      const i0 = tri[t * 3], i1 = tri[t * 3 + 1], i2 = tri[t * 3 + 2];
      a.set(mn[0] + q[i0 * 3] * sx, mn[1] + q[i0 * 3 + 1] * sy, -(mn[2] + q[i0 * 3 + 2] * sz));
      b.set(mn[0] + q[i1 * 3] * sx, mn[1] + q[i1 * 3 + 1] * sy, -(mn[2] + q[i1 * 3 + 2] * sz));
      c.set(mn[0] + q[i2 * 3] * sx, mn[1] + q[i2 * 3 + 1] * sy, -(mn[2] + q[i2 * 3 + 2] * sz));
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      const isRoof = Math.abs(n.y) > 0.55;
      const color = isRoof ? roof : wall;
      // slight per-face variation so flat walls do not look like one blob
      const shade = 0.9 + ((t * 2654435761) % 1000) / 10000;
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], t * 9);
      for (let k = 0; k < 3; k++) col.set([color.r * shade, color.g * shade, color.b * shade], t * 9 + k * 3);
      if (hasUv) {
        uv[t * 6] = u0 + uvq[i0 * 2] * us; uv[t * 6 + 1] = v0 + uvq[i0 * 2 + 1] * vs;
        uv[t * 6 + 2] = u0 + uvq[i1 * 2] * us; uv[t * 6 + 3] = v0 + uvq[i1 * 2 + 1] * vs;
        uv[t * 6 + 4] = u0 + uvq[i2 * 2] * us; uv[t * 6 + 5] = v0 + uvq[i2 * 2 + 1] * vs;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      (L.g || []).forEach((grp, k) => g.addGroup(grp[1] * 3, grp[2] * 3, k));
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    cache.set(key, g);
    return g;
  };

  function baseMaterial(key, make) {
    let m = matCache.get(key);
    if (!m) { m = make(); matCache.set(key, m); }
    return m;
  }

  /** shared materials for the streamed map scene (js/scene.js) */
  M.textureMaterial = function (ti) {
    return baseMaterial('t' + ti, () => new THREE.MeshLambertMaterial({
      map: texture(ti), side: THREE.DoubleSide, alphaTest: texMeta && texMeta[ti] && texMeta[ti][2] ? 0.5 : 0,
    }));
  };
  M.colorMaterial = function (hex) {
    return baseMaterial('c' + hex, () => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex), side: THREE.DoubleSide }));
  };
  /** model paths of the detailed pack (those buildings are drawn by the vanilla-building layer, not by the scene) */
  M.paths = () => new Set(index ? index.models.map((m) => m.path) : []);

  /** material(s) matching M.geometry(cls, lod); fresh=true gives private copies (safe to tint for selection) */
  M.materials = function (cls, lod, fresh) {
    const mi = M.has(cls) ? index.classes[cls] : undefined;
    const vc = baseMaterial('vc', () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    if (mi === undefined) return vc;
    const L = lodOf(index.models[mi], lod);
    if (!(L.uv && L.g && M.textured)) return fresh ? vc.clone() : vc;
    const out = L.g.map((grp) => {
      const k = grp[0];
      let m;
      if (Array.isArray(k)) {
        const ti = k[0];
        m = baseMaterial('t' + ti, () => new THREE.MeshLambertMaterial({
          map: texture(ti), side: THREE.DoubleSide,
          alphaTest: texMeta[ti][2] ? 0.5 : 0,
        }));
      } else if (typeof k === 'string') {
        m = baseMaterial('c' + k, () => new THREE.MeshLambertMaterial({ color: new THREE.Color(k), side: THREE.DoubleSide }));
      } else m = vc;
      return fresh ? m.clone() : m;
    });
    return out;
  };

  S.on('project', () => { if (S.project.meta.world !== M.world) M.load(); });
})();
