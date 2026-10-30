/* DayZ Studio - contextual properties inspector (right panel) */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const I = (DS.Inspector = {});
  let root;

  /* ---------- shared class-name datalist (catalog + imported types.xml) ---------- */
  DS.imported = { items: [], buildings: [] };
  DS.refreshClassList = function () {
    let dl = document.getElementById('dz-classes');
    if (!dl) {
      dl = el('datalist', { id: 'dz-classes' });
      document.body.append(dl);
    }
    const set = new Set();
    DS.CATALOG.forEach((c) => c.items.forEach((i) => set.add(i[0])));
    DS.imported.items.forEach((i) => set.add(i));
    DS.imported.buildings.forEach((i) => set.add(i));
    dl.innerHTML = '';
    [...set].sort().forEach((c) => dl.append(el('option', { value: c })));
    // quest NPC pickers
    [['dz-npcs', DS.NPC_CHARACTERS || []], ['dz-hands', DS.NPC_HANDS || []]].forEach(([id, list]) => {
      let d = document.getElementById(id);
      if (!d) { d = el('datalist', { id }); document.body.append(d); }
      d.innerHTML = '';
      list.forEach((c) => d.append(el('option', { value: c })));
    });
  };

  DS.pickPosition = function (opts, cb) {
    const prev = S.view;
    S.setView('map');
    DS.MapView.onPickEnd = () => {
      DS.MapView.onPickEnd = null;
      if (S.view !== prev) S.setView(prev);
    };
    DS.MapView.pick(opts, cb);
  };

  /* ---------- tiny form helpers ---------- */
  function section(title, ...kids) {
    return el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, title), kids);
  }
  function row(label, input, help) {
    return el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, label), input, help ? el('span', { class: 'ins-help' }, help) : null);
  }
  function textInp(val, onInput, opts) {
    const i = el('input', { class: 'inp', type: 'text', value: val == null ? '' : val, placeholder: (opts && opts.ph) || '' });
    if (opts && opts.list) i.setAttribute('list', opts.list);
    i.addEventListener('input', () => onInput(i.value));
    i.addEventListener('change', () => S.commit());
    return i;
  }
  function numInp(val, onInput, opts) {
    const i = el('input', { class: 'inp', type: 'number', value: val == null ? 0 : val, step: (opts && opts.step) || 'any' });
    if (opts && opts.min != null) i.min = opts.min;
    if (opts && opts.max != null) i.max = opts.max;
    i.addEventListener('input', () => {
      if (i.value !== '' && i.value !== '-') onInput(U.num(i.value));
    });
    i.addEventListener('change', () => S.commit());
    return i;
  }
  function areaInp(val, onInput, rows, code) {
    const i = el('textarea', { class: 'inp' + (code ? ' code' : ''), rows: rows || 3, spellcheck: 'false' });
    i.value = val == null ? '' : val;
    i.addEventListener('input', () => onInput(i.value));
    i.addEventListener('change', () => S.commit());
    return i;
  }
  function checkInp(val, onInput, text) {
    const i = el('input', { type: 'checkbox', checked: !!val });
    i.addEventListener('change', () => {
      onInput(i.checked);
      S.commit();
    });
    return el('label', { class: 'chk' }, i, el('span', null, text));
  }
  function selectInp(val, opts, onInput) {
    const s = el('select', { class: 'inp' });
    opts.forEach((o) => s.append(el('option', { value: o[0], selected: String(o[0]) === String(val) }, o[1])));
    s.addEventListener('change', () => {
      onInput(s.value);
      S.commit();
    });
    return s;
  }

  /* ---------- reusable widgets ---------- */
  function itemsWidget(arr, onChange, withChance) {
    const wrap = el('div', { class: 'items' });
    function draw() {
      wrap.innerHTML = '';
      arr.forEach((it, idx) => {
        const r = el('div', { class: 'item-row' });
        r.append(
          textInp(it.c, (v) => { it.c = v; onChange(); }, { list: 'dz-classes', ph: 'ClassName' }),
          numInp(it.n, (v) => { it.n = Math.max(1, Math.round(v)); onChange(); }, { min: 1, step: 1 })
        );
        if (withChance) {
          const ci = numInp(Math.round((it.chance == null ? 1 : it.chance) * 100), (v) => { it.chance = U.clamp(v, 0, 100) / 100; onChange(); }, { min: 0, max: 100, step: 5 });
          ci.title = 'Spawn chance %';
          r.append(ci, el('span', { class: 'pct' }, '%'));
        }
        r.append(el('button', { class: 'btn icon', title: 'Remove', onclick: () => { arr.splice(idx, 1); onChange(); S.commit(); draw(); } }, '✕'));
        wrap.append(r);
      });
      wrap.append(el('button', { class: 'btn sm', onclick: () => { arr.push({ c: '', n: 1, chance: 1 }); onChange(); draw(); } }, '+ Add item'));
    }
    draw();
    return wrap;
  }

  DS.itemsWidget = itemsWidget;   // also used by the conversation editor

  function classesWidget(arr, onChange) {
    const wrap = el('div', { class: 'items' });
    function draw() {
      wrap.innerHTML = '';
      arr.forEach((c, idx) => {
        wrap.append(el('div', { class: 'item-row' },
          textInp(c, (v) => { arr[idx] = v; onChange(); }, { list: 'dz-classes', ph: 'ClassName or @infected' }),
          el('button', { class: 'btn icon', onclick: () => { arr.splice(idx, 1); onChange(); S.commit(); draw(); } }, '✕')));
      });
      const preset = el('select', { class: 'inp' }, el('option', { value: '' }, '+ Add preset…'));
      DS.KILL_PRESETS.forEach((p) => preset.append(el('option', { value: p[1] }, `${p[0]}  (${p[1]})`)));
      preset.addEventListener('change', () => {
        if (preset.value) { arr.push(preset.value); onChange(); S.commit(); draw(); }
      });
      wrap.append(preset, el('button', { class: 'btn sm', onclick: () => { arr.push(''); onChange(); draw(); } }, '+ Custom class'));
    }
    draw();
    return wrap;
  }

  function posWidget(holder, key, onChange) {
    const p = holder[key] || (holder[key] = { x: 0, y: 0, z: 0, ref: null });
    const wrap = el('div', { class: 'posw' });
    function draw() {
      wrap.innerHTML = '';
      const res = DS.resolvePos(p);
      const lock = !!p.ref;
      const mk = (axis, label) => {
        const i = numInp(U.round(res[axis], 2), (v) => { p[axis] = v; onChange(); }, { step: 1 });
        if (lock) i.disabled = true;
        return el('div', { class: 'posw-c' }, el('span', null, label), i);
      };
      wrap.append(el('div', { class: 'posw-row' }, mk('x', 'X'), mk('y', 'Y'), mk('z', 'Z')));
      const objs = S.project.objects;
      const sel = el('select', { class: 'inp' }, el('option', { value: '' }, '— not linked —'));
      objs.forEach((o) => sel.append(el('option', { value: o.id, selected: p.ref === o.id }, `${o.label || U.pretty(o.c)}  (${Math.round(o.x)}, ${Math.round(o.z)})`)));
      sel.addEventListener('change', () => {
        if (sel.value) {
          const o = S.obj(sel.value);
          p.ref = sel.value;
          if (o) { p.x = o.x; p.y = o.y; p.z = o.z; }
        } else p.ref = null;
        onChange();
        S.commit();
        draw();
      });
      wrap.append(
        el('div', { class: 'posw-row' },
          el('button', { class: 'btn sm', title: 'Click a spot on the map', onclick: () => DS.pickPosition({ allowRef: true, prompt: 'Click the map to set this position — click a placed object to LINK to it  (Esc cancels)' }, (r) => {
            p.x = r.x; p.y = r.y || 0; p.z = r.z; p.ref = r.ref || null;
            onChange(); S.commit(); S.structure();
          }) }, '📍 Pick on map'),
          el('button', { class: 'btn sm', title: 'Centre the map on this position', onclick: () => { const r = DS.resolvePos(p); S.setView('map'); DS.MapView.centerOn(r.x, r.z, 0.4); } }, '⌖ Show')
        ),
        row('Link to placed object', sel, 'Linked positions follow the object when it moves. Y = 0 means “snap to ground”.')
      );
    }
    draw();
    return wrap;
  }

  /* ---------- node form (schema driven) ---------- */
  /** placed effect: particles + light + looping sound, when it is on */
  function fxSection(o, ch) {
    const f = o.fx || (o.fx = { particle: '', repeat: 0, light: false, color: '#ffaa55', radius: 10, brightness: 5, soundset: '', sound: null, range: 300, startOff: false, when: { kind: '' } });
    const re = () => { ch(); S.commit(); I.render(); };
    const snd = el('div', { class: 'btn-row' });
    if (f.soundset === '@file') {
      if (f.sound) snd.append(el('span', { class: 'dlg-fname' }, '🔊 ' + f.sound.name), el('button', { class: 'btn sm', onclick: () => DS.Sounds.play(f.sound) }, '▶'), el('button', { class: 'btn sm', onclick: () => { f.sound = null; re(); } }, 'Remove'));
      else {
        const file = el('input', { type: 'file', accept: DS.Sounds.ACCEPT, class: 'hidden' });
        file.addEventListener('change', async () => {
          if (!file.files[0]) return;
          try { f.sound = await DS.Sounds.upload(file.files[0]); re(); } catch (e) { DS.toast(String(e.message || e), 'error', 6000); }
        });
        snd.append(file, el('button', { class: 'btn sm', onclick: () => file.click() }, '🎙 Choose a sound file (.ogg / .wav)…'));
      }
    }
    return section('Effect',
      row('Particles', selectInp(f.particle, DS.FX_PARTICLES, (v) => { f.particle = v; re(); })),
      f.particle ? row('Replay every (s)', numInp(f.repeat, (v) => { f.repeat = Math.max(0, v); ch(); }, { min: 0, step: 0.5 }), '0 = play once and let it loop itself (fire, smoke, gas). Sparks and explosions are one-shots: give them a few seconds.') : null,
      checkInp(f.light, (v) => { f.light = v; re(); }, 'Light'),
      f.light ? row('Light colour', (() => { const i = el('input', { type: 'color', value: f.color || '#ffaa55' }); i.addEventListener('input', () => { f.color = i.value; ch(); }); i.addEventListener('change', () => S.commit()); return i; })()) : null,
      f.light ? row('Light radius (m)', numInp(f.radius, (v) => { f.radius = Math.max(1, v); ch(); }, { min: 1 })) : null,
      f.light ? row('Brightness', numInp(f.brightness, (v) => { f.brightness = Math.max(0.1, v); ch(); }, { min: 0.1, step: 0.5 })) : null,
      row('Sound (loops)', selectInp(f.soundset, DS.FX_SOUNDS, (v) => { f.soundset = v; re(); })),
      f.soundset === '@file' ? snd : null,
      row('Range (m)', numInp(f.range, (v) => { f.range = Math.max(10, v); ch(); }, { min: 10, step: 10 }), 'Players closer than this see and hear it.'),
      checkInp(f.startOff, (v) => { f.startOff = v; re(); }, 'Starts off — a “Turn Effect On / Off” quest node switches it on'),
      el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Only while'),
        DS.Cond.widget(f.when || (f.when = { kind: '' }), { onChange: ch, redraw: () => I.render() })),
      el('div', { class: 'ins-help' }, 'Checked for each player on their own: “Player stat”, “quest done” or “NOT quest done” conditions phase the effect in or out per player. Played by the quest mod on each player’s PC (Export ▸ Build installable mod). Test it with “Test this exact mod” or the local server.'));
  }

  /** NPC outfit presets + a random casual look */
  function outfitWidget(p, rerender, ch) {
    const wrap = el('div', { class: 'btn-row' });
    const sel = el('select', { class: 'inp' });
    sel.append(el('option', { value: '' }, 'Dress as…'));
    DS.NPC_OUTFITS.forEach((o) => sel.append(el('option', { value: o.id }, o.name)));
    const apply = (gear, hands, label) => {
      const had = (p.gear || []).some((i) => String(i.c).trim()) || p.hands;
      if (had && !confirm(`Replace this NPC’s clothing and hand item with “${label}”?`)) { sel.value = ''; return; }
      p.gear = gear.map((c) => ({ c, n: 1, chance: 1 }));
      p.hands = hands;
      ch(); S.commit(); rerender();
    };
    sel.addEventListener('change', () => {
      const o = DS.NPC_OUTFITS.find((x) => x.id === sel.value);
      if (o) apply(o.gear, o.hands, o.name);
    });
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const random = el('button', { class: 'btn sm', title: 'A random casual outfit (and a random face if you like)', onclick: () => {
      const tops = ['TShirt_Beige', 'TShirt_Black', 'TShirt_Blue', 'TShirt_Green', 'TShirt_Red', 'Hoodie_Black', 'Hoodie_Brown', 'Hoodie_Grey', 'Hoodie_Green', 'Shirt_BlueCheck', 'Shirt_RedCheck', 'Shirt_WhiteCheck', 'BomberJacket_Olive', 'BomberJacket_Brown', 'QuiltedJacket_Blue', 'QuiltedJacket_Green', 'LeatherJacket_Brown', 'Raincoat_Green', 'M65Jacket_Khaki'];
      const legs = ['Jeans_Blue', 'Jeans_Black', 'Jeans_Grey', 'Jeans_BlueDark', 'CargoPants_Beige', 'CargoPants_Grey', 'CargoPants_Green', 'Breeches_Beige', 'Breeches_Browncheck'];
      const feet = ['Sneakers_Black', 'Sneakers_Gray', 'Sneakers_White', 'HikingBootsLow_Blue', 'HikingBootsLow_Beige', 'WorkingBoots_Brown', 'Wellies_Black', 'CombatBoots_Grey', 'LeatherShoes_Brown'];
      const heads = ['', '', 'BaseballCap_Red', 'BaseballCap_Black', 'BoonieHat_Olive', 'FlatCap_Grey', 'Ushanka_Black', 'Bandana_Blue'];
      const gear = [pick(tops), pick(legs), pick(feet), pick(heads)].filter(Boolean);
      apply(gear, '', 'a random outfit');
    } }, '🎲 Random outfit');
    wrap.append(sel, random);
    return wrap;
  }

  function fieldWidget(f, n, rerender) {
    const p = n.p;
    const ch = () => S.changed('quests');
    switch (f.t) {
      case 'text': return row(f.label, textInp(p[f.k], (v) => { p[f.k] = v; ch(); }));
      case 'area': return row(f.label, areaInp(p[f.k], (v) => { p[f.k] = v; ch(); }, 3));
      case 'code': return el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, f.label),
        DS.Code.field({ value: p[f.k], rows: 9, mode: 'action', title: 'Custom Script - ' + (S.activeQuestObj() ? S.activeQuestObj().name : ''),
          vars: [['player', 'PlayerBase', 'the player the quest runs for'], ['pos', 'vector', '0 0 0 unless set by code']],
          onInput: (v) => { p[f.k] = v; ch(); }, onChange: () => S.commit() }),
        el('span', { class: 'ins-help' }, 'Compiled into the quest mod. A mistake here stops ALL quest scripts loading - test it with ⌨ Console ▸ ▶ Compile on local server.'));
      case 'num': return row(f.label, numInp(p[f.k], (v) => { p[f.k] = v; ch(); }, { min: f.min, max: f.max }));
      case 'bool': return el('div', { class: 'ins-row' }, checkInp(p[f.k], (v) => { p[f.k] = v; ch(); rerender(); }, f.label));
      case 'select': return row(f.label, selectInp(p[f.k], f.opts, (v) => { p[f.k] = v; ch(); rerender(); }));
      case 'cls': return row(f.label, textInp(p[f.k], (v) => { p[f.k] = v; ch(); }, { list: f.list || 'dz-classes' }),
        f.list === 'dz-npcs' ? 'Pick one of the game’s survivor characters (M = male, F = female), or enter any class.'
          : f.list === 'dz-hands' ? 'Optional. A weapon or tool the NPC holds (no ammo is given). Leave empty for empty hands.'
            : 'Type to search known class names, or enter any class.');
      case 'fxpick': {
        const fxs = S.project.objects.filter((o) => o.kind === 'fx');
        if (!fxs.length) return row(f.label, el('span', { class: 'ins-help' }, 'Place an effect first (asset list ▸ Effects & sounds).'));
        return row(f.label, selectInp(p[f.k], [['', 'Pick an effect…']].concat(fxs.map((o) => [o.id, (o.label || 'Effect') + ' @ ' + Math.round(o.x) + ', ' + Math.round(o.z)])), (v) => { p[f.k] = v; ch(); rerender(); }));
      }
      case 'objpick': {
        const objs = S.project.objects.filter((o) => ['building', 'prop', 'item', 'vehicle'].includes(o.kind));
        if (!objs.length) return row(f.label, el('span', { class: 'ins-help' }, 'Place an object first (a gate, door, locker, terminal…).'));
        const cur = S.obj(p[f.k]);
        return row(f.label, el('div', { class: 'btn-row' },
          selectInp(p[f.k], [['', 'Pick an object…']].concat(objs.map((o) => [o.id, (o.label || o.c) + ' @ ' + Math.round(o.x) + ', ' + Math.round(o.z)])), (v) => { p[f.k] = v; ch(); rerender(); }),
          cur ? el('button', { class: 'btn', title: 'Show on the map', onclick: () => { if (DS.MapView && DS.MapView.centerOn) DS.MapView.centerOn(cur.x, cur.z); } }, '⌖') : null),
          'The player must stand within reach and look at it.');
      }
      case 'patrol': {
        // waypoints [{x, z}]: picked on the map one after another, the NPC walks them from its own position
        const pts = Array.isArray(p[f.k]) ? p[f.k] : (p[f.k] = []);
        const done = () => { ch(); S.commit(); S.structure(); rerender(); };
        const list = el('div', { class: 'patrol-list' }, pts.map((pt, i) => el('div', { class: 'btn-row' },
          el('span', { class: 'mono' }, `${i + 1}.  ${Math.round(pt.x)}, ${Math.round(pt.z)}`),
          el('button', { class: 'btn sm', title: 'Show it on the map', onclick: () => DS.MapView.centerOn(pt.x, pt.z, 1.5) }, '⌖'),
          el('button', { class: 'btn sm', title: 'Remove this waypoint', onclick: () => { pts.splice(i, 1); done(); } }, '✕'))));
        const add = el('button', { class: 'btn sm primary', onclick: () => DS.pickPosition({ multi: true, prompt: 'Click the map for each waypoint, in walking order  (Esc when done)' }, (r) => {
          pts.push({ x: r.x, z: r.z });
          ch(); S.commit(); S.structure();
        }) }, pts.length ? '+ Add waypoints' : '+ Draw a patrol route');
        const clear = pts.length ? el('button', { class: 'btn sm', onclick: () => { p[f.k] = []; done(); } }, 'Clear') : null;
        return el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, f.label), list, el('div', { class: 'btn-row' }, add, clear), el('span', { class: 'ins-help' }, f.help));
      }
      case 'npcpick': return DS.Npcs.pickWidget(f, n, rerender);
      case 'traderpick': {
        const tl = DS.Traders ? DS.Traders.list() : [];
        const btn = el('button', { class: 'btn sm', onclick: () => DS.Stats && DS.Stats.open('traders') }, '🛒 Traders…');
        if (!tl.length) return row(f.label, el('div', {}, el('span', { class: 'ins-help' }, 'No traders yet. '), btn), f.help);
        return row(f.label, el('div', { class: 'btn-row' }, selectInp(p[f.k] || '', [['', 'None']].concat(tl.map((t) => [t.id, t.name || t.id])), (v) => { p[f.k] = v; ch(); rerender(); }), btn), f.help);
      }
      case 'factionpick': {
        const fl = (S.project.factions && S.project.factions.list) || [];
        const btn = el('button', { class: 'btn sm', onclick: () => DS.Stats && DS.Stats.open('factions') }, '🏳 Factions…');
        if (!fl.length) return row(f.label, el('div', {}, el('span', { class: 'ins-help' }, 'No factions yet. '), btn));
        return row(f.label, el('div', { class: 'btn-row' }, selectInp(p[f.k], [['', f.k === 'faction' && (n.type === 'trg_npc' || n.type === 'npc') ? 'None' : 'Pick a faction…']].concat(fl.map((x) => [x.id, x.name || x.id])), (v) => { p[f.k] = v; ch(); rerender(); }), btn), f.help);
      }
      case 'statpick': {
        const sts = S.project.stats || [];
        if (!sts.length) return row(f.label, el('div', {}, el('span', { class: 'ins-help' }, 'No stats yet. '), el('button', { class: 'btn', onclick: () => DS.Stats && DS.Stats.open() }, '📊 Make XP, reputation…')));
        return row(f.label, selectInp(p[f.k], [['', 'Pick a stat…']].concat(sts.map((st) => [st.id, st.name || st.id])), (v) => { p[f.k] = v; ch(); rerender(); }));
      }
      case 'cond': {
        if (!p[f.k]) p[f.k] = { kind: '' };
        return el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, f.label),
          DS.Cond.widget(p[f.k], { kinds: f.kinds === 'world' ? DS.Cond.WORLD : null, onChange: ch, redraw: rerender }),
          f.help ? el('span', { class: 'ins-help' }, f.help) : null);
      }
      case 'var': {
        DS.Cond.varNames();
        const i = textInp(p[f.k], (v) => { p[f.k] = v.replace(/[^A-Za-z0-9_]/g, ''); ch(); }, { list: 'dz-vars', ph: 'e.g. bandits_defeated' });
        return row(f.label, i, 'Letters, digits and _ only. The same name in any quest means the same variable. New variables start at 0.');
      }
      case 'outfit': return row(f.label, outfitWidget(p, rerender, ch),'Fills the clothing list and the item in hands — edit them afterwards as you like.');
      case 'classes': return row(f.label, classesWidget(p[f.k], ch));
      case 'items': return row(f.label, itemsWidget(p[f.k], ch, f.chance));
      case 'pos': return row(f.label, posWidget(p, f.k, ch), f.help);
      case 'dialog': {
        const sum = el('span', { class: 'ins-help' }, DS.Dialog.summary(p));
        return el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, f.label),
          el('button', { class: 'btn primary', onclick: () => DS.Dialog.open(n, () => { ch(); sum.textContent = DS.Dialog.summary(p); }) }, '💬 Edit conversation…'), sum,
          el('span', { class: 'ins-help' }, 'Skyrim-style: the camera moves to the NPC, text appears with reply options, optional voice files play with each line.'));
      }
    }
    return el('div');
  }

  /** quest chains: copy the NPC of another quest so both quests share one character in game */
  function sameNpcRow(q, n, redraw) {
    const others = [];
    S.project.quests.forEach((oq) => oq.nodes.forEach((on) => { if (on.type === 'trg_npc' && on !== n) others.push([oq, on]); }));
    if (!others.length) return el('div');
    const sel = el('select', { class: 'inp' });
    sel.append(el('option', { value: '' }, 'Use the same NPC as…'));
    others.forEach(([oq, on], i) => sel.append(el('option', { value: i }, `${on.p.name || on.p.npc} — ${oq.name}`)));
    sel.addEventListener('change', () => {
      if (sel.value === '') return;
      const src = others[+sel.value][1].p;
      n.p.npc = src.npc; n.p.name = src.name; n.p.yaw = src.yaw;
      n.p.pos = JSON.parse(JSON.stringify(src.pos));
      n.p.gear = JSON.parse(JSON.stringify(src.gear || []));
      n.p.hands = src.hands || '';
      S.changed('quests'); S.commit(); redraw();
      DS.toast(`Same NPC as in “${others[+sel.value][0].name}” — in game it is one character who talks about both quests.`, 'ok', 4000);
    });
    return row('Quest chain', sel, 'Copies class, name, position, outfit and hand item. NPCs of the same class standing at the same spot become one character in game.');
  }

  function nodeInspector(q, n) {
    const T = DS.NODE_TYPES[n.type];
    const box = el('div', { class: 'ins-body' });
    function draw() {
      box.innerHTML = '';
      box.append(
        el('div', { class: 'ins-head cat-' + T.cat }, el('span', { class: 'ne-icon' }, T.icon), el('div', null, el('div', { class: 'ins-title' }, T.title), el('div', { class: 'ins-sub' }, DS.NODE_CATS[T.cat].name))),
        el('p', { class: 'ins-desc' }, T.desc),
        ...(T.custom && !T.missing ? [el('div', { class: 'btn-row pad' }, el('button', { class: 'btn sm', onclick: () => DS.CustomNodes.wizard(n.type) }, '✎ Edit this node type'), el('button', { class: 'btn sm', onclick: () => DS.Console.open() }, '⌨ Console'))] : [])
      );
      const fs = el('div', { class: 'ins-sec' });
      if (n.type === 'trg_npc' && !n.p.npcId) fs.append(sameNpcRow(q, n, draw));
      T.fields.forEach((f) => {
        if (f.show && !f.show(n.p)) return;
        fs.append(fieldWidget(f, n, draw));
      });
      if (!T.fields.length) fs.append(el('div', { class: 'muted' }, 'No settings — this node just controls the flow.'));
      box.append(fs);
      const issues = (DS.validateQuest ? DS.validateQuest(q) : {})[n.id] || [];
      if (issues.length) box.append(section('Problems', issues.map((i) => el('div', { class: 'issue ' + i.level }, i.msg))));
      box.append(el('div', { class: 'ins-sec' }, el('button', { class: 'btn danger', onclick: () => DS.actions.deleteSelection() }, 'Delete node')));
    }
    draw();
    return box;
  }

  /* ---------- object form ---------- */
  function objectInspector(objs) {
    const box = el('div', { class: 'ins-body' });
    if (objs.length > 1) {
      const sx = (k, v) => objs.forEach((o) => (o[k] = v));
      box.append(
        el('div', { class: 'ins-head' }, el('div', null, el('div', { class: 'ins-title' }, `${objs.length} objects selected`), el('div', { class: 'ins-sub' }, 'Bulk edit'))),
        section('Transform',
          el('div', { class: 'btn-row' },
            el('button', { class: 'btn sm', onclick: () => DS.actions.rotate(-15) }, '⟲ −15°'),
            el('button', { class: 'btn sm', onclick: () => DS.actions.rotate(15) }, '⟳ +15°'),
            el('button', { class: 'btn sm', onclick: () => DS.actions.rotate(90) }, '+90°')),
          row('Set height Y (all)', numInp('', (v) => { sx('y', v); S.changed('objects'); }, { step: 1 })),
          row('Scale (all)', numInp(1, (v) => { sx('scale', Math.max(0.1, v)); S.changed('objects'); }, { step: 0.1 }))),
        section('Organise',
          el('div', { class: 'btn-row' },
            el('button', { class: 'btn sm', title: 'Save the selected objects as a reusable stamp in your prefab library', onclick: () => DS.Stamps.saveSelection() }, '⭐ Save as prefab stamp…'),
            el('button', { class: 'btn sm', onclick: DS.actions.group }, 'Group'),
            el('button', { class: 'btn sm', onclick: DS.actions.ungroup }, 'Ungroup'),
            el('button', { class: 'btn sm', onclick: DS.actions.duplicate }, 'Duplicate'),
            el('button', { class: 'btn sm danger', onclick: DS.actions.deleteSelection }, 'Delete')))
      );
      return box;
    }
    const o = objs[0];
    const K = DS.KINDS[o.kind] || DS.KINDS.prop;
    const ch = () => S.changed('objects');
    const usage = S.usageOf(o.id);
    box.append(
      el('div', { class: 'ins-head' }, el('span', { class: 'dot', style: { background: K.color } }), el('div', null, el('div', { class: 'ins-title' }, o.label || U.pretty(o.c)), el('div', { class: 'ins-sub' }, o.c))),
      section('Identity',
        row('Class name', textInp(o.c, (v) => { o.c = v.trim(); ch(); }, { list: 'dz-classes' })),
        row('Label (editor only)', textInp(o.label, (v) => { o.label = v; ch(); })),
        row('Type', selectInp(o.kind, Object.keys(DS.KINDS).map((k) => [k, DS.KINDS[k].name]), (v) => { o.kind = v; S.structure(); }))),
      section('Transform',
        el('div', { class: 'posw-row' },
          el('div', { class: 'posw-c' }, el('span', null, 'X (E)'), numInp(o.x, (v) => { o.x = v; ch(); })),
          el('div', { class: 'posw-c' }, el('span', null, 'Y (up)'), numInp(o.y, (v) => { o.y = v; ch(); })),
          el('div', { class: 'posw-c' }, el('span', null, 'Z (N)'), numInp(o.z, (v) => { o.z = v; ch(); }))),
        el('div', { class: 'posw-row' },
          el('div', { class: 'posw-c' }, el('span', null, 'Yaw'), numInp(o.yaw, (v) => { o.yaw = U.wrap360(v); ch(); })),
          el('div', { class: 'posw-c' }, el('span', null, 'Pitch'), numInp(o.pitch, (v) => { o.pitch = v; ch(); })),
          el('div', { class: 'posw-c' }, el('span', null, 'Roll'), numInp(o.roll, (v) => { o.roll = v; ch(); }))),
        row('Scale', numInp(o.scale, (v) => { o.scale = Math.max(0.05, v); ch(); }, { step: 0.1 })),
        checkInp(o.snap, (v) => { o.snap = v; ch(); }, 'Snap to terrain at runtime (init.c / mod export)'),
        DS.Terrain && DS.Terrain.has()
          ? el('button', { class: 'btn sm', onclick: () => { o.y = U.round(DS.Terrain.heightAt(o.x, o.z), 2); ch(); S.commit(); S.structure(); } }, `Set Y from game terrain (${U.round(DS.Terrain.heightAt(o.x, o.z), 1)} m)`)
          : null,
        el('div', { class: 'ins-help' }, 'The editor has no terrain heights. Leave Y at 0 and keep “snap to terrain” on — the init.c and quest-framework exports place the object on the ground in-game. For the plain object-spawner JSON, enter a real Y.'))
    );
    if (o.kind === 'event')
      box.append(section('Event', row('Event name (cfgeventspawns)', textInp(o.event, (v) => { o.event = v.trim(); ch(); }, {}), 'Must match an event in events.xml')));
    if (o.kind === 'loot' || o.kind === 'prop') {
      box.append(section('Loot table (spawned inside this container)', itemsWidget(o.loot, ch, true), el('div', { class: 'ins-help' }, 'Each entry rolls its chance when the object is created (init.c export).')));
    }
    box.append(
      section('Custom init script (Enforce)',
        DS.Code.field({ value: o.init, rows: 5, mode: 'init', title: 'Init script - ' + (o.label || o.c),
          vars: [['obj', 'Object', 'the object that was just created']], onInput: (v) => { o.init = v; ch(); }, onChange: () => S.commit() }),
        el('div', { class: 'ins-help' }, 'Runs right after the object is created in init.c. Use the variable “obj”. Example: obj.SetLifetime(0);')),
      section('Organise',
        row('Group id', textInp(o.group, (v) => { o.group = v.trim(); ch(); }), 'Objects sharing a group move together and export as one event group.'),
        el('div', { class: 'chk-row' },
          checkInp(o.hidden, (v) => { o.hidden = v; ch(); }, 'Hidden'),
          checkInp(o.locked, (v) => { o.locked = v; ch(); }, 'Locked')),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn sm', onclick: DS.actions.duplicate }, 'Duplicate'),
          el('button', { class: 'btn sm', onclick: () => DS.MapView.focusSelection() }, 'Frame'),
          el('button', { class: 'btn sm danger', onclick: DS.actions.deleteSelection }, 'Delete')))
    );
    if (o.kind === 'fx') box.append(fxSection(o, ch));
    if (DS.Loot && (o.kind === 'building' || o.kind === 'prop')) {
      const hasProto = !!DS.Loot.proto(o.c);
      box.append(section('Loot spawns (Central Economy)',
        hasProto
          ? el('div', null,
              checkInp(!o.noLoot, (v) => { o.noLoot = !v; ch(); }, `Give this ${o.c} its loot points (${DS.Loot.pointCount(o.c)} points)`),
              el('div', { class: 'ins-help' }, 'Included in the exported mapgrouppos.xml so items spawn inside it.'))
          : el('div', null,
              el('div', { class: 'ins-help' }, 'This class has no loot definition, so nothing will spawn in it.'),
              el('button', { class: 'btn sm', onclick: () => { DS.Loot.newProto(o.c); S.commit(); S.structure(); } }, 'Create loot definition…'))));
    }
    if (usage.length)
      box.append(section('Used by quests', usage.map((u) => el('div', { class: 'usage', onclick: () => { S.activeQuest = u.quest.id; S.setView('quests'); S.select('node', [u.node.id]); } }, `${u.quest.name} → ${DS.NODE_TYPES[u.node.type].title}`))));
    return box;
  }

  /* ---------- quest + project forms ---------- */
  /** true when quest a (directly or through others) needs quest b */
  function needs(a, b, seen = new Set()) {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return (a.requires || []).some((id) => {
      if (id === b.id) return true;
      const x = S.project.quests.find((y) => y.id === id);
      return x ? needs(x, b, seen) : false;
    });
  }

  function chainSection(q, ch) {
    const others = S.project.quests.filter((x) => x.id !== q.id);
    const req = q.requires || [];
    const after = S.project.quests.filter((x) => (x.requires || []).includes(q.id));
    const body = [];
    if (!others.length) body.push(el('div', { class: 'ins-help' }, 'Add another quest to build a chain: a quest can unlock only after others are completed.'));
    else {
      body.push(el('div', { class: 'ins-help' }, 'Unlocks after these quests are completed (all of them). Until then its NPC uses the “Not available yet” conversation and its triggers do nothing.'));
      const list = el('div', { class: 'chain-list' });
      others.forEach((x) => {
        const loop = needs(x, q);   // x already needs q: requiring x here would make a loop
        const cb = checkInp(req.includes(x.id), (v) => {
          q.requires = v ? [...new Set([...(q.requires || []), x.id])] : (q.requires || []).filter((id) => id !== x.id);
          ch(); S.commit(); I.render();
        }, x.name + (loop ? '  (needs this quest — would loop)' : ''));
        if (loop && !req.includes(x.id)) cb.querySelector('input').disabled = true;
        list.append(cb);
      });
      body.push(list);
    }
    if (after.length) body.push(el('div', { class: 'chain-note' }, 'Unlocks next: ' + after.map((x) => x.name).join(', ')));
    return section('Quest chain', ...body);
  }

  function questInspector(q) {
    const ch = () => S.changed('quests');
    return el('div', { class: 'ins-body' },
      el('div', { class: 'ins-head' }, el('div', null, el('div', { class: 'ins-title' }, 'Quest settings'), el('div', { class: 'ins-sub' }, q.id))),
      section('Details',
        row('Quest name', textInp(q.name, (v) => { q.name = v; ch(); S.emit('structure'); })),
        row('Description (shown when it starts)', areaInp(q.description, (v) => { q.description = v; ch(); }, 4))),
      section('Behaviour',
        checkInp(q.repeatable, (v) => { q.repeatable = v; ch(); I.render(); }, 'Repeatable'),
        q.repeatable ? row('Cooldown (play-time seconds)', numInp(q.cooldown, (v) => { q.cooldown = Math.max(0, v); ch(); }, { min: 0 })) : null,
        checkInp(q.failOnDeath, (v) => { q.failOnDeath = v; ch(); }, 'Restart quest if the player dies')),
      chainSection(q, ch),
      section('Server condition',
        el('div', { class: 'ins-help' }, 'Optional: the quest is only available while this holds for the whole server - e.g. after a server variable was set by another quest, only at night, or only during a storm.'),
        DS.Cond.widget(q.avail || (q.avail = { kind: '' }), { kinds: DS.Cond.WORLD, label: 'Available', onChange: ch, redraw: () => I.render() })),
      section('Quest tools',
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn sm', onclick: () => { const c = JSON.parse(JSON.stringify(q)); c.id = U.uid('q'); c.name += ' (copy)'; const idm = {}; c.nodes.forEach((n) => { const o = n.id; n.id = U.uid('n'); idm[o] = n.id; }); c.links.forEach((l) => { l.id = U.uid('l'); l.from = idm[l.from]; l.to = idm[l.to]; }); S.project.quests.push(c); S.activeQuest = c.id; S.structure(); S.commit(); } }, 'Duplicate quest'),
          el('button', { class: 'btn sm danger', onclick: () => { if (confirm('Delete quest “' + q.name + '”?')) { S.deleteQuest(q.id); S.commit(); } } }, 'Delete quest')))
    );
  }

  function projectInspector() {
    const m = S.project.meta;
    const ch = () => S.changed('meta');
    const cur = S.world();
    const worldOpts = DS.WORLDS.map((w) => [w.id, DS.worldLabel(w)]).concat(cur.missing ? [[cur.id, cur.name]] : []);
    const worldSel = selectInp(m.world, worldOpts, (v) => {
      m.world = v;
      m.mapSize = S.world().size;
      S.structure();
      DS.MapView.fit();
      loadMapLayers(v);
    });
    const body = el('div', { class: 'ins-body' },
      el('div', { class: 'ins-head' }, el('div', null, el('div', { class: 'ins-title' }, 'Project'), el('div', { class: 'ins-sub' }, 'Nothing selected — click an object to edit it'))),
      section('Project',
        row('Name', textInp(m.name, (v) => { m.name = v; ch(); S.emit('meta'); })),
        row('Author', textInp(m.author, (v) => { m.author = v; ch(); }))),
      section('World',
        row('Map', worldSel),
        cur.installed === false ? el('div', { class: 'ins-help warn-text' }, cur.mod
          ? `${cur.name} isn't installed. You can still place things on it, but its imagery, loot and zones need the map - subscribe to it on the Steam Workshop (or put its @folder in your DayZ folder), let Steam download it, then reopen Studio.`
          : `${cur.name} isn't installed in your DayZ. You can still place things on it, but its imagery, the game view and play-testing need the map - install it through Steam (DLC maps: buy or download the DLC).`) : null,
        cur.installed && cur.modName ? el('div', { class: 'ins-help' }, `Found in your mods: ${cur.modName}.`) : null,
        cur.missing ? el('div', { class: 'ins-help warn-text' }, `This project was made for “${cur.id}”, a map this PC doesn't have. Its objects and quests are kept; install the map to see its imagery and test in game.`) : null,
        cur.installed && cur.server === false && !cur.mod ? el('div', { class: 'ins-help' }, `DayZ Server has no mission for ${cur.name} yet - update DayZ Server in Steam to test on a local server.`) : null,
        cur.installed && cur.mod && cur.missionFromMod && (cur.server === false || cur.missionOutdated) ? serverMissionButton(cur) : null,
        row('Map size (m)', numInp(m.mapSize, (v) => { m.mapSize = Math.max(512, v); ch(); DS.MapView.invalidate(); }, { step: 256 }), 'Square world side length in metres. Chernarus+ = 15360.'),
        row('Grid snap (m)', selectInp(m.snap, [[0, 'Off'], [1, '1 m'], [5, '5 m'], [10, '10 m'], [25, '25 m'], [50, '50 m']], (v) => { m.snap = +v; ch(); })),
        checkInp(m.showTerrain !== false, (v) => { m.showTerrain = v; ch(); DS.MapView.invalidate(); }, 'Show game terrain imagery'),
        checkInp(m.brighten !== false, (v) => { m.brighten = v; ch(); DS.MapView.invalidate(); }, 'Brighten terrain (the raw satellite is dark)'),
        el('div', { class: 'ins-help' }, { ok: '✔ Terrain imagery loaded for this map.', loading: 'Loading terrain…', none: 'No terrain imagery for this map yet. Extract it from your DayZ install (a few minutes, once), or load your own image below.' }[DS.MapView.terrainState()]),
        DS.MapView.terrainState() === 'none' && cur.installed !== false && !cur.missing ? extractMapsButton(cur) : null,
        checkInp(m.showTowns !== false, (v) => { m.showTowns = v; ch(); DS.MapView.invalidate(); }, 'Show town labels'),
        checkInp(m.showRef !== false, (v) => { m.showRef = v; ch(); DS.MapView.invalidate(); }, 'Show vanilla building layer (if imported)'),
        checkInp(!!m.showDensity, (v) => { m.showDensity = v; ch(); DS.MapView.invalidate(); I.render(); }, '🔥 Show performance heatmap (object density)'),
        m.showDensity ? densityPanel() : null),
      section('Map background',
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn sm', onclick: () => DS.app.loadBackground() }, 'Load image…'),
          el('button', { class: 'btn sm', onclick: () => { S.project.bg = null; S.changed('meta'); S.commit(); I.render(); } }, 'Clear')),
        S.project.bg ? row('Opacity', numInp(Math.round((S.project.bg.opacity == null ? 0.9 : S.project.bg.opacity) * 100), (v) => { S.project.bg.opacity = U.clamp(v, 5, 100) / 100; DS.MapView.invalidate(); S.changed('meta'); }, { min: 5, max: 100, step: 5 }), '%') : null,
        el('div', { class: 'ins-help' }, 'Use a top-down map image covering the whole map (e.g. a satellite export from iZurvive or your own render). It is stretched over 0–map size.')),
      DS.Mods ? DS.Mods.section(() => I.render()) : null,
      section('Export naming',
        row('Mod / folder name', textInp(m.modName, (v) => { m.modName = U.safeName(v); ch(); }), 'Used for the quest framework mod and file names.')),
      removedSection()
    );
    return body;
  }

  /** hotspots of the performance heatmap */
  /** "Extract map imagery": runs tools/extract_maps.py on the studio server against the user's own DayZ install */
  let mapsBusy = false;

  // the loot and zone layers belong to the map: load the new map's (fresh = again, e.g. right after extracting it)
  function loadMapLayers(world, fresh) {
    if (DS.Loot) { if (fresh) DS.Loot.loadedWorld = null; DS.Loot.load(world).then(() => S.emit('loot')); }
    if (DS.Zones) { if (fresh) DS.Zones.loadedWorld = null; DS.Zones.load(world).then(() => DS.MapView.invalidate()); }
  }

  /** a mod map's server mission: DayZ Server has none, but the map mod brings its files - unpack them into
   *  DayZServer/mpmissions (or update one Studio installed, after a mod update; the old one is backed up) */
  function serverMissionButton(w) {
    const update = !!w.missionOutdated;
    const btn = el('button', { class: 'btn sm' + (update ? '' : ' primary'), onclick: async () => {
      btn.disabled = true;
      btn.textContent = 'Installing…';
      const r = await fetch('/api/server/mission/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ world: w.id, update }) })
        .then((x) => x.json()).catch(() => ({ ok: false, error: 'studio server not running' }));
      if (!r.ok) {
        DS.toast(r.error || 'Could not install the server mission', 'error', 8000);
        btn.disabled = false;
        btn.textContent = update ? '⟳ Update server mission' : '⬇ Install server mission';
        return;
      }
      DS.toast(`Server mission ${r.mission} installed - ${w.name} can now run on the local test server.`, 'ok', 7000);
      await DS.loadWorlds();
      I.render();
    } }, update ? '⟳ Update server mission' : '⬇ Install server mission');
    return el('div', { class: 'ins-row' },
      el('div', { class: 'ins-help' }, update
        ? `${w.modName} was updated since Studio installed its server mission. Updating puts the new mission files in place (the old mission folder is kept in Studio's server folder, mission_backups).`
        : `DayZ Server has no mission for ${w.name}, but ${w.modName} brings one. Install it to test on the local server - Studio copies the map's own mission files into DayZServer\\mpmissions.`),
      btn);
  }

  function extractMapsButton(w) {
    const line = el('div', { class: 'ins-help' }, mapsBusy ? 'Extracting… (keep Studio open)' : '');
    // a map the server found is extracted on its own (the others are not redone); otherwise every map
    const one = w && w.installed ? w.id : '';
    const btn = el('button', { class: 'btn sm primary', disabled: mapsBusy, onclick: async () => {
      const r = await fetch('/api/maps/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(one ? { world: one } : {}) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'studio server not running' }));
      if (!r.ok) return DS.toast(r.error || 'Could not start', 'error', 5000);
      mapsBusy = true;
      btn.disabled = true;
      for (;;) {
        await new Promise((res) => setTimeout(res, 1000));
        const s = await fetch('/api/maps/status', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
        if (!s) continue;
        line.textContent = (s.log || []).slice(-1)[0] || 'Extracting…';
        if (s.running) continue;
        mapsBusy = false;
        if (s.done) {
          DS.toast('Map imagery, loot and zones extracted.', 'ok', 6000);
          DS.MapView.reloadTerrain();
          loadMapLayers(S.project.meta.world, true);
          const cw = S.world();
          if (one && cw.id === one) cw.imagery = true;
        } else DS.toast('Extraction failed: ' + ((s.log || []).slice(-1)[0] || 'unknown error'), 'error', 8000);
        I.render();
        return;
      }
    } }, one ? `⬇ Extract ${w.name} imagery from DayZ` : '⬇ Extract map imagery from DayZ');
    return el('div', { class: 'ins-row' }, btn, line);
  }

  function densityPanel() {
    const D = DS.Density, c = D.compute();
    const kids = [el('div', { class: 'ins-help' }, `Weighted objects within ${D.RADIUS} m (DayZ's near network range): buildings count most, loot points a little. Green < ${D.WARN} · yellow < ${D.HIGH} · orange < ${D.DANGER} · red above. A rule of thumb to spot crowded areas before they cost FPS or cause desync.`)];
    if (!c.spots.length) kids.push(el('div', { class: 'ins-help' }, '✔ No crowded areas.'));
    c.spots.forEach((s) => kids.push(el('div', { class: 'removed-row' },
      el('span', { class: 'removed-name dens-' + D.level(s.score) }, `${s.score} · ${D.label(s.score)}`),
      el('span', { class: 'muted' }, `${s.count} obj${s.buildings ? ', ' + s.buildings + ' bldg' : ''}`),
      el('button', { class: 'btn sm', title: 'Show it on the map', onclick: () => DS.MapView.centerOn(s.x, s.z, 1.2) }, '⌖'), el('span'))));
    return el('div', { class: 'dens-panel' }, ...kids);
  }

  /** vanilla map objects removed in this project */
  function removedSection() {
    const L = DS.MapEdits ? DS.MapEdits.list() : [];
    const kids = [];
    if (!L.length) {
      kids.push(el('div', { class: 'ins-help' }, 'None. In the 3D tab use “✂ Remove map objects” to take vanilla trees, rocks, walls or buildings off the map. The exported mod hides them on the server and for every player.'));
    } else {
      kids.push(el('div', { class: 'ins-help' }, `${L.length} object(s) hidden by the exported mod (Build installable mod). Players need the mod; plain init.c exports cannot hide map objects for them.`));
      const list = el('div', { class: 'removed-list' });
      L.slice(0, 200).forEach((r, i) => list.append(el('div', { class: 'removed-row' },
        el('span', { class: 'removed-name', title: (r.c || '') + ' ' + (r.model || '') }, DS.MapEdits.name(r)),
        el('span', { class: 'muted' }, `${Math.round(r.x)}, ${Math.round(r.z)}`),
        el('button', { class: 'btn sm', title: 'Show it on the map', onclick: () => { DS.MapView.centerOn(r.x, r.z, 2.5); if (DS.View3D && S.view === 'view3d') DS.View3D.focus(r.x, r.z, 80); } }, '⌖'),
        el('button', { class: 'btn sm', title: 'Put it back', onclick: () => DS.MapEdits.restore([i]) }, 'Restore'))));
      if (L.length > 200) list.append(el('div', { class: 'muted' }, `… and ${L.length - 200} more`));
      kids.push(list, el('div', { class: 'btn-row' }, el('button', { class: 'btn sm danger', onclick: () => { if (confirm(`Put all ${L.length} removed map objects back?`)) DS.MapEdits.restore(L.map((r, i) => i)); } }, 'Restore all')));
    }
    return section(`Removed map objects (${L.length})`, ...kids);
  }

  function linkInspector() {
    return el('div', { class: 'ins-body' },
      el('div', { class: 'ins-head' }, el('div', { class: 'ins-title' }, 'Connection')),
      el('p', { class: 'ins-desc' }, 'This wire passes control from one node to the next. Right-click a wire (or press Delete) to remove it.'),
      el('div', { class: 'ins-sec' }, el('button', { class: 'btn danger', onclick: DS.actions.deleteSelection }, 'Delete connection')));
  }

  /* ---------- main render ---------- */
  I.render = function () {
    if (!root) return;
    root.innerHTML = '';
    const q = S.activeQuestObj();
    const extra = DS.Hooks ? DS.Hooks.collect('inspector', { sel: S.sel, view: S.view })[0] : null;   // an add-on's own selection or view
    let content;
    if (S.sel.kind === 'object') {
      const objs = S.sel.ids.map((i) => S.obj(i)).filter(Boolean);
      content = objs.length ? objectInspector(objs) : projectInspector();
    } else if (S.sel.kind === 'node' && q) {
      const n = S.node(q, S.sel.ids[0]);
      content = n ? nodeInspector(q, n) : projectInspector();
    } else if (S.sel.kind === 'zone' && DS.Zones) {
      const zs = DS.Zones.get(S.sel.ids[0]);
      content = zs ? DS.Zones.inspector(zs) : projectInspector();
    } else if (S.sel.kind === 'loot' && DS.Loot) {
      const inst = DS.Loot.byId.get(S.sel.ids[0]);
      content = inst ? DS.Loot.inspector(inst) : projectInspector();
    } else if (S.sel.kind === 'bnode' && DS.Npcs) {
      const n = DS.Npcs.selectedNode();
      content = n ? DS.Npcs.nodeInspector(n) : projectInspector();
    } else if (S.sel.kind === 'npc' && DS.Npcs && DS.Npcs.get(S.sel.ids[0])) content = DS.Npcs.inspector(DS.Npcs.get(S.sel.ids[0]));
    else if (S.sel.kind === 'link' || S.sel.kind === 'blink') content = linkInspector();
    else if (extra) content = extra;
    else if (S.view === 'npcs' && DS.Npcs && DS.Npcs.active()) content = DS.Npcs.inspector(DS.Npcs.active());
    else if (S.view === 'quests' && q) content = questInspector(q);
    else content = projectInspector();
    root.append(content);
  };

  // the form helpers, for other panels that edit settings the same way (NPCs)
  I.fieldWidget = (f, n, rerender) => fieldWidget(f, n, rerender);
  I.section = section;
  I.checkInp = checkInp;

  I.init = function (container) {
    root = container;
    DS.refreshClassList();
    S.on('selection', I.render);
    S.on('structure', I.render);
    S.on('view', I.render);
    S.on('project', I.render);
    S.on('terrain', I.render);
    S.on('mapedits', () => { if (!S.sel.kind) I.render(); });
    I.render();
  };
})();
