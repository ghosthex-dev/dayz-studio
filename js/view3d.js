/* DayZ Studio - 3D map editing tab (three.js).
   World -> three.js:  x = east,  y = up,  z = -north   (so DayZ yaw ψ is rotation.y = -ψ). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const V = (DS.View3D = {});

  let THREE_ = null;
  let root, canvas, renderer, scene, camera, hud, raycaster;
  let inited = false;
  let dirty = true;
  const cam = { tx: 7680, ty: 0, tz: -7680, dist: 9000, az: 0.0, pol: 0.95 };
  const layers = { terrain: true, water: true, objects: true, vanilla: true, loot: false, zones: true, quests: true, scene: true };
  let terrainMesh = null, zoneMesh = null, waterMesh = null;
  let objGroup, vanillaMesh = null, lootPoints = null, questGroup;
  const objMeshes = new Map(); // object id -> group
  let pickables = [];
  let drag = null;
  let keys = {};
  let terrainVer = '';
  let marquee = null, marqueeEl = null, toolsEl = null;
  V.cursor = null; // last terrain point under the mouse [x, y, z] (DayZ coordinates)
  V.surface = false; // drag objects onto other objects' surfaces
  V.brush = { mode: 'single', radius: 15, count: 10, spacing: 6, ringN: 12, yawRand: true, sMin: 0.9, sMax: 1.1, align: false, facing: 'out' };
  let lineStart = null;
  V.mapPick = false;          // "Remove map objects" mode: clicks pick vanilla map objects instead of project objects
  let mapSel = [];            // picked map objects: { c, model, x, y, z, label, lootId, box }
  let mapHi = null;           // highlight boxes for them

  const hexNum = (h) => parseInt(String(h).replace('#', ''), 16);
  const tz = (z) => -z;

  /* ---------------- init ---------------- */
  V.init = function (container) {
    root = container;
  };

  function ensure() {
    if (inited) return true;
    if (!window.THREE) {
      root.innerHTML = '<div class="ne-empty"><h3>3D engine missing</h3><p>js/vendor/three.min.js was not found.</p></div>';
      return false;
    }
    THREE_ = window.THREE;
    inited = true;
    root.innerHTML = '';
    canvas = el('canvas', { class: 'v3-canvas', tabindex: 0 });
    hud = el('div', { class: 'v3-hud' });
    root.append(canvas, hud);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);
    scene.fog = null;
    camera = new THREE.PerspectiveCamera(55, 1, 2, 90000);
    raycaster = new THREE.Raycaster();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2dd, 0.9);
    sun.position.set(-4000, 6000, 3000);
    scene.add(sun);

    objGroup = new THREE.Group();
    questGroup = new THREE.Group();
    scene.add(objGroup, questGroup);
    if (DS.Scene) { DS.Scene.attach(scene); DS.Scene.onChange = () => { dirty = true; S.emit('terrain3d'); }; }
    if (DS.Gizmo) {
      DS.Gizmo.init(scene, camera);
      DS.Gizmo.onChange = () => { S.changed('objects'); dirty = true; };
      DS.Gizmo.onEnd = (moved) => { if (moved) S.commit(); dirty = true; };
    }
    marqueeEl = el('div', { class: 'v3-marquee hidden' });
    toolsEl = el('div', { class: 'v3-tools' });
    root.append(marqueeEl, toolsEl);

    new ResizeObserver(resize).observe(root);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (S.view === 'view3d') keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    if (DS.Models) DS.Models.onTexture = () => { dirty = true; };
    ['changed', 'structure', 'selection', 'loot', 'zones', 'terrain3d'].forEach((ev) => S.on(ev, () => { dirty = true; schedule(ev); }));
    S.on('project', () => { terrainVer = ''; schedule('project'); });
    renderHud();
    resize();
    loop();
    return true;
  }

  /* ---------------- scene building ---------------- */
  let pending = {};
  let pendTimer = null;
  function schedule(kind) {
    pending[kind] = true;
    if (pendTimer) return;
    pendTimer = setTimeout(() => {
      pendTimer = null;
      const p = pending;
      pending = {};
      if (S.view === 'view3d') refresh(p);
    }, 60);
  }

  function refresh(p) {
    p = p || { all: true };
    const tv = [S.project.meta.world, DS.Terrain.state, DS.Terrain.n, S.project.meta.mapSize, DS.Models ? DS.Models.state : ''].join('|');
    if (tv !== terrainVer) { buildTerrain(); terrainVer = tv; buildVanilla(); }
    buildObjects();
    buildQuests();
    if (p.loot || p.all || p.terrain3d || p.project) buildVanilla();
    if (zoneMesh) updateZones();
    dirty = true;
  }

  function mapSize() { return DS.Terrain.has() ? DS.Terrain.size : S.project.meta.mapSize; }

  function buildTerrain() {
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); }
    if (zoneMesh) { scene.remove(zoneMesh); zoneMesh = null; }
    if (waterMesh) { scene.remove(waterMesh); waterMesh = null; }
    const size = mapSize();
    const T = DS.Terrain;
    const M = T.has() ? Math.min(511, T.n - 1) : 64;
    const verts = (M + 1) * (M + 1);
    const pos = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
    let k = 0;
    for (let j = 0; j <= M; j++) {
      for (let i = 0; i <= M; i++) {
        const x = (i / M) * size, z = (j / M) * size;
        pos[k * 3] = x;
        pos[k * 3 + 1] = T.has() ? T.heightAt(x, z) : 0;
        pos[k * 3 + 2] = -z;
        uv[k * 2] = i / M;
        uv[k * 2 + 1] = j / M;
        k++;
      }
    }
    const idx = new Uint32Array(M * M * 6);
    let q = 0;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const a = j * (M + 1) + i, b = a + 1, c = a + (M + 1), d = c + 1;
        // z decreases with j (north), keep counter-clockwise from above
        idx[q++] = a; idx[q++] = b; idx[q++] = c;
        idx[q++] = b; idx[q++] = d; idx[q++] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    terrainMesh = new THREE.Mesh(g, mat);
    terrainMesh.visible = layers.terrain;
    scene.add(terrainMesh);

    const w = S.project.meta.world;
    new THREE.TextureLoader().load(`maps/${w}/overview.jpg`, (tex) => {
      tex.anisotropy = 8;
      mat.map = tex;
      mat.color.setRGB(1.55, 1.55, 1.55);
      mat.needsUpdate = true;
      dirty = true;
    }, undefined, () => { mat.color.setHex(0x5a6a50); mat.needsUpdate = true; dirty = true; });

    // sea level
    const wg = new THREE.PlaneGeometry(size * 1.0, size * 1.0);
    waterMesh = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0x1d4f8a, transparent: true, opacity: 0.45, depthWrite: false }));
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set(size / 2, 0.2, -size / 2);
    waterMesh.visible = layers.water && T.has();
    scene.add(waterMesh);

    // loot-zone overlay (reuses the 2D overlay canvas)
    if (DS.Zones && DS.Zones.getOverlay) {
      const zm = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      zoneMesh = new THREE.Mesh(g, zm);
      zoneMesh.visible = layers.zones;
      scene.add(zoneMesh);
      updateZones();
    }
    if (cam.dist === 9000 || !terrainVer) {
      cam.tx = size / 2; cam.tz = -size / 2; cam.dist = size * 0.85;
    }
  }

  function updateZones() {
    if (!zoneMesh) return;
    const c = DS.Zones.getOverlay();
    if (!c) { zoneMesh.visible = false; return; }
    if (!zoneMesh.material.map) {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.LinearFilter;
      zoneMesh.material.map = t;
      zoneMesh.material.needsUpdate = true;
    }
    zoneMesh.material.map.needsUpdate = true;
    zoneMesh.material.opacity = DS.Zones.opacity;
    zoneMesh.visible = layers.zones && DS.Zones.mode !== 'off';
  }

  const boxGeo = () => V._box || (V._box = new THREE.BoxGeometry(1, 1, 1));
  const edgeGeo = () => V._edge || (V._edge = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)));

  function objY(o) { return DS.groundY(o); }

  function buildObjects() {
    const live = new Set();
    const wantCls = [];
    pickables = [];
    S.project.objects.forEach((o) => {
      live.add(o.id);
      let g = objMeshes.get(o.id);
      const K = DS.KINDS[o.kind] || DS.KINDS.prop;
      const hasModel = DS.Models && DS.Models.has(o.c);
      if (!hasModel && DS.Classes) wantCls.push(o.c);
      const sig = o.c + '|' + o.kind + '|' + (hasModel ? 'm' : 'b');
      if (!g || g.userData.sig !== sig) {
        if (g) objGroup.remove(g);
        g = new THREE.Group();
        let mesh, edges = null;
        if (hasModel) {
          mesh = new THREE.Mesh(DS.Models.geometry(o.c, 'hi'), DS.Models.materials(o.c, 'hi', true));
        } else {
          const b = DS.Bounds.get(o.c, o.kind);
          const sx = b.max[0] - b.min[0], sy = Math.max(0.15, b.max[1] - b.min[1]), sz = b.max[2] - b.min[2];
          mesh = new THREE.Mesh(boxGeo(), new THREE.MeshLambertMaterial({ color: hexNum(K.color) }));
          mesh.scale.set(Math.max(0.15, sx), sy, Math.max(0.15, sz));
          mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, -(b.min[2] + b.max[2]) / 2);
          edges = new THREE.LineSegments(edgeGeo(), new THREE.LineBasicMaterial({ color: 0x000000 }));
          edges.scale.copy(mesh.scale);
          edges.position.copy(mesh.position);
        }
        g.add(mesh);
        if (edges) g.add(edges);
        g.userData = { id: o.id, sig, kind: o.kind, mesh, edges };
        mesh.userData.objId = o.id;
        objGroup.add(g);
        objMeshes.set(o.id, g);
      }
      g.position.set(o.x, objY(o), -o.z);
      g.rotation.order = 'YXZ';
      g.rotation.set(-(DS.Gizmo ? DS.Gizmo.PITCH_SIGN : 1) * U.deg2rad(o.pitch || 0), -U.deg2rad(o.yaw || 0), (DS.Gizmo ? DS.Gizmo.ROLL_SIGN : 1) * U.deg2rad(o.roll || 0));
      g.scale.setScalar(o.scale || 1);
      g.visible = layers.objects && !o.hidden;
      const sel = S.sel.kind === 'object' && S.sel.ids.includes(o.id);
      if (g.userData.edges) g.userData.edges.material.color.setHex(sel ? 0x22d3ee : 0x000000);
      [].concat(g.userData.mesh.material).forEach((m) => m.emissive.setHex(sel ? 0x0b7285 : 0x000000));
      if (g.visible) pickables.push(g.userData.mesh);
    });
    objMeshes.forEach((g, id) => {
      if (!live.has(id)) { objGroup.remove(g); objMeshes.delete(id); }
    });
    if (wantCls.length && DS.Classes) DS.Classes.wantModels(wantCls);
  }

  let vanillaGroup = null;
  function buildVanilla() {
    if (vanillaGroup) {
      vanillaGroup.traverse((c) => { if (c.isInstancedMesh) c.dispose(); });
      scene.remove(vanillaGroup);
      vanillaGroup = null;
    }
    if (vanillaMesh) { scene.remove(vanillaMesh); vanillaMesh.geometry.dispose(); vanillaMesh = null; }
    if (lootPoints) { scene.remove(lootPoints); lootPoints.geometry.dispose(); lootPoints = null; }
    const L = DS.Loot;
    if (!L || !L.base) return;
    const list = L.list.filter((i) => !i.del);
    vanillaGroup = new THREE.Group();
    vanillaGroup.visible = layers.vanilla;
    scene.add(vanillaGroup);
    const byClass = new Map();
    const boxes = [];
    const ptsPos = [], ptsCol = [];
    const col = new THREE.Color();
    list.forEach((i) => {
      const xf = L.xf(i);
      const pr = L.proto(i.g);
      const y0 = xf.y || (DS.Terrain.has() ? DS.Terrain.heightAt(xf.x, xf.z) : 0);
      if (DS.Models && DS.Models.has(i.g)) {
        if (!byClass.has(i.g)) byClass.set(i.g, []);
        byClass.get(i.g).push([xf.x, y0, xf.z, xf.yw || 0, i]);
      } else boxes.push([i, xf, y0]);
      if (pr) {
        col.set(pr.u[0] ? L.color(pr.u[0]) : '#9aa4b2');
        pr.c.forEach((c) => c.p.forEach((pt) => {
          const [wx, wz] = L.toWorld(xf, pt[0], pt[2]);
          ptsPos.push(wx, y0 + pt[1] + 0.3, -wz);
          ptsCol.push(col.r, col.g, col.b);
        }));
      }
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
    byClass.forEach((arr, cls) => {
      const im = new THREE.InstancedMesh(DS.Models.geometry(cls, 'lo'), DS.Models.materials(cls, 'lo', false), arr.length);
      arr.forEach((a, n) => {
        p.set(a[0], a[1], -a[2]);
        e.set(0, -U.deg2rad(a[3]), 0);
        q.setFromEuler(e);
        m.compose(p, q, sc);
        im.setMatrixAt(n, m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.userData.lootItems = arr.map((a) => a[4]);   // instanceId -> loot building (for "Remove map objects")
      vanillaGroup.add(im);
    });
    if (boxes.length) {
      const im = new THREE.InstancedMesh(boxGeo(), new THREE.MeshLambertMaterial({ color: 0xffffff }), boxes.length);
      boxes.forEach(([i, xf, y0], n) => {
        const b = DS.Bounds.get(i.g, 'building');
        const sx = Math.max(0.5, b.max[0] - b.min[0]), sy = Math.max(0.5, b.max[1] - b.min[1]), sz = Math.max(0.5, b.max[2] - b.min[2]);
        const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
        const yaw = U.deg2rad(xf.yw || 0);
        const ox = cx * Math.cos(yaw) + cz * Math.sin(yaw), oz = -cx * Math.sin(yaw) + cz * Math.cos(yaw);
        p.set(xf.x + ox, y0 + cy, -(xf.z + oz));
        e.set(0, -yaw, 0);
        q.setFromEuler(e);
        sc.set(sx, sy, sz);
        m.compose(p, q, sc);
        im.setMatrixAt(n, m);
        const pr = L.proto(i.g);
        im.setColorAt(n, col.set(pr && pr.u[0] ? L.color(pr.u[0]) : '#9aa4b2'));
      });
      sc.set(1, 1, 1);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      im.userData.lootItems = boxes.map((b) => b[0]);
      vanillaGroup.add(im);
    }
    if (ptsPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(ptsPos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(ptsCol, 3));
      lootPoints = new THREE.Points(g, new THREE.PointsMaterial({ size: 3.2, vertexColors: true, sizeAttenuation: true, depthTest: true }));
      lootPoints.visible = layers.loot;
      scene.add(lootPoints);
    }
  }

  function buildQuests() {
    while (questGroup.children.length) {
      const c = questGroup.children.pop();
      c.geometry && c.geometry.dispose();
    }
    if (!layers.quests) return;
    const q = S.activeQuestObj();
    if (!q) return;
    const COL = { trigger: 0x22c55e, objective: 0x3b82f6, reward: 0xf59e0b, logic: 0xa78bfa };
    q.nodes.forEach((n) => {
      const T = DS.NODE_TYPES[n.type];
      if (!T) return;
      S.nodePosFields(n).forEach(({ pos }) => {
        if (!pos) return;
        const r = DS.resolvePos(pos);
        const y = r.y || (DS.Terrain.has() ? DS.Terrain.heightAt(r.x, r.z) : 0);
        const mk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 45, 12), new THREE.MeshBasicMaterial({ color: COL[T.cat] }));
        mk.position.set(r.x, y + 22, -r.z);
        questGroup.add(mk);
        const rad = typeof n.p.radius === 'number' ? n.p.radius : 0;
        if (rad > 0) {
          const pts = [];
          for (let a = 0; a <= 64; a++) {
            const th = (a / 64) * Math.PI * 2;
            const x = r.x + Math.cos(th) * rad, z = r.z + Math.sin(th) * rad;
            pts.push(new THREE.Vector3(x, (DS.Terrain.has() ? DS.Terrain.heightAt(x, z) : y) + 1.5, -z));
          }
          questGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COL[T.cat] })));
        }
      });
    });
  }

  // mirror the 3D tab camera into the game viewport (DayZ: x east, y up, z north; yaw 0 = north, clockwise)
  function pushGameCamera() {
    if (!DS.Link || !DS.Link.fresh) return;
    const d = new THREE.Vector3(cam.tx - camera.position.x, cam.ty - camera.position.y, cam.tz - camera.position.z).normalize();
    const yaw = U.wrap360((Math.atan2(d.x, -d.z) * 180) / Math.PI);
    const pitch = (Math.asin(U.clamp(d.y, -1, 1)) * 180) / Math.PI;
    DS.Link.pushCamera(camera.position.x, camera.position.y, -camera.position.z, yaw, pitch);
  }

  function syncGizmo() {
    if (!DS.Gizmo) return;
    const objs = S.sel.kind === 'object' && S.tool === 'select' ? DS.actions.selectedObjects().filter((o) => layers.objects) : [];
    DS.Gizmo.sync(objs);
  }

  /* ---------------- camera / loop ---------------- */
  function applyCamera() {
    const cp = Math.cos(cam.pol), sp = Math.sin(cam.pol);
    camera.position.set(cam.tx + Math.sin(cam.az) * sp * cam.dist, cam.ty + cp * cam.dist, cam.tz + Math.cos(cam.az) * sp * cam.dist);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
  }
  function resize() {
    if (!renderer) return;
    const r = root.getBoundingClientRect();
    const w = Math.max(50, r.width), h = Math.max(50, r.height);
    renderer.setSize(w, h, false);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  function loop() {
    requestAnimationFrame(loop);
    if (S.view !== 'view3d') return;
    // keyboard fly: move the target on the ground plane
    let mv = false;
    const sp = cam.dist * 0.012;
    const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    if (f || r) {
      cam.tx += (-Math.sin(cam.az) * f + Math.cos(cam.az) * r) * sp;
      cam.tz += (-Math.cos(cam.az) * f - Math.sin(cam.az) * r) * sp;
      mv = true;
    }
    if (mv || dirty) {
      cam.ty = DS.Terrain.has() ? DS.Terrain.heightAt(cam.tx, -cam.tz) : 0;
      applyCamera();
      if (DS.Scene && DS.Scene.state === 'ok' && DS.Scene.update(cam.tx, cam.tz, cam.dist)) dirty = true;
      syncGizmo();
      renderer.render(scene, camera);
      dirty = false;
      pushGameCamera();
    }
  }

  /* ---------------- picking ---------------- */
  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    return raycaster.ray;
  }
  function terrainHit(e) {
    const ray = setRay(e);
    const o = [ray.origin.x, ray.origin.y, ray.origin.z], d = [ray.direction.x, ray.direction.y, ray.direction.z];
    if (DS.Terrain.has()) {
      const h = DS.Terrain.raycast(o, d);
      if (h) return h;
    }
    if (d[1] < -1e-4) {
      const t = -o[1] / d[1];
      return [o[0] + d[0] * t, 0, -(o[2] + d[2] * t)];
    }
    return null;
  }
  function pickObject(e) {
    setRay(e);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.objId : null;
  }

  function ndc(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }

  /** nearest hit on other objects / vanilla buildings / terrain while dragging with "snap to surfaces" on */
  function surfaceHit(e, skipIds) {
    setRay(e);
    const list = pickables.filter((m) => !skipIds.has(m.userData.objId));
    if (vanillaGroup) vanillaGroup.children.forEach((c) => c.isInstancedMesh && list.push(c));
    if (DS.Scene && DS.Scene.group && DS.Scene.group.visible) DS.Scene.group.children.forEach((g) => g.children.forEach((m) => m.isMesh && list.push(m)));
    if (terrainMesh) list.push(terrainMesh);
    const hits = raycaster.intersectObjects(list, false);
    if (!hits.length) return null;
    const h = hits[0];
    return { x: h.point.x, y: h.point.y, z: -h.point.z, terrain: h.object === terrainMesh };
  }

  /* ---------------- removing vanilla map objects ---------------- */
  function pickMapObject(e) {
    setRay(e);
    const list = [];
    if (vanillaGroup && vanillaGroup.visible) vanillaGroup.children.forEach((c) => c.isInstancedMesh && list.push(c));
    if (DS.Scene && DS.Scene.group && DS.Scene.group.visible) DS.Scene.group.children.forEach((g) => g.children.forEach((m) => m.isMesh && list.push(m)));
    if (terrainMesh) list.push(terrainMesh);
    const hits = raycaster.intersectObjects(list, false);
    const h = hits[0];
    let entry = null;
    if (h && h.object !== terrainMesh) {
      const items = h.object.userData.lootItems;
      if (items && h.instanceId != null && items[h.instanceId]) {
        const it = items[h.instanceId];
        const xf = DS.Loot.xf(it);
        const y0 = xf.y || (DS.Terrain.has() ? DS.Terrain.heightAt(xf.x, xf.z) : 0);
        const b = DS.Bounds.get(it.g, 'building');
        entry = { c: it.g, model: '', x: xf.x, y: y0, z: xf.z, label: it.g, lootId: it.id, box: { x: xf.x, y: y0, z: xf.z, yaw: xf.yw || 0, pitch: 0, roll: 0, sc: 1, min: b.min, max: b.max } };
      } else {
        const p = DS.Scene.pick(h.point.x, h.point.y, -h.point.z);
        if (p) entry = { c: '', model: p.path, x: p.x, y: p.y, z: p.z, label: '', box: p };
      }
    }
    if (!entry) {
      if (!e.shiftKey) { mapSel = []; drawMapSel(); }
      return;
    }
    entry.label = entry.label || DS.MapEdits.name(entry);
    const same = (a) => (a.lootId && a.lootId === entry.lootId) || (a.model && a.model === entry.model && Math.abs(a.x - entry.x) < 0.01 && Math.abs(a.z - entry.z) < 0.01);
    if (e.shiftKey) mapSel = mapSel.some(same) ? mapSel.filter((a) => !same(a)) : mapSel.concat([entry]);
    else mapSel = [entry];
    drawMapSel();
  }

  function drawMapSel() {
    if (mapHi) { mapHi.traverse((c) => c.geometry && c.geometry.dispose()); scene.remove(mapHi); mapHi = null; }
    if (mapSel.length) {
      mapHi = new THREE.Group();
      const mat = new THREE.LineBasicMaterial({ color: 0xff4d4d, depthTest: false, transparent: true });
      const eu = new THREE.Euler(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
      mapSel.forEach((a) => {
        const b = a.box;
        const sx = Math.max(0.3, b.max[0] - b.min[0]), sy = Math.max(0.3, b.max[1] - b.min[1]), sz = Math.max(0.3, b.max[2] - b.min[2]);
        const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz));
        geo.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, -(b.min[2] + b.max[2]) / 2);
        const line = new THREE.LineSegments(geo, mat);
        line.renderOrder = 999;
        eu.set(U.deg2rad(b.pitch || 0), -U.deg2rad(b.yaw || 0), -U.deg2rad(b.roll || 0), 'YXZ');
        q.setFromEuler(eu);
        p.set(b.x, b.y, -b.z);
        s.set(b.sc || 1, b.sc || 1, b.sc || 1);
        m.compose(p, q, s);
        line.applyMatrix4(m);
        mapHi.add(line);
      });
      scene.add(mapHi);
    }
    renderTools();
    dirty = true;
  }

  V.setMapPick = function (on) {
    V.mapPick = !!on;
    if (!on) mapSel = [];
    if (on) S.select(null, []);
    drawMapSel();
    canvas.style.cursor = on ? 'crosshair' : '';
  };

  V.removePicked = function () {
    if (!mapSel.length) return;
    const n = DS.MapEdits.remove(mapSel);
    mapSel = [];
    drawMapSel();
    DS.toast(`Removed ${n} map object(s) — they are hidden by the exported mod`, 'ok', 2500);
  };

  function updateCursor(e) {
    const h = terrainHit(e);
    if (h) V.cursor = h;
  }

  /* ---------------- brushes ---------------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  function brushAt(x, z, e) {
    const B = V.brush, a = S.asset;
    const list = [];
    const mk = (px, pz, yaw) => {
      const o = S.makeObject({ c: a.c, kind: a.kind || 'prop', label: a.label }, px, pz, {
        yaw: U.round(U.wrap360(yaw), 1),
        scale: B.sMin === B.sMax ? B.sMin : U.round(rnd(B.sMin, B.sMax), 2),
      });
      list.push(o);
    };
    if (B.mode === 'scatter') {
      for (let i = 0; i < B.count; i++) {
        const r = B.radius * Math.sqrt(Math.random()), t = Math.random() * Math.PI * 2;
        mk(x + Math.cos(t) * r, z + Math.sin(t) * r, B.yawRand ? rnd(0, 360) : 0);
      }
    } else if (B.mode === 'ring') {
      const n = Math.max(2, B.ringN);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const px = x + Math.cos(t) * B.radius, pz = z + Math.sin(t) * B.radius;
        // DayZ yaw 0 = north (+z), clockwise: outward direction angle from north
        const out = (Math.atan2(px - x, pz - z) * 180) / Math.PI;
        mk(px, pz, B.facing === 'out' ? out : B.facing === 'in' ? out + 180 : B.yawRand ? rnd(0, 360) : 0);
      }
    } else if (B.mode === 'line') {
      if (!lineStart) {
        lineStart = [x, z];
        DS.toast('Line: click the end point', 'info', 1500);
        return;
      }
      const dx = x - lineStart[0], dz = z - lineStart[1];
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.floor(len / Math.max(0.5, B.spacing)));
      const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
      for (let i = 0; i <= n; i++) {
        const t = n ? i / n : 0;
        mk(lineStart[0] + dx * t, lineStart[1] + dz * t, B.facing === 'along' ? yaw : B.yawRand ? rnd(0, 360) : 0);
      }
      lineStart = null;
    }
    if (!list.length) return;
    if (B.align && DS.Terrain.has()) S.addObjects(list), S.select('object', list.map((o) => o.id)), V.alignToTerrain();
    else { S.addObjects(list); S.select('object', list.map((o) => o.id)); }
    S.commit();
    DS.toast(`Placed ${list.length} × ${a.label || a.c}`, 'ok', 1200);
  }

  function onDown(e) {
    canvas.focus();
    if (e.button === 2 || e.button === 1) {
      drag = { type: e.shiftKey || e.button === 1 ? 'pan' : 'orbit', x: e.clientX, y: e.clientY, az: cam.az, pol: cam.pol, tx: cam.tx, tz: cam.tz };
      return;
    }
    if (e.button !== 0) return;
    if (V.mapPick) { pickMapObject(e); return; }
    if (S.tool === 'place' && S.asset && S.asset.kind !== 'lootgroup') {
      const h = terrainHit(e);
      if (!h) return;
      if (V.brush.mode === 'single' || S.asset.prefab) DS.MapView.placeAt(DS.MapView.snap(h[0]), DS.MapView.snap(h[2]));
      else brushAt(h[0], h[2], e);
      return;
    }
    // transform gizmo handles take priority
    if (DS.Gizmo && DS.Gizmo.visible()) {
      const hid = DS.Gizmo.pick(setRay(e));
      if (hid && DS.Gizmo.begin(hid, setRay(e))) {
        drag = { type: 'gizmo' };
        return;
      }
    }
    const id = pickObject(e);
    if (id) {
      if (e.shiftKey && S.sel.kind === 'object') {
        const cur = new Set(S.sel.ids);
        cur.has(id) ? cur.delete(id) : cur.add(id);
        S.select('object', [...cur]);
      } else if (!S.isSel('object', id)) S.select('object', [id]);
      const h = terrainHit(e);
      const items = S.sel.ids.map((i) => S.obj(i)).filter((o) => o && !o.locked).map((o) => ({ o, x: o.x, y: o.y, z: o.z }));
      drag = { type: 'move', start: h, items, moved: false };
    } else {
      // empty space: rubber-band select (a plain click just clears the selection)
      marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey, moved: false };
      drag = { type: 'marquee' };
    }
  }
  function onMove(e) {
    if (S.view !== 'view3d') return;
    if (!drag) {
      // hover feedback for the gizmo + remember where the cursor is on the ground
      if (e.target === canvas) {
        updateCursor(e);
        if (DS.Gizmo && DS.Gizmo.visible()) {
          const hid = DS.Gizmo.pick(setRay(e));
          if (DS.Gizmo.hover(hid)) { dirty = true; canvas.style.cursor = hid ? 'pointer' : ''; }
        }
      }
      return;
    }
    if (drag.type === 'gizmo') {
      DS.Gizmo.update(setRay(e), e);
      return;
    }
    if (drag.type === 'marquee') {
      marquee.x1 = e.clientX; marquee.y1 = e.clientY;
      if (Math.abs(marquee.x1 - marquee.x0) + Math.abs(marquee.y1 - marquee.y0) > 4) marquee.moved = true;
      drawMarquee();
      return;
    }
    if (drag.type === 'orbit') {
      cam.az = drag.az - (e.clientX - drag.x) * 0.006;
      cam.pol = U.clamp(drag.pol - (e.clientY - drag.y) * 0.005, 0.06, 1.5);
      dirty = true;
    } else if (drag.type === 'pan') {
      const k = cam.dist * 0.0012;
      const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
      cam.tx = drag.tx - Math.cos(cam.az) * dx - Math.sin(cam.az) * dy;
      cam.tz = drag.tz + Math.sin(cam.az) * dx - Math.cos(cam.az) * dy;
      dirty = true;
    } else if (drag.type === 'move') {
      if (V.surface && !e.altKey) {
        // drop onto whatever surface is under the cursor (other objects, vanilla buildings, terrain)
        const skip = new Set(drag.items.map((it) => it.o.id));
        const sh = surfaceHit(e, skip);
        if (!sh) return;
        const first = drag.items[0];
        if (!first) return;
        drag.moved = true;
        let nx = sh.x, nz = sh.z;
        if (!e.ctrlKey) { nx = DS.MapView.snap(nx); nz = DS.MapView.snap(nz); }
        const dx = nx - first.x, dz = nz - first.z;
        const ny = sh.terrain ? 0 : U.round(sh.y, 2);
        drag.items.forEach((it) => {
          it.o.x = U.round(it.x + dx, 2);
          it.o.z = U.round(it.z + dz, 2);
          it.o.y = ny;
        });
        S.changed('objects');
        return;
      }
      const h = terrainHit(e);
      if (!h || !drag.start) return;
      let dx = h[0] - drag.start[0], dz = h[2] - drag.start[2];
      if (!drag.moved && Math.hypot(dx, dz) < 0.5) return;
      drag.moved = true;
      const first = drag.items[0];
      if (first && !e.ctrlKey) {
        dx = DS.MapView.snap(first.x + dx) - first.x;
        dz = DS.MapView.snap(first.z + dz) - first.z;
      }
      drag.items.forEach((it) => { it.o.x = U.round(it.x + dx, 2); it.o.z = U.round(it.z + dz, 2); });
      S.changed('objects');
    }
  }
  function drawMarquee() {
    if (!marqueeEl) return;
    if (!marquee || !marquee.moved) { marqueeEl.classList.add('hidden'); return; }
    const r = root.getBoundingClientRect();
    marqueeEl.classList.remove('hidden');
    marqueeEl.style.left = Math.min(marquee.x0, marquee.x1) - r.left + 'px';
    marqueeEl.style.top = Math.min(marquee.y0, marquee.y1) - r.top + 'px';
    marqueeEl.style.width = Math.abs(marquee.x1 - marquee.x0) + 'px';
    marqueeEl.style.height = Math.abs(marquee.y1 - marquee.y0) + 'px';
  }
  function finishMarquee() {
    const m = marquee;
    marquee = null;
    drawMarquee();
    if (!m) return;
    if (!m.moved) {
      if (!m.add) S.select(null, []);
      return;
    }
    const r = canvas.getBoundingClientRect();
    const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
    const v = new THREE.Vector3();
    const hit = [];
    S.project.objects.forEach((o) => {
      if (o.hidden || !layers.objects) return;
      v.set(o.x, G_objY(o), -o.z).project(camera);
      if (v.z > 1) return;
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hit.push(o.id);
    });
    if (m.add && S.sel.kind === 'object') S.select('object', [...new Set([...S.sel.ids, ...hit])]);
    else S.select(hit.length ? 'object' : null, hit);
  }
  function G_objY(o) { return objY(o); }
  function onUp() {
    if (drag && drag.type === 'gizmo') DS.Gizmo.end();
    else if (drag && drag.type === 'marquee') finishMarquee();
    else if (drag && drag.type === 'move' && drag.moved) S.commit();
    drag = null;
  }
  function onWheel(e) {
    e.preventDefault();
    cam.dist = U.clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 15, 60000);
    dirty = true;
  }

  /* ---------------- hud ---------------- */
  function renderHud() {
    hud.innerHTML = '';
    const t = DS.Terrain;
    const mdl = DS.Models && DS.Models.state === 'ok' ? ` • ${DS.Models.count()} 3D models` : '';
    const status = t.state === 'ok' ? `Terrain from game: ${t.n}×${t.n} samples (${U.round(t.step, 1)} m)${mdl}` : t.state === 'loading' ? 'Loading terrain…' : 'No terrain data yet — flat preview';
    const tog = (k, label) => el('label', { class: 'v3-tog' }, el('input', { type: 'checkbox', checked: layers[k], onchange: (e) => { layers[k] = e.target.checked; applyLayers(); } }), label);
    hud.append(
      el('div', { class: 'v3-info' },
        el('div', { class: 'v3-status' + (t.state === 'ok' ? ' ok' : '') }, status),
        t.state !== 'ok' ? el('button', { class: 'btn sm primary', onclick: () => { DS.Browser.show('game'); } }, 'Capture terrain from the game…') : null,
        el('div', { class: 'v3-keys' }, 'Click: select • Drag empty: box-select (Shift adds) • Right-drag: orbit • Middle / Shift+right: pan • Wheel: zoom • WASD: fly • 1/2/3: move/rotate/scale • X: world/local • O: snap to surfaces • Ctrl: no snapping • F: focus')),
      el('div', { class: 'v3-toggles' }, tog('terrain', 'Terrain'), tog('water', 'Sea'), tog('objects', 'My objects'), tog('vanilla', 'Vanilla loot buildings'), tog('loot', 'Loot points'), tog('zones', 'Loot zones'), tog('quests', 'Quest markers'), ...(DS.Scene && DS.Scene.state === 'ok' ? [tog('scene', `Map objects (${Math.round(DS.Scene.count / 1000)}k)`)] : []))
    );
  }
  function renderTools() {
    if (!toolsEl) return;
    const G = DS.Gizmo;
    toolsEl.innerHTML = '';
    const mode = (m, label, key, tip) => el('button', { class: 'btn sm' + (G.mode === m ? ' primary' : ''), title: tip + ' (' + key + ')', onclick: () => { G.mode = m; renderTools(); dirty = true; } }, label);
    const sel = DS.actions.selectedObjects();
    const has = sel.length > 0;
    if (V.mapPick) {
      const names = mapSel.slice(0, 3).map((a) => a.label).join(', ') + (mapSel.length > 3 ? ` +${mapSel.length - 3}` : '');
      toolsEl.append(
        el('span', { class: 'v3-pickhint' }, '🗑 Removing map objects: click a tree, rock, wall or building (Shift adds more).'),
        el('span', { class: 'muted' }, mapSel.length ? `Picked: ${names}` : 'Nothing picked'),
        el('button', { class: 'btn sm danger', disabled: !mapSel.length, title: 'Remove the picked objects from the map (Delete)', onclick: () => V.removePicked() }, `Remove ${mapSel.length || ''} (Del)`),
        el('button', { class: 'btn sm primary', title: 'Back to editing your objects (Esc)', onclick: () => V.setMapPick(false) }, 'Done'));
      [...toolsEl.childNodes].forEach((n) => { if (n.nodeType === 3) n.remove(); });
      return;
    }
    if (S.tool === 'place' && S.asset && !S.asset.prefab) {
      const B = V.brush;
      const num = (key, label, min, max, step) => el('label', { class: 'gv-tog' }, label,
        el('input', { class: 'inp sm', type: 'number', style: { width: '58px' }, value: B[key], min, max, step: step || 1, onchange: (ev) => { B[key] = +ev.target.value; } }));
      const bm = (m, label) => el('button', { class: 'btn sm' + (B.mode === m ? ' primary' : ''), onclick: () => { B.mode = m; lineStart = null; renderTools(); } }, label);
      toolsEl.append(
        el('span', { class: 'muted' }, 'Place ' + (S.asset.label || S.asset.c) + ':'),
        bm('single', 'Single'), bm('scatter', 'Scatter'), bm('line', 'Line'), bm('ring', 'Ring'),
        B.mode === 'scatter' ? num('radius', 'Radius', 1, 500) : null,
        B.mode === 'scatter' ? num('count', 'Count', 1, 200) : null,
        B.mode === 'ring' ? num('radius', 'Radius', 1, 500) : null,
        B.mode === 'ring' ? num('ringN', 'Count', 2, 200) : null,
        B.mode === 'line' ? num('spacing', 'Spacing', 0.5, 200, 0.5) : null,
        B.mode === 'ring' || B.mode === 'line' ? el('select', { class: 'inp sm', onchange: (ev) => { B.facing = ev.target.value; } },
          (B.mode === 'ring' ? [['out', 'face outward'], ['in', 'face centre'], ['none', 'no facing']] : [['along', 'along line'], ['none', 'no facing']])
            .map(([v, l]) => el('option', { value: v, selected: B.facing === v }, l))) : null,
        B.mode !== 'single' ? el('label', { class: 'gv-tog' }, el('input', { type: 'checkbox', checked: B.yawRand, onchange: (ev) => { B.yawRand = ev.target.checked; } }), 'random yaw') : null,
        B.mode !== 'single' ? num('sMin', 'Scale ≥', 0.1, 10, 0.05) : null,
        B.mode !== 'single' ? num('sMax', '≤', 0.1, 10, 0.05) : null,
        B.mode !== 'single' ? el('label', { class: 'gv-tog' }, el('input', { type: 'checkbox', checked: B.align, onchange: (ev) => { B.align = ev.target.checked; } }), 'align to terrain') : null,
        el('span', { class: 'sep' }));
    }
    toolsEl.append(
      mode('move', '✥ Move', '1', 'Move gizmo'),
      mode('rotate', '⟳ Rotate', '2', 'Rotate gizmo: yaw / pitch / roll rings'),
      mode('scale', '⤢ Scale', '3', 'Uniform scale'),
      el('span', { class: 'sep' }),
      el('button', { class: 'btn sm', title: 'World / local axes (X)', onclick: () => { G.space = G.space === 'world' ? 'local' : 'world'; renderTools(); dirty = true; } }, G.space === 'world' ? '🌐 World' : '📐 Local'),
      el('label', { class: 'gv-tog', title: 'Angle snap for the rotate gizmo (hold Shift for 1°, Ctrl for free)' }, 'Angle',
        el('select', { class: 'inp sm', onchange: (e) => { G.angleSnap = +e.target.value; } },
          [0, 1, 5, 15, 45, 90].map((a) => el('option', { value: a, selected: a === G.angleSnap }, a ? a + '°' : 'free')))),
      el('label', { class: 'gv-tog', title: 'Dragging an object drops it onto other objects, buildings or terrain under the cursor (O)' },
        el('input', { type: 'checkbox', checked: V.surface, onchange: (e) => { V.surface = e.target.checked; } }), 'Snap to surfaces'),
      el('span', { class: 'sep' }),
      el('button', { class: 'btn sm', disabled: !has, title: 'Put selected objects back on the terrain (End)', onclick: () => V.dropToGround() }, '⤓ Drop'),
      el('button', { class: 'btn sm', disabled: !has, title: 'Tilt selected objects to follow the terrain slope (N)', onclick: () => V.alignToTerrain() }, '◢ Align to terrain'),
      el('button', { class: 'btn sm', disabled: !has, title: 'Reset pitch, roll and scale', onclick: () => V.resetTilt() }, '↺ Reset tilt'),
      el('button', { class: 'btn sm', disabled: !has, title: 'Duplicate (Ctrl+D)', onclick: () => DS.actions.duplicate() }, '⧉ Duplicate'),
      el('button', { class: 'btn sm danger', disabled: !has, title: 'Delete', onclick: () => DS.actions.deleteSelection() }, '🗑'),
      el('span', { class: 'sep' }),
      el('button', { class: 'btn sm', title: 'Remove vanilla trees, rocks, walls or buildings from the map (exported in the mod)', onclick: () => V.setMapPick(true) }, '✂ Remove map objects'));
    [...toolsEl.childNodes].forEach((n) => { if (n.nodeType === 3) n.remove(); }); // stray "null" text from skipped controls
  }
  S.on('selection', () => { if (inited) renderTools(); });
  S.on('tool', () => { lineStart = null; if (inited) renderTools(); });
  S.on('asset', () => { if (inited) renderTools(); });
  S.on('structure', () => { if (inited) renderTools(); });

  V.dropToGround = function () {
    const objs = DS.actions.selectedObjects().filter((o) => !o.locked);
    if (!objs.length) return;
    objs.forEach((o) => { o.y = 0; });
    S.changed('objects');
    S.commit();
  };
  V.resetTilt = function () {
    const objs = DS.actions.selectedObjects().filter((o) => !o.locked);
    if (!objs.length) return;
    objs.forEach((o) => { o.pitch = 0; o.roll = 0; o.scale = 1; });
    S.changed('objects');
    S.commit();
  };
  V.alignToTerrain = function () {
    if (!DS.Terrain.has()) { DS.toast('No terrain data loaded', 'warn'); return; }
    const objs = DS.actions.selectedObjects().filter((o) => !o.locked);
    if (!objs.length) return;
    const Gz = DS.Gizmo;
    const d = 1.5;
    objs.forEach((o) => {
      const gx = (DS.Terrain.heightAt(o.x + d, o.z) - DS.Terrain.heightAt(o.x - d, o.z)) / (2 * d);
      const gz = (DS.Terrain.heightAt(o.x, o.z + d) - DS.Terrain.heightAt(o.x, o.z - d)) / (2 * d);
      // terrain normal in three.js space, then into the object's yaw frame
      const n = new THREE.Vector3(-gx, 1, gz).normalize();
      const v = n.applyAxisAngle(new THREE.Vector3(0, 1, 0), U.deg2rad(o.yaw || 0));
      const b = -Math.asin(U.clamp(v.x, -1, 1));
      const a = Math.atan2(v.z, v.y);
      o.pitch = U.round((-a * 180 / Math.PI) / Gz.PITCH_SIGN, 1);
      o.roll = U.round((b * 180 / Math.PI) / Gz.ROLL_SIGN, 1);
    });
    S.changed('objects');
    S.commit();
  };

  function applyLayers() {
    if (terrainMesh) terrainMesh.visible = layers.terrain;
    if (waterMesh) waterMesh.visible = layers.water && DS.Terrain.has();
    if (vanillaGroup) vanillaGroup.visible = layers.vanilla;
    if (lootPoints) lootPoints.visible = layers.loot;
    if (zoneMesh) updateZones();
    if (DS.Scene) { DS.Scene.visible = layers.scene; if (DS.Scene.group) DS.Scene.group.visible = layers.scene; }
    buildObjects();
    buildQuests();
    dirty = true;
  }

  /* ---------------- public ---------------- */
  V.show = function () {
    if (!ensure()) return;
    // start where the 2D map was looking (or where the game camera is, when it is running)
    const mv = DS.MapView.view;
    cam.tx = mv.x;
    cam.tz = -mv.z;
    cam.dist = U.clamp(380 / Math.max(0.01, mv.s) * 1.2, 120, mapSize() * 1.4);
    const gc = DS.Link && DS.Link.fresh && DS.Link.camSync ? DS.Link.camera : null;
    if (gc) {
      const a = (gc.yaw * Math.PI) / 180;
      const ahead = Math.max(40, gc.y - (DS.Terrain.has() ? DS.Terrain.heightAt(gc.x, gc.z) : 0) * 0 + 40);
      cam.tx = gc.x + Math.sin(a) * ahead;
      cam.tz = -(gc.z + Math.cos(a) * ahead);
      cam.dist = U.clamp(Math.max(60, gc.y * 0.8), 60, 3000);
    }
    if (!DS.Terrain.state || DS.Terrain.state === 'idle' || DS.Terrain.world !== S.project.meta.world) { DS.Terrain.load(); DS.Bounds.load(); }
    if (DS.Models && DS.Models.state === 'idle') DS.Models.load();
    if (DS.Scene && DS.Scene.state === 'idle') DS.Scene.load();
    terrainVer = '';
    renderHud();
    renderTools();
    resize();
    refresh({ all: true });
    dirty = true;
  };
  S.on('terrain3d', () => { if (inited) { renderHud(); } });
  V._dbg = () => ({ objs: objMeshes.size, vis: [...objMeshes.values()].filter((g) => g.visible).length, cam: Object.assign({}, cam), first: [...objMeshes.values()].slice(0, 3).map((g) => [g.position.x, g.position.y, g.position.z, g.userData.sig]) });
  V.focus = function (x, z, dist) {
    cam.tx = x; cam.tz = -z; if (dist) cam.dist = dist; dirty = true;
  };
  window.addEventListener('keydown', (e) => {
    if (S.view !== 'view3d') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (V.mapPick) {
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); V.removePicked(); }
      else if (e.code === 'Escape') V.setMapPick(false);
      return;
    }
    if (e.code === 'KeyF') {
      const o = DS.actions.selectedObjects()[0];
      if (o) V.focus(o.x, o.z, 120);
    } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      DS.Gizmo.mode = ['move', 'rotate', 'scale'][+e.code.slice(-1) - 1];
      renderTools(); dirty = true;
    } else if (e.code === 'KeyX') {
      DS.Gizmo.space = DS.Gizmo.space === 'world' ? 'local' : 'world';
      renderTools(); dirty = true;
    } else if (e.code === 'KeyO') {
      V.surface = !V.surface;
      renderTools();
      DS.toast('Snap to surfaces: ' + (V.surface ? 'on' : 'off'), 'info', 900);
    } else if (e.code === 'End') V.dropToGround();
    else if (e.code === 'KeyN') V.alignToTerrain();
  });
})();
