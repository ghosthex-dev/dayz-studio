/* DayZ Studio - the project's mods (Inspector > Project > Mods). Pick Steam Workshop mods you are subscribed to (or
   @folders in the DayZ folder) to load wherever Studio starts DayZ for this project: the game view, captures, the local
   server and Join. The mods they require are added by the studio server (CfgPatches requiredAddons, e.g. -> CF);
   "server only" mods go into the local server's -serverMod and stay off the client. A project keeps its list in
   meta.mods = [{id, name, serverOnly}] (id = Workshop id or '@folder', the same on every PC); named lists that any
   project can load are kept by the studio server in data/modlists.json. */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const M = (DS.Mods = {});

  M.info = null;   // { mods: [{id, name, path, workshop, maps, needs, missing}], lists: [{name, mods}] } from /api/mods
  let loading = null;
  const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());

  M.refresh = function () {
    loading = api('/api/mods').then((r) => { M.info = r && r.ok ? r : { mods: [], lists: [] }; return M.info; })
      .catch(() => { M.info = null; return null; });
    return loading;
  };
  M.ready = () => loading || M.refresh();

  M.entries = () => (S.project.meta.mods || []).filter((e) => e && e.id);
  /** what the launch / build calls send: [{id, name, serverOnly}] */
  M.forLaunch = () => M.entries().map((e) => ({ id: e.id, name: e.name || '', serverOnly: !!e.serverOnly }));
  const find = (id) => (M.info ? M.info.mods.find((m) => m.id.toLowerCase() === String(id).toLowerCase()) : null);
  const nameOf = (id) => { const m = find(id); return m ? m.name : id; };
  const where = (m) => (m.workshop ? 'Workshop ' + m.id : m.id + ' in the DayZ folder');

  /** the Mods section of the project inspector */
  M.section = function (rerender) {
    if (!M.info && !loading) M.ready().then(rerender);
    const list = M.entries();
    const kids = [];
    if (!list.length) kids.push(el('div', { class: 'ins-help' }, 'None - DayZ starts with Studio\'s own mods only (and a mod map\'s mods). Add Workshop mods you are subscribed to, e.g. a building pack you place objects from, to test with them.'));
    else {
      list.forEach((e) => {
        const m = find(e.id);
        kids.push(el('div', { class: 'mod-row' },
          el('span', { class: 'mod-name' + (M.info && !m ? ' warn-text' : '') }, (m ? m.name : e.name || e.id) + (M.info && !m ? ' (not installed)' : '')),
          el('span', { class: 'muted' }, e.serverOnly ? 'server only' : m && m.needs.length ? '+ ' + m.needs.map(nameOf).join(', ') : '')));
      });
      kids.push(el('div', { class: 'ins-help' }, 'Loaded in the game view, captures, the local server and Join. Mods they require come along by themselves.'));
    }
    kids.push(el('div', { class: 'btn-row' }, el('button', { class: 'btn sm', onclick: () => M.open() }, '🧩 Choose mods…')));
    return DS.Inspector.section(`Mods (${list.length})`, ...kids);
  };

  /** the picker: every installed mod, the project's choice, and the saved lists */
  M.open = async function () {
    const info = await M.refresh();
    if (!info) { DS.toast('The studio server is not running.', 'error', 4000); return; }
    // the working copy: id -> {id, name, serverOnly}, in the order picked
    const pick = new Map(M.entries().map((e) => [e.id.toLowerCase(), { id: e.id, name: e.name || nameOf(e.id), serverOnly: !!e.serverOnly }]));
    let filter = '';
    const listBox = el('div', { class: 'mod-list' });
    const listSel = el('select', { class: 'inp' });
    const count = el('span', { class: 'muted' });

    function fillLists(sel) {
      listSel.innerHTML = '';
      listSel.append(el('option', { value: '' }, info.lists.length ? '— saved lists —' : 'No saved lists yet'));
      info.lists.forEach((l) => listSel.append(el('option', { value: l.name }, `${l.name} (${l.mods.length})`)));
      listSel.value = sel || '';
    }

    function draw() {
      listBox.innerHTML = '';
      const q = filter.toLowerCase();
      // chosen mods this PC doesn't have (a list from another PC, an unsubscribed mod) stay visible so they can be removed
      const gone = [...pick.values()].filter((p) => !find(p.id));
      gone.forEach((p) => listBox.append(el('div', { class: 'mod-pick gone' },
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: true, onchange: () => { pick.delete(p.id.toLowerCase()); draw(); } }),
          el('span', null, el('b', null, p.name || p.id), el('span', { class: 'warn-text' }, ' - not installed on this PC (' + p.id + ')'))))));
      info.mods.filter((m) => !q || (m.name + ' ' + m.id).toLowerCase().includes(q)).forEach((m) => {
        const p = pick.get(m.id.toLowerCase());
        const notes = [where(m)];
        if (m.maps.length) notes.push('map: ' + m.maps.map((w) => (DS.WORLDS.find((x) => x.id === w) || { name: w }).name).join(', ') + ' (loaded by itself on that map)');
        if (m.needs.length) notes.push('needs ' + m.needs.map(nameOf).join(', ') + ' (added by itself)');
        const so = el('label', { class: 'chk mod-so', title: 'Load it only on the local server (-serverMod), not in the game that joins - for server-side mods such as admin tools' },
          el('input', { type: 'checkbox', checked: !!(p && p.serverOnly), disabled: !p, onchange: (e) => { if (p) p.serverOnly = e.target.checked; } }), el('span', null, 'server only'));
        listBox.append(el('div', { class: 'mod-pick' + (p ? ' on' : '') },
          el('label', { class: 'chk' },
            el('input', { type: 'checkbox', checked: !!p, onchange: (e) => { if (e.target.checked) pick.set(m.id.toLowerCase(), { id: m.id, name: m.name, serverOnly: false }); else pick.delete(m.id.toLowerCase()); draw(); } }),
            el('span', null, el('b', null, m.name), el('span', { class: 'muted' }, ' · ' + notes.join(' · ')),
              m.missing.length ? el('span', { class: 'warn-text' }, ' · needs addons no installed mod brings: ' + m.missing.join(', ')) : null)),
          so));
      });
      if (!info.mods.length) listBox.append(el('div', { class: 'hint-box' }, 'No mods found. Subscribe to mods on the Steam Workshop (Steam downloads them into steamapps\\workshop\\content\\221100), or put @folders into your DayZ folder.'));
      count.textContent = `${pick.size} chosen`;
    }

    const search = el('input', { class: 'inp', type: 'search', placeholder: 'Search mods…' });
    search.addEventListener('input', () => { filter = search.value; draw(); });
    fillLists();
    const saveList = async (action, name) => {
      const r = await api('/api/mods/lists', { action, name, mods: [...pick.values()] }).catch(() => ({ ok: false, error: 'studio server not running' }));
      if (!r.ok) { DS.toast(r.error || 'Could not save the list', 'error', 5000); return; }
      info.lists = r.lists;
      fillLists(action === 'save' ? name : '');
      DS.toast(action === 'save' ? `Saved the mod list “${name}”.` : `Deleted the mod list “${name}”.`, 'ok', 3500);
    };
    const body = el('div', { class: 'mod-picker' },
      el('div', { class: 'hint-box' }, 'Choose the mods this project loads in the game view, captures (so “Capture class list” knows their items), the local test server and Join. Mods they require are added by themselves. Save a choice as a list to reuse it in other projects.'),
      el('div', { class: 'mod-lists' },
        listSel,
        el('button', { class: 'btn sm', title: 'Replace the choice with the saved list', onclick: () => {
          const l = info.lists.find((x) => x.name === listSel.value);
          if (!l) return DS.toast('Pick a saved list first.', 'warn', 3000);
          pick.clear();
          l.mods.forEach((e) => pick.set(e.id.toLowerCase(), { id: e.id, name: e.name || nameOf(e.id), serverOnly: !!e.serverOnly }));
          draw();
        } }, 'Load'),
        el('button', { class: 'btn sm', onclick: () => {
          const name = prompt('Save these mods as a list named:', listSel.value || S.project.meta.name || 'My mods');
          if (name && name.trim()) saveList('save', name.trim());
        } }, '💾 Save as list…'),
        el('button', { class: 'btn sm danger', onclick: () => {
          if (!listSel.value) return DS.toast('Pick a saved list first.', 'warn', 3000);
          if (confirm(`Delete the saved mod list “${listSel.value}”? Projects that use these mods keep them.`)) saveList('delete', listSel.value);
        } }, 'Delete')),
      el('div', { class: 'mod-search' }, search, count),
      listBox);
    draw();
    DS.app.modal({ title: '🧩 Mods for this project', body, wide: true, buttons: (close) => [
      el('button', { class: 'btn', onclick: close }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: () => {
        S.project.meta.mods = [...pick.values()];
        S.changed('meta');
        S.commit();
        DS.Inspector.render();
        close();
        DS.toast(pick.size ? `This project loads ${pick.size} mod(s). Restart the game view or server to use them.` : 'This project loads no extra mods.', 'ok', 5000);
      } }, 'Use these mods')] });
  };

  // the list may change in Steam while Studio runs: look again when a project is opened
  S.on('project', () => { if (M.info) M.refresh(); });
})();
