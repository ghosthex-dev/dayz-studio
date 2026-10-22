/* DayZ Studio - the quest flow editor: the shared graph editor (js/grapheditor.js) set up for quests */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;

  let E = null;
  const NE = (DS.NodeEditor = {});

  function bar(b, q) {
    const sel = el('select', {
      class: 'inp', title: 'Active quest',
      onchange: (e) => {
        S.activeQuest = e.target.value;
        S.select(null, []);
        S.structure();
      },
    });
    S.project.quests.forEach((x) => sel.append(el('option', { value: x.id, selected: q && x.id === q.id }, x.name || '(unnamed)')));
    b.append(
      el('span', { class: 'ne-bar-label' }, 'Quest'),
      S.project.quests.length ? sel : el('span', { class: 'muted' }, 'none'),
      el('button', { class: 'btn sm', onclick: () => { S.newQuest(); S.commit(); } }, '+ New Quest'),
      el('span', { class: 'sep' }),
      el('button', { class: 'btn sm', onclick: () => E.openAddMenu(), disabled: !q }, '+ Add Node'),
      el('button', { class: 'btn sm', onclick: () => E.autoLayout(), disabled: !q }, 'Auto-layout'),
      el('button', { class: 'btn sm', onclick: () => E.fit(), disabled: !q }, 'Fit'),
      el('button', { class: 'btn sm', disabled: !q, title: 'Draw this quest inside the running game (areas, NPCs, crates, flow)', onclick: () => {
        DS.Link.setPreview(true);
        S.setView('game');
        if (!DS.Link.fresh && !DS.Link.launching) DS.Link.launch();
      } }, '🧭 Preview in game'),
      el('button', { class: 'btn sm primary', disabled: !q, title: 'Run this quest in the real game and play it as the character, starting at the quest start (F2 in the game switches back to the editor camera)', onclick: () => DS.Link.playTestQuest() }, '▶ Play-test'),
      el('span', { class: 'sep' }),
      el('span', { class: 'muted' }, 'Drag from a node’s right dot onto another node to connect. Double-click empty space to add nodes.')
    );
  }

  // play-test: nodes that are running / done in the game
  function applyLive(world) {
    if (!world) return;
    const m = DS.Link && DS.Link.pt && DS.Link.pt.on ? DS.Link.pt.nodes : null;
    world.querySelectorAll('.ne-node').forEach((c) => {
      const st = m ? m.get(c.dataset.id) : null;
      c.classList.toggle('live-run', !!st && st.status === 1);
      c.classList.toggle('live-done', !!st && st.status === 2);
      let b = c.querySelector('.ne-live');
      if (st && st.status > 0) {
        if (!b) { b = el('div', { class: 'ne-live' }); c.append(b); }
        b.textContent = st.status === 2 ? '✔ done' : '▶ active' + (st.progress > 0 ? ' · ' + Math.round(st.progress * 10) / 10 : '');
        b.onclick = null;
      } else if (b) b.remove();
    });
  }
  let liveWorld = null;
  S.on('playtest', () => applyLive(liveWorld));

  NE.init = function (container) {
    E = DS.GraphEditor.make({
      view: 'quests',
      graph: () => S.activeQuestObj(),
      types: () => DS.NODE_TYPES,
      cats: () => DS.NODE_CATS,
      isStart: (T) => T.cat === 'trigger',
      isEnd: (n) => n.type === 'end',
      sel: 'node',
      selLink: 'link',
      changed: 'quests',
      linkError: 'That connection isn’t allowed (triggers can’t have inputs, Quest Complete has no output).',
      bar,
      empty: (box) => box.append(
        el('h3', null, 'No quest yet'),
        el('p', null, 'A quest is a flow of nodes: a trigger starts it, objectives are completed in order, then rewards are given.'),
        el('button', { class: 'btn primary', onclick: () => { S.newQuest(); S.commit(); } }, 'Create your first quest')),
      validate: (q) => (DS.validateQuest ? DS.validateQuest(q) : {}),
      newGraph: () => S.newQuest(),
      afterRender: (world) => { liveWorld = world; applyLive(world); },
      addMenuExtra: (m, close) => m.append(el('div', { class: 'ctx-sep' }), el('div', { class: 'ctx-item', title: 'Write a little Enforce Script and use it as a block', onclick: () => { close(); DS.CustomNodes.wizard(); } }, el('span', { class: 'ctx-ic' }, '🧩'), 'Make your own node…')),
      onAdd: (n) => {
        const T = DS.NODE_TYPES[n.type];
        if (T.custom && DS.CustomNodes) DS.CustomNodes.embed(n.type);   // the project keeps its own copy of the definition
        if (n.type === 'trg_npc' && DS.Npcs && !n.p.npc) DS.Npcs.giveNewNpc(n);   // a new quest-giver is a new NPC
      },
    });
    E.init(container);
  };
  NE.fit = () => E && E.fit();
  /** Add a node; positional params default to the current map centre so it is visible straight away. */
  NE.addNode = (type, x, y, params) => E.addNode(type, x, y, params);
})();
