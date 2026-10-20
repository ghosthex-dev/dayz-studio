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
    { const ap = DS.Cond.problem(q.avail); if (ap) add('_quest', 'error', 'Server condition ' + ap + '.'); }
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
            const op = DS.Cond.problem(l.openIf);
            if (op) add(n.id, 'error', `Conversation (${k}) line ${i + 1}: its opening condition ${op}.`);
            l.options.forEach((o) => {
              if (!String(o.text || '').trim()) add(n.id, 'warn', `Conversation (${k}) line ${i + 1} has a reply without text.`);
              if (o.next && !ids.has(o.next)) add(n.id, 'error', `Conversation (${k}) line ${i + 1}: a reply points to a deleted line.`);
              const cp = DS.Cond.problem(o.if);
              if (cp) add(n.id, 'error', `Conversation (${k}) line ${i + 1}: reply “${o.text || '…'}” ${cp}.`);
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
      if (n.p.cond && n.p.cond.kind) { const cp = DS.Cond.problem(n.p.cond); if (cp) add(n.id, 'error', 'Condition ' + cp + '.'); }
      if (n.type === 'act_fx' && !S.obj(n.p.fx)) add(n.id, 'error', 'Turn Effect On / Off: pick a placed effect (it may have been deleted).');
      if (n.type === 'act_setvar' && !String(n.p.var || '').trim()) add(n.id, 'error', 'Set Server Variable: no variable name.');
      if (n.type === 'act_pvar' && !(S.project.stats || []).some((x) => x.id === n.p.stat)) add(n.id, 'error', 'Change Player Stat: pick a stat (Quests ▸ 📊 Player stats).');
      if (n.type === 'trg_object' || n.type === 'obj_use') {
        const ob = S.obj(n.p.obj);
        if (!ob) add(n.id, 'error', 'Use Object: pick a placed object (it may have been deleted).');
        else if (n.p.removeObj && ob.kind === 'building') add(n.id, 'info', 'Use Object: big buildings can take a moment to disappear for players far away.');
      }
      if ((n.type === 'trg_cond' || n.type === 'logic_wait' || n.type === 'obj_cond') && !(n.p.cond && n.p.cond.kind)) add(n.id, 'warn', 'The condition is “Always”, so this step passes immediately.');
      if (n.type === 'rew_script' && !String(n.p.code || '').replace(/\/\/.*$/gm, '').trim()) add(n.id, 'info', 'Script is empty or only comments.');
      if (n.type === 'rew_script' && DS.Code) DS.Code.lint(n.p.code, { mode: 'action', vars: [['player'], ['pos']] }).filter((i) => i.level === 'error').slice(0, 3).forEach((i) => add(n.id, 'error', 'Custom Script: ' + i.msg));
      if (DS.CustomNodes && DS.CustomNodes.isCustom(n.type) && !DS.CustomNodes.def(n.type)) add(n.id, 'error', 'This custom node’s definition is missing (' + n.type + '). Import its .json in Quests ▸ 🧩 Custom nodes, or delete the node.');
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
      if (o.kind === 'fx' && o.fx) {
        if (o.fx.soundset === '@file' && !(o.fx.sound && o.fx.sound.id)) list.push({ level: 'warn', msg: `${name}: set to play your own sound file, but no file is attached.`, target: t });
        if (!o.fx.particle && !o.fx.light && !o.fx.soundset) list.push({ level: 'warn', msg: `${name}: the effect has no particles, light or sound.`, target: t });
        const cp = DS.Cond.problem(o.fx.when);
        if (cp) list.push({ level: 'error', msg: `${name}: its condition ${cp}.`, target: t });
      }
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
    // Enforce snippets: the checker of the code editor, plus init scripts that clash (they share one init.c function)
    if (DS.Code) {
      const owner = new Map();
      P.objects.filter((o) => String(o.init || '').trim()).forEach((o) => {
        const t = { kind: 'object', id: o.id };
        const name = o.label || o.c;
        DS.Code.lint(o.init, { mode: 'init', vars: [['obj']] }).filter((i) => i.level === 'error').slice(0, 3).forEach((i) => list.push({ level: 'error', msg: `${name} - init script: ${i.msg}`, target: t }));
        DS.Code.declared(o.init).forEach((d) => {
          const prev = owner.get(d.name);
          if (prev && prev !== o) list.push({ level: 'error', msg: `${name} and ${prev.label || prev.c} both declare “${d.name}” in their init script. All init scripts end up in one init.c function, so the name may only be declared once - rename one.`, target: t });
          else owner.set(d.name, o);
        });
      });
      (P.customNodes || []).forEach((d) => {
        DS.Code.lint(d.code, { mode: d.kind === 'check' ? 'check' : 'action', params: (d.params || []).map((x) => x.k), vars: [['player'], ['pos']] }).filter((i) => i.level === 'error').slice(0, 3)
          .forEach((i) => list.push({ level: 'error', msg: `Custom node “${d.title || d.id}”: ${i.msg}`, target: { kind: 'custom', id: d.id } }));
      });
    }
    // player stats, item requirements, HUD
    const statIds = new Set();
    (P.stats || []).forEach((st) => {
      const t = { kind: 'stats' };
      if (!st.id) list.push({ level: 'error', msg: `Player stat “${st.name || '?'}” has no id.`, target: t });
      else if (statIds.has(st.id)) list.push({ level: 'error', msg: `Two player stats share the id “${st.id}”.`, target: t });
      statIds.add(st.id);
      if (st.max > st.min && (st.start < st.min || st.start > st.max)) list.push({ level: 'warn', msg: `Player stat “${st.name || st.id}” starts outside its min…max.`, target: t });
    });
    (P.itemReqs || []).forEach((r) => {
      const t = { kind: 'stats' };
      if (!String(r.cls || '').trim()) list.push({ level: 'warn', msg: 'An item requirement has no item class and is ignored.', target: t });
      else if (DS.Classes && DS.Classes.known && !DS.Classes.known(r.cls)) list.push({ level: 'info', msg: `Item requirement: “${r.cls}” is not a class Studio knows - check the spelling.`, target: t });
      if (!(r.cond && r.cond.kind)) list.push({ level: 'warn', msg: `Item requirement for ${r.cls || '?'}: the condition is “Always”, so it never blocks anything.`, target: t });
      const cp = DS.Cond.problem(r.cond);
      if (cp) list.push({ level: 'error', msg: `Item requirement for ${r.cls || '?'}: its condition ${cp}.`, target: t });
    });
    (P.hud || []).forEach((h) => {
      if (h.type === 'bar' && !statIds.has(h.stat)) list.push({ level: 'error', msg: 'A HUD bar shows a stat that does not exist.', target: { kind: 'stats' } });
    });
    // crowded areas (performance heatmap)
    if (DS.Density) DS.Density.compute().spots.filter((s) => s.score >= DS.Density.HIGH).forEach((s) =>
      list.push({ level: 'warn', msg: `Crowded area around ${Math.round(s.x)}, ${Math.round(s.z)}: load score ${s.score} (${DS.Density.label(s.score)}) - ${s.count} objects within ${DS.Density.RADIUS} m. Spread them out or remove some.`, target: s.near ? { kind: 'object', id: s.near.id } : null }));
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
