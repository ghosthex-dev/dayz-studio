/* DayZ Studio - prefab stamps: your own reusable groups of objects (a fortified base, an outpost, a camp…).
   Library in Documents/DayZStudio/Prefabs (shared by every project; browser storage when there is no studio server).
   part = [class, kind, dx, dz, yaw, dyAboveGround|null, pitch, roll, scale, label]   (built-in prefabs use the first 5) */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const P = (DS.Stamps = {});
  const LS = 'dzstudio.stamps';

  P.list = [];
  P.dir = '';

  const local = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
  const setLocal = (l) => { try { localStorage.setItem(LS, JSON.stringify(l)); } catch (e) { /* ignore */ } };

  P.load = async function () {
    try {
      const r = await fetch('/api/prefabs', { cache: 'no-store' }).then((x) => x.json());
      if (r.ok) { P.list = r.prefabs; P.dir = r.dir; P.server = true; }
    } catch (e) {
      P.list = local();
      P.server = false;
    }
    S.emit('stamps');
  };

  const ground = (x, z) => (DS.Terrain && DS.Terrain.has() ? DS.Terrain.heightAt(x, z) : 0);

  /** the selected objects as a stamp (relative to their centre) */
  P.fromObjects = function (objs, name) {
    const cx = objs.reduce((a, o) => a + o.x, 0) / objs.length;
    const cz = objs.reduce((a, o) => a + o.z, 0) / objs.length;
    return {
      id: 'st' + Date.now().toString(36), name, desc: `${objs.length} objects`,
      parts: objs.map((o) => [o.c, o.kind, U.round(o.x - cx, 2), U.round(o.z - cz, 2), U.round(o.yaw || 0, 1),
        o.y ? U.round(o.y - ground(o.x, o.z), 2) : null, U.round(o.pitch || 0, 1), U.round(o.roll || 0, 1), o.scale || 1, o.label || '']),
    };
  };

  P.saveSelection = async function () {
    const objs = DS.actions.selectedObjects();
    if (!objs.length) { DS.toast('Select the objects for the stamp first (box-select or Shift+click).', 'warn', 3000); return; }
    const name = prompt(`Name for this prefab stamp (${objs.length} objects)`, 'My outpost');
    if (!name || !name.trim()) return;
    const st = P.fromObjects(objs, name.trim());
    if (P.server) {
      const r = await fetch('/api/prefabs/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { DS.toast('Could not save the stamp', 'error'); return; }
    } else setLocal(local().concat([st]));
    await P.load();
    DS.toast(`Saved prefab stamp “${st.name}” — find it under “My prefab stamps” in the asset list.`, 'ok', 3500);
  };

  P.remove = async function (id) {
    const st = P.list.find((x) => x.id === id);
    if (!st || !confirm(`Delete the prefab stamp “${st.name}” from your library?`)) return;
    if (P.server) await fetch('/api/prefabs/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
    else setLocal(local().filter((x) => x.id !== id));
    if (S.asset && S.asset.prefab && S.asset.prefab.id === id) S.asset = null;
    await P.load();
  };

  /** the objects of prefab pf stamped at (x, z) turned by yaw degrees (not added to the project yet) */
  P.place = function (pf, x, z, yaw, extraYaw) {
    const g = U.uid('g');
    const r = U.deg2rad(yaw || 0);
    return pf.parts.map((p) => {
      const dx = p[2] * Math.cos(r) + p[3] * Math.sin(r);
      const dz = -p[2] * Math.sin(r) + p[3] * Math.cos(r);
      const px = x + dx, pz = z + dz;
      const extra = { yaw: U.wrap360((p[4] || 0) + (yaw || 0) + (extraYaw || 0)), group: g };
      if (p[5] != null) extra.y = U.round(ground(px, pz) + p[5], 2);
      if (p[6]) extra.pitch = p[6];
      if (p[7]) extra.roll = p[7];
      if (p[8] && p[8] !== 1) extra.scale = p[8];
      return S.makeObject({ c: p[0], kind: p[1], label: p[9] || '' }, px, pz, extra);
    });
  };

  setTimeout(P.load, 800);
})();
