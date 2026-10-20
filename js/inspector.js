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
      case 'code': return row(f.label, areaInp(p[f.k], (v) => { p[f.k] = v; ch(); }, 8, true), 'Inserted as-is into the generated script. A syntax error will stop the quest scripts from compiling.');
      case 'num': return row(f.label, numInp(p[f.k], (v) => { p[f.k] = v; ch(); }, { min: f.min, max: f.max }));
      case 'bool': return el('div', { class: 'ins-row' }, checkInp(p[f.k], (v) => { p[f.k] = v; ch(); rerender(); }, f.label));
      case 'select': return row(f.label, selectInp(p[f.k], f.opts, (v) => { p[f.k] = v; ch(); rerender(); }));
      case 'cls': return row(f.label, textInp(p[f.k], (v) => { p[f.k] = v; ch(); }, { list: f.list || 'dz-classes' }),
        f.list === 'dz-npcs' ? 'Pick one of the game’s survivor characters (M = male, F = female), or enter any class.'
          : f.list === 'dz-hands' ? 'Optional. A weapon or tool the NPC holds (no ammo is given). Leave empty for empty hands.'
            : 'Type to search known class names, or enter any class.');
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
        el('p', { class: 'ins-desc' }, T.desc)
      );
      const fs = el('div', { class: 'ins-sec' });
      if (n.type === 'trg_npc') fs.append(sameNpcRow(q, n, draw));
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
        areaInp(o.init, (v) => { o.init = v; ch(); }, 4, true),
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
    const worldSel = selectInp(m.world, DS.WORLDS.map((w) => [w.id, w.name]), (v) => {
      m.world = v;
      m.mapSize = S.world().size;
      S.structure();
      DS.MapView.fit();
    });
    const body = el('div', { class: 'ins-body' },
      el('div', { class: 'ins-head' }, el('div', null, el('div', { class: 'ins-title' }, 'Project'), el('div', { class: 'ins-sub' }, 'Nothing selected — click an object to edit it'))),
      section('Project',
        row('Name', textInp(m.name, (v) => { m.name = v; ch(); S.emit('meta'); })),
        row('Author', textInp(m.author, (v) => { m.author = v; ch(); }))),
      section('World',
        row('Map', worldSel),
        row('Map size (m)', numInp(m.mapSize, (v) => { m.mapSize = Math.max(512, v); ch(); DS.MapView.invalidate(); }, { step: 256 }), 'Square world side length in metres. Chernarus+ = 15360.'),
        row('Grid snap (m)', selectInp(m.snap, [[0, 'Off'], [1, '1 m'], [5, '5 m'], [10, '10 m'], [25, '25 m'], [50, '50 m']], (v) => { m.snap = +v; ch(); })),
        checkInp(m.showTerrain !== false, (v) => { m.showTerrain = v; ch(); DS.MapView.invalidate(); }, 'Show game terrain imagery'),
        checkInp(m.brighten !== false, (v) => { m.brighten = v; ch(); DS.MapView.invalidate(); }, 'Brighten terrain (the raw satellite is dark)'),
        el('div', { class: 'ins-help' }, { ok: '✔ Terrain imagery loaded for this map.', loading: 'Loading terrain…', none: 'No terrain imagery for this map yet. Run tools/extract_maps.py (reads your DayZ install), or load your own image below.' }[DS.MapView.terrainState()]),
        checkInp(m.showTowns !== false, (v) => { m.showTowns = v; ch(); DS.MapView.invalidate(); }, 'Show town labels'),
        checkInp(m.showRef !== false, (v) => { m.showRef = v; ch(); DS.MapView.invalidate(); }, 'Show vanilla building layer (if imported)')),
      section('Map background',
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn sm', onclick: () => DS.app.loadBackground() }, 'Load image…'),
          el('button', { class: 'btn sm', onclick: () => { S.project.bg = null; S.changed('meta'); S.commit(); I.render(); } }, 'Clear')),
        S.project.bg ? row('Opacity', numInp(Math.round((S.project.bg.opacity == null ? 0.9 : S.project.bg.opacity) * 100), (v) => { S.project.bg.opacity = U.clamp(v, 5, 100) / 100; DS.MapView.invalidate(); S.changed('meta'); }, { min: 5, max: 100, step: 5 }), '%') : null,
        el('div', { class: 'ins-help' }, 'Use a top-down map image covering the whole map (e.g. a satellite export from iZurvive or your own render). It is stretched over 0–map size.')),
      section('Export naming',
        row('Mod / folder name', textInp(m.modName, (v) => { m.modName = U.safeName(v); ch(); }), 'Used for the quest framework mod and file names.')),
      removedSection()
    );
    return body;
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
    } else if (S.sel.kind === 'link') content = linkInspector();
    else if (S.view === 'quests' && q) content = questInspector(q);
    else content = projectInspector();
    root.append(content);
  };

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
