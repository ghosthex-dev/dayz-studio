/* DayZ Studio - conditions shared by replies, opening lines, "Condition Met" / "Wait Until" / "Meet a Condition"
   nodes, quest availability and NPCs that only appear sometimes.
   c = { kind, cls, n, quest, var, op, value, to, stat }   (same shape as DSCond in the game runtime) */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const C = (DS.Cond = {});

  C.KINDS = [
    ['', 'Always'],
    ['has_item', 'Player carries an item'],
    ['lacks_item', 'Player does NOT carry an item'],
    ['quest_done', 'A quest is completed'],
    ['quest_active', 'A quest is in progress'],
    ['quest_new', 'A quest was never started'],
    ['player', 'Player condition (bleeding, sick, blood…)'],
    ['var', 'Server variable'],
    ['time', 'Time of day'],
    ['weather', 'Weather'],
    ['uptime', 'Server uptime'],
  ];
  /** conditions that do not depend on a player (quest availability, NPC appearance) */
  C.WORLD = ['', 'var', 'time', 'weather', 'uptime'];

  C.PLAYER = [
    ['bleeding', 'is bleeding', true], ['sick', 'is sick (any disease or poisoning)', true], ['fracture', 'has broken legs', true],
    ['unconscious', 'is unconscious', true], ['blood', 'blood (0–5000)', false], ['health', 'health (0–100)', false],
    ['water', 'water (0–5000)', false], ['energy', 'energy / food (0–20000)', false],
  ];
  C.WEATHER = [
    ['storm', 'thunderstorm', true], ['clear', 'clear sky', true],
    ['rain', 'rain (0–1)', false], ['fog', 'fog (0–1)', false], ['overcast', 'clouds (0–1)', false],
  ];
  C.OPS = [['==', '='], ['!=', '≠'], ['>', '>'], ['>=', '≥'], ['<', '<'], ['<=', '≤']];

  const questName = (id) => { const q = S.project.quests.find((x) => x.id === id); return q ? q.name : '(missing quest)'; };
  const isFlag = (list, stat) => { const e = list.find((x) => x[0] === stat); return e ? e[2] : false; };
  const hh = (v) => { v = +v || 0; const h = Math.floor(v) % 24, m = Math.round((v - Math.floor(v)) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };

  /** short plain-English text, e.g. "if the player is bleeding", "while it storms", "if wolves_seen ≥ 1" */
  C.text = function (c) {
    if (!c || !c.kind) return '';
    const op = (C.OPS.find((o) => o[0] === c.op) || C.OPS[0])[1];
    switch (c.kind) {
      case 'has_item': return `if carrying ${c.n || 1}× ${c.cls || '?'}`;
      case 'lacks_item': return `if not carrying ${c.n || 1}× ${c.cls || '?'}`;
      case 'quest_done': return `if “${questName(c.quest)}” is done`;
      case 'quest_active': return `if “${questName(c.quest)}” is running`;
      case 'quest_new': return `if “${questName(c.quest)}” not started`;
      case 'var': return `if ${c.var || '?'} ${op} ${+c.value || 0}`;
      case 'time': return `between ${hh(c.value)} and ${hh(c.to)}`;
      case 'uptime': return `${+c.value || 0}–${c.to > 0 ? c.to : '∞'} min after server start`;
      case 'player': {
        const e = C.PLAYER.find((x) => x[0] === c.stat) || C.PLAYER[0];
        return e[2] ? `if the player ${c.op === 'not' ? 'is not' : 'is'} ${e[1].replace(/^is |^has /, c.op === 'not' && /^has/.test(e[1]) ? 'with ' : '')}` : `if player ${e[1].split(' (')[0]} ${op} ${+c.value || 0}`;
      }
      case 'weather': {
        const e = C.WEATHER.find((x) => x[0] === c.stat) || C.WEATHER[0];
        return e[2] ? `${c.op === 'not' ? 'unless' : 'during a'} ${e[1]}` : `if ${e[1].split(' (')[0]} ${op} ${+c.value || 0}`;
      }
    }
    return '';
  };

  /** problem text or '' */
  C.problem = function (c) {
    if (!c || !c.kind) return '';
    if ((c.kind === 'has_item' || c.kind === 'lacks_item') && !String(c.cls || '').trim()) return 'checks for an item but no item class is set';
    if (c.kind.startsWith('quest_') && !S.project.quests.some((x) => x.id === c.quest)) return 'checks a quest that is not set or was deleted';
    if (c.kind === 'var' && !String(c.var || '').trim()) return 'checks a server variable but no name is set';
    if (c.kind === 'time' && (c.value == null || c.to == null || +c.value === +c.to)) return 'the time window is empty (from and to are the same)';
    return '';
  };

  /** every server variable name used in the project (for suggestions) */
  C.varNames = function () {
    const set = new Set();
    const add = (c) => { if (c && c.kind === 'var' && c.var) set.add(c.var); };
    S.project.quests.forEach((q) => {
      add(q.avail);
      q.nodes.forEach((n) => {
        if (n.p.var) set.add(n.p.var);
        add(n.p.cond);
        const d = n.p.dialog;
        if (d) Object.values(d).forEach((dl) => dl && dl.lines && dl.lines.forEach((l) => { add(l.openIf); (l.options || []).forEach((o) => add(o.if)); }));
      });
    });
    let dl = document.getElementById('dz-vars');
    if (!dl) { dl = el('datalist', { id: 'dz-vars' }); document.body.append(dl); }
    dl.innerHTML = '';
    [...set].sort().forEach((v) => dl.append(el('option', { value: v })));
    return [...set];
  };

  /** editor for condition c (edited in place). opts: { kinds: [...allowed], label, onChange, redraw } */
  C.widget = function (c, opts) {
    opts = opts || {};
    const ch = () => opts.onChange && opts.onChange();
    const commit = () => { ch(); S.commit(); if (opts.redraw) opts.redraw(); else draw(); };
    const wrap = el('div', { class: 'cond-w' });
    const num = (key, step, min, max, title) => {
      const i = el('input', { class: 'inp num', type: 'number', step: step || 1, value: c[key] == null ? '' : c[key], title: title || '' });
      if (min != null) i.min = min;
      if (max != null) i.max = max;
      i.addEventListener('change', () => { c[key] = +i.value || 0; commit(); });
      return i;
    };
    const sel = (key, list, def) => {
      const s = el('select', { class: 'inp' });
      list.forEach(([v, l]) => s.append(el('option', { value: v, selected: (c[key] == null ? def : c[key]) === v }, l)));
      s.addEventListener('change', () => { c[key] = s.value; commit(); });
      if (c[key] == null) c[key] = def;
      return s;
    };
    function draw() {
      wrap.innerHTML = '';
      const kinds = C.KINDS.filter(([k]) => !opts.kinds || opts.kinds.includes(k));
      const row = el('div', { class: 'dlg-opt-row' });
      if (opts.label) row.append(el('span', { class: 'ins-help' }, opts.label));
      const ks = el('select', { class: 'inp' });
      kinds.forEach(([v, l]) => ks.append(el('option', { value: v, selected: (c.kind || '') === v }, l)));
      ks.addEventListener('change', () => {
        c.kind = ks.value;
        // sensible starting values per kind
        if (c.kind === 'time' && c.value == null) { c.value = 22; c.to = 4; }
        if (c.kind === 'weather') { c.stat = c.stat && C.WEATHER.some((w) => w[0] === c.stat) ? c.stat : 'storm'; c.op = 'is'; }
        if (c.kind === 'player') { c.stat = c.stat && C.PLAYER.some((w) => w[0] === c.stat) ? c.stat : 'bleeding'; c.op = 'is'; }
        if (c.kind === 'var') { c.op = c.op && C.OPS.some((o) => o[0] === c.op) ? c.op : '>='; if (c.value == null) c.value = 1; }
        if (c.kind === 'uptime' && c.value == null) { c.value = 0; c.to = 60; }
        commit();
      });
      row.append(ks);
      const k = c.kind || '';
      if (k === 'has_item' || k === 'lacks_item') {
        const cls = el('input', { class: 'inp', type: 'text', value: c.cls || '', placeholder: 'Item class', list: 'dz-classes' });
        cls.addEventListener('input', () => { c.cls = cls.value.trim(); ch(); });
        cls.addEventListener('change', () => S.commit());
        row.append(cls, num('n', 1, 1, null, 'Amount'));
      } else if (k.startsWith('quest_')) {
        const qs = el('select', { class: 'inp' });
        qs.append(el('option', { value: '' }, 'Pick a quest…'));
        S.project.quests.forEach((q) => qs.append(el('option', { value: q.id, selected: c.quest === q.id }, q.name)));
        qs.addEventListener('change', () => { c.quest = qs.value; commit(); });
        row.append(qs);
      } else if (k === 'var') {
        C.varNames();
        const v = el('input', { class: 'inp', type: 'text', value: c.var || '', placeholder: 'variable name, e.g. bandits_defeated', list: 'dz-vars' });
        v.addEventListener('input', () => { c.var = v.value.replace(/[^A-Za-z0-9_]/g, ''); ch(); });
        v.addEventListener('change', () => { v.value = c.var || ''; S.commit(); });
        row.append(v, sel('op', C.OPS, '>='), num('value', 1));
      } else if (k === 'player') {
        row.append(sel('stat', C.PLAYER.map(([v, l]) => [v, l]), 'bleeding'));
        if (isFlag(C.PLAYER, c.stat)) row.append(sel('op', [['is', 'yes'], ['not', 'no']], 'is'));
        else { if (c.op === 'is' || c.op === 'not') c.op = '<'; row.append(sel('op', C.OPS, '<'), num('value', 1, 0)); }
      } else if (k === 'weather') {
        row.append(sel('stat', C.WEATHER.map(([v, l]) => [v, l]), 'storm'));
        if (isFlag(C.WEATHER, c.stat)) row.append(sel('op', [['is', 'yes'], ['not', 'no']], 'is'));
        else { if (c.op === 'is' || c.op === 'not') c.op = '>='; row.append(sel('op', C.OPS, '>='), num('value', 0.05, 0, 1)); }
      } else if (k === 'time') {
        row.append(el('span', { class: 'ins-help' }, 'from'), num('value', 0.25, 0, 24, 'hour, e.g. 23.5 = 23:30'), el('span', { class: 'ins-help' }, 'to'), num('to', 0.25, 0, 24, 'hour'));
      } else if (k === 'uptime') {
        row.append(el('span', { class: 'ins-help' }, 'from minute'), num('value', 1, 0), el('span', { class: 'ins-help' }, 'to'), num('to', 1, 0, null, '0 = no end'));
      }
      wrap.append(row);
      const help = {
        time: 'In-game time. A window may run past midnight (e.g. 23 → 1). Exactly midnight: 0 → 0.25.',
        uptime: 'Minutes since the server started (0 as “to” = no end) — e.g. an event only in the first hour after a restart.',
        weather: 'Thunderstorms happen at heavy overcast (lightning starts around 0.9).',
        var: 'Server variables are shared by every player and survive restarts. Set them with a “Set Server Variable” node.',
        player: 'Checked on the server for the player who talks / plays the quest.',
      }[k];
      if (help) wrap.append(el('div', { class: 'ins-help' }, help));
      const pr = C.problem(c);
      if (pr) wrap.append(el('div', { class: 'issue warn' }, pr));
    }
    draw();
    return wrap;
  };

  /** export shape for the game runtime (DSCond); undefined when there is no condition */
  C.out = function (c) {
    if (!c || !c.kind) return undefined;
    return {
      kind: c.kind, cls: String(c.cls || '').trim(), n: Math.max(1, Math.round(c.n || 1)), quest: c.quest || '',
      var: String(c.var || ''), op: c.op || '==', value: +c.value || 0, to: +c.to || 0, stat: c.stat || '',
    };
  };
})();
