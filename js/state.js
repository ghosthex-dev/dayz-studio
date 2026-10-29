/* DayZ Studio - central store: project model, selection, undo/redo, persistence, shared-entity helpers */
(function () {
  const DS = (window.DS = window.DS || {});
  const U = DS.util;
  const KEY = 'dzstudio.project.v1';
  const S = (DS.store = {});

  const listeners = {};
  S.on = (ev, fn) => ((listeners[ev] = listeners[ev] || []).push(fn), fn);
  S.emit = (ev, a, b) => (listeners[ev] || []).slice().forEach((f) => f(a, b));

  S.blank = function () {
    return {
      v: 1,
      meta: { name: 'Untitled Project', author: '', world: 'chernarusplus', mapSize: 15360, modName: 'DZStudioQuests', snap: 5 },
      objects: [],
      quests: [],
      npcs: [],   // characters with their own behaviour (js/npcs.js), used by quests too
      bg: null,
      loot: { removed: [], moved: {}, added: [], protos: {} },
      zones: [],
    };
  };

  S.project = S.blank();
  S.sel = { kind: null, ids: [] }; // kind: object | node | link | quest
  S.view = 'map';
  S.tool = 'select';
  S.asset = null; // asset being placed
  S.activeQuest = null;
  S.ver = 0;

  /* ---------- lookups ---------- */
  let mapVer = -1;
  let objMap = new Map();
  S.obj = function (id) {
    if (mapVer !== S.ver) {
      objMap = new Map(S.project.objects.map((o) => [o.id, o]));
      mapVer = S.ver;
    }
    return objMap.get(id);
  };
  S.quest = (id) => S.project.quests.find((q) => q.id === id) || null;
  S.activeQuestObj = function () {
    let q = S.quest(S.activeQuest);
    if (!q && S.project.quests.length) {
      q = S.project.quests[0];
      S.activeQuest = q.id;
    }
    return q;
  };
  S.node = function (q, id) {
    return q ? q.nodes.find((n) => n.id === id) || null : null;
  };
  // a project made for a map this PC doesn't list (e.g. a newer DLC map) keeps its own map and size
  S.world = () => DS.WORLDS.find((w) => w.id === S.project.meta.world)
    || (S.project.meta.world ? { id: S.project.meta.world, name: S.project.meta.world + ' (not on this PC)', size: S.project.meta.mapSize || 15360, mission: 'dayzOffline.' + S.project.meta.world, missing: true } : DS.WORLDS[0]);

  /** ask the studio server which maps this PC has (/api/worlds) and merge them into DS.WORLDS: new DLC maps are
   *  added before the mod maps, known ones get installed / imagery / size from the PC. false without a server. */
  DS.loadWorlds = async function () {
    const r = await fetch('/api/worlds', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    if (!r || !r.ok) return false;
    (r.worlds || []).forEach((f) => {
      let w = DS.WORLDS.find((x) => x.id === f.id);
      if (!w) {
        const at = DS.WORLDS.findIndex((x) => x.mod);
        w = { id: f.id, name: f.name, size: f.size || 15360, mission: f.mission || 'dayzOffline.' + f.id, found: true };
        DS.WORLDS.splice(at < 0 ? DS.WORLDS.length : at, 0, w);
      }
      if (f.size) w.size = f.size;
      if (f.mission) w.mission = f.mission;
      Object.assign(w, { installed: f.game, dlc: f.dlc, modName: f.mod || '', server: !!f.mission, imagery: f.imagery, terrain: f.terrain,
        missionFromMod: !!f.missionFromMod, missionOutdated: !!f.missionOutdated });
      if (f.mod) w.mod = true;
    });
    // maps the server didn't find are not installed (DLC not owned / not downloaded, map mod not subscribed) - except
    // 'custom', which is the user's own map with their own background image
    DS.WORLDS.forEach((w) => { if (w.id !== 'custom' && w.installed === undefined) w.installed = false; });
    return true;
  };
  /** name for the Map list: "Nasdara (DLC)", "Sakhal (not installed)" */
  DS.worldLabel = (w) => w.name + (w.installed === false ? ' (not installed)' : w.dlc ? ' (DLC)' : '');

  /** Resolve a quest position {x,y,z,ref}: linked placed objects win over stored numbers. */
  DS.resolvePos = function (p) {
    if (p && p.ref) {
      const o = S.obj(p.ref);
      if (o) return { x: o.x, y: o.y, z: o.z };
    }
    return { x: (p && p.x) || 0, y: (p && p.y) || 0, z: (p && p.z) || 0 };
  };

  /** All positional fields of a node: [{field, pos}] */
  S.nodePosFields = function (n) {
    const T = DS.NODE_TYPES[n.type];
    if (!T) return [];
    // a quest's NPC stands where its NPC (NPCs tab) stands - the same position object, so dragging it moves the NPC
    const npc = n.type === 'trg_npc' && n.p.npcId && DS.Npcs ? DS.Npcs.get(n.p.npcId) : null;
    if (npc) return [{ field: T.fields.find((f) => f.k === 'pos'), pos: npc.pos }];
    return T.fields.filter((f) => f.t === 'pos' && (!f.show || f.show(n.p))).map((f) => ({ field: f, pos: n.p[f.k] }));
  };

  /** Quest nodes referencing a placed object */
  S.usageOf = function (objId) {
    const out = [];
    S.project.quests.forEach((q) =>
      q.nodes.forEach((n) => {
        const T = DS.NODE_TYPES[n.type];
        if (!T) return;
        T.fields.forEach((f) => {
          if (f.t === 'pos' && n.p[f.k] && n.p[f.k].ref === objId) out.push({ quest: q, node: n });
        });
      })
    );
    return out;
  };

  /* ---------- change notification ---------- */
  let saveTimer = null;
  S.changed = function (kind) {
    S.ver++;
    S.emit('changed', kind || 'any');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(S.save, 600);
  };
  S.structure = function () {
    S.ver++;
    S.emit('structure');
    S.emit('changed', 'structure');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(S.save, 600);
  };

  /* ---------- selection ---------- */
  S.select = function (kind, ids) {
    S.sel = { kind: ids && ids.length ? kind : null, ids: ids || [] };
    S.emit('selection');
  };
  S.isSel = (kind, id) => S.sel.kind === kind && S.sel.ids.includes(id);
  // S.view is the focused view (keyboard shortcuts act on it); with the docking workspace several views can be on
  // screen at once - S.shown(v) says whether a view is visible and should keep drawing
  S.setView = function (v) {
    S.view = v;
    S.emit('view');
  };
  S.shown = (v) => (DS.Dock && DS.Dock.ready ? DS.Dock.shown(v) : S.view === v);
  S.setTool = function (t) {
    S.tool = t;
    S.emit('tool');
  };
  S.setAsset = function (a) {
    S.asset = a;
    if (a) S.tool = 'place';
    S.emit('tool');
    S.emit('asset');
  };

  /* ---------- history ---------- */
  let past = [];
  let idx = -1;
  const snap = () => JSON.stringify(S.project);
  S.resetHistory = function () {
    past = [snap()];
    idx = 0;
    S.emit('history');
  };
  S.commit = function () {
    const s = snap();
    if (s === past[idx]) return;
    past = past.slice(0, idx + 1);
    past.push(s);
    if (past.length > 120) past.shift();
    idx = past.length - 1;
    S.emit('history');
  };
  S.canUndo = () => idx > 0;
  S.canRedo = () => idx < past.length - 1;
  function restore() {
    S.project = JSON.parse(past[idx]);
    S.sel = { kind: null, ids: [] };
    if (!S.quest(S.activeQuest)) S.activeQuest = S.project.quests[0] ? S.project.quests[0].id : null;
    if (DS.Npcs && !DS.Npcs.get(S.activeNpc)) S.activeNpc = null;
    S.structure();
    S.emit('selection');
    S.emit('history');
  }
  S.undo = () => S.canUndo() && (idx--, restore());
  S.redo = () => S.canRedo() && (idx++, restore());

  /* ---------- persistence ---------- */
  S.save = function () {
    const write = (p) => localStorage.setItem(KEY, JSON.stringify(p));
    S.project.meta.savedAt = Date.now();   // lets the app tell whether the disk copy is newer
    try {
      write(S.project);
      S.emit('saved', true);
    } catch (e) {
      try {
        const copy = Object.assign({}, S.project, { bg: null });
        write(copy);
        S.emit('saved', 'nobg');
      } catch (e2) {
        S.emit('saved', false);
      }
    }
  };
  S.load = function () {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.objects && p.quests) return S.setProject(p, true);
      }
    } catch (e) {}
    return false;
  };
  S.setProject = function (p, silent) {
    const b = S.blank();
    S.project = Object.assign(b, p);
    S.project.meta = Object.assign(b.meta, p.meta || {});
    if (DS.CustomNodes) DS.CustomNodes.registerProject(S.project);   // custom node types before anything draws them
    S.project.objects.forEach((o) => {
      if (!o.id) o.id = U.uid('o');
    });
    S.sel = { kind: null, ids: [] };
    S.activeQuest = S.project.quests[0] ? S.project.quests[0].id : null;
    S.activeNpc = null;
    if (DS.Npcs) DS.Npcs.sync();   // NPCs made inside quests (older projects) become NPCs of the NPCs tab
    S.resetHistory();
    S.structure();
    S.emit('selection');
    S.emit('project');
    return true;
  };

  /* ---------- object operations ---------- */
  S.makeObject = function (a, x, z, extra) {
    return Object.assign(
      {
        id: U.uid('o'), c: a.c, kind: a.kind || 'prop', label: a.label && a.label !== a.c ? a.label : '',
        x: U.round(x, 2), y: 0, z: U.round(z, 2), yaw: 0, pitch: 0, roll: 0, scale: 1, snap: true,
        init: '', group: '', loot: [], event: a.kind === 'event' ? a.c : '', hidden: false, locked: false,
        fx: a.fx ? JSON.parse(JSON.stringify(a.fx)) : undefined,
      },
      extra || {}
    );
  };
  S.addObjects = function (list) {
    S.project.objects.push(...list);
    S.structure();
  };
  S.deleteObjects = function (ids) {
    const set = new Set(ids);
    // keep quest positions: freeze linked refs to their last coordinates
    S.project.quests.forEach((q) =>
      q.nodes.forEach((n) => {
        S.nodePosFields(n).forEach(({ pos }) => {
          if (pos && pos.ref && set.has(pos.ref)) {
            const o = S.obj(pos.ref);
            if (o) {
              pos.x = o.x;
              pos.y = o.y;
              pos.z = o.z;
            }
            pos.ref = null;
          }
        });
      })
    );
    S.project.objects = S.project.objects.filter((o) => !set.has(o.id));
    S.structure();
  };

  /* ---------- quest / node operations ---------- */
  S.newQuest = function (name) {
    const q = {
      id: U.uid('q'), name: name || 'New Quest ' + (S.project.quests.length + 1),
      description: '', repeatable: false, cooldown: 3600, failOnDeath: false, nodes: [], links: [],
    };
    S.project.quests.push(q);
    S.activeQuest = q.id;
    S.structure();
    return q;
  };
  S.deleteQuest = function (id) {
    S.project.quests = S.project.quests.filter((q) => q.id !== id);
    S.project.quests.forEach((q) => { if (q.requires) q.requires = q.requires.filter((r) => r !== id); });   // quest chains
    if (S.activeQuest === id) S.activeQuest = S.project.quests[0] ? S.project.quests[0].id : null;
    S.structure();
  };
  S.defaultParams = function (type) {
    const p = {};
    DS.NODE_TYPES[type].fields.forEach((f) => (p[f.k] = JSON.parse(JSON.stringify(f.def === undefined ? '' : f.def))));
    return p;
  };
  S.addNode = function (q, type, x, y, params) {
    const n = { id: U.uid('n'), type, x: Math.round(x), y: Math.round(y), p: Object.assign(S.defaultParams(type), params || {}) };
    q.nodes.push(n);
    S.structure();
    return n;
  };
  S.deleteNodes = function (q, ids) {
    const set = new Set(ids);
    q.nodes = q.nodes.filter((n) => !set.has(n.id));
    q.links = q.links.filter((l) => !set.has(l.from) && !set.has(l.to));
    S.structure();
  };
  S.link = function (q, from, to) {
    if (from === to) return false;
    const tn = S.node(q, to);
    const fn = S.node(q, from);
    if (!tn || !fn || DS.NODE_TYPES[tn.type].cat === 'trigger' || fn.type === 'end') return false;
    if (q.links.some((l) => l.from === from && l.to === to)) return false;
    q.links.push({ id: U.uid('l'), from, to });
    S.structure();
    return true;
  };

  /* ---------- editing actions shared by map + hotkeys ---------- */
  const A = (DS.actions = {});
  A.selectedObjects = () => (S.sel.kind === 'object' ? S.sel.ids.map((i) => S.obj(i)).filter(Boolean) : []);
  A.deleteSelection = function () {
    if (S.sel.kind === 'object') {
      const ids = S.sel.ids.filter((id) => !(S.obj(id) || {}).locked);
      S.deleteObjects(ids);
      S.select(null, []);
      S.commit();
    } else if (S.sel.kind === 'zone') {
      S.sel.ids.forEach((id) => DS.Zones.remove(id));
      S.select(null, []);
      S.commit();
    } else if (S.sel.kind === 'loot') {
      DS.Loot.deleteInstances(S.sel.ids);
      S.select(null, []);
      S.commit();
    } else if (S.sel.kind === 'node') {
      const q = S.activeQuestObj();
      if (q) {
        S.deleteNodes(q, S.sel.ids);
        S.select(null, []);
        S.commit();
      }
    } else if (S.sel.kind === 'bnode' && DS.Npcs) {
      DS.Npcs.deleteNodes(S.sel.ids);
      S.select(null, []);
      S.commit();
    } else if (S.sel.kind === 'blink' && DS.Npcs && DS.Npcs.active()) {
      const g = DS.Npcs.active().graph;
      g.links = g.links.filter((l) => !S.sel.ids.includes(l.id));
      S.select(null, []);
      S.structure();
      S.commit();
    } else if (S.sel.kind === 'npc' && DS.Npcs) {
      DS.Npcs.remove(S.sel.ids[0]);
    } else if (S.sel.kind === 'link') {
      const q = S.activeQuestObj();
      if (q) {
        q.links = q.links.filter((l) => !S.sel.ids.includes(l.id));
        S.select(null, []);
        S.structure();
        S.commit();
      }
    }
  };
  A.rotate = function (deg) {
    if (S.sel.kind === 'loot') {
      DS.Loot.rotate(S.sel.ids, deg);
      S.commit();
      return true;
    }
    const objs = A.selectedObjects();
    if (!objs.length) return false;
    objs.forEach((o) => (o.yaw = U.round(U.wrap360(o.yaw + deg), 1)));
    S.changed('objects');
    S.commit();
    return true;
  };
  A.nudge = function (dx, dz) {
    if (S.sel.kind === 'loot') {
      DS.Loot.nudge(S.sel.ids, dx, dz);
      S.commit();
      return;
    }
    const objs = A.selectedObjects();
    objs.forEach((o) => {
      o.x = U.round(o.x + dx, 2);
      o.z = U.round(o.z + dz, 2);
    });
    if (objs.length) {
      S.changed('objects');
      S.commit();
    }
  };
  A.duplicate = function () {
    if (S.sel.kind === 'loot') {
      const c = DS.Loot.duplicate(S.sel.ids);
      S.select('loot', c.map((x) => x.id));
      S.commit();
      return;
    }
    const objs = A.selectedObjects();
    if (!objs.length) return;
    const gmap = {};
    const copies = objs.map((o) => {
      const c = JSON.parse(JSON.stringify(o));
      c.id = U.uid('o');
      c.x = U.round(o.x + 5, 2);
      c.z = U.round(o.z - 5, 2);
      if (c.group) c.group = gmap[c.group] = gmap[c.group] || U.uid('g');
      return c;
    });
    S.addObjects(copies);
    S.select('object', copies.map((c) => c.id));
    S.commit();
  };
  let clip = [];
  A.copy = function () {
    clip = A.selectedObjects().map((o) => JSON.parse(JSON.stringify(o)));
    return clip.length;
  };
  A.paste = function (wx, wz) {
    if (!clip.length) return;
    const cx = clip.reduce((s, o) => s + o.x, 0) / clip.length;
    const cz = clip.reduce((s, o) => s + o.z, 0) / clip.length;
    const gmap = {};
    const copies = clip.map((o) => {
      const c = JSON.parse(JSON.stringify(o));
      c.id = U.uid('o');
      c.x = U.round(wx + (o.x - cx), 2);
      c.z = U.round(wz + (o.z - cz), 2);
      if (c.group) c.group = gmap[c.group] = gmap[c.group] || U.uid('g');
      return c;
    });
    S.addObjects(copies);
    S.select('object', copies.map((c) => c.id));
    S.commit();
  };
  A.group = function () {
    const objs = A.selectedObjects();
    if (objs.length < 2) return;
    const g = U.uid('g');
    objs.forEach((o) => (o.group = g));
    S.changed('objects');
    S.commit();
  };
  A.ungroup = function () {
    const objs = A.selectedObjects();
    objs.forEach((o) => (o.group = ''));
    S.changed('objects');
    S.commit();
  };
  A.selectAll = function () {
    if (S.view === 'map') S.select('object', S.project.objects.filter((o) => !o.hidden).map((o) => o.id));
    else if (S.view === 'npcs' && DS.Npcs) DS.Npcs.selectAll();
    else {
      const q = S.activeQuestObj();
      if (q) S.select('node', q.nodes.map((n) => n.id));
    }
  };
})();
