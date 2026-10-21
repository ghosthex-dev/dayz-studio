/* DayZ Studio - customizable workspace (v1): resizable / collapsible side panels, swap sides, UI scale and named
   workspaces (built-in presets + the user's own), all remembered per user in local storage.
   The ▦ toolbar button opens the menu; Ctrl+B / Ctrl+Alt+B show or hide the left / right panel.
   Layout state: { left, right (px), leftOpen, rightOpen, swap, scale, view } - see Docs/Workspace_v2_Plan.md for
   the docking version that builds on this. */
(function () {
  const DS = (window.DS = window.DS || {});
  const U = DS.util;
  const el = U.el;
  const W = (DS.Workspace = {});
  const KEY = 'dzstudio.workspace';
  const KEY_SAVED = 'dzstudio.workspaces';
  const MIN = 180, CENTER_MIN = 420;
  const DEFAULT = { left: 290, right: 330, leftOpen: true, rightOpen: true, swap: false, scale: 1 };
  const PRESETS = {
    Default: Object.assign({}, DEFAULT),
    Mapping: { left: 340, right: 300, leftOpen: true, rightOpen: true, swap: false, view: 'map' },
    'Quest writing': { left: 290, right: 420, leftOpen: false, rightOpen: true, swap: false, view: 'quests' },
    Focus: { left: 290, right: 330, leftOpen: false, rightOpen: false, swap: false },
  };
  const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
  const host = window.studioHost;

  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off: layout lasts this session */ } };

  let st = Object.assign({}, DEFAULT, read(KEY, {}));
  let current = st.name || 'Default';
  let ws, splitL, splitR;

  /** left / right are the panels' own widths; with swap the right panel sits in the first column */
  function widths() {
    const total = ws.clientWidth || window.innerWidth;
    const room = Math.max(0, total - CENTER_MIN);
    let l = st.leftOpen ? Math.max(MIN, st.left) : 0;
    let r = st.rightOpen ? Math.max(MIN, st.right) : 0;
    if (l + r > room) { const k = room / (l + r || 1); l = Math.round(l * k); r = Math.round(r * k); }   // a small window: shrink both
    return { l, r, total };
  }

  function apply() {
    if (!ws) return;
    const { l, r, total } = widths();
    const first = st.swap ? r : l, last = st.swap ? l : r;
    ws.style.gridTemplateColumns = `${first}px minmax(0, 1fr) ${last}px`;
    ws.style.gridTemplateAreas = st.swap ? '"right center left"' : '"left center right"';
    document.getElementById('left').style.display = st.leftOpen ? '' : 'none';
    document.getElementById('right').style.display = st.rightOpen ? '' : 'none';
    ws.classList.toggle('ws-swapped', !!st.swap);
    // the handles sit on the inner edge of each panel; a closed panel keeps a slim tab to open it again
    const seen = Math.min(total, window.innerWidth - Math.max(0, ws.getBoundingClientRect().left));   // a cramped toolbar can make the page wider than the window
    const place = (h, x, open, side) => {
      h.style.left = Math.max(0, Math.min(seen - 10, x - 4)) + 'px';
      h.classList.toggle('closed', !open);
      h.title = open ? 'Drag to resize  •  double-click to hide' : 'Show the ' + side + ' panel';
    };
    const leftX = st.swap ? total - l : l, rightX = st.swap ? r : total - r;
    place(splitL, leftX, st.leftOpen, 'left');
    place(splitR, rightX, st.rightOpen, 'right');
    if (host && host.setZoom) host.setZoom(st.scale || 1);
  }

  function save() {
    st.name = current;
    write(KEY, st);
  }

  function drag(side) {
    return (e) => {
      if (e.button !== 0) return;
      const open = side === 'left' ? st.leftOpen : st.rightOpen;
      if (!open) { set({ [side + 'Open']: true }); return; }
      e.preventDefault();
      const h = e.currentTarget;
      h.setPointerCapture(e.pointerId);
      h.classList.add('active');
      const rect = ws.getBoundingClientRect();
      // which edge of the window the panel is attached to
      const fromLeft = (side === 'left') !== !!st.swap;
      const move = (ev) => {
        const x = ev.clientX - rect.left;
        const w = Math.round(fromLeft ? x : rect.width - x);
        const other = side === 'left' ? (st.rightOpen ? st.right : 0) : (st.leftOpen ? st.left : 0);
        st[side] = Math.max(MIN, Math.min(w, rect.width - CENTER_MIN - other));
        apply();
      };
      const up = () => {
        h.classList.remove('active');
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        current = 'Custom';
        save();
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    };
  }

  function set(patch, name) {
    Object.assign(st, patch);
    current = name || 'Custom';
    apply();
    save();
  }

  W.toggle = (side) => set({ [side + 'Open']: !st[side + 'Open'] });
  W.state = () => Object.assign({}, st, { name: current });

  W.use = function (name) {
    const p = PRESETS[name] || read(KEY_SAVED, {})[name];
    if (!p) return;
    const keepScale = st.scale;
    st = Object.assign({}, DEFAULT, { scale: keepScale }, p);
    current = name;
    apply();
    save();
    if (p.view && DS.store && DS.store.setView) DS.store.setView(p.view);
    DS.toast('Workspace: ' + name, 'ok', 1500);
  };

  W.saveAs = function () {
    const name = (prompt('Name for this workspace (e.g. "Mapping on the laptop"):', current !== 'Custom' && !PRESETS[current] ? current : '') || '').trim();
    if (!name) return;
    if (PRESETS[name]) { DS.toast('"' + name + '" is a built-in workspace - pick another name', 'warn', 3500); return; }
    const all = read(KEY_SAVED, {});
    all[name] = Object.assign({}, st, { view: DS.store ? DS.store.view : undefined, name: undefined });
    write(KEY_SAVED, all);
    current = name;
    save();
    DS.toast('Saved workspace "' + name + '"', 'ok');
  };

  W.remove = function (name) {
    const all = read(KEY_SAVED, {});
    if (!all[name] || !confirm('Delete the workspace "' + name + '"?')) return;
    delete all[name];
    write(KEY_SAVED, all);
    if (current === name) { current = 'Custom'; save(); }
  };

  W.menu = function (anchor) {
    const saved = Object.keys(read(KEY_SAVED, {}));
    const mark = (on, t) => (on ? '✓ ' : '  ') + t;
    const items = [{ head: 'Workspaces' }];
    Object.keys(PRESETS).forEach((n) => items.push({ label: mark(current === n, n), run: () => W.use(n) }));
    saved.forEach((n) => items.push({ label: mark(current === n, '★ ' + n), run: () => W.use(n) }));
    items.push({ label: '  Save current layout as…', run: W.saveAs });
    if (saved.length) items.push({ label: '  Delete a saved workspace…', run: () => {
      const n = prompt('Delete which workspace?\n' + saved.join('\n'), saved[0]);
      if (n) W.remove(n.trim());
    } });
    items.push('-', { head: 'Panels' },
      { label: mark(st.leftOpen, 'Show left panel (assets, loot…)'), key: 'Ctrl+B', run: () => W.toggle('left') },
      { label: mark(st.rightOpen, 'Show right panel (inspector)'), key: 'Ctrl+Alt+B', run: () => W.toggle('right') },
      { label: mark(st.swap, 'Swap left and right'), run: () => set({ swap: !st.swap }) },
      '-', { head: host && host.setZoom ? 'Interface size' : 'Interface size (use Ctrl + / Ctrl − in the browser)' });
    if (host && host.setZoom) SCALES.forEach((s) => items.push({ label: mark(Math.abs((st.scale || 1) - s) < 0.01, Math.round(s * 100) + '%'), run: () => set({ scale: s }, current) }));
    items.push('-', { label: '  Reset to default', run: () => W.use('Default') });
    DS.app.dropdown(anchor, items);
  };

  W.init = function () {
    ws = document.getElementById('workspace');
    if (!ws) return;
    document.getElementById('left').style.gridArea = 'left';
    document.getElementById('center').style.gridArea = 'center';
    document.getElementById('right').style.gridArea = 'right';
    splitL = el('div', { class: 'ws-split', onpointerdown: drag('left'), ondblclick: () => W.toggle('left') });
    splitR = el('div', { class: 'ws-split', onpointerdown: drag('right'), ondblclick: () => W.toggle('right') });
    ws.append(splitL, splitR);
    window.addEventListener('resize', apply);
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b' || e.shiftKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      W.toggle(e.altKey ? 'right' : 'left');
    });
    apply();
  };
})();
