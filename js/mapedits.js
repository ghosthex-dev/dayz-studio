/* DayZ Studio - removed vanilla map objects (trees, rocks, walls, buildings baked into the world).
   project.removed = [{ c, model, x, y, z, label, lootId? }]  (also filled by the DayZ Editor / Expansion importers)
   Exported into the quest mod (DSMapEditsData in DSCustom.c): the server and every player hide the same objects. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const ME = (DS.MapEdits = {});

  ME.list = () => S.project.removed || (S.project.removed = []);

  /** same rounding as the scene file (0.25 m), so a removed record matches its scene instance exactly */
  ME.key = (model, x, z) => String(model || '').toLowerCase() + '|' + Math.round(x * 4) + '|' + Math.round(z * 4);

  let sig = '';
  let keys = new Set();
  let lootIds = new Set();
  function rebuild() {
    const L = ME.list();
    keys = new Set(L.filter((r) => r.model).map((r) => ME.key(r.model, r.x, r.z)));
    lootIds = new Set(L.filter((r) => r.lootId).map((r) => r.lootId));
  }
  ME.keys = () => keys;
  ME.isLootRemoved = (id) => lootIds.has(id);

  /** called after anything that may have changed the list (edit, undo, open): refresh the 3D scene + 2D map */
  ME.refresh = function (force) {
    const L = ME.list();
    const s = L.length + ':' + L.reduce((a, r) => a + r.x * 7.3 + r.z * 13.1, 0).toFixed(2);
    if (!force && s === sig) return;
    sig = s;
    rebuild();
    if (DS.Scene && DS.Scene.state === 'ok') DS.Scene.refreshRemoved();
    if (DS.MapView) DS.MapView.invalidate();
    S.emit('mapedits');
  };
  S.on('structure', () => ME.refresh());
  S.on('project', () => ME.refresh(true));

  ME.name = (r) => r.label || r.c || String(r.model || '').split(/[\\/]/).pop().replace(/\.p3d$/i, '') || 'map object';

  /** remove picked map objects: [{ c, model, x, y, z, label, lootId }] */
  ME.remove = function (entries) {
    const L = ME.list();
    let n = 0;
    entries.forEach((e) => {
      const dup = L.some((r) => (e.lootId && r.lootId === e.lootId) || (e.model && r.model && ME.key(r.model, r.x, r.z) === ME.key(e.model, e.x, e.z)) || (!e.model && e.c && r.c === e.c && Math.hypot(r.x - e.x, r.z - e.z) < 0.5));
      if (dup) return;
      L.push({ c: e.c || '', model: e.model || '', x: U.round(e.x, 3), y: U.round(e.y || 0, 3), z: U.round(e.z, 3), label: e.label || '', lootId: e.lootId || undefined });
      n++;
    });
    // loot buildings: their loot spawns go too
    const loot = entries.filter((e) => e.lootId).map((e) => e.lootId);
    if (loot.length && DS.Loot) DS.Loot.deleteInstances(loot);
    if (!n) return 0;
    S.changed('removed');
    S.commit();
    ME.refresh(true);
    return n;
  };

  ME.restore = function (idxs) {
    const L = ME.list();
    const gone = new Set(idxs);
    const back = L.filter((r, i) => gone.has(i));
    S.project.removed = L.filter((r, i) => !gone.has(i));
    const loot = back.filter((r) => r.lootId).map((r) => r.lootId);
    if (loot.length && DS.Loot && S.project.loot) {
      S.project.loot.removed = (S.project.loot.removed || []).filter((id) => !loot.includes(id));
      DS.Loot.apply();
      S.emit('loot');
    }
    S.changed('removed');
    S.commit();
    ME.refresh(true);
  };
})();
