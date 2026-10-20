/* DayZ Studio - the game's full class list (data/<world>/classes_all.csv, captured from the running game):
   every CfgVehicles class with a model, grouped by kind and model folder.  Also fetches missing 3D models on demand. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const C = (DS.Classes = {});

  C.state = 'idle'; // idle | loading | ok | none
  C.world = null;
  C.list = [];      // {c, kind, grp, model}
  C.by = new Map();
  C.groups = [];    // [{id, title, kind, items:[entry]}]

  // first match along the inheritance chain wins
  const KIND_BY_ANCESTOR = [
    ['ZombieBase', 'infected'], ['AnimalBase', 'animal'], ['Transport', 'vehicle'], ['Man', 'npc'],
    ['HouseNoDestruct', 'building'], ['House', 'building'], ['Inventory_Base', 'item'], ['Static', 'prop'],
  ];

  function parse(text) {
    const rows = [];
    text.split('\n').forEach((ln) => {
      if (!ln) return;
      const p = ln.split(',');
      if (p.length < 4) return;
      rows.push({ c: p[0], parent: p[1], scope: +p[2], model: p.slice(3).join(',').trim() });
    });
    const parent = new Map(rows.map((r) => [r.c, r.parent]));
    const chain = (c) => {
      const out = [];
      let n = 0;
      while (c && parent.has(c) && n++ < 40) { out.push(c); c = parent.get(c); }
      return out;
    };
    const list = [];
    rows.forEach((r) => {
      if (r.scope < 1 || !r.model || /\.bmp$/i.test(r.model)) return;
      const ch = chain(r.c);
      let kind = null;
      for (const [anc, k] of KIND_BY_ANCESTOR) if (ch.includes(anc)) { kind = k; break; }
      if (!kind) return;
      const parts = r.model.replace(/\//g, '\\').toLowerCase().split('\\').filter(Boolean);
      const dir = parts.slice(0, -1).filter((x) => x !== 'dz');
      list.push({ c: r.c, kind, model: r.model, grp: dir.slice(0, 2).join(' / ') || 'misc' });
    });
    return list;
  }

  C.load = async function (world) {
    world = world || S.project.meta.world;
    if (C.world === world && (C.state === 'ok' || C.state === 'loading')) return;
    C.world = world;
    C.state = 'loading';
    try {
      const r = await fetch(`data/${world}/classes_all.csv?t=${Date.now()}`);
      if (!r.ok) throw new Error();
      let text = await r.text();
      // classes of mods added with PBO tools ▸ Use in Studio (data/mods/classes_mods.csv)
      try {
        const m = await fetch(`data/mods/classes_mods.csv?t=${Date.now()}`);
        if (m.ok) text += '\n' + (await m.text());
      } catch (e) { /* no mods */ }
      C.list = parse(text);
      C.by = new Map(C.list.map((e) => [e.c, e]));
      const gm = new Map();
      C.list.forEach((e) => {
        const id = e.kind + '|' + e.grp;
        if (!gm.has(id)) gm.set(id, { id: 'cls_' + id, title: `${DS.KINDS[e.kind].name} · ${e.grp}`, kind: e.kind, items: [] });
        gm.get(id).items.push(e);
      });
      C.groups = [...gm.values()].sort((a, b) => a.title.localeCompare(b.title));
      C.state = 'ok';
    } catch (e) {
      C.list = [];
      C.state = 'none';
    }
    S.emit('classes');
  };

  /** re-read the class list (after mods were added) */
  C.reload = function () {
    C.world = null;
    return C.load();
  };

  /* ---- on-demand 3D models for classes that are not in the pack yet ---- */
  const asked = new Set();
  let timer = null;
  let inflight = false;
  const queue = new Set();

  C.wantModels = function (classes) {
    if (C.state !== 'ok' || !DS.Models || DS.Models.state === 'loading') return;
    classes.forEach((c) => {
      if (asked.has(c) || DS.Models.has(c)) return;
      const e = C.by.get(c);
      if (!e) return;
      queue.add(c);
    });
    if (!queue.size || timer || inflight) return;
    timer = setTimeout(flush, 700);
  };

  async function flush() {
    timer = null;
    const batch = [...queue].slice(0, 120);
    batch.forEach((c) => { queue.delete(c); asked.add(c); });
    if (!batch.length) return;
    inflight = true;
    try {
      const r = await fetch('/api/models/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ world: C.world, classes: batch }) }).then((x) => x.json());
      if (r.ok && DS.Models) await DS.Models.reload();
    } catch (e) { /* offline server: boxes stay */ }
    inflight = false;
    if (queue.size) timer = setTimeout(flush, 700);
  }

  S.on('project', () => { if (S.project.meta.world !== C.world) C.load(); });
  setTimeout(() => C.load(), 400);
})();
