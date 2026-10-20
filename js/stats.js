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

  let tab = 'stats';
  T.open = function (which) {
    if (which) tab = which;
    const body = el('div', {});
    const redraw = () => {
      U.clear ? U.clear(body) : (body.innerHTML = '');
      const tabs = el('div', { class: 'btn-row st-row' }, [['stats', '📊 Stats'], ['reqs', '🔒 Item requirements'], ['hud', '🖥 HUD & character sheet']].map(([k, l]) =>
        el('button', { class: 'btn' + (tab === k ? ' primary' : ''), onclick: () => { tab = k; redraw(); } }, l)));
      body.append(tabs, tab === 'stats' ? statsTab(redraw) : tab === 'reqs' ? reqsTab(redraw) : hudTab(redraw));
    };
    redraw();
    DS.app.modal({
      title: 'Player stats, item requirements & HUD', wide: true, body,
      buttons: (close) => [el('span', { class: 'ins-help' }, 'Compiled into the quest mod: File ▸ Build installable mod.'), el('button', { class: 'btn primary', onclick: close }, 'Done')],
      onClose: () => { S.commit(); if (DS.Inspector && DS.Inspector.render) DS.Inspector.render(); },
    });
  };
})();
