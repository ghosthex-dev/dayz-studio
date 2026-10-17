/* DayZ Studio - 3D transform gizmo (move / rotate / scale) for the 3D view.
   three.js space: x = east, y = up, z = -north.  Object yaw psi (deg) is rotation.y = -psi.
   The gizmo edits the selected store objects directly (x, y, z, yaw, pitch, roll, scale) and reports through callbacks. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const G = (DS.Gizmo = {});

  G.mode = 'move';       // move | rotate | scale
  G.space = 'world';     // world | local
  G.angleSnap = 15;      // degrees, 0 = free
  G.PITCH_SIGN = -1;     // three.js Euler X = -PITCH_SIGN * pitch, Z = ROLL_SIGN * roll (order YXZ) - measured in the game
  G.ROLL_SIGN = -1;
  G.onChange = null;     // () => void   called while dragging
  G.onEnd = null;        // (moved:boolean) => void

  const COLORS = { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6, s: 0xe5e7eb };
  const HOT = 0xfacc15;
  let T = null;
  let group = null;
  let camera = null;
  let handles = []; // {id, kind, axis, proxy, shown[], mats[]}
  let hover = null;
  let items = []; // current selection
  let activeDrag = null;
  const centre = { x: 0, y: 0, z: 0 };

  G.objectY = (o) => DS.groundY(o);

  function rotGeo(geo, q) {
    geo.applyMatrix4(new T.Matrix4().makeRotationFromQuaternion(q));
  }
  function basicMat(color) {
    return new T.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, side: T.DoubleSide });
  }
  function addHandle(id, kind, axis, color, visibleMeshes, proxyGeo, mode) {
    const mats = [];
    visibleMeshes.forEach((m) => {
      m.material = basicMat(color);
      m.renderOrder = 999;
      mats.push(m.material);
      group.add(m);
    });
    const proxy = new T.Mesh(proxyGeo, new T.MeshBasicMaterial({ visible: false, side: T.DoubleSide }));
    proxy.userData.handle = id;
    group.add(proxy);
    const h = { id, kind, axis, mode, proxy, meshes: visibleMeshes, mats, color };
    handles.push(h);
    return h;
  }

  G.init = function (scene, cam) {
    T = window.THREE;
    camera = cam;
    group = new T.Group();
    group.visible = false;
    scene.add(group);
    const axes = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) };
    ['x', 'y', 'z'].forEach((a) => {
      const shaft = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.8, 8));
      shaft.position.y = 0.4;
      const tip = new T.Mesh(new T.ConeGeometry(0.1, 0.28, 12));
      tip.position.y = 0.94;
      const proxyGeo = new T.CylinderGeometry(0.16, 0.16, 1.15, 6);
      proxyGeo.translate(0, 0.58, 0);
      // orient: cylinder axis is +Y; rotate to the handle axis
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axes[a]);
      [shaft, tip].forEach((m) => { rotGeo(m.geometry, q); m.position.applyQuaternion(q); });
      rotGeo(proxyGeo, q);
      addHandle('m' + a, 'axis', a, COLORS[a], [shaft, tip], proxyGeo, 'move');
    });
    // planes: ground (xz) and the two vertical ones
    const plane = (id, a, b, nAxis, color) => {
      const g = new T.PlaneGeometry(0.3, 0.3);
      const m = new T.Mesh(g);
      const n = axes[nAxis];
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n);
      m.position.copy(axes[a]).multiplyScalar(0.42).addScaledVector(axes[b], 0.42);
      const proxyGeo = g.clone();
      rotGeo(proxyGeo, m.quaternion);
      proxyGeo.translate(m.position.x, m.position.y, m.position.z);
      addHandle(id, 'plane', nAxis, color, [m], proxyGeo, 'move');
    };
    plane('pxz', 'x', 'z', 'y', COLORS.y);
    plane('pxy', 'x', 'y', 'z', COLORS.z);
    plane('pyz', 'y', 'z', 'x', COLORS.x);
    // rotation rings
    const ring = (id, axis, color) => {
      const g = new T.TorusGeometry(1, 0.018, 6, 72);
      const pg = new T.TorusGeometry(1, 0.09, 4, 36);
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), axes[axis]);
      rotGeo(g, q);
      rotGeo(pg, q);
      addHandle(id, 'ring', axis, color, [new T.Mesh(g)], pg, 'rotate');
    };
    ring('ry', 'y', COLORS.y);
    ring('rx', 'x', COLORS.x);
    ring('rz', 'z', COLORS.z);
    // uniform scale
    const box = new T.Mesh(new T.BoxGeometry(0.28, 0.28, 0.28));
    addHandle('s', 'scale', 's', COLORS.s, [box], new T.BoxGeometry(0.5, 0.5, 0.5), 'scale');
  };

  function applyVisibility() {
    handles.forEach((h) => {
      const on = h.mode === G.mode;
      h.meshes.forEach((m) => (m.visible = on));
      h.proxy.visible = on; // keeps raycasting of the proxy cheap to filter below
    });
  }

  /** place the gizmo on the current selection (array of store objects) */
  G.sync = function (objs) {
    if (!group) return;
    items = objs.filter((o) => o && !o.locked && !o.hidden);
    if (!items.length) { group.visible = false; return; }
    let sx = 0, sy = 0, sz = 0;
    items.forEach((o) => { sx += o.x; sy += G.objectY(o); sz += o.z; });
    centre.x = sx / items.length;
    centre.y = sy / items.length;
    centre.z = sz / items.length;
    group.position.set(centre.x, centre.y, -centre.z);
    // local space follows the first object's orientation; world space stays axis aligned
    const o = items[0];
    if (G.space === 'local') {
      // rings are drawn on the yaw frame only (pitch/roll are applied after yaw); the move gizmo follows the full tilt
      const full = G.mode === 'move';
      const e = new T.Euler(full ? -G.PITCH_SIGN * U.deg2rad(o.pitch || 0) : 0, -U.deg2rad(o.yaw || 0), full ? G.ROLL_SIGN * U.deg2rad(o.roll || 0) : 0, 'YXZ');
      group.quaternion.setFromEuler(e);
    } else group.quaternion.identity();
    applyVisibility();
    group.visible = true;
    G.rescale();
  };

  /** keep the gizmo a constant size on screen */
  G.rescale = function () {
    if (!group || !group.visible) return;
    const d = camera.position.distanceTo(group.position);
    group.scale.setScalar(Math.max(0.5, d * 0.13));
    group.updateMatrixWorld(true);
  };

  G.visible = () => !!group && group.visible;

  function setHot(id) {
    handles.forEach((h) => h.mats.forEach((m) => m.color.setHex(h.id === id ? HOT : h.color)));
  }
  G.hover = function (id) {
    if (id === hover) return false;
    hover = id;
    setHot(id);
    return true;
  };

  /** which handle (id) does this ray hit? */
  G.pick = function (ray) {
    if (!group || !group.visible) return null;
    group.updateMatrixWorld(true);
    const rc = new T.Raycaster();
    rc.ray.copy(ray);
    const proxies = handles.filter((h) => h.mode === G.mode).map((h) => h.proxy);
    const hits = rc.intersectObjects(proxies, false);
    return hits.length ? hits[0].object.userData.handle : null;
  };

  /* ---------------------------------------------------------------- dragging */
  const axisWorld = (h) => {
    const base = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) }[h.axis];
    return base.applyQuaternion(group.quaternion).normalize();
  };
  function axisParam(p0, a, ray) {
    const w = new T.Vector3().subVectors(p0, ray.origin);
    const b = a.dot(ray.direction);
    const den = 1 - b * b;
    if (den < 1e-5) return null;
    const s = (ray.direction.dot(w) - b * a.dot(w)) / den;
    return s * b - a.dot(w);
  }
  function planePoint(p0, n, ray) {
    const dn = ray.direction.dot(n);
    if (Math.abs(dn) < 1e-5) return null;
    const s = new T.Vector3().subVectors(p0, ray.origin).dot(n) / dn;
    if (s < 0) return null;
    return ray.origin.clone().addScaledVector(ray.direction, s);
  }

  G.begin = function (id, ray) {
    const h = handles.find((x) => x.id === id);
    if (!h || !items.length) return false;
    const p0 = group.position.clone();
    const st = {
      h, p0, moved: false,
      items: items.map((o) => ({ o, x: o.x, y: o.y, ay: G.objectY(o), z: o.z, yaw: o.yaw || 0, pitch: o.pitch || 0, roll: o.roll || 0, scale: o.scale || 1 })),
    };
    if (h.kind === 'axis') {
      st.a = axisWorld(h);
      st.t0 = axisParam(p0, st.a, ray);
      if (st.t0 === null) return false;
    } else if (h.kind === 'plane') {
      st.n = axisWorld(h);
      st.q0 = planePoint(p0, st.n, ray);
      if (!st.q0) return false;
    } else if (h.kind === 'ring') {
      st.n = axisWorld(h);
      const q = planePoint(p0, st.n, ray);
      if (!q) return false;
      st.v0 = q.sub(p0).normalize();
    } else {
      const n = camera.getWorldDirection(new T.Vector3()).negate();
      st.n = n;
      const q = planePoint(p0, n, ray);
      if (!q) return false;
      st.r0 = Math.max(0.01, q.distanceTo(p0));
    }
    activeDrag = st;
    return true;
  };

  G.dragging = () => !!activeDrag;

  const snapV = (v) => DS.MapView.snap(v);
  G.update = function (ray, e) {
    const st = activeDrag;
    if (!st) return;
    const free = e.ctrlKey || e.metaKey;
    const h = st.h;
    if (h.kind === 'axis' || h.kind === 'plane') {
      const D = new T.Vector3();
      if (h.kind === 'axis') {
        const t = axisParam(st.p0, st.a, ray);
        if (t === null) return;
        D.copy(st.a).multiplyScalar(t - st.t0);
      } else {
        const q = planePoint(st.p0, st.n, ray);
        if (!q) return;
        D.subVectors(q, st.q0);
      }
      // grid snapping is applied to the first object's final position
      const f = st.items[0];
      let dx = D.x, dz = -D.z, dy = D.y;
      if (!free && +S.project.meta.snap > 0) {
        if (Math.abs(dx) > 1e-6) dx = snapV(f.x + dx) - f.x;
        if (Math.abs(dz) > 1e-6) dz = snapV(f.z + dz) - f.z;
      }
      if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 0.001) st.moved = true;
      const useY = Math.abs(D.y) > 1e-6;
      st.items.forEach((it) => {
        it.o.x = U.round(it.x + dx, 2);
        it.o.z = U.round(it.z + dz, 2);
        if (useY) it.o.y = U.round(Math.max(-50, it.ay + dy), 2);
      });
    } else if (h.kind === 'ring') {
      const q = planePoint(st.p0, st.n, ray);
      if (!q) return;
      const v = q.sub(st.p0).normalize();
      const c = new T.Vector3().crossVectors(st.v0, v);
      let ang = Math.atan2(c.dot(st.n), st.v0.dot(v)); // radians about the ring normal
      let deg = U.rad2deg ? U.rad2deg(ang) : (ang * 180) / Math.PI;
      const step = e.shiftKey ? 1 : G.angleSnap;
      if (!free && step > 0) deg = Math.round(deg / step) * step;
      if (Math.abs(deg) > 0.01) st.moved = true;
      const phi = (deg * Math.PI) / 180;
      st.deg = deg;
      if (h.axis === 'y') {
        // yaw: spin each object and orbit the group around the centre
        const cs = Math.cos(phi), sn = Math.sin(phi);
        st.items.forEach((it) => {
          it.o.yaw = U.round(U.wrap360(it.yaw - deg), 1);
          if (st.items.length > 1) {
            const ox = it.x - centre.x, oz3 = -(it.z - centre.z);
            // rotation about +Y by phi in three.js space
            const nx = ox * cs + oz3 * sn;
            const nz3 = -ox * sn + oz3 * cs;
            it.o.x = U.round(centre.x + nx, 2);
            it.o.z = U.round(centre.z - nz3, 2);
          }
        });
      } else if (h.axis === 'x') {
        st.items.forEach((it) => { it.o.pitch = U.round(wrap180(it.pitch - G.PITCH_SIGN * deg), 1); });
      } else {
        st.items.forEach((it) => { it.o.roll = U.round(wrap180(it.roll + G.ROLL_SIGN * deg), 1); });
      }
    } else {
      const q = planePoint(st.p0, st.n, ray);
      if (!q) return;
      let f = q.distanceTo(st.p0) / st.r0;
      if (!free) f = Math.round(f * 20) / 20;
      f = U.clamp(f, 0.05, 40);
      if (Math.abs(f - 1) > 0.01) st.moved = true;
      st.items.forEach((it) => {
        it.o.scale = U.round(U.clamp(it.scale * f, 0.05, 40), 3);
        if (st.items.length > 1) {
          it.o.x = U.round(centre.x + (it.x - centre.x) * f, 2);
          it.o.z = U.round(centre.z + (it.z - centre.z) * f, 2);
        }
      });
    }
    if (G.onChange) G.onChange();
  };

  G.end = function () {
    const st = activeDrag;
    activeDrag = null;
    if (st && G.onEnd) G.onEnd(st.moved);
  };

  function wrap180(a) {
    a = ((a % 360) + 360) % 360;
    return a > 180 ? a - 360 : a;
  }
  G.info = () => {
    const st = activeDrag;
    if (!st) return '';
    if (st.h.kind === 'ring') return (st.deg || 0).toFixed(0) + '°';
    return '';
  };
})();
