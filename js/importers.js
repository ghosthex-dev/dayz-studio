/* DayZ Studio - import of other editors' map files:
     .dze      DayZ Editor (Dabs) saves - binary (versions 1-8) and the old JSON flavour
     .map/.txt Expansion mod object files (also what Dabs exports as "Expansion")
     init.c    SpawnObject("Class", "x y z", "yaw pitch roll", scale)  lines (Dabs init.c export, hand written missions)
   Every parser returns { map, author, objects:[{c,x,y,z,yaw,pitch,roll,scale,label,locked}], removed:[{c,x,y,z}], notes:[] }. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const I = (DS.Import = {});

  /* ---------------------------------------------------------------- Dabs .dze (binary) */
  class Reader {
    constructor(buf) {
      this.dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      this.p = 0;
      this.bytes = new Uint8Array(this.dv.buffer);
    }
    u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
    i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
    f32() { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
    bool() { const v = this.dv.getUint32(this.p, true) !== 0; this.p += 4; return v; } // FileSerializer stores bools as 4 bytes
    str() {
      const n = this.u32();
      if (n > 4096 || this.p + n > this.bytes.length) throw new Error('bad string length ' + n);
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.p + i]);
      this.p += n;
      return s;
    }
    vec() {
      const n = this.u32();
      if (n !== 3) throw new Error('bad vector');
      return [this.f32(), this.f32(), this.f32()];
    }
    get end() { return this.p >= this.bytes.length; }
  }

  /** parameter payloads of SerializableParamN<...> : read by the template argument list */
  function readParam(r, type) {
    const m = /<(.*)>/.exec(type);
    const args = m ? m[1].split(',').map((x) => x.trim()) : [];
    const out = [];
    args.forEach((a) => {
      if (a === 'string') out.push(r.str());
      else if (a === 'int') out.push(r.i32());
      else if (a === 'float') out.push(r.f32());
      else if (a === 'bool') out.push(r.bool());
      else if (a === 'vector') out.push(r.vec());
      else throw new Error('unknown parameter type ' + a);
    });
    return out;
  }

  function readObject(r, version) {
    const o = { type: r.str(), display: r.str(), pos: r.vec(), ori: r.vec(), scale: r.f32(), flags: r.i32() };
    if (version < 2) return o;
    if (version < 8) {
      const n = r.u32();
      for (let i = 0; i < n; i++) r.str();
    }
    const np = r.u32();
    o.params = {};
    for (let i = 0; i < np; i++) {
      const key = r.str();
      const type = r.str();
      o.params[key] = readParam(r, type);
    }
    if (version < 3) return o;
    o.editorOnly = r.bool();
    o.locked = r.bool();
    r.bool(); // AllowDamage
    r.bool(); // Simulate
    if (version < 5) return o;
    o.model = r.str();
    if (version < 8) return o;
    const na = r.u32();
    for (let i = 0; i < na; i++) {
      r.i32();
      readObject(r, version); // attachments are not placed as separate objects
    }
    return o;
  }

  I.parseDze = function (buf) {
    const r = new Reader(buf);
    const check = r.str();
    if (check !== 'EditorBinned') throw new Error('Not a binary DayZ Editor file.');
    const version = r.i32();
    if (version < 1 || version > 20) throw new Error('Unsupported file version ' + version);
    const out = { format: 'DayZ Editor save (v' + version + ')', map: r.str(), objects: [], removed: [], notes: [] };
    out.camera = r.vec();
    if (version >= 7) {
      out.author = r.str();
      const nc = r.u32();
      for (let i = 0; i < nc; i++) r.str();
      r.i32(); // last modified
      r.i32(); // created
    }
    const n = r.u32();
    for (let i = 0; i < n; i++) {
      const o = readObject(r, version);
      if (o.editorOnly || (o.flags & 128)) continue; // camera helpers etc.
      out.objects.push({
        c: o.type, x: o.pos[0], y: o.pos[1], z: o.pos[2], yaw: o.ori[0], pitch: o.ori[1], roll: o.ori[2], scale: o.scale || 1,
        label: o.display && o.display !== o.type ? o.display : '', locked: !!o.locked || !!(o.flags & 64),
      });
    }
    const nd = r.u32();
    for (let i = 0; i < nd; i++) {
      let type = '';
      if (version !== 6 && version !== 7) type = r.str();
      const pos = r.vec();
      r.i32();
      let model = '';
      if (version >= 6) model = r.str();
      out.removed.push({ c: type, model, x: pos[0], y: pos[1], z: pos[2] });
    }
    return out;
  };

  /** the old text flavour of .dze (EditorSaveData as JSON) */
  I.parseDzeJson = function (text) {
    const j = JSON.parse(text);
    const out = { format: 'DayZ Editor save (JSON)', map: j.MapName || '', author: j.AuthorId || '', objects: [], removed: [], notes: [] };
    (j.EditorObjects || []).forEach((o) => {
      const p = o.Position || [0, 0, 0], q = o.Orientation || [0, 0, 0];
      out.objects.push({ c: o.Type, x: p[0], y: p[1], z: p[2], yaw: q[0], pitch: q[1], roll: q[2], scale: o.Scale || 1, label: '', locked: false });
    });
    (j.EditorHiddenObjects || []).forEach((o) => {
      const p = o.Position || [0, 0, 0];
      out.removed.push({ c: o.Type || '', model: o.ModelName || '', x: p[0], y: p[1], z: p[2] });
    });
    return out;
  };

  /* ---------------------------------------------------------------- Expansion .map */
  const vec3 = (s) => String(s || '').trim().split(/\s+/).map(Number);
  I.parseExpansion = function (text) {
    const out = { format: 'Expansion object file', map: '', objects: [], removed: [], notes: [] };
    text.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('#')) return;
      const t = line.split('|');
      if (t.length < 2) return;
      let type = t[0];
      const del = type.startsWith('-');
      if (del) type = type.slice(1);
      const dot = type.indexOf('.');
      if (dot > 0 && !/\.p3d$/i.test(type)) type = type.slice(0, dot); // "Class.TraderName"
      const p = vec3(t[1]);
      const o = vec3(t[2] || '0 0 0');
      if (p.length < 3 || p.some((v) => Number.isNaN(v))) return;
      if (del) out.removed.push(/\.p3d$/i.test(type) ? { c: '', model: type, x: p[0], y: p[1], z: p[2] } : { c: type, x: p[0], y: p[1], z: p[2] });
      else out.objects.push({ c: type, x: p[0], y: p[1], z: p[2], yaw: o[0] || 0, pitch: o[1] || 0, roll: o[2] || 0, scale: 1, label: '', locked: false });
    });
    return out;
  };

  /* ---------------------------------------------------------------- init.c */
  I.parseInitC = function (text) {
    const out = { format: 'init.c SpawnObject calls', map: '', objects: [], removed: [], notes: [] };
    // SpawnObject( "Class", "x y z", "yaw pitch roll" [, scale] );
    const re = /SpawnObject\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*(?:,\s*([-\d.]+))?\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      const p = vec3(m[2]), o = vec3(m[3]);
      if (p.length < 3) continue;
      out.objects.push({ c: m[1].replace(/\//g, '\\'), x: p[0], y: p[1], z: p[2], yaw: o[0] || 0, pitch: o[1] || 0, roll: o[2] || 0, scale: m[4] ? +m[4] : 1, label: '', locked: false });
    }
    if (!out.objects.length) {
      // plain  GetGame().CreateObject("Class", "x y z")  calls
      const re2 = /CreateObject(?:Ex)?\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
      while ((m = re2.exec(text))) {
        const p = vec3(m[2]);
        if (p.length >= 3) out.objects.push({ c: m[1], x: p[0], y: p[1], z: p[2], yaw: 0, pitch: 0, roll: 0, scale: 1, label: '', locked: false });
      }
    }
    return out;
  };

  /** pick the parser from the file name / content */
  I.parse = async function (file) {
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 16));
    const asText = () => new TextDecoder('utf-8').decode(buf);
    // binary Dabs saves start with the string "EditorBinned"
    if (head[0] === 12 && head[1] === 0 && String.fromCharCode(...head.slice(4, 16)) === 'EditorBinned') return I.parseDze(buf);
    if (name.endsWith('.dze') || name.endsWith('.json')) {
      const t = asText().trim();
      if (t.startsWith('{')) {
        const j = JSON.parse(t);
        if (j.EditorObjects) return I.parseDzeJson(t);
        if (j.Objects) { // object spawner file
          return { format: 'Object spawner JSON', map: '', notes: [], removed: [], objects: j.Objects.filter((o) => o.name && o.pos).map((o) => ({ c: o.name, x: o.pos[0], y: o.pos[1], z: o.pos[2], yaw: (o.ypr || [])[0] || 0, pitch: (o.ypr || [])[1] || 0, roll: (o.ypr || [])[2] || 0, scale: o.scale || 1, label: '', locked: false })) };
        }
      }
      throw new Error('This file is not a DayZ Editor save.');
    }
    if (name.endsWith('.map') || name.endsWith('.txt')) return I.parseExpansion(asText());
    if (name.endsWith('.c')) return I.parseInitC(asText());
    throw new Error('Unknown file type. Supported: .dze (DayZ Editor), .map / .txt (Expansion), init.c');
  };

  /* ---------------------------------------------------------------- into the project */
  const WORLD_BY_NAME = { chernarusplus: 'chernarusplus', chernarus: 'chernarusplus', enoch: 'enoch', livonia: 'enoch', sakhal: 'sakhal' };
  function kindOf(cls) {
    const e = DS.Classes && DS.Classes.by && DS.Classes.by.get(cls);
    if (e) return e.kind;
    if (/\.p3d$/i.test(cls) || /^(Land_|StaticObj_|Static_|Wreck_)/.test(cls)) return 'building';
    if (/^(Zmb|ZombieM|ZombieF)/.test(cls)) return 'infected';
    if (/^Animal_/.test(cls)) return 'animal';
    if (/^(Survivor|Player)/.test(cls)) return 'npc';
    return 'prop';
  }

  I.apply = function (res, opts) {
    opts = opts || {};
    const list = res.objects.map((o) => S.makeObject({ c: o.c, kind: kindOf(o.c), label: o.label }, o.x, o.z, {
      y: o.y || 0, yaw: U.round(o.yaw, 2), pitch: U.round(o.pitch, 2), roll: U.round(o.roll, 2), scale: o.scale || 1, locked: !!o.locked, snap: !o.y,
    }));
    if (opts.replace) S.project.objects = [];
    S.addObjects(list);
    if (res.removed && res.removed.length) {
      S.project.removed = (S.project.removed || []).concat(res.removed);
    }
    const w = WORLD_BY_NAME[String(res.map || '').toLowerCase()];
    if (w && w !== S.project.meta.world && opts.switchWorld !== false) {
      S.project.meta.world = w;
      S.emit('project');
    }
    S.commit();
    if (DS.MapView && list.length) {
      const cx = list.reduce((s, o) => s + o.x, 0) / list.length, cz = list.reduce((s, o) => s + o.z, 0) / list.length;
      DS.MapView.centerOn(cx, cz, 0.35);
    }
    return list.length;
  };

  /** File ▸ Import ▸ other editors */
  I.run = async function () {
    const f = await U.pickFile('.dze,.map,.txt,.c,.json');
    if (!f) return;
    let res;
    try {
      res = await I.parse(f);
    } catch (e) {
      DS.toast('Could not import: ' + (e.message || e), 'error', 6000);
      return;
    }
    const classes = new Set(res.objects.map((o) => o.c));
    const body = U.el('div', { class: 'imp' },
      U.el('p', null, `${f.name}: ${res.format}`),
      U.el('ul', null,
        U.el('li', null, `${res.objects.length} objects (${classes.size} different classes)`),
        res.removed.length ? U.el('li', null, `${res.removed.length} removed map objects (kept in the project, not shown)`) : null,
        res.map ? U.el('li', null, `Map: ${res.map}`) : null,
        res.author ? U.el('li', null, `Author id: ${res.author}`) : null));
    const mode = { replace: false };
    const sel = U.el('select', { class: 'inp', onchange: (e) => { mode.replace = e.target.value === 'replace'; } },
      U.el('option', { value: 'add' }, 'Add to the current project'), U.el('option', { value: 'replace' }, 'Replace the objects of the current project'));
    body.append(sel);
    DS.app.modal({
      title: 'Import ' + f.name, body,
      buttons: (close) => [
        U.el('button', { class: 'btn', onclick: close }, 'Cancel'),
        U.el('button', { class: 'btn primary', disabled: !res.objects.length, onclick: () => { const n = I.apply(res, mode); close(); DS.toast(`Imported ${n} objects`, 'ok'); } }, 'Import'),
      ],
    });
  };
})();
