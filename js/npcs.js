/* DayZ Studio - NPCs: characters with their own behaviour graph (the NPCs view), which quests can use too.
   project.npcs = [{ id, npc (character class), name, outfit, gear, hands, pos, yaw, radius, nomark, faction,
                     trader, cond, stops, graph: { nodes, links } }]
   A quest's Talk to NPC node points at one with p.npcId. The NPC's settings are mirrored into those nodes (sync),
   so the exporters, the game link and the checks read them as before. NPCs made inside quests before the NPC tab
   existed are turned into NPCs when a project opens (migrate). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const N = (DS.Npcs = {});

  /** the character settings an NPC shares with the quest nodes that use it */
  N.KEYS = ['npc', 'name', 'outfit', 'gear', 'hands', 'pos', 'yaw', 'radius', 'nomark', 'faction', 'trader', 'cond'];

  /* ================================================================ behaviour node types */
  DS.NPC_NODE_CATS = {
    event: { name: 'Events', color: '#22c55e' },
    activity: { name: 'Activities', color: '#38bdf8' },
    step: { name: 'Steps', color: '#f59e0b' },
    flow: { name: 'Flow', color: '#a78bfa' },
  };
  N.EMOTES = [['greet', 'Wave'], ['salute', 'Salute'], ['point', 'Point'], ['thumbup', 'Thumbs up'], ['thumbdown', 'Thumbs down'],
    ['clap', 'Clap'], ['shrug', 'Shrug'], ['taunt', 'Taunt'], ['heart', 'Heart'], ['sit', 'Sit down'], ['lyingdown', 'Lie down'],
    ['warmhands', 'Warm hands'], ['dance', 'Dance'], ['surrender', 'Hands up']];
  const emoteName = (id) => (N.EMOTES.find((e) => e[0] === id) || [id, id || '?'])[1];
  const hh = (h) => String(Math.floor(+h || 0)).padStart(2, '0') + ':' + String(Math.round(((+h || 0) % 1) * 60)).padStart(2, '0');
  const posTxt = (pos) => (pos ? `${Math.round(DS.resolvePos(pos).x)}, ${Math.round(DS.resolvePos(pos).z)}` : 'its position');
  const jog = { k: 'prun', t: 'bool', label: 'Jog instead of walking', def: false };

  DS.NPC_NODE_TYPES = {
    // ---- events: start a chain
    ev_spawn: { cat: 'event', title: 'Spawned', icon: '✦', fields: [],
      desc: 'When the NPC appears: at server start, or when its “Only appears while” condition comes true. Start its everyday routine here (patrol, wander, stand guard…).',
      sum: () => 'When it appears' },
    ev_near: { cat: 'event', title: 'Player comes near', icon: '👣',
      desc: 'A player comes within the distance. Fires once per player, then again after the cooldown.',
      fields: [{ k: 'radius', t: 'num', label: 'Distance (m)', def: 8, min: 1, max: 100 }, { k: 'cooldown', t: 'num', label: 'Again after (s)', def: 120, min: 0 }],
      sum: (p) => `within ${p.radius} m` },
    ev_talk: { cat: 'event', title: 'Talked to', icon: '💬',
      desc: 'A player looks at the NPC and presses F - when none of the NPC’s quest conversations takes the talk.',
      fields: [{ k: 'prompt', t: 'text', label: 'Prompt', def: 'Talk' }], sum: (p) => `[F] ${p.prompt || 'Talk'}` },
    ev_hostile: { cat: 'event', title: 'Hostile player seen', icon: '⚠',
      desc: 'A player the NPC’s faction sees as Hostile comes within range and in sight. Needs a faction (NPC settings).',
      fields: [{ k: 'radius', t: 'num', label: 'Range (m)', def: 40, min: 2, max: 400 }], sum: (p) => `within ${p.radius} m` },
    ev_time: { cat: 'event', title: 'Time of day', icon: '🕑',
      desc: 'Between two in-game hours. Fires when the time window starts (and at spawn inside it) - a schedule: patrol by day, sit at the fire at night.',
      fields: [{ k: 'from', t: 'num', label: 'From (hour)', def: 6, min: 0, max: 24 }, { k: 'to', t: 'num', label: 'To (hour)', def: 20, min: 0, max: 24 }],
      sum: (p) => `${hh(p.from)} – ${hh(p.to)}` },
    ev_cond: { cat: 'event', title: 'Condition', icon: '❓',
      desc: 'When a world condition becomes true: a server variable, the weather, server uptime…',
      fields: [{ k: 'cond', t: 'cond', label: 'When', def: null, kinds: 'world' }], sum: (p) => (DS.Cond ? DS.Cond.text(p.cond) : '') },
    // ---- activities: run until something else replaces them
    act_patrol: { cat: 'activity', title: 'Patrol', icon: '🚶',
      desc: 'Walks between waypoints, from its position, waiting at each. Stops for a player next to it. Runs until another activity replaces it.',
      fields: [{ k: 'patrol', t: 'patrol', label: 'Patrol route', def: [], help: 'Waypoints it walks between, starting from its position.' },
        { k: 'pwait', t: 'num', label: 'Wait at each waypoint (s)', def: 5, min: 0, max: 600 },
        { k: 'pback', t: 'bool', label: 'Walk the route back and forth (instead of a loop back to the start)', def: false }, jog],
      sum: (p) => `${(p.patrol || []).length} waypoint(s)${p.pback ? ', back and forth' : ''}` },
    act_wander: { cat: 'activity', title: 'Wander', icon: '🌀',
      desc: 'Walks to random spots inside a circle, pausing between moves.',
      fields: [{ k: 'around', t: 'pos', label: 'Area centre', def: null }, { k: 'radius', t: 'num', label: 'Radius (m)', def: 15, min: 2, max: 300 },
        { k: 'pause', t: 'num', label: 'Pause between moves (s)', def: 8, min: 0, max: 600 }, jog],
      sum: (p) => `${p.radius} m around ${posTxt(p.around)}` },
    act_stand: { cat: 'activity', title: 'Stand at', icon: '🧍',
      desc: 'Walks to a spot and stays there facing a direction, optionally doing an emote.',
      fields: [{ k: 'at', t: 'pos', label: 'Spot', def: null }, { k: 'yaw', t: 'num', label: 'Facing (deg)', def: 0, min: 0, max: 360 },
        { k: 'emote', t: 'select', label: 'While standing', def: '', opts: [['', 'Nothing']].concat(N.EMOTES) }],
      sum: (p) => `${posTxt(p.at)}${p.emote ? ' · ' + emoteName(p.emote) : ''}` },
    act_follow: { cat: 'activity', title: 'Follow player', icon: '🐾',
      desc: 'Follows the player who started this chain (who came near, talked to it…). Gives up when they get too far away.',
      fields: [{ k: 'dist', t: 'num', label: 'Keeps (m) behind', def: 2.5, min: 1, max: 20 }, { k: 'giveup', t: 'num', label: 'Gives up beyond (m)', def: 60, min: 5 }, jog],
      sum: (p) => `${p.dist} m behind` },
    act_escort: { cat: 'activity', title: 'Escort to', icon: '🧭',
      desc: 'Walks ahead to a destination, waiting whenever the player who started the chain falls behind. The chain continues on arrival.',
      fields: [{ k: 'to', t: 'pos', label: 'Destination', def: null }, { k: 'wait', t: 'num', label: 'Waits when the player is more than (m) away', def: 10, min: 2 }, jog],
      sum: (p) => `to ${posTxt(p.to)}` },
    act_guard: { cat: 'activity', title: 'Guard', icon: '🛡',
      desc: 'Holds its position and aims / fires at players its faction sees as Hostile (needs a faction and a gun in hands).',
      fields: [{ k: 'radius', t: 'num', label: 'Engage range (m)', def: 40, min: 2, max: 400 }], sum: (p) => `engages within ${p.radius} m` },
    // ---- steps: one after another
    st_walkto: { cat: 'step', title: 'Walk to', icon: '➜', fields: [{ k: 'to', t: 'pos', label: 'Walk to', def: null }, jog],
      desc: 'Walks to a point, then the chain goes on.', sum: (p) => posTxt(p.to) },
    st_wait: { cat: 'step', title: 'Wait', icon: '⏳', fields: [{ k: 'seconds', t: 'num', label: 'Seconds', def: 5, min: 0, max: 3600 }],
      desc: 'Waits, then the chain goes on.', sum: (p) => `${p.seconds} s` },
    st_face: { cat: 'step', title: 'Face player', icon: '👀', fields: [], desc: 'Turns to the player who started this chain.', sum: () => 'turns to the player' },
    st_say: { cat: 'step', title: 'Say', icon: '🗨',
      desc: 'Text above the NPC’s head for players nearby (“Halt!”, “Nice weather today”).',
      fields: [{ k: 'text', t: 'area', label: 'Says', def: 'Hello there.' }, { k: 'range', t: 'num', label: 'Heard within (m)', def: 20, min: 1, max: 200 },
        { k: 'secs', t: 'num', label: 'Shown for (s)', def: 5, min: 1, max: 60 }],
      sum: (p) => `“${String(p.text || '').slice(0, 40)}”` },
    st_emote: { cat: 'step', title: 'Emote', icon: '👋', fields: [{ k: 'emote', t: 'select', label: 'Emote', def: 'greet', opts: N.EMOTES }],
      desc: 'Plays an emote (wave, salute, sit…).', sum: (p) => emoteName(p.emote) },
    st_give: { cat: 'step', title: 'Give item', icon: '🎁', fields: [{ k: 'items', t: 'items', label: 'Gives the player', def: [] }],
      desc: 'Gives items to the player who started this chain.', sum: (p) => (p.items || []).map((i) => `${i.n || 1}x ${i.c}`).join(', ') || 'nothing yet' },
    st_setvar: { cat: 'step', title: 'Set server variable', icon: '🔧',
      fields: [{ k: 'var', t: 'var', label: 'Server variable', def: '' }, { k: 'op', t: 'select', label: 'Change', def: 'set', opts: [['set', 'Set to'], ['add', 'Add']] },
        { k: 'value', t: 'num', label: 'Value', def: 1 }],
      desc: 'Changes a server variable (quests and other NPCs can react to it).', sum: (p) => `${p.var || '?'} ${p.op === 'add' ? '+=' : '='} ${p.value}` },
    st_leave: { cat: 'step', title: 'Leave', icon: '🚪', fields: [], desc: 'The NPC leaves (disappears). It comes back when the server restarts, or when its “Only appears while” condition comes true again.', sum: () => 'disappears' },
    // ---- flow
    fl_if: { cat: 'flow', title: 'Only if', icon: '⑂', fields: [{ k: 'cond', t: 'cond', label: 'Only continues if', def: null }],
      desc: 'The chain only goes on when the condition holds (for the player who started it).', sum: (p) => (DS.Cond ? DS.Cond.text(p.cond) : '') },
    fl_random: { cat: 'flow', title: 'Random', icon: '🎲', fields: [], desc: 'Goes on along ONE of its wires, picked at random - for variety (different lines, different routes).', sum: () => 'one wire at random' },
  };

  /* ================================================================ store */
  N.list = () => S.project.npcs || (S.project.npcs = []);
  N.get = (id) => N.list().find((x) => x.id === id) || null;
  S.activeNpc = null;
  N.active = function () {
    let n = N.get(S.activeNpc);
    if (!n && N.list().length) { n = N.list()[0]; S.activeNpc = n.id; }
    return n;
  };
  N.open = function (id, view) {
    S.activeNpc = id;
    S.select(null, []);
    if (view !== false) S.setView('npcs');
    S.structure();
  };
  N.usedBy = (id) => S.project.quests.flatMap((q) => q.nodes.filter((n) => n.type === 'trg_npc' && n.p.npcId === id).map((n) => ({ quest: q, node: n })));

  function blankNpc(extra) {
    const c = DS.MapView ? DS.MapView.center() : { x: 0, z: 0 };
    let k = N.list().length + 1;
    while (N.list().some((x) => x.name === 'NPC ' + k)) k++;
    return Object.assign({
      id: U.uid('npc'), npc: 'SurvivorM_Mirek', name: 'NPC ' + k, outfit: '', gear: [], hands: '',
      pos: { x: Math.round(c.x), y: 0, z: Math.round(c.z), ref: null }, yaw: 0, radius: 4, nomark: false,
      faction: '', trader: '', cond: null, stops: true, graph: { nodes: [], links: [] },
    }, extra || {});
  }
  N.create = function (extra) {
    const n = blankNpc(extra);
    N.list().push(n);
    S.activeNpc = n.id;
    S.structure();
    return n;
  };
  N.remove = function (id) {
    const n = N.get(id);
    if (!n) return;
    const used = N.usedBy(id);
    if (used.length) {
      DS.toast(`“${n.name}” is used by ${used.map((u) => '“' + u.quest.name + '”').join(', ')}. Pick another NPC in those Talk to NPC nodes (or delete them) first.`, 'warn', 6000);
      return;
    }
    if (!confirm(`Delete the NPC “${n.name}” and its behaviour?`)) return;
    S.project.npcs = N.list().filter((x) => x !== n);
    if (S.activeNpc === id) S.activeNpc = null;
    S.select(null, []);
    S.structure();
    S.commit();
  };

  /** a quest node just added: its NPC is a new one, made from the node's own settings */
  N.giveNewNpc = function (node) {
    const extra = {};
    N.KEYS.forEach((k) => { if (node.p[k] !== undefined) extra[k] = JSON.parse(JSON.stringify(node.p[k])); });
    const n = blankNpc(extra);
    N.list().push(n);
    node.p.npcId = n.id;
    return n;
  };

  /* ================================================================ NPCs made inside quests -> NPCs */
  N.migrate = function (P) {
    if (!P.npcs) P.npcs = [];
    let made = 0;
    P.quests.forEach((q) => q.nodes.forEach((n) => {
      if (n.type !== 'trg_npc' || n.p.npcId) return;
      const at = DS.resolvePos(n.p.pos);
      // quest chains: the same character at the same spot is one NPC used by several quests
      const same = P.npcs.find((x) => x.npc === n.p.npc && Math.hypot(DS.resolvePos(x.pos).x - at.x, DS.resolvePos(x.pos).z - at.z) < 1.5);
      if (same) { n.p.npcId = same.id; return; }
      const extra = {};
      N.KEYS.forEach((k) => { if (n.p[k] !== undefined) extra[k] = JSON.parse(JSON.stringify(n.p[k])); });
      const npc = blankNpc(extra);
      if (!npc.name) npc.name = String(n.p.npc || 'NPC').replace(/^Survivor[MF]_/, '');
      if (Array.isArray(n.p.patrol) && n.p.patrol.length) {
        const a = { id: U.uid('n'), type: 'ev_spawn', x: 40, y: 40, p: {} };
        const b = { id: U.uid('n'), type: 'act_patrol', x: 330, y: 40, p: { patrol: JSON.parse(JSON.stringify(n.p.patrol)), pwait: n.p.pwait == null ? 5 : n.p.pwait, pback: !!n.p.pback, prun: !!n.p.prun } };
        npc.graph = { nodes: [a, b], links: [{ id: U.uid('l'), from: a.id, to: b.id }] };
      }
      P.npcs.push(npc);
      n.p.npcId = npc.id;
      made++;
    }));
    return made;
  };

  /** the patrol an NPC's behaviour starts with (mirrored into its quest nodes for the game) */
  N.patrolOf = function (npc) {
    const g = npc.graph || { nodes: [] };
    return g.nodes.find((x) => x.type === 'act_patrol' && (x.p.patrol || []).length) || null;
  };

  /** mirror every NPC into the quest nodes that use it (no events - it only copies data) */
  N.sync = function () {
    const P = S.project;
    N.migrate(P);   // a Talk to NPC node without an NPC (a template, an import, an older project) gets one
    P.quests.forEach((q) => q.nodes.forEach((n) => {
      if (n.type !== 'trg_npc' || !n.p.npcId) return;
      const npc = N.get(n.p.npcId);
      if (!npc) { delete n.p.npcId; return; }
      N.KEYS.forEach((k) => {
        const v = npc[k] === undefined ? null : npc[k];
        if (k === 'pos') n.p.pos = npc.pos;   // the same object: dragging the quest marker moves the NPC
        else if (JSON.stringify(n.p[k]) !== JSON.stringify(v)) n.p[k] = v === null ? v : JSON.parse(JSON.stringify(v));
      });
      const pt = N.patrolOf(npc);
      n.p.patrol = pt ? JSON.parse(JSON.stringify(pt.p.patrol)) : [];
      n.p.pwait = pt ? pt.p.pwait : 5;
      n.p.pback = pt ? !!pt.p.pback : false;
      n.p.prun = pt ? !!pt.p.prun : false;
    }));
  };
  S.on('changed', () => N.sync());
  S.on('structure', () => N.sync());

  /** NPCs no quest uses: exported on their own (they spawn and go about their behaviour) */
  N.standalone = () => N.list().filter((npc) => !N.usedBy(npc.id).length);
  /** an NPC as a Talk to NPC node, for the exporter */
  N.asNode = function (npc) {
    const p = {};
    N.KEYS.forEach((k) => { p[k] = npc[k]; });
    const pt = N.patrolOf(npc);
    Object.assign(p, { text: '', dialog: null, patrol: pt ? pt.p.patrol : [], pwait: pt ? pt.p.pwait : 5, pback: pt ? !!pt.p.pback : false, prun: pt ? !!pt.p.prun : false });
    return { id: npc.id, type: 'trg_npc', x: 0, y: 0, p };
  };

  /* ================================================================ checks */
  N.validateGraph = function (g) {
    const out = {};
    const add = (id, level, msg) => (out[id] = out[id] || []).push({ level, msg });
    const incoming = new Set(g.links.map((l) => l.to));
    g.nodes.forEach((n) => {
      const T = DS.NPC_NODE_TYPES[n.type];
      if (!T) return;
      if (T.cat !== 'event' && !incoming.has(n.id)) add(n.id, 'warn', 'Nothing leads here - connect an event (e.g. Spawned) to it, or it never runs.');
      if (n.type === 'act_patrol' && !(n.p.patrol || []).length) add(n.id, 'error', 'No waypoints yet - draw the route.');
      if (n.type === 'st_say' && !String(n.p.text || '').trim()) add(n.id, 'warn', 'Nothing to say.');
      if (n.type === 'st_give' && !(n.p.items || []).some((i) => String(i.c || '').trim())) add(n.id, 'warn', 'No items listed.');
      if (n.type === 'st_setvar' && !n.p.var) add(n.id, 'error', 'Pick a server variable.');
    });
    return out;
  };
  N.problems = function () {
    const list = [];
    N.list().forEach((npc) => {
      const tgt = { kind: 'npc', id: npc.id };
      if (!String(npc.npc || '').trim()) list.push({ level: 'error', msg: `NPC “${npc.name}” has no character class.`, target: tgt });
      if (npc.pos && npc.pos.ref && !S.obj(npc.pos.ref)) list.push({ level: 'error', msg: `NPC “${npc.name}” stands at an object that no longer exists - pick a new position.`, target: tgt });
      else {
        const r = DS.resolvePos(npc.pos);
        const size = S.project.meta.mapSize;
        if (!npc.pos.ref && r.x === 0 && r.z === 0) list.push({ level: 'warn', msg: `NPC “${npc.name}”: position is still 0,0 - pick a spot on the map.`, target: tgt });
        else if (r.x < 0 || r.z < 0 || r.x > size || r.z > size) list.push({ level: 'warn', msg: `NPC “${npc.name}” stands outside the map.`, target: tgt });
      }
      const g = npc.graph || { nodes: [], links: [] };
      const issues = N.validateGraph(g);
      Object.keys(issues).forEach((id) => issues[id].forEach((i) => list.push({ level: i.level, msg: `NPC “${npc.name}”: ${i.msg}`, target: { kind: 'bnode', npc: npc.id, id } })));
      if (g.nodes.some((n) => n.type === 'ev_hostile' || n.type === 'act_guard') && !npc.faction) list.push({ level: 'warn', msg: `NPC “${npc.name}” reacts to Hostile players but has no faction.`, target: tgt });
    });
    return list;
  };
  /** jump to a problem's target */
  N.show = function (t) {
    if (t.kind === 'npc') N.open(t.id);
    else if (t.kind === 'bnode') { N.open(t.npc); S.select('bnode', [t.id]); }
  };

  /* ================================================================ the NPCs view */
  let E = null;
  function bar(b, g) {
    const cur = N.active();
    const sel = el('select', { class: 'inp', title: 'NPC', onchange: (e) => N.open(e.target.value, false) });
    N.list().forEach((x) => sel.append(el('option', { value: x.id, selected: cur && x.id === cur.id }, x.name || '(unnamed)')));
    b.append(
      el('span', { class: 'ne-bar-label' }, 'NPC'),
      N.list().length ? sel : el('span', { class: 'muted' }, 'none'),
      el('button', { class: 'btn sm', onclick: () => { N.create(); S.select(null, []); S.commit(); } }, '+ New NPC'),
      el('span', { class: 'sep' }),
      el('button', { class: 'btn sm', onclick: () => E.openAddMenu(), disabled: !g }, '+ Add Node'),
      el('button', { class: 'btn sm', onclick: () => E.autoLayout(), disabled: !g }, 'Auto-layout'),
      el('button', { class: 'btn sm', onclick: () => E.fit(), disabled: !g }, 'Fit'),
      el('button', { class: 'btn sm', disabled: !cur, title: 'Show this NPC on the map', onclick: () => { const r = DS.resolvePos(cur.pos); S.setView('map'); DS.MapView.centerOn(r.x, r.z, 2); } }, '⌖ On map'),
      el('span', { class: 'sep' }),
      el('span', { class: 'muted' }, 'Events start chains: Spawned → Patrol, Player comes near → Face player → Say … Double-click empty space to add nodes.'));
  }

  N.init = function (container) {
    E = DS.GraphEditor.make({
      view: 'npcs',
      graph: () => { const n = N.active(); return n ? n.graph || (n.graph = { nodes: [], links: [] }) : null; },
      types: () => DS.NPC_NODE_TYPES,
      cats: () => DS.NPC_NODE_CATS,
      isStart: (T) => T.cat === 'event',
      isEnd: (n) => n.type === 'st_leave',
      sel: 'bnode',
      selLink: 'blink',
      changed: 'npcs',
      linkError: 'That connection isn’t allowed (events can’t have inputs, Leave has no output).',
      bar,
      empty: (box) => box.append(
        el('h3', null, 'No NPCs yet'),
        el('p', null, 'An NPC is a character in the world with its own behaviour: patrols, wandering, reacting to players, talking, trading. Quests can use the same NPCs.'),
        el('button', { class: 'btn primary', onclick: () => { N.create(); S.commit(); } }, 'Create your first NPC')),
      validate: (g) => N.validateGraph(g),
      newGraph: () => N.create().graph,
      onAdd: (n) => {
        // points of a new activity start at the NPC (a wander area, a spot to stand)
        const npc = N.active();
        if (!npc) return;
        DS.NPC_NODE_TYPES[n.type].fields.forEach((f) => {
          if (f.t === 'pos' && (f.k === 'around' || f.k === 'at')) { const r = DS.resolvePos(npc.pos); n.p[f.k] = { x: Math.round(r.x), y: 0, z: Math.round(r.z), ref: null }; }
        });
      },
    });
    E.init(container);
  };
  N.fit = () => E && E.fit();
  N.deleteNodes = (ids) => { const g = N.active() && N.active().graph; if (g) E.deleteNodes(g, ids); };
  N.selectAll = () => { const g = N.active() && N.active().graph; if (g) S.select('bnode', g.nodes.map((n) => n.id)); };

  /* ================================================================ inspector */
  const I = () => DS.Inspector;
  /** the NPC itself: character, placement, faction, behaviour settings, quests that use it */
  N.inspector = function (npc) {
    const box = el('div', { class: 'ins-body' });
    const T = DS.NODE_TYPES.trg_npc;
    const field = (k) => T.fields.find((f) => f.k === k);
    const pseudo = { type: 'npc', p: npc };
    function draw() {
      box.innerHTML = '';
      const sec = (title, keys) => I().section(title, ...keys.filter(field).map((k) => I().fieldWidget(field(k), pseudo, draw)));
      const used = N.usedBy(npc.id);
      box.append(
        el('div', { class: 'ins-head' }, el('span', { class: 'ne-icon' }, '👤'), el('div', null, el('div', { class: 'ins-title' }, npc.name || 'NPC'), el('div', { class: 'ins-sub' }, 'NPC — click empty graph space to come back here'))),
        sec('Character', ['name', 'npc', 'outfit', 'gear', 'hands']),
        sec('In the world', ['pos', 'yaw', 'radius', 'nomark', 'cond']),
        I().section('Behaviour',
          el('div', { class: 'ins-row' }, I().checkInp(npc.stops !== false, (v) => { npc.stops = v; S.changed('npcs'); }, 'Stops and turns to a player who comes within 3 m (so players can talk to it)'))),
        sec('Faction and trade', ['faction', 'trader']),
        I().section('Used by quests', ...(used.length
          ? used.map((u) => el('div', { class: 'btn-row' }, el('span', null, `“${u.quest.name}”`),
            el('button', { class: 'btn sm', onclick: () => { S.activeQuest = u.quest.id; S.setView('quests'); S.structure(); S.select('node', [u.node.id]); } }, 'Open')))
          : [el('div', { class: 'ins-help' }, 'No quest uses this NPC. In a quest, add a “Talk to NPC” node and pick this NPC in its NPC field.')])),
        el('div', { class: 'ins-sec' }, el('button', { class: 'btn danger', onclick: () => N.remove(npc.id) }, 'Delete NPC')));
    }
    draw();
    return box;
  };
  /** a selected behaviour node */
  N.nodeInspector = function (n) {
    const T = DS.NPC_NODE_TYPES[n.type];
    const box = el('div', { class: 'ins-body' });
    function draw() {
      box.innerHTML = '';
      const cat = DS.NPC_NODE_CATS[T.cat];
      box.append(
        el('div', { class: 'ins-head', style: { borderLeft: '4px solid ' + cat.color } }, el('span', { class: 'ne-icon' }, T.icon), el('div', null, el('div', { class: 'ins-title' }, T.title), el('div', { class: 'ins-sub' }, cat.name))),
        el('p', { class: 'ins-desc' }, T.desc));
      const fs = el('div', { class: 'ins-sec' });
      T.fields.forEach((f) => { if (!f.show || f.show(n.p)) fs.append(I().fieldWidget(f, n, draw)); });
      if (!T.fields.length) fs.append(el('div', { class: 'muted' }, 'No settings.'));
      box.append(fs);
      const g = N.active() ? N.active().graph : null;
      const issues = (g ? N.validateGraph(g) : {})[n.id] || [];
      if (issues.length) box.append(I().section('Problems', ...issues.map((i) => el('div', { class: 'issue ' + i.level }, i.msg))));
      box.append(el('div', { class: 'ins-sec' }, el('button', { class: 'btn danger', onclick: () => DS.actions.deleteSelection() }, 'Delete node')));
    }
    draw();
    return box;
  };
  N.selectedNode = () => {
    const g = N.active() && N.active().graph;
    return g && S.sel.kind === 'bnode' ? g.nodes.find((n) => n.id === S.sel.ids[0]) || null : null;
  };

  /** the NPC field of a quest's Talk to NPC node */
  N.pickWidget = function (f, n, rerender) {
    const p = n.p;
    const sel = el('select', { class: 'inp' });
    N.list().forEach((x) => sel.append(el('option', { value: x.id, selected: p.npcId === x.id }, x.name || x.id)));
    sel.addEventListener('change', () => {
      p.npcId = sel.value;
      N.sync(); S.structure(); S.commit(); rerender();
    });
    const cur = p.npcId ? N.get(p.npcId) : null;
    return el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, f.label),
      el('div', { class: 'btn-row' }, sel,
        cur ? el('button', { class: 'btn sm', title: 'Edit this NPC: look, position, behaviour', onclick: () => N.open(cur.id) }, '👤 Open') : null,
        el('button', { class: 'btn sm', title: 'A new NPC at this node’s position', onclick: () => { const x = N.giveNewNpc(n); N.sync(); S.structure(); S.commit(); N.open(x.id); } }, '+ New')),
      el('span', { class: 'ins-help' }, cur
        ? `The NPC’s look, position, faction and behaviour are edited in the NPCs tab. Here: what it says about this quest.`
        : 'Pick an NPC from the NPCs tab, or make a new one.'));
  };

  /* ================================================================ map */
  let markers = [];
  N.drawMap = function (ctx, w2s, s) {
    markers = [];
    const act = S.shown('npcs') ? N.active() : null;
    const selNpc = S.sel.kind === 'npc' ? S.sel.ids[0] : null;
    ctx.font = '11px system-ui, sans-serif';
    N.list().forEach((npc) => {
      const r = DS.resolvePos(npc.pos);
      const [x, y] = w2s(r.x, r.z);
      const hot = (act && act.id === npc.id) || selNpc === npc.id;
      if (hot) drawRoutes(ctx, w2s, s, npc, r);
      ctx.fillStyle = hot ? '#f0abfc' : '#c084fc';
      ctx.strokeStyle = '#0b0d10';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, hot ? 8 : 6, 0, 7); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#0b0d10';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👤', x, y + 0.5);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      if (s > 0.25 || hot) {
        ctx.fillStyle = hot ? '#f5d0fe' : '#e9d5ff';
        ctx.fillText(npc.name || 'NPC', x + 10, y - 8);
      }
      markers.push({ id: npc.id, sx: x, sy: y });
    });
  };
  function drawRoutes(ctx, w2s, s, npc, home) {
    const g = npc.graph || { nodes: [] };
    const color = '#c084fc';
    const dot = (pt, label) => {
      const [x, y] = w2s(pt.x, pt.z);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#0b0d10';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 0.5);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      ctx.font = '11px system-ui, sans-serif';
    };
    const line = (pts, closed) => {
      ctx.strokeStyle = color + 'cc'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
      ctx.beginPath();
      pts.concat(closed ? [pts[0]] : []).forEach((pt, i) => { const [x, y] = w2s(pt.x, pt.z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    };
    g.nodes.forEach((n) => {
      const p = n.p;
      if (n.type === 'act_patrol' && (p.patrol || []).length) {
        line([{ x: home.x, z: home.z }].concat(p.patrol), !p.pback);
        p.patrol.forEach((pt, i) => dot(pt, String(i + 1)));
      } else if (n.type === 'act_wander' && p.around) {
        const c = DS.resolvePos(p.around);
        const [x, y] = w2s(c.x, c.z);
        ctx.strokeStyle = color + 'cc'; ctx.fillStyle = color + '1a'; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(x, y, Math.max(3, (+p.radius || 0) * s), 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      } else if ((n.type === 'act_stand' && p.at) || ((n.type === 'st_walkto' || n.type === 'act_escort') && p.to)) {
        const t = DS.resolvePos(n.type === 'act_stand' ? p.at : p.to);
        line([{ x: home.x, z: home.z }, t], false);
        dot(t, n.type === 'act_stand' ? '◉' : n.type === 'act_escort' ? '⚑' : '➜');
      }
    });
  }
  N.hit = function (sx, sy) {
    for (let i = markers.length - 1; i >= 0; i--) if (Math.hypot(markers[i].sx - sx, markers[i].sy - sy) <= 9) return markers[i].id;
    return null;
  };

  /* ================================================================ NPC list panel */
  N.listPanel = function () {
    const box = el('div', { class: 'npc-list' });
    const search = el('input', { class: 'inp', type: 'search', placeholder: 'Search NPCs…' });
    const list = el('div', {});
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const cur = N.active();
      list.replaceChildren(...N.list().filter((n) => !q || (n.name + ' ' + n.npc).toLowerCase().includes(q)).map((n) => {
        const used = N.usedBy(n.id).length;
        const acts = (n.graph ? n.graph.nodes : []).filter((x) => DS.NPC_NODE_TYPES[x.type] && DS.NPC_NODE_TYPES[x.type].cat === 'activity').map((x) => DS.NPC_NODE_TYPES[x.type].icon).join(' ');
        return el('div', { class: 'npc-row' + (cur && cur.id === n.id ? ' active' : ''), onclick: () => N.open(n.id) },
          el('span', { class: 'npc-name' }, n.name || '(unnamed)'),
          el('span', { class: 'muted' }, `${String(n.npc || '').replace(/^Survivor[MF]_/, '')}${used ? ' · ' + used + ' quest' + (used > 1 ? 's' : '') : ''} ${acts}`));
      }));
      if (!N.list().length) list.append(el('div', { class: 'ins-help' }, 'No NPCs yet.'));
    };
    search.addEventListener('input', draw);
    box.append(el('div', { class: 'btn-row pad' }, search, el('button', { class: 'btn sm primary', onclick: () => { N.create(); S.commit(); N.open(S.activeNpc); } }, '+ New')), list);
    S.on('structure', draw);
    S.on('changed', U.debounce(draw, 300));
    draw();
    return box;
  };
})();
