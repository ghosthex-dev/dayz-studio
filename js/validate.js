/* DayZ Studio - project validation: plain-English problems for objects and quest graphs */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;

  let cache = { ver: -1, map: new Map() };

  /** returns { nodeId: [{level,msg}], _quest: [{level,msg}] } */
  DS.validateQuest = function (q) {
    if (cache.ver !== S.ver) cache = { ver: S.ver, map: new Map() };
    if (cache.map.has(q.id)) return cache.map.get(q.id);
    const out = { _quest: [] };
    const add = (id, level, msg) => (out[id] = out[id] || []).push({ level, msg });
    const incoming = {}, outgoing = {};
    q.nodes.forEach((n) => { incoming[n.id] = 0; outgoing[n.id] = 0; });
    q.links.forEach((l) => { incoming[l.to] = (incoming[l.to] || 0) + 1; outgoing[l.from] = (outgoing[l.from] || 0) + 1; });

    const triggers = q.nodes.filter((n) => DS.NODE_TYPES[n.type] && DS.NODE_TYPES[n.type].cat === 'trigger');
    if (!q.nodes.length) add('_quest', 'warn', 'This quest has no nodes yet.');
    else {
      if (!triggers.length) add('_quest', 'error', 'No trigger node — nothing can start this quest. Add a “Quest Available”, “Enter Area” or “Talk to NPC” node.');
      if (!q.nodes.some((n) => n.type === 'end')) add('_quest', 'warn', 'No “Quest Complete” node — the quest will never be marked as finished.');
    }

    // reachability from triggers
    const reach = new Set();
    const stack = triggers.map((t) => t.id);
    while (stack.length) {
      const id = stack.pop();
      if (reach.has(id)) continue;
      reach.add(id);
      q.links.filter((l) => l.from === id).forEach((l) => stack.push(l.to));
    }
    // cycle check (DFS)
    const state = {};
    let cyc = false;
    const visit = (id) => {
      state[id] = 1;
      q.links.filter((l) => l.from === id).forEach((l) => {
        if (state[l.to] === 1) cyc = true;
        else if (!state[l.to]) visit(l.to);
      });
      state[id] = 2;
    };
    q.nodes.forEach((n) => { if (!state[n.id]) visit(n.id); });
    if (cyc) add('_quest', 'error', 'The flow contains a loop (a node leads back to an earlier one). Quests must flow forward.');

    // quest chain
    (q.requires || []).forEach((id) => { if (!S.project.quests.some((x) => x.id === id)) add('_quest', 'warn', 'It unlocks after a quest that was deleted — that requirement is ignored.'); });
    const chainLoop = (cur, seen) => (cur.requires || []).some((id) => {
      if (id === q.id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const x = S.project.quests.find((y) => y.id === id);
      return x ? chainLoop(x, seen) : false;
    });
    if (chainLoop(q, new Set())) add('_quest', 'error', 'Quest chain loop: this quest (through others) needs itself to be completed first, so it can never unlock.');

    // bonus objectives: the "main" path is what can be reached without going through one
    const isBonus = (n) => !!(n && n.p && n.p.optional && DS.NODE_TYPES[n.type] && DS.NODE_TYPES[n.type].cat === 'objective');
    const main = new Set();
    const mstack = triggers.map((t) => t.id);
    while (mstack.length) {
      const id = mstack.pop();
      if (main.has(id)) continue;
      const nd = S.node(q, id);
      if (isBonus(nd)) continue;
      main.add(id);
      q.links.filter((l) => l.from === id).forEach((l) => mstack.push(l.to));
    }
    const bonusBranch = (id) => reach.has(id) && !main.has(id);
    const ends = q.nodes.filter((n) => n.type === 'end');
    if (ends.length && !ends.some((n) => main.has(n.id)) && ends.some((n) => reach.has(n.id)))
      add('_quest', 'error', '“Quest Complete” can only be reached through a bonus objective, so players would have to do the bonus. Connect it to the main path.');

    q.nodes.forEach((n) => {
      const T = DS.NODE_TYPES[n.type];
      if (!T) { add(n.id, 'error', 'Unknown node type ' + n.type); return; }
      if (T.cat !== 'trigger' && !reach.has(n.id)) add(n.id, 'error', 'Not reachable — connect it (directly or indirectly) from a trigger.');
      // a bonus branch may simply stop (e.g. bonus objective → extra reward)
      if (n.type !== 'end' && !outgoing[n.id] && !bonusBranch(n.id)) add(n.id, 'warn', 'Dead end — nothing follows this node. Connect it to the next step or to “Quest Complete”.');
      if (n.type === 'end' && q.links.some((l) => l.to === n.id && bonusBranch(l.from)) && ends.some((e) => main.has(e.id)))
        add(n.id, 'warn', 'This “Quest Complete” follows a bonus objective: doing the bonus would finish the quest early.');
      if (n.type === 'logic_join' && q.links.some((l) => l.to === n.id && bonusBranch(l.from)))
        add(n.id, 'warn', '“Wait For All” waits for a bonus objective, so the bonus is no longer optional.');
      if (n.type === 'logic_join' && incoming[n.id] < 2) add(n.id, 'warn', '“Wait For All” needs at least two incoming connections.');
      T.fields.forEach((f) => {
        if (f.show && !f.show(n.p)) return;
        const val = n.p[f.k];
        if (f.t === 'pos' && val) {
          if (val.ref && !S.obj(val.ref)) add(n.id, 'error', 'Linked object no longer exists — pick a new position.');
          else {
            const r = DS.resolvePos(val);
            if (!val.ref && r.x === 0 && r.z === 0) add(n.id, 'warn', `${f.label}: position is still 0,0 — pick a spot on the map.`);
            const size = S.project.meta.mapSize;
            if (r.x < 0 || r.z < 0 || r.x > size || r.z > size) add(n.id, 'warn', `${f.label}: position is outside the map.`);
          }
        }
        if (f.t === 'cls' && f.k !== 'hands' && !String(val || '').trim() && (f.k !== 'npc' || n.type === 'trg_npc'))
          add(n.id, 'error', `${f.label}: class name is empty.`);
        if (f.t === 'items') {
          if (!(val || []).length && n.type !== 'trg_npc' && n.type !== 'rew_crate') add(n.id, 'warn', `${f.label}: no items listed.`);
          (val || []).forEach((i) => { if (!String(i.c).trim()) add(n.id, 'error', `${f.label}: an item row has no class name.`); });
        }
        if (f.t === 'classes' && (val || []).some((c) => !String(c).trim())) add(n.id, 'warn', `${f.label}: an empty class entry will be ignored.`);
      });
      if (n.type === 'trg_npc' && n.p.dialog) {
        const dg = n.p.dialog;
        ['offer', 'active', 'done', 'locked'].forEach((k) => {
          const d = dg[k];
          if (!d || !d.lines || !d.lines.length) return;
          const ids = new Set(d.lines.map((l) => l.id));
          d.lines.forEach((l, i) => {
            if (!String(l.text || '').trim()) add(n.id, 'warn', `Conversation (${k}) line ${i + 1} has no text.`);
            if (l.next && !ids.has(l.next)) add(n.id, 'error', `Conversation (${k}) line ${i + 1} continues to a line that was deleted.`);
            l.options.forEach((o) => {
              if (!String(o.text || '').trim()) add(n.id, 'warn', `Conversation (${k}) line ${i + 1} has a reply without text.`);
              if (o.next && !ids.has(o.next)) add(n.id, 'error', `Conversation (${k}) line ${i + 1}: a reply points to a deleted line.`);
              const c = o.if || {};
              if ((c.kind === 'has_item' || c.kind === 'lacks_item') && !String(c.cls || '').trim())
                add(n.id, 'error', `Conversation (${k}) line ${i + 1}: reply “${o.text || '…'}” checks for an item but no item class is set.`);
              if (c.kind && c.kind.startsWith('quest_') && !S.project.quests.some((x) => x.id === c.quest))
                add(n.id, 'error', `Conversation (${k}) line ${i + 1}: reply “${o.text || '…'}” checks a quest that is not set or was deleted.`);
              [...(o.give || []), ...(o.take || [])].forEach((it) => { if (!String(it.c || '').trim()) add(n.id, 'error', `Conversation (${k}) line ${i + 1}: reply “${o.text || '…'}” has an item row without a class name.`); });
              if (o.accept && k !== 'offer') add(n.id, 'warn', `Conversation (${k}) line ${i + 1}: “accepts quest” only works in the “before the quest” conversation.`);
            });
            const always = l.options.filter((o) => !(o.if && o.if.kind) && !(o.take || []).some((it) => it.c));
            if (always.length > 4) add(n.id, 'warn', `Conversation (${k}) line ${i + 1}: the game shows 4 replies at most and ${always.length} have no condition — the extra ones are cut off.`);
            if (l.options.length && !always.length) add(n.id, 'warn', `Conversation (${k}) line ${i + 1}: every reply has a condition — if none applies, the player only gets “Continue”.`);
          });
          if (k === 'offer' && !d.lines.some((l) => l.options.some((o) => o.accept)))
            add(n.id, 'error', 'The "before the quest" conversation has no reply that accepts the quest, so players could never start it.');
        });
      }
      if (n.type === 'rew_script' && !String(n.p.code || '').replace(/\/\/.*$/gm, '').trim()) add(n.id, 'info', 'Script is empty or only comments.');
    });

    cache.map.set(q.id, out);
    return out;
  };

  /** Flat problem list for the Problems dialog */
  DS.validateAll = function () {
    const list = [];
    const P = S.project;
    const size = P.meta.mapSize;
    const seen = new Map();
    P.objects.forEach((o) => {
      const t = { kind: 'object', id: o.id };
      const name = o.label || o.c || '(no class)';
      if (!String(o.c).trim()) list.push({ level: 'error', msg: 'An object has an empty class name.', target: t });
      if (o.x < 0 || o.z < 0 || o.x > size || o.z > size) list.push({ level: 'warn', msg: `${name} is outside the map (${Math.round(o.x)}, ${Math.round(o.z)}).`, target: t });
      const key = o.c + '|' + Math.round(o.x * 10) + '|' + Math.round(o.z * 10);
      if (seen.has(key)) list.push({ level: 'warn', msg: `${name} is stacked exactly on top of another identical object.`, target: t });
      seen.set(key, true);
      if (o.kind === 'event' && !String(o.event || '').trim()) list.push({ level: 'error', msg: `${name}: event spawn has no event name.`, target: t });
      if ((o.kind === 'loot' || o.kind === 'prop') && o.loot.some((l) => !String(l.c).trim())) list.push({ level: 'error', msg: `${name}: loot table has a row without a class name.`, target: t });
    });
    const idSeen = new Set();
    P.quests.forEach((q) => {
      if (!String(q.name).trim()) list.push({ level: 'error', msg: 'A quest has no name.', target: { kind: 'quest', id: q.id } });
      if (idSeen.has(q.name)) list.push({ level: 'warn', msg: `Two quests are both called “${q.name}”.`, target: { kind: 'quest', id: q.id } });
      idSeen.add(q.name);
      const iss = DS.validateQuest(q);
      Object.keys(iss).forEach((k) =>
        iss[k].forEach((i) => list.push({ level: i.level, msg: `[${q.name}] ${i.msg}`, target: k === '_quest' ? { kind: 'quest', id: q.id } : { kind: 'node', id: k, quest: q.id } }))
      );
    });
    // the same NPC (same name + class) in several quests should stand on the same spot to become one character
    const npcs = [];
    P.quests.forEach((q) => q.nodes.forEach((n) => { if (n.type === 'trg_npc' && n.p.name) npcs.push({ q, n, r: DS.resolvePos(n.p.pos) }); }));
    npcs.forEach((a, i) => npcs.slice(i + 1).forEach((b) => {
      if (a.q === b.q || a.n.p.name !== b.n.p.name || a.n.p.npc !== b.n.p.npc) return;
      const d = Math.hypot(a.r.x - b.r.x, a.r.z - b.r.z);
      if (d >= 1.5 && d < 200) list.push({ level: 'warn', msg: `“${a.n.p.name}” appears in “${a.q.name}” and “${b.q.name}” ${Math.round(d)} m apart, so the game spawns two of them. Use “Use the same NPC as…” on the NPC node to make them one character.`, target: { kind: 'node', id: b.n.id, quest: b.q.id } });
    }));
    if (!P.objects.length && !P.quests.length) list.push({ level: 'info', msg: 'The project is empty — place some objects or create a quest.', target: null });
    const rank = { error: 0, warn: 1, info: 2 };
    return list.sort((a, b) => rank[a.level] - rank[b.level]);
  };
})();
