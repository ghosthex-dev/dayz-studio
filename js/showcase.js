/* DayZ Studio - the showcase: one small area that uses every system, as an example to learn from (Templates) and as
   the project the automatic script check builds (tools/check_scripts.js).

   A Survivor camp with Mirek (trade replies, a gift only for friends, a quest to clear infected that pays XP and
   standing and ends with a custom "Patch Up" node), a supply container you can search once you have enough XP (it
   holds an M4A1 that needs XP to hold), a Bandit checkpoint with an armed guard who shoots players the Bandits hate,
   a signal fire that burns until you have helped the camp, faction territories, kill rules and relations, an XP bar,
   faction standings on the HUD and a character sheet on K. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const SC = (DS.Showcase = {});

  const PATCH_UP = {
    id: 'cna_patch_up', title: 'Patch Up', icon: '✚', kind: 'action', desc: 'Heals the player and refills their blood.',
    params: [{ k: 'amount', label: 'Health', t: 'num', def: 100 }],
    code: 'player.SetHealth("", "", amount);\nplayer.SetHealth("", "Blood", player.GetMaxHealth("", "Blood"));',
  };

  /** the showcase content around map position c = { x, z } -> parts of a project */
  function build(c) {
    const at = (dx, dz) => ({ x: Math.round(c.x + dx), y: 0, z: Math.round(c.z + dz), ref: null });
    const objects = [];
    const obj = (cls, kind, dx, dz, extra) => {
      const o = S.makeObject({ c: cls, kind }, c.x + dx, c.z + dz, extra);
      objects.push(o);
      return o;
    };
    // the camp, from the built-in camp prefab
    const camp = (DS.PREFABS || []).find((p) => p.id === 'camp');
    const g = U.uid('g');
    if (camp) camp.parts.forEach((p) => obj(p[0], p[1], p[2] - 14, p[3] - 14, { yaw: p[4] || 0, group: g, label: 'Survivor camp' }));
    const container = obj('Land_Container_1Bo', 'building', -30, 18, { yaw: 30, label: 'Supply container' });
    obj('Land_Mil_GuardBox_Green', 'building', 172, -8, { yaw: 270, label: 'Bandit checkpoint' });
    obj('Land_Wreck_Uaz', 'building', 176, 14, { yaw: 120, label: 'Roadblock' });
    // effects: a signal fire that burns until the player helped the camp (per player), a fire at the checkpoint
    const fxDef = (particle, extra) => Object.assign({ particle, repeat: 0, light: true, color: '#ffaa55', radius: 8, brightness: 3, soundset: '', range: 200, startOff: false, when: { kind: '' } }, extra || {});
    const signal = obj('DSFx', 'fx', -6, -24, { label: 'Signal fire', fx: fxDef('CAMP_NORMAL_FIRE') });
    obj('DSFx', 'fx', 186, 4, { label: 'Bandit fire', fx: fxDef('CAMP_SMALL_FIRE') });

    const quests = [];
    const quest = (name, description, extra) => {
      const q = Object.assign({ id: U.uid('q'), name, description, repeatable: false, cooldown: 3600, failOnDeath: false, nodes: [], links: [] }, extra || {});
      quests.push(q);
      return q;
    };
    const node = (q, type, p) => {
      const n = { id: U.uid('n'), type, x: 40 + (q.nodes.length % 5) * 250, y: 40 + Math.floor(q.nodes.length / 5) * 150, p: Object.assign(S.defaultParams(type), p || {}) };
      q.nodes.push(n);
      return n;
    };
    const chain = (q, ns) => ns.forEach((n, i) => { if (i) q.links.push({ id: U.uid('l'), from: ns[i - 1].id, to: n.id }); });

    // ---- 1. Welcome to the Camp (Mirek, Survivors)
    const q1 = quest('Welcome to the Camp', 'Mirek wants the infected cleared from around the camp.');
    const trade = { text: 'Trade 3 apples for a bandage', next: '', accept: false, give: [{ c: 'BandageDressing', n: 1 }], take: [{ c: 'Apple', n: 3 }] };
    const gift = { text: 'Friends of the camp eat for free.', next: '', accept: false, if: { kind: 'reptier', var: 'survivors', stat: 'friendly' }, give: [{ c: 'Canteen', n: 1 }] };
    const dlg = (text, opts) => ({ start: 'l1', lines: [{ id: 'l1', text, sound: null, next: '', openIf: null, options: opts }] });
    const mirek = node(q1, 'trg_npc', {
      npc: 'SurvivorM_Mirek', name: 'Mirek', faction: 'survivors', trader: 'camp_store', pos: at(4, 4), yaw: 200, radius: 4,
      gear: [{ c: 'Hoodie_Green', n: 1, chance: 1 }, { c: 'CargoPants_Green', n: 1, chance: 1 }, { c: 'HikingBootsLow_Black', n: 1, chance: 1 }], hands: '',
      text: 'Infected keep wandering into camp.',
      dialog: {
        offer: dlg('Infected keep wandering into camp. Clear five of them and you are one of us.', [{ text: 'I will do it.', next: '', accept: true }, trade, { text: 'Not now.', next: '' }]),
        active: dlg('Still infected around. Five, remember?', [trade, { text: 'On it.', next: '' }]),
        done: dlg('The camp owes you one.', [trade, gift, { text: 'See you.', next: '' }]),
      },
    });
    const kill = node(q1, 'obj_kill', { classes: ['@infected'], count: 5, area: true, pos: at(0, 0), radius: 250, text: 'Clear infected around the camp' });
    const xp1 = node(q1, 'act_pvar', { stat: 'xp', op: 'add', value: 150, notify: true });
    const pay1 = node(q1, 'rew_item', { items: [{ c: 'DSQ_Dollar20', n: 5, chance: 1 }] });   // $100 to spend at Mirek's store
    const rep1 = node(q1, 'act_rep', { faction: 'survivors', op: 'add', amount: 600, spread: true, text: 'The camp trusts you' });
    const heal = node(q1, PATCH_UP.id, { amount: 100 });
    const end1 = node(q1, 'end', { text: 'Mirek patches you up. “Welcome to the camp.”' });
    chain(q1, [mirek, kill, xp1, pay1, rep1, heal, end1]);

    // ---- 2. The Supply Container (Use Object, needs XP)
    const q2 = quest('The Supply Container', 'Something is locked away in the camp container.');
    const use = node(q2, 'trg_object', {
      obj: container.id, prompt: 'Search the container', radius: 3,
      cond: { kind: 'pvar', var: 'xp', op: '>=', value: 150 },
      failText: 'Mirek’s people guard this. Help the camp first (150 XP).', okText: 'You find a rifle wrapped in cloth.',
    });
    const give = node(q2, 'rew_item', { items: [{ c: 'M4A1', n: 1, chance: 1 }, { c: 'Mag_STANAG_30Rnd', n: 2, chance: 1 }] });
    const xp2 = node(q2, 'act_pvar', { stat: 'xp', op: 'add', value: 200, notify: true });
    const end2 = node(q2, 'end', { text: 'Now you know how to use it, too.' });
    chain(q2, [use, give, xp2, end2]);

    // ---- 3. Run the Checkpoint (starts on the road; the guard shoots players the Bandits see as Hostile)
    const q3 = quest('Run the Checkpoint', 'Get past the bandits on the road east of the camp.');
    const zone = node(q3, 'trg_zone', { pos: at(130, 0), radius: 30, text: 'Bandits ahead. Get past them!' });
    const pass = node(q3, 'obj_travel', { pos: at(240, 0), radius: 15, text: 'Get past the checkpoint' });
    const rep3 = node(q3, 'act_rep', { faction: 'survivors', op: 'add', amount: 100, spread: true, text: 'The camp heard you made it' });
    const nodes3 = [zone, pass, rep3];
    const veh = vehicleNode();
    if (veh) nodes3.push(node(q3, veh.id, { vehicle: 'OffroadHatchback', where: at(250, 12) }));
    nodes3.push(node(q3, 'end', { text: 'You made it past the checkpoint. Someone left a car on the road.' }));
    chain(q3, nodes3);

    // ---- 4. The Bandit Boss: the armed guard of the checkpoint. He only talks to players the Bandits don't hate.
    const q4 = quest('The Bandit Toll', 'The Bandit Boss lets you use the road - for a price.');
    const boss = node(q4, 'trg_npc', {
      npc: 'SurvivorM_Boris', name: 'Bandit Boss', faction: 'bandits', hands: 'AKM', pos: at(170, 0), yaw: 270, radius: 4,
      gear: [{ c: 'BomberJacket_Black', n: 1, chance: 1 }, { c: 'Jeans_Black', n: 1, chance: 1 }, { c: 'MilitaryBoots_Black', n: 1, chance: 1 }],
      text: 'Toll road. Two cans of food and you can use it.',
      dialog: { offer: dlg('Toll road. Two cans of food and you can use it.', [
        { text: 'Here, two cans.', next: '', accept: true, take: [{ c: 'TunaCan', n: 2 }] },
        { text: 'Not today.', next: '' }]) },
    });
    const toll = node(q4, 'act_rep', { faction: 'bandits', op: 'add', amount: 150, spread: false, text: 'The bandits remember who pays' });
    chain(q4, [boss, toll, node(q4, 'end', { text: 'The Boss waves you through.' })]);

    signal.fx.when = { kind: 'quest_done', quest: q1.id, neg: true };   // burns until this player helped the camp

    return {
      objects, quests,
      stats: [{ id: 'xp', name: 'XP', start: 0, min: 0, max: 1000, color: '#c8a864', resetOnDeath: false, sheet: true }],
      itemReqs: [{ cls: 'M4A1', exact: false, cond: { kind: 'pvar', var: 'xp', op: '>=', value: 300 }, msg: 'You need 300 XP to handle the M4A1.' }],
      hud: [
        { id: 'xpbar', type: 'bar', x: 0.35, y: 0.955, w: 0.3, h: 0.022, color: '#c8a864', bg: '#000000', size: 20, stat: 'xp', text: '{xp} / {xp.max} XP' },
        { id: 'standing', type: 'text', x: 0.02, y: 0.3, w: 0.3, h: 0.03, color: '#d7e3c8', bg: '', size: 20, stat: '', text: 'Survivors: {rep.survivors.tier}   Bandits: {rep.bandits.tier}' },
      ],
      sheetKey: 'K',
      factions: {
        min: -1000, max: 1000,
        tiers: [
          { id: 'hostile', name: 'Hostile', min: -1000, max: -500, color: '#e5484d', stance: 'hostile', discount: 0 },
          { id: 'neutral', name: 'Neutral', min: -499, max: 499, color: '#aaaaaa', stance: 'neutral', discount: 0 },
          { id: 'friendly', name: 'Friendly', min: 500, max: 1000, color: '#46a758', stance: 'friendly', discount: 20 },
        ],
        list: [
          { id: 'survivors', name: 'Survivors', color: '#46a758', start: 0,
            territories: [{ name: 'Survivor camp', x: Math.round(c.x), z: Math.round(c.z), radius: 250 }],
            kills: [{ victim: '@infected', where: 'territory', victimTier: '', amount: 5, text: '' },
              { victim: '@player', where: 'territory', victimTier: '', amount: -150, text: 'You killed someone in the Survivor camp' }],
            guard: { warn: 30, attack: 0, damage: 0.3, interval: 2, warnText: 'Easy. We are watching you.', refuseText: 'We do not deal with your kind.' } },
          { id: 'bandits', name: 'Bandits', color: '#e5484d', start: -600,
            territories: [{ name: 'Bandit checkpoint', x: Math.round(c.x + 180), z: Math.round(c.z), radius: 120 }],
            kills: [{ victim: '@player', where: 'anywhere', victimTier: 'hostile', amount: 50, text: 'The bandits liked that' }],
            guard: { warn: 60, attack: 35, damage: 0.08, interval: 3, warnText: 'You are on our road. Walk away.', refuseText: 'Get lost before we shoot.' } },
        ],
        relations: [{ from: 'survivors', to: 'bandits', factor: -0.5 }, { from: 'bandits', to: 'survivors', factor: -0.5 }],
      },
      customNodes: [PATCH_UP].concat(vehicleNode() ? [vehicleNode()] : []),
      // Mirek's store: dollars, a Friendly-only item, limited stock, things the camp buys from players
      trade: { currencies: [], traders: [{ id: 'camp_store', name: 'Mirek’s camp store', currency: 'dollars', items: [
        { cat: 'Food & drink', c: 'TunaCan', name: '', buy: 25, sell: 8, n: 1, stock: '' },
        { cat: 'Food & drink', c: 'BakedBeansCan', name: '', buy: 20, sell: 6, n: 1, stock: '' },
        { cat: 'Food & drink', c: 'WaterBottle', name: '', buy: 30, sell: 10, n: 1, stock: '' },
        { cat: 'Food & drink', c: 'Apple', name: '', buy: 0, sell: 3, n: 1, stock: '' },
        { cat: 'Medical', c: 'BandageDressing', name: '', buy: 30, sell: 10, n: 1, stock: '' },
        { cat: 'Medical', c: 'Morphine', name: '', buy: 120, sell: 40, n: 1, stock: 2, need: { kind: 'reptier', var: 'survivors', stat: 'friendly' }, needText: 'Morphine is for friends of the camp.' },
        { cat: 'Ammunition', c: 'Ammo_556x45', name: '5.56 rounds', buy: 90, sell: 30, n: 20, stock: '' },
        { cat: 'Ammunition', c: 'Mag_STANAG_30Rnd', name: '', buy: 160, sell: 50, n: 1, stock: 3 },
        { cat: 'Tools', c: 'Matchbox', name: '', buy: 25, sell: 8, n: 1, stock: '' },
        { cat: 'Tools', c: 'Rag', name: '', buy: 4, sell: 1, n: 1, stock: '' },
      ] }] },
    };
  }

  // the "Spawn Custom Vehicle" example of the custom node wizard, as the reward at the checkpoint
  const vehicleNode = () => {
    const ex = DS.CustomNodes && DS.CustomNodes.EXAMPLES.find((x) => x.title === 'Spawn Custom Vehicle');
    return ex ? Object.assign(JSON.parse(JSON.stringify(ex)), { id: 'cna_spawn_custom_vehicle' }) : null;
  };

  function prepare() {
    if (!DS.CustomNodes) return;
    DS.CustomNodes.register(PATCH_UP);   // before their nodes get default settings
    const v = vehicleNode();
    if (v) DS.CustomNodes.register(v);
  }

  /** a complete stand-alone project (the script check builds this) */
  SC.project = function (c) {
    prepare();
    const p = S.blank();
    p.meta.name = 'DayZ Studio showcase';
    p.meta.modName = 'DZStudioShowcase';
    const b = build(c);
    Object.assign(p, { objects: b.objects, quests: b.quests, stats: b.stats, itemReqs: b.itemReqs, hud: b.hud, factions: b.factions, customNodes: b.customNodes, trade: b.trade });
    p.meta.sheetKey = b.sheetKey;
    return p;
  };

  /** add the showcase to a project (Templates): parts the project already has (same ids) are kept as they are */
  SC.addTo = function (P, c) {
    prepare();
    const b = build(c);
    P.objects.push(...b.objects);
    P.quests.push(...b.quests);
    const merge = (key, list, id) => {
      if (!P[key]) P[key] = [];
      list.forEach((x) => { if (!P[key].some((y) => y[id] === x[id])) P[key].push(x); });
    };
    merge('stats', b.stats, 'id');
    merge('itemReqs', b.itemReqs, 'cls');
    merge('customNodes', b.customNodes, 'id');
    if (!P.trade) P.trade = { traders: [], currencies: [] };
    if (!P.trade.traders) P.trade.traders = [];
    b.trade.traders.forEach((t) => { if (!P.trade.traders.some((x) => x.id === t.id)) P.trade.traders.push(t); });
    if (!(P.hud || []).length) P.hud = b.hud;
    if (!P.meta.sheetKey) P.meta.sheetKey = b.sheetKey;
    if (!P.factions || !(P.factions.list || []).length) P.factions = b.factions;
    else {
      b.factions.list.forEach((f) => { if (!P.factions.list.some((x) => x.id === f.id)) P.factions.list.push(f); });
      b.factions.relations.forEach((r) => { if (!P.factions.relations.some((x) => x.from === r.from && x.to === r.to)) P.factions.relations.push(r); });
    }
  };
})();
