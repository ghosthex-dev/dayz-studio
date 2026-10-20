/* DayZ Studio - custom node blocks made from Enforce Script snippets.
   def = { id: 'cna_xxx' (action) | 'cno_xxx' (check = objective), title, icon, desc, kind: 'action' | 'check',
           objText: 'Reach {height} m', params: [{ k, label, t: num|int|text|cls|bool|pos, def }], code }
   Definitions live in a library (Documents/DayZStudio/Nodes, shared by every project) and a copy goes into the
   project as soon as one of its nodes is used (project.customNodes), so the project builds on any PC.
   The exporter turns each into a static function in DSCustom.c; the runtime calls it with the node's settings. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const N = (DS.CustomNodes = {});

  N.lib = [];   // library definitions
  const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'The studio server is not running.' }));

  N.PTYPES = [['num', 'Number', 'float'], ['int', 'Whole number', 'int'], ['text', 'Text', 'string'], ['cls', 'Class name', 'string'], ['bool', 'Yes / no', 'bool'], ['pos', 'Map position', 'vector']];
  const etype = (t) => (N.PTYPES.find((p) => p[0] === t) || N.PTYPES[0])[2];
  N.etype = etype;
  /** replace a node's children (arrays flattened, null skipped - like el()) */
  const fill = (node, ...kids) => {
    node.replaceChildren();
    kids.flat(Infinity).forEach((k) => { if (k != null && k !== false) node.append(k.nodeType ? k : String(k)); });
  };
  const isCustom = (type) => /^cn[ao]_/.test(type || '');
  N.isCustom = isCustom;

  N.EXAMPLES = [
    { title: 'Set Player Health', icon: '❤', kind: 'action', desc: 'Sets the player’s health (0–100).', params: [{ k: 'amount', label: 'Health', t: 'num', def: 100 }],
      code: 'player.SetHealth("", "", amount);' },
    { title: 'Spawn Custom Vehicle', icon: '🚗', kind: 'action', desc: 'Spawns a vehicle with its parts, fuel and fluids at a map position.',
      params: [{ k: 'vehicle', label: 'Vehicle class', t: 'cls', def: 'OffroadHatchback' }, { k: 'where', label: 'Spawn at', t: 'pos', def: null },
        { k: 'parts', label: 'Parts (comma separated)', t: 'text', def: 'HatchbackWheel,HatchbackWheel,HatchbackWheel,HatchbackWheel,HatchbackDoors_Driver,HatchbackDoors_CoDriver,HatchbackHood,HatchbackTrunk,CarBattery,CarRadiator,SparkPlug,HeadlightH7,HeadlightH7' }],
      code: 'EntityAI car = EntityAI.Cast(GetGame().CreateObjectEx(vehicle, where, ECE_PLACE_ON_SURFACE));\nif (!car)\n\treturn;\nTStringArray list = new TStringArray;\nparts.Split(",", list);\nforeach (string part : list)\n{\n\tpart.TrimInPlace();\n\tcar.GetInventory().CreateAttachment(part);\n}\nCar c = Car.Cast(car);\nif (c)\n{\n\tc.Fill(CarFluid.FUEL, c.GetFluidCapacity(CarFluid.FUEL));\n\tc.Fill(CarFluid.OIL, c.GetFluidCapacity(CarFluid.OIL));\n\tc.Fill(CarFluid.BRAKE, c.GetFluidCapacity(CarFluid.BRAKE));\n\tc.Fill(CarFluid.COOLANT, c.GetFluidCapacity(CarFluid.COOLANT));\n}' },
    { title: 'Teleport Player', icon: '✈', kind: 'action', desc: 'Moves the player to a map position.', params: [{ k: 'where', label: 'Destination', t: 'pos', def: null }],
      code: 'player.SetPosition(where);' },
    { title: 'Hold an Item', icon: '✋', kind: 'check', desc: 'Done when the player holds an item of a class in their hands.', objText: 'Hold a {cls} in your hands',
      params: [{ k: 'cls', label: 'Item class', t: 'cls', def: 'Flashlight' }],
      code: 'EntityAI inHands = player.GetHumanInventory().GetEntityInHands();\nif (!inHands)\n\treturn false;\nif (inHands.IsKindOf(cls))\n\treturn true;\nreturn false;' },
    { title: 'Climb Above', icon: '⛰', kind: 'check', desc: 'Done when the player is higher than a height above sea level.', objText: 'Climb above {height} m',
      params: [{ k: 'height', label: 'Height (m)', t: 'num', def: 300 }],
      code: 'if (player.GetPosition()[1] >= height)\n\treturn true;\nreturn false;' },
  ];

  /* ---------------- registering definitions as node types ---------------- */
  const FIELD = { num: 'num', int: 'num', text: 'text', cls: 'cls', bool: 'bool', pos: 'pos' };
  N.fill = (tpl, def, p) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => {
    const prm = def.params.find((x) => x.k === k);
    if (!prm) return m;
    const v = p[k];
    return prm.t === 'pos' ? (DS.posText ? DS.posText(v) : 'a position') : prm.t === 'bool' ? (v ? 'yes' : 'no') : String(v == null ? '' : v);
  });
  N.register = function (def) {
    if (!def || !isCustom(def.id)) return;
    const check = def.kind === 'check';
    const fields = (def.params || []).map((p) => {
      const f = { k: p.k, t: FIELD[p.t] || 'text', label: p.label || p.k, def: p.t === 'pos' ? { x: 0, y: 0, z: 0, ref: null } : p.t === 'bool' ? !!p.def : (p.t === 'num' || p.t === 'int') ? +p.def || 0 : String(p.def == null ? '' : p.def) };
      if (p.t === 'int') f.step = 1;
      return f;
    });
    if (check) fields.push({ k: 'text', t: 'text', label: 'Objective text (tracker)', def: '' });
    DS.NODE_TYPES[def.id] = {
      cat: check ? 'objective' : 'reward', title: def.title || def.id, icon: def.icon || (check ? '✪' : '⚙'), custom: true, def,
      desc: (def.desc || '') + ' (custom node - your own Enforce Script)',
      fields,
      sum: (p) => (check ? p.text || N.fill(def.objText, def, p) || def.title : (def.params || []).filter((x) => x.t !== 'pos').map((x) => `${x.label || x.k}: ${p[x.k]}`).join(', ') || def.title),
    };
  };
  /** project copies win over the library; node types without a definition get a placeholder so nothing breaks */
  N.registerProject = function (P) {
    (P.customNodes || []).forEach(N.register);
    (P.quests || []).forEach((q) => q.nodes.forEach((n) => {
      if (isCustom(n.type) && !DS.NODE_TYPES[n.type]) {
        DS.NODE_TYPES[n.type] = { cat: n.type.startsWith('cno_') ? 'objective' : 'reward', title: 'Missing custom node', icon: '?', custom: true, missing: true,
          desc: 'This project uses a custom node whose definition is missing (' + n.type + ').', fields: [], sum: () => n.type };
      }
    }));
  };
  N.def = (id) => (S.project.customNodes || []).find((d) => d.id === id) || N.lib.find((d) => d.id === id) || null;
  /** copy the definition into the project (called when a node of that type is added) */
  N.embed = function (id) {
    const d = N.def(id);
    if (!d) return;
    if (!S.project.customNodes) S.project.customNodes = [];
    if (!S.project.customNodes.some((x) => x.id === id)) S.project.customNodes.push(JSON.parse(JSON.stringify(d)));
  };
  N.loadLibrary = async function () {
    const r = await api('/api/nodes');
    if (!r.ok) return;
    N.lib = r.nodes;
    N.lib.forEach(N.register);
    N.registerProject(S.project);   // project copies stay on top
    S.emit('structure');
  };

  /* ---------------- generated Enforce code (used by the exporter) ---------------- */
  const fnName = (id) => id.toUpperCase().replace(/^CN([AO])_/, 'CN$1_');
  /** -> { lines: [...], map: [{ from, to, label, target, codeFrom }] } relative to the first returned line (0-based) */
  N.generate = function (defs) {
    const L = [], map = [];
    L.push('\t// ---- custom nodes (Quests ▸ 🧩 Custom nodes) ----');
    L.push('\tstatic float ArgF(array<string> a, int i)', '\t{', '\t\tif (!a || i >= a.Count())', '\t\t\treturn 0;', '\t\treturn a.Get(i).ToFloat();', '\t}');
    L.push('\tstatic int ArgI(array<string> a, int i)', '\t{', '\t\tif (!a || i >= a.Count())', '\t\t\treturn 0;', '\t\treturn a.Get(i).ToInt();', '\t}');
    L.push('\tstatic string ArgS(array<string> a, int i)', '\t{', '\t\tif (!a || i >= a.Count())', '\t\t\treturn "";', '\t\treturn a.Get(i);', '\t}');
    L.push('\tstatic bool ArgB(array<string> a, int i)', '\t{', '\t\tif (!a || i >= a.Count())', '\t\t\treturn false;', '\t\treturn a.Get(i) == "1";', '\t}');
    L.push('\tstatic vector ArgV(array<string> a, int i)', '\t{', '\t\tif (!a || i >= a.Count())', '\t\t\treturn vector.Zero;', '\t\tvector v = a.Get(i).ToVector();',
      '\t\tif (v[1] == 0)', '\t\t\tv[1] = GetGame().SurfaceY(v[0], v[2]);', '\t\treturn v;', '\t}');
    defs.forEach((d) => {
      const check = d.kind === 'check';
      const start = L.length;
      L.push(`\t// custom node "${String(d.title || d.id).replace(/[\r\n]/g, ' ')}"`);
      L.push(`\tstatic ${check ? 'bool' : 'void'} ${fnName(d.id)}(PlayerBase player, vector pos, array<string> args)`);
      L.push('\t{');
      (d.params || []).forEach((p, i) => {
        const f = { num: 'ArgF', int: 'ArgI', text: 'ArgS', cls: 'ArgS', bool: 'ArgB', pos: 'ArgV' }[p.t] || 'ArgS';
        L.push(`\t\t${etype(p.t)} ${p.k} = ${f}(args, ${i});`);
      });
      const codeFrom = L.length;
      String(d.code || '').split(/\r?\n/).forEach((ln) => L.push('\t\t' + ln));
      if (check && !/\breturn\b/.test(d.code || '')) L.push('\t\treturn false;');
      L.push('\t}');
      map.push({ from: start, to: L.length - 1, codeFrom, label: `custom node “${d.title || d.id}”`, target: { kind: 'custom', id: d.id } });
    });
    L.push('\tstatic void RunNode(string type, PlayerBase player, vector pos, array<string> args)', '\t{');
    defs.filter((d) => d.kind !== 'check').forEach((d) => L.push(`\t\tif (type == "${d.id}")`, '\t\t{', `\t\t\t${fnName(d.id)}(player, pos, args);`, '\t\t\treturn;', '\t\t}'));
    L.push('\t}');
    L.push('\tstatic bool CheckNode(string type, PlayerBase player, vector pos, array<string> args)', '\t{');
    defs.filter((d) => d.kind === 'check').forEach((d) => L.push(`\t\tif (type == "${d.id}")`, `\t\t\treturn ${fnName(d.id)}(player, pos, args);`));
    L.push('\t\treturn false;', '\t}');
    return { lines: L, map };
  };
  /** the node's settings as strings, in parameter order (runtime: DSNode.args) */
  N.args = function (def, p) {
    return (def.params || []).map((prm) => {
      const v = p[prm.k];
      if (prm.t === 'pos') { const r = DS.resolvePos(v || {}); return `${U.round(r.x, 2)} ${U.round(r.y || 0, 2)} ${U.round(r.z, 2)}`; }
      if (prm.t === 'bool') return v ? '1' : '0';
      return String(v == null ? '' : v);
    });
  };

  /* ---------------- the wizard ---------------- */
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'node';
  const RESERVED_NAMES = new Set('player pos args out inout local ref class int float bool string vector auto void null this super new return if else for while'.split(' '));

  N.wizard = function (idOrDef) {
    const src = typeof idOrDef === 'string' ? N.def(idOrDef) : idOrDef;
    const d = JSON.parse(JSON.stringify(src || { id: '', title: '', icon: '⚙', kind: 'action', desc: '', objText: '', params: [], code: '' }));
    const editing = !!(src && src.id);
    const used = editing ? S.project.quests.reduce((a, q) => a + q.nodes.filter((n) => n.type === d.id).length, 0) : 0;
    const body = el('div', {});
    let ed = null;
    const vars = () => [['player', 'PlayerBase', 'the player the quest runs for'], ['pos', 'vector', 'the node’s first map position (or 0 0 0)'],
      ...d.params.map((p) => [p.k, etype(p.t), p.label || p.k])];
    const txt = (v, on, ph, w) => { const i = el('input', { class: 'inp', type: 'text', value: v || '', placeholder: ph || '', style: w ? { flex: '0 1 ' + w } : {} }); i.addEventListener('input', () => on(i.value)); return i; };

    function draw() {
      const code = d.code;
      const kindSel = el('select', { class: 'inp', disabled: used > 0 },
        el('option', { value: 'action', selected: d.kind !== 'check' }, 'Action - runs once (a reward / outcome)'),
        el('option', { value: 'check', selected: d.kind === 'check' }, 'Check - an objective, done when the code returns true'));
      kindSel.addEventListener('change', () => { d.kind = kindSel.value; if (!d.code.trim()) d.code = d.kind === 'check' ? 'if (player.GetHealth("", "") > 50)\n\treturn true;\nreturn false;' : ''; draw(); });
      const params = el('div', {}, d.params.map((p, i) => {
        const t = el('select', { class: 'inp' }, N.PTYPES.map(([k, l]) => el('option', { value: k, selected: k === p.t }, l)));
        t.addEventListener('change', () => { p.t = t.value; p.def = p.t === 'pos' ? null : p.t === 'bool' ? false : (p.t === 'num' || p.t === 'int') ? 0 : ''; draw(); });
        const name = txt(p.k, (v) => { p.k = v.replace(/[^A-Za-z0-9_]/g, ''); refreshVars(); }, 'name in code', '120px');
        const def = p.t === 'pos' ? el('span', { class: 'ins-help' }, 'picked on the node') : p.t === 'bool'
          ? (() => { const c = el('input', { type: 'checkbox', checked: !!p.def }); c.addEventListener('change', () => { p.def = c.checked; }); return el('label', { class: 'chk' }, c, el('span', {}, 'default')); })()
          : txt(p.def, (v) => { p.def = p.t === 'num' || p.t === 'int' ? +v || 0 : v; }, 'default', '140px');
        return el('div', { class: 'btn-row st-row' },
          name, txt(p.label, (v) => { p.label = v; }, 'label in the inspector', '170px'), t, def,
          el('button', { class: 'btn icon', title: 'Remove', onclick: () => { d.params.splice(i, 1); draw(); } }, '🗑'));
      }),
      el('button', { class: 'btn sm', onclick: () => { let k = 'value', n = 2; while (d.params.some((x) => x.k === k)) k = 'value' + n++; d.params.push({ k, label: 'Value', t: 'num', def: 0 }); draw(); } }, '+ Setting'));
      ed = DS.Code.editor({ value: code, rows: 14, mode: d.kind === 'check' ? 'check' : 'action', vars: vars(), params: d.params.map((p) => p.k), onInput: (v) => { d.code = v; } });
      const sig = el('div', { class: 'code-vars' }, el('code', {}, `static ${d.kind === 'check' ? 'bool' : 'void'} ${fnName(d.id || (d.kind === 'check' ? 'cno_' : 'cna_') + slug(d.title))}(PlayerBase player, vector pos, …)`));
      fill(body, 
        el('div', { class: 'hint-box' }, 'Write a little Enforce Script once and use it as a block in any quest. Settings become fields in the inspector and variables in your code. ',
          el('b', {}, 'An error here stops every quest script from loading'), ' - test with ▶ Compile on local server before using it on a live server.'),
        editing ? null : el('div', { class: 'btn-row st-row' }, el('span', { class: 'ins-help' }, 'Start from an example:'),
          N.EXAMPLES.map((x) => el('button', { class: 'btn sm', onclick: () => { Object.assign(d, JSON.parse(JSON.stringify(x))); draw(); } }, x.icon + ' ' + x.title))),
        el('div', { class: 'btn-row st-row' }, txt(d.icon, (v) => { d.icon = v.slice(0, 2); }, 'icon', '50px'), txt(d.title, (v) => { d.title = v; }, 'Node name (Set Player Health)', '260px'), kindSel),
        used ? el('div', { class: 'ins-help' }, `Used by ${used} node(s) in this project - the kind can't change now.`) : null,
        el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Description'), txt(d.desc, (v) => { d.desc = v; }, 'What it does (shown as a tooltip)')),
        d.kind === 'check' ? el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Objective text in the tracker'), txt(d.objText, (v) => { d.objText = v; }, 'Climb above {height} m - {setting} is replaced by its value')) : null,
        el('div', { class: 'ins-sec-title' }, 'Settings'), params,
        el('div', { class: 'ins-sec-title' }, 'Code'), sig, ed);
    }
    function refreshVars() { /* names show up the next time the code box is drawn */ }

    function problems() {
      const out = [];
      if (!String(d.title).trim()) out.push('Give the node a name.');
      const ks = new Set();
      d.params.forEach((p) => {
        if (!/^[A-Za-z_]\w*$/.test(p.k)) out.push(`Setting “${p.label || p.k}” needs a name made of letters, digits and _.`);
        else if (RESERVED_NAMES.has(p.k)) out.push(`“${p.k}” can't be a setting name (reserved or already given to your code).`);
        if (ks.has(p.k)) out.push(`Two settings are called “${p.k}”.`);
        ks.add(p.k);
      });
      const errs = ed ? ed.issues().filter((i) => i.level === 'error') : [];
      if (errs.length) out.push('The code has ' + errs.length + ' error(s): ' + errs[0].msg);
      return out;
    }
    async function save(close, toProject) {
      const pr = problems();
      if (pr.length) { DS.toast(pr[0], 'error', 6000); return false; }
      if (!d.id) {
        let id = (d.kind === 'check' ? 'cno_' : 'cna_') + slug(d.title), n = 2;
        while (DS.NODE_TYPES[id] && !(src && src.id === id)) id = (d.kind === 'check' ? 'cno_' : 'cna_') + slug(d.title) + '_' + n++;
        d.id = id;
      }
      d.code = ed.getValue();
      const r = await api('/api/nodes/save', { node: d });
      if (!r.ok) DS.toast('Saved in this project only (library: ' + (r.error || 'server offline') + ')', 'warn', 5000);
      const i = N.lib.findIndex((x) => x.id === d.id);
      if (i >= 0) N.lib[i] = JSON.parse(JSON.stringify(d)); else N.lib.push(JSON.parse(JSON.stringify(d)));
      const P = S.project;
      if (!P.customNodes) P.customNodes = [];
      const j = P.customNodes.findIndex((x) => x.id === d.id);
      if (j >= 0) P.customNodes[j] = JSON.parse(JSON.stringify(d));
      else if (toProject) P.customNodes.push(JSON.parse(JSON.stringify(d)));
      N.register(d);
      S.changed('quests');
      S.commit();
      S.emit('structure');
      DS.toast('“' + d.title + '” saved - find it in the node menu under ' + (d.kind === 'check' ? 'Objectives' : 'Rewards & Outcomes'), 'ok', 3500);
      if (close) close();
      return true;
    }
    draw();
    DS.app.modal({
      title: editing ? 'Custom node - ' + (d.title || d.id) : 'New custom node', wide: true, body,
      buttons: (close) => [
        el('button', { class: 'btn', title: 'Saves, adds it to this project and builds + starts the local test server so DayZ compiles it', onclick: async () => { if (await save(null, true)) { DS.Console.open(); DS.Console.compile(); } } }, '▶ Save & compile on local server'),
        el('button', { class: 'btn primary', onclick: () => save(close, false) }, '💾 Save'),
        el('button', { class: 'btn', onclick: close }, 'Cancel')],
    });
  };

  /* ---------------- the manager (list, edit, delete, share) ---------------- */
  N.manager = function () {
    const body = el('div', {});
    const draw = () => {
      const all = new Map();
      N.lib.forEach((d) => all.set(d.id, { d, lib: true }));
      (S.project.customNodes || []).forEach((d) => { const e = all.get(d.id); if (e) e.proj = true; else all.set(d.id, { d, proj: true }); });
      fill(body, 
        el('div', { class: 'hint-box' }, 'Your own node blocks. The library is shared by all projects (Documents/DayZStudio/Nodes - send the .json files to others); a project keeps a copy of every custom node it uses.'),
        ...[...all.values()].map(({ d, lib, proj }) => el('div', { class: 'btn-row st-row', style: { borderBottom: '1px solid var(--line)', padding: '4px 0' } },
          el('span', { style: { width: '24px' } }, d.icon || '⚙'), el('b', { style: { flex: '1 1 160px' } }, d.title || d.id),
          el('span', { class: 'ins-help' }, (d.kind === 'check' ? 'check' : 'action') + (lib ? ' · library' : '') + (proj ? ' · in this project' : '')),
          el('button', { class: 'btn sm', onclick: () => N.wizard(d.id) }, '✎ Edit'),
          el('button', { class: 'btn sm', title: 'Download the definition as .json', onclick: () => { const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })), download: d.id + '.json' }); a.click(); } }, '⇩'),
          lib ? el('button', { class: 'btn sm', title: 'Remove from the library (projects keep their copy)', onclick: async () => { if (!confirm('Remove “' + (d.title || d.id) + '” from the library? Projects that use it keep their own copy.')) return; await api('/api/nodes/delete', { id: d.id }); N.lib = N.lib.filter((x) => x.id !== d.id); if (!(S.project.customNodes || []).some((x) => x.id === d.id)) delete DS.NODE_TYPES[d.id]; draw(); } }, '🗑') : null)),
        all.size ? null : el('div', { class: 'ins-help' }, 'No custom nodes yet.'),
        el('div', { class: 'btn-row st-row pad' },
          el('button', { class: 'btn primary', onclick: () => N.wizard() }, '+ New custom node'),
          el('button', { class: 'btn', onclick: () => {
            const inp = el('input', { type: 'file', accept: '.json' });
            inp.addEventListener('change', async () => {
              try {
                const j = JSON.parse(await inp.files[0].text());
                if (!isCustom(j.id) || typeof j.code !== 'string') throw new Error('not a custom node file');
                await api('/api/nodes/save', { node: j });
                N.lib = N.lib.filter((x) => x.id !== j.id).concat([j]);
                N.register(j);
                draw();
                DS.toast('Imported “' + (j.title || j.id) + '”', 'ok');
              } catch (e) { DS.toast('Could not import: ' + e.message, 'error'); }
            });
            inp.click();
          } }, '⇧ Import .json')));
    };
    draw();
    DS.app.modal({ title: '🧩 Custom nodes', body, wide: true, buttons: (c) => [el('button', { class: 'btn', onclick: c }, 'Close')] });
  };

  S.on('project', () => N.registerProject(S.project));
  setTimeout(() => N.loadLibrary(), 300);
})();
