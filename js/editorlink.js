/* DayZ Studio - live link to the DayZ Editor (Dabs) running in the game, plus the embedded "Game" view.
   Transport: studio server <-> link mod (JSON files).  Object ids: Studio objects use "dzs_<id>" as Editor uuid;
   objects created in the game keep their Editor uuid in object.gid. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const L = (DS.Link = {});

  const host = window.studioHost || null;
  L.desktop = !!host;
  L.fresh = false;
  L.state = null;
  L.camera = null;
  L.docked = false;
  L.launching = false;
  L.live = true;
  L.autoPull = true;
  L.follow = false;
  L.msg = '';
  L.engine = 'world';      // 'world' = DayZ Studio's own viewport mod, 'dabs' = DayZ Editor (Dabs) in the game
  L.camSync = true;         // 3D tab camera drives the game camera

  const lastSig = new Map(); // gid -> signature of what the game last received
  let lastSeq = 0;
  let lastHash = null;
  let lastCount = -1;
  let lastGameSel = '';
  let lastSentSel = '';
  let pushTimer = null;
  let busy = false;
  let lastPushAt = 0;
  let connectedAt = 0;
  const confirmed = new Set(); // gids the game has actually reported back

  const gidOf = (o) => o.gid || 'dzs_' + o.id;
  const sig = (o) => [o.c, o.x, o.y, o.z, o.yaw, o.pitch || 0, o.roll || 0, o.scale || 1].join('|');
  const spawnable = (o) => o.kind !== 'event' && o.kind !== 'fx' && String(o.c || '').trim() !== '';

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------------------------------------------------------- polling */
  async function poll() {
    try {
      const r = await api('/api/link/state');
      const was = L.fresh;
      L.fresh = !!r.fresh;
      L.state = r.fresh ? r.state : null;
      if (r.fresh && r.state) {
        L.camera = { x: r.state.cx, y: r.state.cy, z: r.state.cz, yaw: r.state.cyaw, pitch: r.state.cpitch };
        onState(r.state);
      } else L.camera = null;
      if (was !== L.fresh) {
        if (L.fresh) { lastSig.clear(); confirmed.clear(); connectedAt = Date.now(); lastCount = -1; lastHash = null; if (L.live) schedulePush(true); }
        S.emit('link');
      }
    } catch (e) {
      L.fresh = false;
    }
    S.emit('linkstate');
    if (DS.MapView) DS.MapView.invalidate();
    setTimeout(poll, L.fresh || L.launching ? 450 : 2500);
  }

  function onState(st) {
    // selection game -> studio
    const selKey = (st.selected || []).slice().sort().join(',');
    if (selKey !== lastGameSel) {
      lastGameSel = selKey;
      if (selKey !== lastSentSel) {
        const byGid = new Map(S.project.objects.map((o) => [gidOf(o), o.id]));
        const ids = (st.selected || []).map((g) => byGid.get(g)).filter(Boolean);
        if (ids.length) {
          lastSentSel = ids.map((i) => gidOf(S.obj(i))).sort().join(',');
          S.select('object', ids);
        }
      }
    }
    // changes made inside the game -> pull
    if (L.autoPull && L.live && !busy && st.pending === 0 && !pushTimer) {
      if (lastCount === -1) { lastCount = st.count; lastHash = st.hash; }
      else if (st.count !== lastCount || Math.abs((st.hash || 0) - (lastHash || 0)) > 0.01) {
        lastCount = st.count;
        lastHash = st.hash;
        L.pull(true);
      }
    }
    if (L.follow && L.camera && S.view === 'map') DS.MapView.centerOn(L.camera.x, L.camera.z);
  }

  /* ---------------------------------------------------------------- push */
  function toWire(o) {
    const gy = o.y || (DS.groundY ? DS.groundY(o) : 0); // buildings on slopes stand on their highest corner
    return { id: gidOf(o), type: o.c, x: o.x, y: gy, z: o.z, yaw: o.yaw || 0, pitch: o.pitch || 0, roll: o.roll || 0, scale: o.scale || 1 };
  }

  // vanilla map objects removed in the project: the standalone viewport hides them live (whole list each time)
  let mapHideDirty = false;
  const mapHideCmd = () => ({ op: 'maphide', objects: (S.project.removed || []).map((r) => ({ id: r.model || '', type: r.c || '', x: r.x, y: r.y || 0, z: r.z })) });
  S.on('mapedits', () => { mapHideDirty = true; if (L.fresh) schedulePush(false); });

  L.push = async function (all) {
    if (!L.fresh) return { ok: false };
    busy = true;
    try {
      const objs = S.project.objects.filter((o) => !o.hidden && spawnable(o));
      const cur = new Set(objs.map(gidOf));
      const changed = objs.filter((o) => all || lastSig.get(gidOf(o)) !== sig(o));
      const deleted = [...lastSig.keys()].filter((g) => !cur.has(g));
      const cmds = [];
      for (let i = 0; i < changed.length; i += 150) cmds.push({ op: 'sync', objects: changed.slice(i, i + 150).map(toWire) });
      if (deleted.length) cmds.push({ op: 'delete', ids: deleted });
      if (all || mapHideDirty) { cmds.push(mapHideCmd()); mapHideDirty = false; }
      if (!cmds.length) return { ok: true, sent: 0 };
      lastSeq++;
      await api('/api/link/cmd', { seq: lastSeq, cmds });
      lastPushAt = Date.now();
      changed.forEach((o) => lastSig.set(gidOf(o), sig(o)));
      deleted.forEach((g) => lastSig.delete(g));
      L.msg = `Sent ${changed.length} object(s)${deleted.length ? ', removed ' + deleted.length : ''}`;
      S.emit('linkstate');
      return { ok: true, sent: changed.length, removed: deleted.length };
    } finally {
      busy = false;
      lastHash = null; // re-read the game's checksum after our own changes
    }
  };

  function schedulePush(all) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      if (L.fresh && L.live) await L.push(!!all);
    }, all ? 300 : 350);
  }

  /* ---------------------------------------------------------------- pull */
  const KIND_BY_CLASS = (() => {
    const m = new Map();
    DS.CATALOG.forEach((c) => c.items.forEach((i) => m.set(i[0], c.kind === 'loot' ? 'prop' : c.kind)));
    return m;
  })();
  const guessKind = (cls) => KIND_BY_CLASS.get(cls) || (/^Land_|^StaticObj_|^Static_/.test(cls) || /\.p3d$/i.test(cls) ? 'building' : /^Zmb|^Animal_/.test(cls) ? 'infected' : 'prop');

  L.pull = async function (silent) {
    if (!L.fresh || busy) return { ok: false };
    if (Date.now() - lastPushAt < 1800) return { ok: false, pending: true };
    busy = true;
    try {
      const token = 1 + Math.floor(Math.random() * 9000000); // must be exactly representable as a float in the game
      await api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'dump', x: token }] });
      let data = null;
      for (let i = 0; i < 40 && !data; i++) {
        await wait(250);
        const r = await api('/api/link/objects?token=' + token);
        if (r.ok) data = r.data;
      }
      if (!data) return { ok: false };
      const st = L.state;
      if (st && st.pending > 0) return { ok: false, pending: true };
      let upd = 0, add = 0, del = 0;
      const byGid = new Map(S.project.objects.map((o) => [gidOf(o), o]));
      const seen = new Set();
      const orphans = [];
      (data.objects || []).forEach((g) => {
        seen.add(g.id);
        const o = byGid.get(g.id);
        if (o) {
          const gy = Math.round(g.y * 100) / 100;
          const ground = DS.Terrain && DS.Terrain.has() ? DS.Terrain.heightAt(g.x, g.z) : null;
          const newY = ground !== null && Math.abs(gy - ground) < 0.75 && !o.y ? 0 : gy;
          const ch = Math.abs(o.x - g.x) > 0.02 || Math.abs(o.z - g.z) > 0.02 || Math.abs((o.yaw || 0) - g.yaw) > 0.05 ||
            Math.abs((o.y || 0) - newY) > 0.02 || Math.abs((o.scale || 1) - g.scale) > 0.001;
          if (ch) {
            o.x = U.round(g.x, 2); o.z = U.round(g.z, 2); o.y = newY;
            o.yaw = U.round(((g.yaw % 360) + 360) % 360, 2); o.pitch = U.round(g.pitch, 2); o.roll = U.round(g.roll, 2); o.scale = g.scale;
            upd++;
          }
          lastSig.set(g.id, sig(o));
        } else if (g.id.indexOf('dzs_') === 0) {
          orphans.push(g.id); // Studio removed it; make the game agree
        } else {
          const no = S.makeObject({ c: g.type, kind: guessKind(g.type), label: '' }, g.x, g.z, {
            y: U.round(g.y, 2), yaw: U.round(((g.yaw % 360) + 360) % 360, 2), pitch: U.round(g.pitch, 2), roll: U.round(g.roll, 2), scale: g.scale, snap: false, gid: g.id,
          });
          S.project.objects.push(no);
          lastSig.set(g.id, sig(no));
          add++;
        }
      });
      // objects we sent earlier that no longer exist in the game were deleted there
      seen.forEach((g) => confirmed.add(g));
      const missing = S.project.objects.filter((o) => lastSig.has(gidOf(o)) && !seen.has(gidOf(o)));
      if (missing.length) {
        // The Editor reloads its own last session shortly after start-up, which would look like "deleted in the
        // game". Only trust a removal once the game had confirmed the object and start-up has settled.
        const settled = Date.now() - connectedAt > 75000;
        const gone = missing.filter((o) => settled && confirmed.has(gidOf(o)));
        const resend = missing.filter((o) => !gone.includes(o));
        resend.forEach((o) => lastSig.delete(gidOf(o)));
        if (resend.length) schedulePush(false);
        if (gone.length) {
          const ids = new Set(gone.map((o) => o.id));
          gone.forEach((o) => { lastSig.delete(gidOf(o)); confirmed.delete(gidOf(o)); });
          S.deleteObjects([...ids]);
          del = gone.length;
        }
      }
      if (orphans.length) await api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'delete', ids: orphans }] });
      if (upd || add || del) {
        S.structure();
        S.commit();
        L.msg = `Pulled from game: ${add} new, ${upd} changed, ${del} removed`;
        if (!silent) DS.toast(L.msg, 'ok');
      } else if (!silent) DS.toast('Studio is already in sync with the game', 'info', 1800);
      return { ok: true, add, upd, del };
    } finally {
      busy = false;
      S.emit('linkstate');
    }
  };

  /* ---------------------------------------------------------------- selection / camera */
  S.on('selection', () => {
    if (!L.fresh || !L.live) return;
    const ids = S.sel.kind === 'object' ? S.sel.ids.map((i) => S.obj(i)).filter(Boolean).map(gidOf) : [];
    const key = ids.slice().sort().join(',');
    if (key === lastSentSel) return;
    lastSentSel = key;
    clearTimeout(L._selT);
    L._selT = setTimeout(() => api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'select', ids }] }).catch(() => {}), 120);
  });

  /** move the game camera so it looks at world point (x,z) */
  L.flyTo = function (x, z, dist) {
    if (!L.fresh) return DS.toast('The game is not connected yet.', 'warn');
    const d = dist || 140, h = d * 0.7;
    const yaw = L.camera ? L.camera.yaw : 0;
    const a = (yaw * Math.PI) / 180;
    const gy = DS.Terrain && DS.Terrain.has() ? DS.Terrain.heightAt(x, z) : (L.camera ? L.camera.y - 60 : 0);
    const cx = x - Math.sin(a) * d, cz = z - Math.cos(a) * d;
    api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'camera', x: cx, y: gy + h, z: cz, yaw, pitch: -Math.round((Math.atan2(h, d) * 180) / Math.PI) }] });
  };
  L.focusSelection = function () {
    const o = DS.actions.selectedObjects()[0];
    if (o) L.flyTo(o.x, o.z, 60);
  };

  /** the 3D tab's camera drives the game camera (throttled) */
  let camPushAt = 0;
  let camSig = '';
  L.pushCamera = function (x, y, z, yaw, pitch) {
    if (!L.fresh || !L.camSync || (L.state && L.state.play)) return;
    const sg = [x, y, z, yaw, pitch].map((v) => Math.round(v * 2)).join('|');
    const now = Date.now();
    if (sg === camSig || now - camPushAt < 120) return;
    camSig = sg;
    camPushAt = now;
    api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'camera', x, y, z, yaw, pitch, roll: 0 }] }).catch(() => {});
  };

  /** camera frustum marker for the 2D map */
  L.drawCamera = function (ctx, w2s, s) {
    if (!L.fresh || !L.camera) return;
    const [x, y] = w2s(L.camera.x, L.camera.z);
    const a = (L.camera.yaw * Math.PI) / 180;
    const len = Math.max(26, 90 * s);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(34,211,238,.18)';
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-Math.tan(0.65) * len, -len);
    ctx.lineTo(Math.tan(0.65) * len, -len);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, 6.3);
    ctx.fill();
    ctx.restore();
    ctx.font = '600 11px system-ui';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.strokeText('game camera', x + 10, y + 14);
    ctx.fillStyle = '#67e8f9';
    ctx.fillText('game camera', x + 10, y + 14);
  };

  /* ---------------------------------------------------------------- quest preview in the game */
  L.previewOn = false;
  L.previewAll = false;
  const argb = (a, r, g, b) => ((a << 24) | (r << 16) | (g << 8) | b) | 0;
  const CAT = { trigger: [34, 197, 94], objective: [59, 130, 246], reward: [245, 158, 11], logic: [167, 139, 250] };

  /** shapes for the quest(s): areas as translucent cylinders, beacons, labels and flow lines */
  function questShapes() {
    const out = [];
    const quests = L.previewAll ? S.project.quests : [S.activeQuestObj()].filter(Boolean);
    quests.forEach((q) => {
      const anchors = new Map(); // node id -> {x,z}
      q.nodes.forEach((n) => {
        const T = DS.NODE_TYPES[n.type];
        if (!T) return;
        const c = CAT[T.cat];
        const sel = S.isSel('node', n.id);
        S.nodePosFields(n).forEach(({ pos }) => {
          if (!pos) return;
          const r = DS.resolvePos(pos);
          if (!anchors.has(n.id)) anchors.set(n.id, { x: r.x, y: r.y, z: r.z });
          const rad = typeof n.p.radius === 'number' ? n.p.radius : 0;
          if (rad > 0) {
            out.push({ kind: 'cyl', x: r.x, y: r.y, z: r.z, r: rad, h: n.type === 'trg_zone' || n.type === 'obj_kill' ? 18 : 10, dy: -1, color: argb(sel ? 90 : 56, c[0], c[1], c[2]) });
          }
          // beacon pillar
          out.push({ kind: 'cyl', x: r.x, y: r.y, z: r.z, r: sel ? 0.6 : 0.3, h: 30, dy: 0, color: argb(210, c[0], c[1], c[2]) });
          if (T.cat === 'reward') out.push({ kind: 'sphere', x: r.x, y: r.y, z: r.z, r: 0.9, dy: 1.2, color: argb(230, c[0], c[1], c[2]) });
          const sum = T.sum ? T.sum(n.p) : '';
          out.push({ kind: 'text', text: `${sel ? '► ' : ''}${T.title}${sum ? ' — ' + String(sum).slice(0, 48) : ''}${L.previewAll ? '  [' + q.name + ']' : ''}`, x: r.x, y: r.y, z: r.z, r: sel ? 28 : 21, dy: 33, color: argb(255, 255, 255, 255) });
        });
      });
      // flow lines between positional nodes (through nodes that have no position of their own)
      const byId = new Map(q.nodes.map((n) => [n.id, n]));
      const seenPairs = new Set();
      anchors.forEach((a, id) => {
        const walk = (from, depth, seen) => {
          q.links.filter((l) => l.from === from).forEach((l) => {
            if (seen.has(l.to) || depth > 8) return;
            seen.add(l.to);
            const b = anchors.get(l.to);
            if (b) {
              const k = id + '>' + l.to;
              if (!seenPairs.has(k)) {
                seenPairs.add(k);
                out.push({ kind: 'line', x: a.x, y: a.y, z: a.z, x2: b.x, y2: b.y, z2: b.z, dy: 31, color: argb(255, 255, 255, 255) });
              }
            } else if (byId.get(l.to)) walk(l.to, depth + 1, seen);
          });
        };
        walk(id, 0, new Set([id]));
      });
    });
    return out;
  }

  let previewTimer = null;
  L.pushPreview = async function () {
    if (!L.fresh) return;
    const shapes = L.previewOn ? questShapes() : [];
    await api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'shapes', shapes }] });
  };
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => L.pushPreview().catch(() => {}), 350);
  }
  function flyToQuest() {
    // look at the quest's first location so the overlay is visible right away
    const q = S.activeQuestObj();
    if (!q || !L.fresh) return;
    for (const n of q.nodes) {
      const f = S.nodePosFields(n).find((x) => x.pos);
      if (f) { const r = DS.resolvePos(f.pos); L.flyTo(r.x, r.z, 110); break; }
    }
  }
  L.setPreview = function (on, all) {
    L.previewOn = on;
    if (all !== undefined) L.previewAll = all;
    if (on && L.fresh) flyToQuest();
    schedulePreview();
    S.emit('linkstate');
  };
  S.on('changed', (kind) => { if (L.previewOn && L.fresh && (kind === 'quests' || kind === 'structure' || kind === 'objects' || kind === 'any')) schedulePreview(); });
  S.on('selection', () => { if (L.previewOn && L.fresh && S.sel.kind === 'node') schedulePreview(); });
  S.on('link', () => {
    if (!L.fresh || !L.previewOn) return;
    setTimeout(() => { schedulePreview(); flyToQuest(); }, 1500);
  });


  /* ---------------------------------------------------------------- play-test */
  // Runs the exported quest framework inside the Editor session; Studio shows live progress.
  const PT = (L.pt = { on: false, building: false, prog: null, errors: [], loaded: false, age: 0, nodes: new Map(), log: [], msg: '' });

  function friendlyError(line) {
    const l = String(line);
    let m;
    if ((m = /DSCustom\.c.*?(?:\((\d+)\))?.*?:\s*(.*)$/.exec(l)) && /DSCustom/.test(l)) return 'A Custom Script node has a code error' + (m[1] ? ' (line ' + m[1] + ')' : '') + ': ' + (m[2] || l).slice(0, 140);
    if (/Undefined (variable|function)/i.test(l)) return 'The game could not find a name used in the scripts — ' + l.replace(/^.*?(Undefined)/i, '$1').slice(0, 140);
    if (/Variable name .* already used/i.test(l)) return 'A script variable name is used twice — ' + l.replace(/^.*?(Variable)/i, '$1').slice(0, 140);
    if (/Can't find|not found/i.test(l)) return 'Something the quest scripts need was not found — ' + l.slice(-150);
    return l.slice(-170);
  }

  const lastKnownQuests = { sig: '' };
  function questsPayload() {
    return DS.exporters.questsJson();
  }

  L.startPlaytest = async function () {
    if (PT.building) return;
    if (!S.project.quests.length) { DS.toast('Create a quest first', 'warn'); return; }
    PT.building = true;
    PT.msg = 'Building the play-test mod…';
    S.emit('linkstate');
    try {
      const R = DS.RUNTIME;
      const custom = DS.exporters.customScripts();
      const bad = DS.exporters.checkScripts ? DS.exporters.checkScripts({ core: R.core, custom, hook: R.hookEditor }) : [];
      if (bad.length) throw new Error('the scripts would not compile - ' + bad[0].text + (bad.length > 1 ? ` (+${bad.length - 1} more, see ⌨ Console)` : ''));
      const r = await api('/api/playtest/prepare', {
        config: R.configTest + (DS.exporters.soundConfig ? DS.exporters.soundConfig('DZStudioQuestTest') : ''),
        sounds: DS.Sounds ? DS.Sounds.all().map((s) => ({ id: s.id, ext: s.ext })) : [],
        core: R.core,
        custom,
        hook: R.hookEditor,
        quests: questsPayload(),
        factions: DS.exporters.factionsJson ? DS.exporters.factionsJson(S.project) : '',
        trade: DS.exporters.tradeJson ? DS.exporters.tradeJson(S.project) : '',
      });
      if (!r.ok) throw new Error(r.error || 'build failed');
      if (L.fresh || L.launching) {
        PT.msg = 'Restarting the game with the quest runtime…';
        S.emit('linkstate');
        await L.close();
        await wait(3500);
      }
      PT.on = true;
      PT.prog = null;
      PT.errors = [];
      PT.loaded = false;
      lastKnownQuests.sig = questsPayload();
      S.setView('game');
      await L.launch({ playtest: true });
      PT.msg = 'Game starting — quests load when the Editor is up.';
    } catch (e) {
      PT.on = false;
      PT.msg = 'Play-test failed: ' + e.message;
      DS.toast(PT.msg, 'error', 7000);
    }
    PT.building = false;
    S.emit('linkstate');
    pollPlaytest();
  };

  /** one click: start the play-test if needed and drop the player at the quest start */
  L.playTestQuest = async function () {
    S.setView('game');
    if (PT.on && L.fresh) { await L.playAtQuestStart(); return; }
    L.autoPlay = true;
    await L.startPlaytest();
  };

  L.stopPlaytest = function () {
    PT.on = false;
    PT.prog = null;
    PT.nodes = new Map();
    S.emit('playtest');
    S.emit('linkstate');
  };

  async function flag(body) {
    try { return await api('/api/playtest/flag', body); } catch (e) { return { ok: false }; }
  }
  L.ptReload = async () => { lastKnownQuests.sig = questsPayload(); await flag({ action: 'reload', quests: lastKnownQuests.sig }); DS.toast('Quests re-sent to the game', 'ok', 1500); };
  L.ptReset = async () => { await flag({ action: 'reset' }); };
  L.ptSimKill = async (cls, count) => { await flag({ action: 'simkill', cls: cls || '@infected', count: count || 1 }); };
  /** where the active quest begins: its first trigger with a position (else any positioned node) */
  L.questStart = function () {
    const q = S.activeQuestObj() || S.project.quests[0];
    if (!q) return null;
    const order = q.nodes.slice().sort((a, b) => (DS.NODE_TYPES[a.type] && DS.NODE_TYPES[a.type].cat === 'trigger' ? 0 : 1) - (DS.NODE_TYPES[b.type] && DS.NODE_TYPES[b.type].cat === 'trigger' ? 0 : 1));
    for (const n of order) {
      const f = S.nodePosFields(n).find((x) => x.pos);
      if (f) {
        const r = DS.resolvePos(f.pos);
        if (n.type === 'trg_npc') {
          // stand 2.5 m in front of the NPC, not inside it
          const yaw = ((+n.p.yaw || 0) * Math.PI) / 180;
          return { x: r.x + Math.sin(yaw) * 2.5, z: r.z + Math.cos(yaw) * 2.5, quest: q.name, node: n };
        }
        return { x: r.x, z: r.z, quest: q.name, node: n };
      }
    }
    return null;
  };
  /** edit | play | toggle ; with a position the player is dropped there when entering play mode */
  L.setMode = (mode, pos) => api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'mode', ids: [mode], x: pos ? pos.x : 0, y: pos ? 1 : 0, z: pos ? pos.z : 0 }] });
  L.gotoQuestStart = async function () {
    const s = L.questStart();
    if (!s) { DS.toast('This quest has no positioned node yet', 'warn'); return; }
    await api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'goto', x: s.x, y: 0, z: s.z }] });
  };
  L.playAtQuestStart = async function () {
    const s = L.questStart();
    await L.setMode('play', s || null);
  };
  L.ptTeleport = async (x, z) => { await api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'tp', x, y: 0, z }] }); };
  L.ptSpawn = async (cls, n, x, z, scatter) => { await api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'spawn', ids: [cls], x, y: n, z, pitch: scatter || 6 }] }); };
  L.ptGive = async (cls, n) => { await api('/api/link/cmd', { seq: ++lastSeq, cmds: [{ op: 'give', ids: [cls], y: n || 1 }] }); };

  // auto-reload: edits made in Studio reach the running game after a short pause
  let reloadTimer = null;
  S.on('changed', (kind) => {
    if (!PT.on || !L.fresh) return;
    if (kind === 'quests' || kind === 'structure' || kind === 'any') {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        const now = questsPayload();
        if (now !== lastKnownQuests.sig) L.ptReload();
      }, 1200);
    }
  });

  async function pollPlaytest() {
    if (!PT.on) return;
    try {
      const r = await api('/api/playtest/progress');
      PT.errors = (r.errors || []).map(friendlyError);
      PT.loaded = !!r.loaded;
      if (L.autoPlay && PT.loaded && L.fresh && r.progress && r.progress.hasPlayer) { L.autoPlay = false; L.playAtQuestStart(); }
      PT.age = r.age || 0;
      PT.prog = r.progress || null;
      PT.log = (r.progress && r.progress.log) || [];
      const m = new Map();
      if (r.progress && r.age < 15) r.progress.quests.forEach((q) => (q.nodes || []).forEach((n) => m.set(n.id, n)));
      PT.nodes = m;
      PT.questStatus = new Map();
      if (r.progress && r.age < 15) r.progress.quests.forEach((q) => PT.questStatus.set(q.id, q.status));
      S.emit('playtest');
      S.emit('linkstate');
    } catch (e) { /* server briefly unavailable */ }
    setTimeout(pollPlaytest, 900);
  }

  function nodeAnchor(nid) {
    for (const q of S.project.quests) {
      const n = q.nodes.find((x) => x.id === nid);
      if (n) {
        const f = S.nodePosFields(n).find((x) => x.pos);
        if (f) return DS.resolvePos(f.pos);
      }
    }
    return null;
  }
  L.ptGoToNode = function (nid) {
    const a = nodeAnchor(nid);
    if (!a) { DS.toast('That node has no position', 'warn'); return; }
    L.ptTeleport(a.x, a.z);
  };
  L.ptSimKillNode = function (nid) {
    for (const q of S.project.quests) {
      const n = q.nodes.find((x) => x.id === nid);
      if (n && n.type === 'obj_kill') {
        const cls = n.p.classes && n.p.classes.length ? n.p.classes[0] : '@infected';
        return L.ptSimKill(cls, Math.max(1, (n.p.count || 1)));
      }
    }
  };

  /* ---------------------------------------------------------------- launching */
  // the map's Central Economy in the Studio viewport: loot in buildings, infected, animals, cars (on unless turned off)
  L.economy = (() => { try { return localStorage.getItem('dzstudio.economy') !== '0'; } catch (e) { return true; } })();
  // the project's loot (edited spawn points, placed buildings that have loot) replaces the map's own files in game
  function lootFiles() {
    const Lt = DS.Loot;
    if (!Lt || Lt.loadedWorld !== S.project.meta.world || Lt.state !== 'ok') return null;
    if (!Lt.modified() && !Lt.autoInstances().length) return null;
    return { 'mapgrouppos.xml': Lt.exportPos(), 'mapgroupproto.xml': Lt.exportProto() };
  }

  L.launch = async function (opts) {
    if (L.launching || L.fresh) return;
    const pt = !!(opts && opts.playtest);
    L.launching = true;
    L.msg = L.engine === 'dabs' || pt ? 'Starting DayZ… (about 40 s)' : 'Starting DayZ… (about 40 s)';
    S.emit('linkstate');
    let r;
    try {
      const exp = opts && opts.exportName ? opts.exportName : '';
      const body = { world: S.project.meta.world, playtest: pt, exportName: exp, engine: pt || exp ? 'world' : L.engine };
      if (body.engine === 'world' && L.economy) Object.assign(body, { economy: true, loot: lootFiles() });
      r = host ? await host.launchEditor(body) : await api('/api/editor/launch', body);
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    if (!r.ok) {
      L.launching = false;
      L.msg = r.error || 'Could not start the game';
      DS.toast(L.msg, 'error', 6000);
    }
    S.emit('linkstate');
  };
  L.close = async function () {
    if (host) host.closeGame();
    else await api('/api/capture/stop', {});
    L.fresh = false;
    L.launching = false;
    L.docked = false;
    L.msg = '';
    S.emit('linkstate');
  };

  /* live sync: any project edit -> debounced diff push */
  S.on('changed', (kind) => {
    if (!L.fresh || !L.live || busy) return;
    if (kind === 'objects' || kind === 'structure' || kind === 'any') schedulePush(false);
  });

  if (host) {
    host.onGameState((st) => {
      L.docked = st.state === 'docked';
      if (st.state === 'docked') { L.msg = 'Game window docked — waiting for the Editor…'; }
      if (st.state === 'closed') { L.launching = false; L.fresh = false; L.msg = 'The game was closed.'; }
      S.emit('linkstate');
      layout();
    });
  }

  /* ---------------------------------------------------------------- Game view (UI) */
  let root, bar, embed, overlayMsg, statusChip;
  L.initView = function (container) {
    root = container;
    root.innerHTML = '';
    bar = el('div', { class: 'gv-bar' });
    overlayMsg = el('div', { class: 'gv-overlay' });
    embed = el('div', { class: 'gv-embed' }, overlayMsg);
    root.append(bar, embed);
    new ResizeObserver(layout).observe(embed);
    window.addEventListener('resize', layout);
    new MutationObserver(layout).observe(document.body, { childList: true });
    new MutationObserver(layout).observe(document.getElementById('modal-root'), { childList: true });
    S.on('linkstate', renderBar);
    S.on('link', renderBar);
    S.on('view', () => { renderBar(); layout(); });
    S.on('layout', layout);   // docked somewhere else: follow the panel
    renderBar();
    setTimeout(poll, 300);
  };

  function overlayOpen() {
    return !!document.querySelector('.modal-back, .ctx-menu');
  }

  function layout() {
    if (!host || !embed) return;
    const r = embed.getBoundingClientRect();
    const visible = S.shown('game') && !overlayOpen() && r.width > 40 && r.height > 40;
    host.setRect({ x: r.left, y: r.top, w: r.width, h: r.height, visible });
    renderOverlay();
  }

  function renderOverlay() {
    if (!overlayMsg) return;
    const show = !L.fresh && !(L.desktop && L.docked);
    overlayMsg.classList.toggle('hidden', !show && L.desktop);
    overlayMsg.innerHTML = '';
    if (L.fresh && !L.desktop) {
      overlayMsg.classList.remove('hidden');
      overlayMsg.append(el('h3', null, 'Connected to the DayZ Editor'), el('p', null, 'The game runs in its own window. Edits sync both ways. For the game inside this window, start DayZ Studio Desktop (run_desktop.bat).'));
      return;
    }
    if (L.fresh) return;
    if (L.launching) {
      overlayMsg.append(el('div', { class: 'spinner' }), el('h3', null, 'Starting DayZ…'), el('p', null, L.msg || 'Loading the Editor and the map. This takes around 40 seconds.'));
      return;
    }
    overlayMsg.append(
      el('h3', null, 'DayZ Editor'),
      el('p', null, 'Launch the real game with the DayZ Studio viewport mod. It appears here and everything you place in Studio shows up in it. Fly with WASD, Q / E and the right mouse button.'),
      el('button', { class: 'btn primary', onclick: () => L.launch() }, '▶ Launch DayZ Editor — ' + S.world().name),
      L.desktop ? null : el('p', { class: 'muted' }, 'Tip: run_desktop.bat opens DayZ Studio Desktop, which embeds the game right here instead of a separate window.'));
    if (L.msg) overlayMsg.append(el('p', { class: 'muted' }, L.msg));
  }


  const QSTAT = ['not started', 'running', 'completed'];
  function playtestRow() {
    const row = el('div', { class: 'gv-pt' });
    if (!PT.on) {
      row.append(
        el('button', { class: 'btn primary', disabled: PT.building || !S.project.quests.length, title: 'Run your quests inside the real game and watch them progress here', onclick: () => L.startPlaytest() }, PT.building ? '◌ Building…' : '🧪 Play-test quests'),
        el('span', { class: 'muted' }, PT.msg || 'Runs the exported quest framework in the game, with test controls. The game restarts with the quest runtime loaded.'));
      return row;
    }
    const q = S.activeQuestObj();
    const qs = q && PT.questStatus ? PT.questStatus.get(q.id) : null;
    row.append(
      el('span', { class: 'gv-chip ' + (PT.errors.length ? 'off' : PT.loaded ? 'ok' : 'wait') }, PT.errors.length ? '✖ Script errors' : PT.loaded ? (L.state && L.state.play ? '● Playing' : '● Quests running · editor camera') : '◌ Waiting for the game…'),
      el('button', { class: 'btn sm primary', disabled: !L.fresh, title: 'Drop into normal first-person play where the camera is (F2 in the game toggles)', onclick: () => L.setMode(L.state && L.state.play ? 'edit' : 'play') }, L.state && L.state.play ? '◼ Back to editor (F2)' : '▶ Play (F2)'),
      el('button', { class: 'btn sm primary', disabled: !L.fresh, title: 'Teleport to where this quest starts: the camera in editor mode, the player in play mode', onclick: () => L.gotoQuestStart() }, '⌖ Go to quest start'),
      el('button', { class: 'btn sm', disabled: !L.fresh, title: 'Start playing as the character right at the quest start', onclick: () => L.playAtQuestStart() }, '▶ Play at quest start'),
      el('button', { class: 'btn sm', disabled: !L.fresh, title: 'Send the current quests to the game now (also happens automatically when you edit)', onclick: () => L.ptReload() }, '↻ Reload quests'),
      el('button', { class: 'btn sm', disabled: !L.fresh, title: 'Forget all quest progress', onclick: () => L.ptReset() }, '⟲ Reset progress'),
      el('button', { class: 'btn sm', disabled: !L.fresh, title: 'Count one infected kill for active kill objectives', onclick: () => L.ptSimKill('@infected', 1) }, '☠ Simulate kill'),
      el('button', { class: 'btn sm', disabled: !L.fresh || !L.camera, title: 'Spawn 5 infected where the camera is looking', onclick: () => L.ptSpawn('ZmbM_CitizenASkinny_Blue', 5, L.camera.x, L.camera.z, 8) }, '🧟 Spawn infected'),
      el('button', { class: 'btn sm', disabled: !L.fresh, onclick: () => {
        const c = window.prompt('Item class name to give the test player', 'Apple');
        if (c) L.ptGive(c.trim(), 1);
      } }, '🎒 Give item'),
      el('button', { class: 'btn sm', onclick: () => L.stopPlaytest() }, 'Stop play-test'),
      q ? el('span', { class: 'muted' }, `${q.name}: ${qs == null ? '—' : QSTAT[qs] || qs}`) : null);
    if (PT.errors.length) {
      const box = el('div', { class: 'gv-pt-err' }, el('b', null, 'The game could not compile the quest scripts:'));
      PT.errors.slice(0, 6).forEach((e) => box.append(el('div', null, '• ' + e)));
      row.append(box);
    }
    if (PT.log.length) row.append(el('div', { class: 'gv-pt-log' }, PT.log.slice(-5).join('  ·  ')));
    return row;
  }

  function renderBar() {
    if (!bar) return;
    bar.innerHTML = '';
    const st = L.state;
    const chip = el('span', { class: 'gv-chip ' + (L.fresh ? 'ok' : L.launching ? 'wait' : 'off') },
      L.fresh ? `● Connected — ${st ? st.count : 0} objects${st && st.play ? ' · playing' : ''}` : L.launching ? '◌ Starting…' : '○ Not running');
    const t = (label, key, title) => el('label', { class: 'gv-tog', title }, el('input', { type: 'checkbox', checked: L[key], onchange: (e) => { L[key] = e.target.checked; if (key === 'live' && L.live && L.fresh) schedulePush(true); renderBar(); } }), label);
    bar.append(
      el('button', { class: 'btn primary', disabled: L.fresh || L.launching, onclick: () => L.launch() }, '▶ Launch'),
      el('select', { class: 'inp sm', disabled: L.fresh || L.launching, title: 'DayZ Studio viewport: the game runs without any other mod. DayZ Editor (Dabs): the game with the Dabs editor UI.', onchange: (e) => { L.engine = e.target.value; renderBar(); } },
        el('option', { value: 'world', selected: L.engine === 'world' }, 'Studio viewport'),
        el('option', { value: 'dabs', selected: L.engine === 'dabs' }, 'DayZ Editor (Dabs)')),
      el('label', { class: 'gv-tog', title: 'Run the map\'s Central Economy, like a real server: loot in buildings (your own loot spawn edits included), infected, animals and cars. Each launch starts fresh. Turn off for an empty world. Applies to the Studio viewport and play-tests; takes effect on the next launch.' },
        el('input', { type: 'checkbox', checked: L.economy, disabled: L.fresh || L.launching, onchange: (e) => { L.economy = e.target.checked; try { localStorage.setItem('dzstudio.economy', L.economy ? '1' : '0'); } catch (x) {} } }), '🎒 Loot & infected'),
      el('button', { class: 'btn', disabled: !L.fresh && !L.launching, onclick: () => L.close() }, '■ Close game'),
      chip,
      el('span', { class: 'sep' }),
      el('button', { class: 'btn', disabled: !L.fresh, title: 'Send every object of this project to the game', onclick: async () => { const r = await L.push(true); DS.toast(`Sent ${r.sent || 0} objects to the game`, 'ok', 1800); } }, '⇧ Push all'),
      el('button', { class: 'btn', disabled: !L.fresh, title: 'Bring objects (and edits) from the game into this project', onclick: () => L.pull(false) }, '⇩ Pull'),
      t('Live sync', 'live', 'Push every change you make here to the game as you work'),
      t('Auto-pull', 'autoPull', 'Pick up changes made inside the Editor automatically'),
      t('Follow camera on map', 'follow', 'Keep the 2D map centred on the game camera'),
      t('3D tab drives game camera', 'camSync', 'The camera of the 3D tab is mirrored in the game'),
      el('span', { class: 'sep' }),
      el('label', { class: 'gv-tog', title: 'Draw the active quest in the game: areas, NPCs, crates, flow lines' }, el('input', { type: 'checkbox', checked: L.previewOn, disabled: !L.fresh, onchange: (e) => L.setPreview(e.target.checked) }), '🧭 Quest preview'),
      el('label', { class: 'gv-tog', title: 'Show every quest, not just the one open in the Quests view' }, el('input', { type: 'checkbox', checked: L.previewAll, disabled: !L.fresh, onchange: (e) => L.setPreview(L.previewOn, e.target.checked) }), 'all quests'),
      el('span', { class: 'sep' }),
      el('button', { class: 'btn', disabled: !L.fresh, title: 'Fly the game camera to the selected object (F)', onclick: () => L.focusSelection() }, '⌖ Fly to selection'),
      L.desktop ? el('button', { class: 'btn', disabled: !L.docked, title: 'Give keyboard/mouse focus to the game', onclick: () => host.focusGame() }, '🎮 Focus game') : null,
      el('span', { class: 'tb-spacer' }),
      el('span', { class: 'muted' }, L.msg && L.fresh ? L.msg : ''));
    bar.append(playtestRow());
    renderOverlay();
    const sc = document.getElementById('st-link');
    if (sc) sc.textContent = L.fresh ? `Game link: connected (${st ? st.count : 0})` : L.launching ? 'Game link: starting…' : 'Game link: off';
  }
})();
