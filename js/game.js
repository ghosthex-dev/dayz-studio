/* DayZ Studio - game connection panel: talks to tools/studio_server.py to capture terrain from the real
   game and to hand the project to the DayZ Editor mod. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const G = (DS.Game = {});

  G.server = null; // env object when the studio server answered
  G.job = { running: false, msg: '', pct: 0 };
  G.checked = false;

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }

  G.refresh = async function () {
    try {
      const env = await api('/api/env');
      G.server = env && env.ok ? env : null;
    } catch (e) {
      G.server = null;
    }
    G.checked = true;
    S.emit('game');
  };

  /** every class we want a bounding box for: loot groups, placed objects and the catalogue */
  function classList() {
    const set = new Set();
    if (DS.Loot) DS.Loot.protoNames().forEach((n) => set.add(n));
    S.project.objects.forEach((o) => o.c && set.add(o.c));
    DS.CATALOG.forEach((c) => c.items.forEach((i) => set.add(i[0])));
    DS.imported.buildings.forEach((c) => set.add(c));
    return [...set].filter((c) => /^[A-Za-z0-9_\-]+$/.test(c));
  }

  G.capture = async function (n) {
    const world = S.project.meta.world;
    G.job = { running: true, msg: 'Starting DayZ…', pct: 2 };
    S.emit('game');
    const classes = classList();
    let r;
    try {
      r = await api('/api/capture/start', { world, size: S.project.meta.mapSize, n, classes });
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    if (!r.ok) {
      G.job = { running: false, msg: r.error || 'Could not start the game', pct: 0, error: true };
      S.emit('game');
      return;
    }
    const t0 = Date.now();
    const timer = setInterval(async () => {
      let st;
      try { st = await api('/api/capture/status'); } catch (e) { return; }
      const el_ = Math.round((Date.now() - t0) / 1000);
      if (st.captureDone) {
        clearInterval(timer);
        G.job = { running: true, msg: 'Importing…', pct: 98 };
        S.emit('game');
        await api('/api/capture/finalize', { world });
        await DS.Terrain.load(world);
        await DS.Bounds.load(world);
        G.job = { running: true, msg: 'Building 3D building models from the game files…', pct: 99 };
        S.emit('game');
        try { await api('/api/models/build', { world }); await DS.Models.load(world); } catch (e) {}
        await G.refresh();
        G.job = { running: false, msg: `Done — ${classes.length} models measured, terrain loaded.`, pct: 100 };
        DS.toast('Terrain captured from the game', 'ok');
      } else if (!st.running && el_ > 15) {
        clearInterval(timer);
        G.job = { running: false, msg: 'The game closed before the capture finished. Check the log below.', pct: 0, error: true };
      } else {
        const frac = st.heightsDone ? (st.boundsDone ? 0.95 : 0.8) : Math.min(0.75, 0.1 + el_ / (n >= 2048 ? 200 : n >= 1024 ? 90 : 45) * 0.65);
        G.job = { running: true, msg: st.heightsDone ? 'Measuring models…' : st.running ? 'Sampling terrain heights in the game…' : 'Starting DayZ…', pct: Math.round(frac * 100) };
      }
      S.emit('game');
    }, 2000);
  };

  /** scan every object of the world in the game (trees, rocks, props, buildings) and build the 3D scene from it */
  G.captureScene = async function () {
    const world = S.project.meta.world;
    const size = S.project.meta.mapSize;
    G.job = { running: true, msg: 'Starting DayZ to scan the world objects… (about 3 minutes)', pct: 5 };
    S.emit('game');
    const r = await api('/api/capture/start', { world, size, n: 16, classes: [], scan: true, x0: 0, z0: 0, x1: size, z1: size, cell: 100 }).catch((e) => ({ ok: false, error: String(e) }));
    if (!r.ok) {
      G.job = { running: false, msg: r.error || 'Could not start the game', pct: 0, error: true };
      S.emit('game');
      return;
    }
    const t0 = Date.now();
    const timer = setInterval(async () => {
      let st;
      try { st = await api('/api/capture/status'); } catch (e) { return; }
      if (st.scanDone || st.captureDone) {
        clearInterval(timer);
        G.job = { running: true, msg: 'Building the 3D scene from the scan…', pct: 70 };
        S.emit('game');
        await api('/api/capture/finalize', { world });
        const b = await api('/api/scene/build', { world }).catch((e) => ({ ok: false, log: [String(e)] }));
        if (b.ok) {
          DS.Scene.world = null;
          await DS.Scene.load(world);
          if (DS.Models) await DS.Models.reload();
          G.job = { running: false, msg: `Scene ready — ${DS.Scene.count.toLocaleString()} map objects.`, pct: 100 };
          DS.toast('World objects added to the 3D tab', 'ok');
        } else G.job = { running: false, msg: 'Scene build failed: ' + (b.log || []).join(' '), pct: 0, error: true };
      } else if (!st.running && Date.now() - t0 > 20000) {
        clearInterval(timer);
        G.job = { running: false, msg: 'The game closed before the scan finished.', pct: 0, error: true };
      } else G.job = { running: true, msg: 'Scanning the world objects in the game…', pct: Math.min(65, 10 + Math.round((Date.now() - t0) / 3000)) };
      S.emit('game');
    }, 2500);
  };

  /** list every class of the game (names, parents, models) so the whole library can be browsed + placed */
  G.captureClasses = async function () {
    const world = S.project.meta.world;
    G.job = { running: true, msg: 'Starting DayZ to read the class list…', pct: 10 };
    S.emit('game');
    const r = await api('/api/capture/start', { world, size: S.project.meta.mapSize, n: 16, classes: [], list: true }).catch((e) => ({ ok: false, error: String(e) }));
    if (!r.ok) {
      G.job = { running: false, msg: r.error || 'Could not start the game', pct: 0, error: true };
      S.emit('game');
      return;
    }
    const timer = setInterval(async () => {
      let st;
      try { st = await api('/api/capture/status'); } catch (e) { return; }
      if (st.listDone || st.captureDone) {
        clearInterval(timer);
        await api('/api/capture/finalize', { world });
        DS.Classes.world = null;
        await DS.Classes.load(world);
        G.job = { running: false, msg: `Class list captured — ${DS.Classes.list.length} classes.`, pct: 100 };
        DS.toast('Game class library updated', 'ok');
      } else if (!st.running) {
        clearInterval(timer);
        G.job = { running: false, msg: 'The game closed before the class list was written.', pct: 0, error: true };
      }
      S.emit('game');
    }, 2000);
  };

  G.launchEditor = async function () {
    const r = await api('/api/editor/launch', { world: S.project.meta.world });
    if (!r.ok) DS.toast(r.error || 'Could not start DayZ', 'error', 6000);
    else DS.toast('Starting DayZ with the Editor mod… choose the map, then File ▸ Import ▸ Object Spawner', 'ok', 7000);
  };

  /** project objects as an Object Spawner file with real heights baked in */
  G.handoff = async function () {
    const files = DS.exporters.build({ objects: true });
    const f = files.find((x) => x.path.endsWith('_objects.json'));
    if (!f) return null;
    const r = await api('/api/handoff', { name: U.safeName(S.project.meta.name) + '_objects.json', text: f.data });
    return r.ok ? r.path : null;
  };

  /* ---------------- panel ---------------- */
  G.panel = function (body, search, redraw) {
    if (!G.checked) { G.refresh().then(redraw); }
    const sv = G.server;
    const world = S.project.meta.world;
    const T = DS.Terrain;

    // connection
    const conn = el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, 'Connection'));
    if (!sv) {
      conn.append(
        el('div', { class: 'hint-box' }, G.checked
          ? 'The DayZ Studio server is not running, so the editor cannot reach the game.'
          : 'Looking for the DayZ Studio server…'),
        el('div', { class: 'ins-help' }, 'Start it by double-clicking run_studio.bat in the DayZ Studio folder (or run: python tools/studio_server.py) and open http://localhost:8765 instead of the file.'),
        el('button', { class: 'btn sm', onclick: () => G.refresh().then(redraw) }, 'Check again'));
      body.append(conn);
    } else {
      const row = (ok, label, detail) => el('div', { class: 'g-row' }, el('span', { class: 'g-dot ' + (ok ? 'ok' : 'bad') }, ok ? '✔' : '✖'), el('span', null, label), detail ? el('span', { class: 'asset-sub' }, detail) : null);
      conn.append(
        row(!!sv.game, 'DayZ game', sv.game ? 'found' : 'not found'),
        row(!!sv.tools, 'DayZ Tools', sv.tools ? 'found' : 'optional'),
        row(!!sv.mods.CF, 'CF (only for the Dabs editor)'),
        row(!!sv.mods.DabsFramework, 'Dabs Framework (optional)'),
        row(!!sv.mods.DayZEditor, 'DayZ-Editor mod (optional)'));
      body.append(conn);

      // terrain capture
      const sec = el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, 'Terrain from the game'));
      sec.append(el('div', { class: 'ins-help' }, 'Runs DayZ once with a small helper mod. The game itself measures the real terrain height and the size of every building model, then closes. Takes about a minute.'));
      const has = T.state === 'ok' && T.world === world;
      sec.append(row(has, `Terrain heights — ${world}`, has ? `${T.n}×${T.n}` : 'not captured'));
      sec.append(row(DS.Bounds.map.size > 0 && DS.Bounds.world === world, 'Model sizes', DS.Bounds.map.size ? DS.Bounds.map.size + ' models' : 'not captured'));
      sec.append(row(DS.Models && DS.Models.state === 'ok', '3D building models', DS.Models && DS.Models.state === 'ok' ? DS.Models.count() + ' models' : 'not built'));
      const res = el('select', { class: 'inp' },
        el('option', { value: '512' }, 'Draft  (512 × 512, ~30 m)'),
        el('option', { value: '1024', selected: true }, 'Standard  (1024 × 1024, ~15 m)'),
        el('option', { value: '2048' }, 'Fine  (2048 × 2048, ~7.5 m)'));
      sec.append(el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Resolution'), res));
      const j = G.job;
      if (j.running || j.msg) {
        sec.append(el('div', { class: 'progress' }, el('div', { class: 'bar', style: { width: (j.pct || 0) + '%' } })));
        sec.append(el('div', { class: j.error ? 'issue error' : 'ins-help' }, j.msg));
      }
      sec.append(el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary', disabled: j.running || !sv.game, onclick: () => G.capture(+res.value) }, has ? '↻ Re-capture' : '⬇ Capture from the game'),
        j.running ? el('button', { class: 'btn', onclick: () => api('/api/capture/stop', {}) }, 'Stop') : null,
        el('button', { class: 'btn', disabled: j.running || !sv.game, title: 'Read every class of the game (names + models) into the Assets library', onclick: () => G.captureClasses() }, '☰ Capture class list'),
        el('button', { class: 'btn', disabled: j.running || !sv.game, title: 'Scan every tree, rock, prop and building of the world in the game and show them in the 3D tab (about 3 minutes)', onclick: () => G.captureScene() }, '🌲 Capture world objects'),
        el('button', { class: 'btn', disabled: j.running || !has, title: 'Re-read the building models from the game files (no game launch)', onclick: async () => {
          G.job = { running: true, msg: 'Building 3D models…', pct: 50 }; S.emit('game');
          const r = await api('/api/models/build', { world });
          await DS.Models.load(world);
          G.job = { running: false, msg: r.ok ? 'Models rebuilt.' : 'Model build failed: ' + (r.log || []).join(' '), pct: 100, error: !r.ok };
          S.emit('game');
        } }, '▦ Build 3D models')));
      body.append(sec);

      // editor
      const ed = el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, 'Game viewport'));
      ed.append(
        el('div', { class: 'ins-help' }, 'The real game runs in the Game view with a small DayZ Studio mod only (no other mods needed): objects you place appear in it, the 3D tab camera is mirrored, and WASD / Q E / right-mouse look fly the camera. The Dabs editor remains available as an alternative engine.'),
        el('button', { class: 'btn primary', onclick: () => S.setView('game') }, '🎮 Open the Game view'));
      body.append(ed);

      // log
      body.append(el('div', { class: 'ins-sec' },
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn sm', onclick: async () => {
            const r = await api('/api/rpt');
            DS.app.modal({ title: 'Game log (script lines)', wide: true, body: el('pre', { class: 'logbox' }, r.text || '(empty)'), buttons: (c) => el('button', { class: 'btn', onclick: c }, 'Close') });
          } }, 'View game log'),
          el('button', { class: 'btn sm', onclick: () => G.refresh().then(redraw) }, 'Refresh'))));
    }
  };

  S.on('game', () => {});
})();
