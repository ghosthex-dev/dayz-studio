/* DayZ Studio - per-player stats (XP, reputation, skills), item requirements and the HUD / character sheet.
   S.project.stats    = [{ id, name, start, min, max, color, resetOnDeath, sheet }]
   S.project.itemReqs = [{ cls, exact, cond, msg }]
   S.project.hud      = [{ id, type: bar|text|panel, x, y, w, h (fractions of the screen), color, bg, size, stat, text }]
   S.project.meta.sheetKey = 'K' (or '' for none)   - all compiled into the quest mod (Build installable mod). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const T = (DS.Stats = {});

  const PRESETS = [
    { id: 'xp', name: 'XP', start: 0, min: 0, max: 1000, color: '#c8a864', resetOnDeath: false, sheet: true },
    { id: 'reputation', name: 'Reputation', start: 0, min: -100, max: 100, color: '#5aa0e6', resetOnDeath: false, sheet: true },
    { id: 'skill', name: 'Skill level', start: 0, min: 0, max: 10, color: '#7cc46a', resetOnDeath: false, sheet: true },
    { id: 'bounty', name: 'Bounty', start: 0, min: 0, max: 0, color: '#e05a4a', resetOnDeath: true, sheet: true },
  ];
  const KEYS = [['', 'No character sheet']].concat('KLNOPUY'.split('').map((k) => [k, k + ' key' + (k === 'K' ? ' (recommended)' : '')]));
  const cleanId = (v) => String(v || '').replace(/[^A-Za-z0-9_]/g, '');

  const lists = () => {
    const P = S.project;
    if (!P.stats) P.stats = [];
    if (!P.itemReqs) P.itemReqs = [];
    if (!P.hud) P.hud = [];
    return P;
  };
  const ch = () => S.changed('quests');

  /* small inputs (commit on change, like the inspector) */
  function txt(v, on, ph, list) {
    const i = el('input', { class: 'inp', type: 'text', value: v == null ? '' : v, placeholder: ph || '' });
    if (list) i.setAttribute('list', list);
    i.addEventListener('input', () => on(i.value));
    i.addEventListener('change', () => S.commit());
    return i;
  }
  function num(v, on, step, w) {
    const i = el('input', { class: 'inp', type: 'number', value: v == null ? 0 : v, step: step || 'any', style: { width: (w || 70) + 'px' } });
    i.addEventListener('input', () => { if (i.value !== '' && i.value !== '-') on(U.num(i.value)); });
    i.addEventListener('change', () => S.commit());
    return i;
  }
  function chk(v, on, label) {
    const i = el('input', { type: 'checkbox', checked: !!v });
    i.addEventListener('change', () => { on(i.checked); S.commit(); });
    return el('label', { class: 'chk' }, i, el('span', null, label));
  }
  function sel(v, opts, on) {
    const s = el('select', { class: 'inp' });
    opts.forEach((o) => s.append(el('option', { value: o[0], selected: String(o[0]) === String(v || '') }, o[1])));
    s.addEventListener('change', () => { on(s.value); S.commit(); });
    return s;
  }
  function color(v, on) {
    const i = el('input', { type: 'color', value: v || '#ffffff' });
    i.addEventListener('input', () => on(i.value));
    i.addEventListener('change', () => S.commit());
    return i;
  }

  /* ---------- stats ---------- */
  function statsTab(redraw) {
    const P = lists();
    const wrap = el('div', {});
    wrap.append(el('div', { class: 'hint-box' }, 'Stats belong to each player and are saved on the server with their quest progress. Quests change them with “Change Player Stat”, and every condition can check them (“Player stat”). A stat with a max larger than its min is shown as a bar; with max = min it has no limits.'));
    P.stats.forEach((st, i) => {
      wrap.append(el('div', { class: 'ins-sec' },
        el('div', { class: 'btn-row st-row' },
          txt(st.name, (v) => { const auto = !st.id || st.id === cleanId(st.name).toLowerCase(); st.name = v; if (auto) st.id = cleanId(v).toLowerCase(); ch(); }, 'Name (XP, Reputation…)'),
          el('span', { class: 'ins-help' }, 'id'), txt(st.id, (v) => { st.id = cleanId(v); ch(); }, 'id'),
          color(st.color, (v) => { st.color = v; ch(); }),
          el('button', { class: 'btn icon', title: 'Delete this stat', onclick: () => { P.stats.splice(i, 1); ch(); S.commit(); redraw(); } }, '🗑')),
        el('div', { class: 'btn-row st-row' },
          el('span', { class: 'ins-help' }, 'start'), num(st.start, (v) => { st.start = v; ch(); }),
          el('span', { class: 'ins-help' }, 'min'), num(st.min, (v) => { st.min = v; ch(); }),
          el('span', { class: 'ins-help' }, 'max'), num(st.max, (v) => { st.max = v; ch(); }),
          chk(st.resetOnDeath, (v) => { st.resetOnDeath = v; ch(); }, 'Resets on death'),
          chk(st.sheet !== false, (v) => { st.sheet = v; ch(); }, 'On the character sheet'))));
    });
    const add = (pre) => {
      const st = Object.assign({}, pre);
      let id = st.id, k = 2;
      while (P.stats.some((x) => x.id === id)) id = st.id + k++;
      st.id = id;
      P.stats.push(st);
      ch(); S.commit(); redraw();
    };
    wrap.append(el('div', { class: 'btn-row pad' },
      el('button', { class: 'btn primary', onclick: () => add({ id: 'stat', name: 'New stat', start: 0, min: 0, max: 100, color: '#c8a864', resetOnDeath: false, sheet: true }) }, '+ Add stat'),
      PRESETS.filter((p) => !P.stats.some((x) => x.id === p.id)).map((p) => el('button', { class: 'btn', onclick: () => add(p) }, '+ ' + p.name))));
    return wrap;
  }

  /* ---------- item requirements ---------- */
  function reqsTab(redraw) {
    const P = lists();
    const wrap = el('div', {});
    wrap.append(el('div', { class: 'hint-box' }, 'Stop players from taking an item into their hands or wearing / attaching it until they meet a condition - e.g. M4A1 needs Skill level ≥ 5, a Ghillie suit needs the “Sniper training” quest done. The player sees your message instead. Without “this class only” it also covers every variant of the class (M4A1 covers M4A1_Green…).'));
    P.itemReqs.forEach((r, i) => {
      if (!r.cond) r.cond = { kind: 'pvar', var: (P.stats[0] || {}).id || '', op: '>=', value: 1 };
      wrap.append(el('div', { class: 'ins-sec' },
        el('div', { class: 'btn-row st-row' },
          txt(r.cls, (v) => { r.cls = v.trim(); ch(); }, 'Item class (M4A1, GhillieSuit_Tan…)', 'dz-classes'),
          chk(r.exact, (v) => { r.exact = v; ch(); }, 'this class only'),
          el('button', { class: 'btn icon', title: 'Delete this rule', onclick: () => { P.itemReqs.splice(i, 1); ch(); S.commit(); redraw(); } }, '🗑')),
        el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Allowed if'), DS.Cond.widget(r.cond, { onChange: ch, redraw })),
        el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Message'), txt(r.msg, (v) => { r.msg = v; ch(); }, 'You need Skill level 5 to use this.'))));
    });
    wrap.append(el('div', { class: 'btn-row pad' },
      el('button', { class: 'btn primary', onclick: () => { P.itemReqs.push({ cls: '', exact: false, cond: { kind: 'pvar', var: (P.stats[0] || {}).id || '', op: '>=', value: 5 }, msg: '' }); ch(); S.commit(); redraw(); } }, '+ Add requirement')));
    return wrap;
  }

  /* ---------- HUD ---------- */
  function hudTab(redraw) {
    const P = lists();
    const wrap = el('div', {});
    const statOpts = [['', '—']].concat(P.stats.map((st) => [st.id, st.name || st.id]));
    wrap.append(el('div', { class: 'hint-box' }, 'Widgets drawn on every player’s screen by the quest mod (hidden while a menu, the map or a conversation is open). Drag them in the preview. Text can show stats: {xp} = value, {xp.max} = maximum, {xp.name} = name.'));
    wrap.append(el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Character sheet key'),
      sel(P.meta.sheetKey || '', KEYS, (v) => { P.meta.sheetKey = v; S.changed('meta'); }),
      el('span', { class: 'ins-help' }, 'Opens a panel with the player’s stats (those ticked “On the character sheet”). K is free in vanilla DayZ (J opens the quest journal).')));

    // 16:9 preview, 1920x1080 scaled down
    const PW = 576, PH = 324, k = PW / 1920;
    const prev = el('div', { style: { position: 'relative', width: PW + 'px', height: PH + 'px', background: 'linear-gradient(#56606a,#2c3136)', border: '1px solid var(--line2)', borderRadius: '6px', overflow: 'hidden', margin: '8px 0' } });
    P.hud.forEach((h) => {
      const st = P.stats.find((x) => x.id === h.stat);
      const fill = st && st.max > st.min ? Math.max(0, Math.min(1, ((st.start || 0) - st.min) / (st.max - st.min))) || 0.35 : 0.35;
      const sample = String(h.text || '').replace(/\{(\w+)(\.max|\.name)?\}/g, (m, id, sfx) => {
        const s2 = P.stats.find((x) => x.id === id);
        if (!s2) return m;
        return sfx === '.max' ? String(s2.max) : sfx === '.name' ? s2.name : String(Math.round(s2.min + (s2.max - s2.min) * 0.35));
      });
      const box = el('div', { title: h.id, style: { position: 'absolute', left: h.x * PW + 'px', top: h.y * PH + 'px', width: h.w * PW + 'px', height: h.h * PH + 'px', cursor: 'move', outline: '1px dashed rgba(255,255,255,.25)' } });
      if (h.type !== 'text') box.style.background = h.bg || '#000000b0';
      if (h.type === 'bar') box.append(el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: fill * 100 + '%', background: h.color } }));
      if (sample) box.append(el('div', { style: { position: 'absolute', left: 6 * k + 'px', right: 6 * k + 'px', top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: Math.max(7, (h.size || 24) * k) + 'px', color: h.type === 'text' ? h.color : '#fff', whiteSpace: 'nowrap', overflow: 'hidden' } }, sample));
      box.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const sx = e.clientX, sy = e.clientY, ox = h.x, oy = h.y;
        const mv = (ev) => {
          h.x = U.round(Math.max(0, Math.min(1 - h.w, ox + (ev.clientX - sx) / PW)), 4);
          h.y = U.round(Math.max(0, Math.min(1 - h.h, oy + (ev.clientY - sy) / PH)), 4);
          box.style.left = h.x * PW + 'px'; box.style.top = h.y * PH + 'px';
        };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); ch(); S.commit(); redraw(); };
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
      });
      prev.append(box);
    });
    wrap.append(prev);

    const pct = (v, on) => num(U.round((v || 0) * 100, 2), (x) => on(x / 100), 0.5, 62);
    P.hud.forEach((h, i) => {
      wrap.append(el('div', { class: 'ins-sec' },
        el('div', { class: 'btn-row st-row' },
          sel(h.type, [['bar', 'Bar'], ['text', 'Text'], ['panel', 'Panel (background)']], (v) => { h.type = v; ch(); redraw(); }),
          h.type === 'bar' ? el('span', { class: 'ins-help' }, 'shows') : null,
          h.type === 'bar' ? sel(h.stat, statOpts, (v) => { h.stat = v; ch(); redraw(); }) : null,
          txt(h.text, (v) => { h.text = v; ch(); }, h.type === 'bar' ? 'Text on the bar (optional): {xp} / {xp.max} XP' : 'Text: Reputation {reputation}'),
          el('button', { class: 'btn icon', title: 'Delete this widget', onclick: () => { P.hud.splice(i, 1); ch(); S.commit(); redraw(); } }, '🗑')),
        el('div', { class: 'btn-row st-row' },
          el('span', { class: 'ins-help' }, 'x %'), pct(h.x, (v) => { h.x = v; ch(); }),
          el('span', { class: 'ins-help' }, 'y %'), pct(h.y, (v) => { h.y = v; ch(); }),
          el('span', { class: 'ins-help' }, 'w %'), pct(h.w, (v) => { h.w = v; ch(); }),
          el('span', { class: 'ins-help' }, 'h %'), pct(h.h, (v) => { h.h = v; ch(); }),
          el('span', { class: 'ins-help' }, h.type === 'text' ? 'colour' : 'fill'), color(h.color, (v) => { h.color = v; ch(); }),
          h.type !== 'text' ? el('span', { class: 'ins-help' }, 'back') : null, h.type !== 'text' ? color(String(h.bg || '#000000').slice(0, 7), (v) => { h.bg = v; ch(); }) : null,
          el('span', { class: 'ins-help' }, 'font'), num(h.size || 24, (v) => { h.size = Math.max(8, Math.round(v)); ch(); }, 1, 56))));
    });
    const nid = (base) => { let n = 1; while (P.hud.some((x) => x.id === base + n)) n++; return base + n; };
    const xp = P.stats.find((x) => x.id === 'xp') || P.stats[0];
    wrap.append(el('div', { class: 'btn-row pad' },
      el('button', { class: 'btn primary', disabled: !xp, title: xp ? '' : 'Make a stat first', onclick: () => {
        P.hud.push({ id: nid('bar'), type: 'bar', x: 0.35, y: 0.955, w: 0.3, h: 0.022, color: xp.color || '#c8a864', bg: '#000000', size: 20, stat: xp.id, text: `{${xp.id}} / {${xp.id}.max} ${xp.name || xp.id}` });
        ch(); S.commit(); redraw();
      } }, '+ ' + (xp ? (xp.name || xp.id) + ' bar' : 'Stat bar')),
      el('button', { class: 'btn', onclick: () => { P.hud.push({ id: nid('text'), type: 'text', x: 0.02, y: 0.3, w: 0.2, h: 0.03, color: '#ffffff', bg: '', size: 22, stat: '', text: xp ? `${xp.name || xp.id}: {${xp.id}}` : 'Text' }); ch(); S.commit(); redraw(); } }, '+ Text'),
      el('button', { class: 'btn', onclick: () => { P.hud.push({ id: nid('panel'), type: 'panel', x: 0.02, y: 0.28, w: 0.22, h: 0.12, color: '#ffffff', bg: '#000000', size: 22, stat: '', text: '' }); ch(); S.commit(); redraw(); } }, '+ Panel')));
    return wrap;
  }

  /* ---------- factions & reputation ---------- */
  // the scale from the design doc; the 5-tier set adds Unfriendly / Allied bands
  const TIERS3 = [
    { id: 'hostile', name: 'Hostile', min: -1000, max: -500, color: '#e5484d', stance: 'hostile', discount: 0 },
    { id: 'neutral', name: 'Neutral', min: -499, max: 499, color: '#aaaaaa', stance: 'neutral', discount: 0 },
    { id: 'friendly', name: 'Friendly', min: 500, max: 1000, color: '#46a758', stance: 'friendly', discount: 20 },
  ];
  const TIERS5 = [
    { id: 'hated', name: 'Hated', min: -1000, max: -600, color: '#e5484d', stance: 'hostile', discount: 0 },
    { id: 'unfriendly', name: 'Unfriendly', min: -599, max: -200, color: '#f08c3a', stance: 'neutral', discount: 0 },
    { id: 'neutral', name: 'Neutral', min: -199, max: 199, color: '#aaaaaa', stance: 'neutral', discount: 0 },
    { id: 'friendly', name: 'Friendly', min: 200, max: 599, color: '#7cc46a', stance: 'friendly', discount: 10 },
    { id: 'allied', name: 'Allied', min: 600, max: 1000, color: '#46a758', stance: 'friendly', discount: 25 },
  ];
  const STANCES = [['hostile', 'Hostile - warn, refuse, shoot'], ['neutral', 'Neutral'], ['friendly', 'Friendly']];
  const VICTIMS = [['@infected', 'Infected'], ['@animal', 'Animals'], ['@player', 'Players'], ['@class', 'A class…']];
  const WHERE = [['anywhere', 'anywhere'], ['territory', 'inside their territory'], ['outside', 'outside their territory']];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const newGuard = () => ({ warn: 40, attack: 25, damage: 0.35, interval: 2, warnText: '', refuseText: '' });
  const fac = () => {
    const P = S.project;
    if (!P.factions) P.factions = { min: -1000, max: 1000, tiers: clone(TIERS3), list: [], relations: [] };
    const F = P.factions;
    ['tiers', 'list', 'relations'].forEach((k) => { if (!F[k]) F[k] = []; });
    return F;
  };
  T.factions = fac;

  /** the same tier checks the studio server makes before it builds (tools/factions.py) */
  T.tierProblems = function (F) {
    const out = [];
    const ts = (F.tiers || []).slice().sort((a, b) => a.min - b.min);
    if (!ts.length) return ['Add at least one tier.'];
    if (+F.max <= +F.min) out.push('The scale maximum must be larger than the minimum.');
    if (ts[0].min > F.min) out.push(`No tier covers ${F.min} to ${ts[0].min - 1}.`);
    if (ts[ts.length - 1].max < F.max) out.push(`No tier covers ${ts[ts.length - 1].max + 1} to ${F.max}.`);
    ts.forEach((t, i) => {
      if (t.max < t.min) out.push(`Tier “${t.name}” ends before it starts.`);
      const nx = ts[i + 1];
      if (nx && nx.min <= t.max) out.push(`Tiers “${t.name}” and “${nx.name}” overlap.`);
      else if (nx && nx.min > t.max + 1) out.push(`No tier covers ${t.max + 1} to ${nx.min - 1}.`);
    });
    const ids = new Set();
    ts.forEach((t) => { if (ids.has(t.id)) out.push(`Two tiers share the id “${t.id}”.`); ids.add(t.id); });
    return out;
  };
  const slugId = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f$1').slice(0, 40);

  function factionsTab(redraw) {
    const F = fac();
    const wrap = el('div', {});
    const box = (title, ...kids) => el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, title), kids.flat(2));
    const later = (fn) => () => { fn(); ch(); S.commit(); redraw(); };
    wrap.append(el('div', { class: 'hint-box' }, 'Each player has a standing with every faction: a number on one scale, split into named tiers. Quests change it (“Change Faction Standing”), kills can too, conditions check it (“Faction standing”), and NPCs with a faction act on it - Hostile players are warned, refused and, if the NPC holds a gun, shot at; Friendly players get the tier’s discount on trade replies. Standings are saved per player on the server.'));

    // ---- scale + tiers
    const tp = T.tierProblems(F);
    wrap.append(box('Scale & tiers',
      el('div', { class: 'btn-row st-row' },
        el('span', { class: 'ins-help' }, 'scale from'), num(F.min, (v) => { F.min = Math.round(v); ch(); }, 1, 90),
        el('span', { class: 'ins-help' }, 'to'), num(F.max, (v) => { F.max = Math.round(v); ch(); }, 1, 90),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'btn sm', onclick: later(() => { F.tiers = clone(TIERS3); F.min = -1000; F.max = 1000; }) }, '3 tiers'),
        el('button', { class: 'btn sm', onclick: later(() => { F.tiers = clone(TIERS5); F.min = -1000; F.max = 1000; }) }, '5 tiers')),
      F.tiers.map((t, i) => el('div', { class: 'btn-row st-row' },
        color(t.color, (v) => { t.color = v; ch(); }),
        txt(t.name, (v) => { const auto = !t.id || t.id === slugId(t.name); t.name = v; if (auto) t.id = slugId(v); ch(); }, 'Tier name'),
        el('span', { class: 'ins-help' }, 'from'), num(t.min, (v) => { t.min = Math.round(v); ch(); }, 1, 80),
        el('span', { class: 'ins-help' }, 'to'), num(t.max, (v) => { t.max = Math.round(v); ch(); }, 1, 80),
        sel(t.stance, STANCES, (v) => { t.stance = v; ch(); }),
        el('span', { class: 'ins-help', title: 'Discount on the items that trade replies of this faction’s NPCs ask for' }, 'discount %'),
        num(t.discount || 0, (v) => { t.discount = Math.max(0, Math.min(90, Math.round(v))); ch(); }, 1, 60),
        el('button', { class: 'btn icon', title: 'Delete this tier', onclick: later(() => F.tiers.splice(i, 1)) }, '🗑'))),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn sm', onclick: later(() => {
        const last = F.tiers[F.tiers.length - 1];
        F.tiers.push({ id: 'tier' + (F.tiers.length + 1), name: 'Tier ' + (F.tiers.length + 1), min: last ? last.max + 1 : F.min, max: F.max, color: '#888888', stance: 'neutral', discount: 0 });
      }) }, '+ Tier')),
      tp.length ? el('div', { class: 'issue warn' }, tp.join(' ')) : el('div', { class: 'ins-help' }, '✔ The tiers cover the whole scale without gaps.')));

    // ---- factions
    F.list.forEach((f, i) => {
      if (!f.guard) f.guard = newGuard();
      if (!f.territories) f.territories = [];
      if (!f.kills) f.kills = [];
      const terr = el('div', {}, f.territories.map((t, j) => el('div', { class: 'btn-row st-row' },
        txt(t.name, (v) => { t.name = v; ch(); }, 'Territory name'),
        el('span', { class: 'ins-help' }, 'X'), num(t.x, (v) => { t.x = v; ch(); }, 1, 80),
        el('span', { class: 'ins-help' }, 'Z'), num(t.z, (v) => { t.z = v; ch(); }, 1, 80),
        el('span', { class: 'ins-help' }, 'radius m'), num(t.radius, (v) => { t.radius = Math.max(1, v); ch(); }, 10, 70),
        el('button', { class: 'btn sm', title: 'Pick the centre on the map', onclick: () => {
          if (T._close) T._close();
          DS.pickPosition({ prompt: 'Click the centre of “' + (t.name || f.name) + '”  (Esc to cancel)' }, (pos) => { t.x = pos.x; t.z = pos.z; ch(); S.commit(); T.open('factions'); });
        } }, '📍'),
        el('button', { class: 'btn icon', title: 'Delete this territory', onclick: later(() => f.territories.splice(j, 1)) }, '🗑'))),
      el('button', { class: 'btn sm', onclick: later(() => {
        const c = DS.MapView && DS.MapView.center ? DS.MapView.center() : { x: 7500, z: 7500 };
        f.territories.push({ name: '', x: Math.round(c.x), z: Math.round(c.z), radius: 300 });
      }) }, '+ Territory (at the map centre)'));
      const tierOpts = [['', 'any standing']].concat(F.tiers.map((t) => [t.id, 'they see as ' + t.name]));
      const where = () => (f.territories.length ? 'territory' : 'anywhere');
      const kills = el('div', {}, f.kills.map((k, j) => {
        const isClass = k.victim && !k.victim.startsWith('@');
        return el('div', { class: 'btn-row st-row' },
          el('span', { class: 'ins-help' }, 'killing'),
          sel(isClass ? '@class' : k.victim, VICTIMS, (v) => { k.victim = v === '@class' ? 'ZmbM_SoldierNormal' : v; ch(); redraw(); }),
          isClass ? txt(k.victim, (v) => { k.victim = v.trim(); ch(); }, 'class', 'dz-classes') : null,
          k.victim === '@player' ? sel(k.victimTier || '', tierOpts, (v) => { k.victimTier = v; ch(); }) : null,
          sel(k.where || 'anywhere', WHERE, (v) => { k.where = v; ch(); }),
          el('span', { class: 'ins-help' }, 'points'), num(k.amount, (v) => { k.amount = Math.round(v); ch(); }, 1, 70),
          txt(k.text, (v) => { k.text = v; ch(); }, 'message (optional)'),
          el('button', { class: 'btn icon', title: 'Delete this rule', onclick: later(() => f.kills.splice(j, 1)) }, '🗑'));
      }),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn sm', onclick: later(() => f.kills.push({ victim: '@infected', where: where(), victimTier: '', amount: 2, text: '' })) }, '+ Infected kill'),
        el('button', { class: 'btn sm', onclick: later(() => f.kills.push({ victim: '@player', where: where(), victimTier: '', amount: -150, text: 'You killed someone on ' + f.name + ' ground' })) }, '+ Player kill penalty'),
        el('button', { class: 'btn sm', onclick: later(() => {
          const h = F.tiers.find((t) => t.stance === 'hostile');
          f.kills.push({ victim: '@player', where: 'anywhere', victimTier: h ? h.id : '', amount: 50, text: 'You took out an enemy of ' + f.name });
        }) }, '+ Reward for killing their enemies')));
      const g = f.guard;
      wrap.append(el('div', { class: 'ins-sec', style: { borderLeft: '3px solid ' + (f.color || '#888888') } },
        el('div', { class: 'btn-row st-row' },
          color(f.color, (v) => { f.color = v; ch(); }),
          txt(f.name, (v) => { const auto = !f.id || f.id === slugId(f.name); f.name = v; if (auto) f.id = slugId(v); ch(); }, 'Faction name (Survivors, Bandits…)'),
          el('span', { class: 'ins-help' }, 'id'), txt(f.id, (v) => { f.id = slugId(v); ch(); }, 'id'),
          el('span', { class: 'ins-help' }, 'starts at'), num(f.start || 0, (v) => { f.start = Math.round(v); ch(); }, 10, 80),
          el('button', { class: 'btn icon', title: 'Delete this faction', onclick: later(() => { F.list.splice(i, 1); F.relations = F.relations.filter((r) => r.from !== f.id && r.to !== f.id); }) }, '🗑')),
        el('div', { class: 'ins-label' }, 'Territories'), terr,
        el('div', { class: 'ins-label' }, 'Kills change the standing'), kills,
        el('div', { class: 'ins-label' }, 'Their NPCs, towards players they see as Hostile'),
        el('div', { class: 'btn-row st-row' },
          el('span', { class: 'ins-help' }, 'warn within m'), num(g.warn, (v) => { g.warn = Math.max(0, v); ch(); }, 5, 64),
          el('span', { class: 'ins-help' }, 'shoot within m'), num(g.attack, (v) => { g.attack = Math.max(0, v); ch(); }, 5, 64),
          el('span', { class: 'ins-help', title: '1 = a full hit of the bullet the NPC’s gun fires' }, 'damage'), num(g.damage, (v) => { g.damage = Math.max(0, Math.min(1, v)); ch(); }, 0.05, 64),
          el('span', { class: 'ins-help' }, 'every s'), num(g.interval, (v) => { g.interval = Math.max(1, v); ch(); }, 0.5, 60)),
        el('div', { class: 'btn-row st-row' },
          txt(g.warnText, (v) => { g.warnText = v; ch(); }, 'Warning (Stay back! You’re not welcome here.)'),
          txt(g.refuseText, (v) => { g.refuseText = v; ch(); }, 'Instead of talking (Get lost.)')),
        el('div', { class: 'ins-help' }, 'Only NPCs with a gun in their hands shoot (AKM, AK74, AKS74U, M4A1, SKS, Mosin, FAL, MP5, Izh18 - Studio knows their bullets and sounds): players see the muzzle flash and hear the shot. The others warn and refuse. Quest NPCs can’t be hurt.')));
    });
    wrap.append(el('div', { class: 'btn-row st-row pad' },
      el('button', { class: 'btn primary', onclick: later(() => {
        const n = F.list.length + 1;
        F.list.push({ id: 'faction' + n, name: 'Faction ' + n, color: '#5aa0e6', start: 0, territories: [], kills: [], guard: newGuard() });
      }) }, '+ Faction'),
      F.list.length ? null : el('button', { class: 'btn', onclick: later(() => {
        F.list.push({ id: 'survivors', name: 'Survivors', color: '#46a758', start: 0, territories: [], kills: [{ victim: '@infected', where: 'anywhere', victimTier: '', amount: 1, text: '' }],
          guard: { warn: 40, attack: 0, damage: 0.35, interval: 2, warnText: 'Easy there. We’re watching you.', refuseText: 'We don’t deal with your kind.' } });
        F.list.push({ id: 'bandits', name: 'Bandits', color: '#e5484d', start: -100, territories: [], kills: [],
          guard: { warn: 50, attack: 30, damage: 0.3, interval: 2, warnText: 'You’re on our turf. Walk away.', refuseText: 'Get lost before we shoot.' } });
        F.relations = [{ from: 'survivors', to: 'bandits', factor: -0.5 }, { from: 'bandits', to: 'survivors', factor: -0.5 }];
      }) }, '+ Survivors & Bandits example')));

    // ---- relations
    if (F.list.length > 1) {
      const get = (a, b) => { const r = F.relations.find((x) => x.from === a && x.to === b); return r ? r.factor : 0; };
      const set = (a, b, v) => {
        F.relations = F.relations.filter((x) => !(x.from === a && x.to === b));
        if (+v) F.relations.push({ from: a, to: b, factor: Math.max(-1, Math.min(1, +v)) });
        ch();
      };
      const cell = { padding: '2px 6px' };
      const table = el('table', { style: { borderCollapse: 'collapse', fontSize: '12px' } },
        el('tr', {}, el('th', { style: Object.assign({ textAlign: 'left' }, cell) }, 'gain with ↓ changes →'), F.list.map((f) => el('th', { style: Object.assign({ color: f.color }, cell) }, f.name))),
        F.list.map((a) => el('tr', {}, el('td', { style: Object.assign({ color: a.color }, cell) }, a.name),
          F.list.map((b) => el('td', { style: cell }, a.id === b.id ? el('span', { class: 'ins-help' }, '—') : num(get(a.id, b.id), (v) => set(a.id, b.id, v), 0.1, 64))))));
      wrap.append(box('Relations', el('div', { style: { overflowX: 'auto' } }, table),
        el('div', { class: 'ins-help' }, 'A factor of −0.5 means +100 with the row’s faction gives −50 with the column’s faction (0 = not related). Only one step is applied, so relations never loop.')));
    }
    return wrap;
  }

  let tab = 'stats';
  T.open = function (which) {
    if (which) tab = which;
    const body = el('div', {});
    const redraw = () => {
      U.clear ? U.clear(body) : (body.innerHTML = '');
      const tabs = el('div', { class: 'btn-row st-row' }, [['stats', '📊 Stats'], ['factions', '🏳 Factions'], ['reqs', '🔒 Item requirements'], ['hud', '🖥 HUD & character sheet']].map(([k, l]) =>
        el('button', { class: 'btn' + (tab === k ? ' primary' : ''), onclick: () => { tab = k; redraw(); } }, l)));
      body.append(tabs, tab === 'stats' ? statsTab(redraw) : tab === 'factions' ? factionsTab(redraw) : tab === 'reqs' ? reqsTab(redraw) : hudTab(redraw));
    };
    redraw();
    T._close = DS.app.modal({
      title: 'Player stats, factions, item requirements & HUD', wide: true, body,
      buttons: (close) => [el('span', { class: 'ins-help' }, 'Compiled into the quest mod: File ▸ Build installable mod.'), el('button', { class: 'btn primary', onclick: close }, 'Done')],
      onClose: () => { S.commit(); if (DS.Inspector && DS.Inspector.render) DS.Inspector.render(); },
    });
  };
})();
