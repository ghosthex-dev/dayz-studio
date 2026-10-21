/* DayZ Studio - publish the quest mod to the Steam Workshop (File ▸ Publish to Steam Workshop).
   S.project.workshop = { id, title, description, overview, tags: [], visibility, preview (data URL, own image only) }
   Builds the mod, then the studio server uploads addons + keys + mod.cpp through the Steam client (tools/workshop.py). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const W = (DS.Workshop = {});

  const VIS = [['private', 'Private - only you (check it first)'], ['unlisted', 'Unlisted - anyone with the link'], ['friends', 'Friends only'], ['public', 'Public - everyone']];
  const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
  const itemUrl = (id) => 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + id;
  const plain = (bb) => String(bb || '').replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, '').replace(/\n{2,}/g, '\n').trim();
  const kb = (n) => (n / 1024 < 1024 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  /** a starting description (Steam BBCode) from what the project contains */
  W.describe = function (P, title) {
    const nm = U.safeName(P.meta.modName || 'DZStudioQuests');
    const has = [];
    if (P.quests.length) has.push(`${P.quests.length} quest${P.quests.length > 1 ? 's' : ''} with NPC conversations, a quest tracker and a journal`);
    const fac = (P.factions && P.factions.list) || [];
    if (fac.length) has.push(`faction standings (${fac.map((f) => f.name || f.id).join(', ')})`);
    if ((P.stats || []).length) has.push('player stats: ' + P.stats.map((s) => s.name || s.id).join(', '));
    if ((P.itemReqs || []).length) has.push('items that need a stat to use');
    if ((P.hud || []).length) has.push('an on-screen HUD');
    return `${title || nm} adds ${has.length ? has.join(', ') : 'quests'} to DayZ.\n\n` +
      '[h2]For players[/h2]\nSubscribe and join a server that runs it - the mod only shows the conversations, tracker and HUD.\n\n' +
      '[h2]For server owners[/h2]\n[list]\n' +
      `[*]Add [b]@${nm}[/b] to -mod= on the server and copy [b]keys/${nm}.bikey[/b] into the server's keys folder.\n` +
      '[*]The quests themselves live on the server: copy the profile/DZStudioQuests folder from the mod author into your server profile folder.\n' +
      '[/list]\n\nMade with [url=https://github.com/ghosthex-dev/dayz-studio]DayZ Studio[/url].';
  };

  /** a 512x512 preview: the title on a dark card, used when no own image is chosen */
  W.defaultPreview = function (title) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#1b2a24');
    grd.addColorStop(1, '#0c1210');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = '#c8a864';
    g.lineWidth = 6;
    g.strokeRect(24, 24, 464, 464);
    g.fillStyle = '#e8e2d0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // wrap the title on up to three lines, as large as fits
    const words = String(title || 'Quest mod').split(/\s+/);
    let size = 64, lines;
    for (; size >= 28; size -= 4) {
      g.font = `bold ${size}px Segoe UI, Arial, sans-serif`;
      lines = [''];
      words.forEach((w) => {
        const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w;
        if (g.measureText(t).width > 410 && lines[lines.length - 1]) lines.push(w);
        else lines[lines.length - 1] = t;
      });
      if (lines.length <= 3 && lines.every((l) => g.measureText(l).width <= 410)) break;
    }
    lines.forEach((l, i) => g.fillText(l, 256, 230 + (i - (lines.length - 1) / 2) * size * 1.15));
    g.font = '22px Segoe UI, Arial, sans-serif';
    g.fillStyle = '#c8a864';
    g.fillText('DAYZ QUEST MOD', 256, 410);
    return c.toDataURL('image/jpeg', 0.9);
  };

  /** an image file -> JPEG data URL, longest side at most 1024 px (Steam takes up to 1 MB) */
  const loadImage = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.9, url = c.toDataURL('image/jpeg', q);
      while (url.length * 0.75 > 1000000 && q > 0.4) url = c.toDataURL('image/jpeg', (q -= 0.1));
      URL.revokeObjectURL(img.src);
      resolve(url);
    };
    img.onerror = () => reject(new Error('not an image'));
    img.src = URL.createObjectURL(file);
  });

  W.open = function () {
    const P = S.project;
    const w = (P.workshop = P.workshop || {});
    const nm = U.safeName(P.meta.modName || 'DZStudioQuests');
    const defTitle = P.meta.name && P.meta.name !== 'Untitled Project' ? P.meta.name : nm;
    const f = {
      title: el('input', { class: 'inp', maxlength: 128, value: w.title || defTitle }),
      desc: el('textarea', { class: 'inp', rows: 9, maxlength: 8000 }),
      vis: el('select', { class: 'inp' }, VIS.map(([v, l]) => el('option', { value: v }, l))),
      note: el('textarea', { class: 'inp', rows: 3, maxlength: 8000, placeholder: 'What changed in this version (shown on the Workshop page under Change Notes)' }),
    };
    f.desc.value = w.description || W.describe(P, w.title || defTitle);
    f.vis.value = w.visibility || 'private';
    const tags = new Set(w.tags || ['Mechanics']);
    const tagBox = el('div', { class: 'chips' });
    let own = w.preview || null;
    const img = el('img', { style: { width: '128px', height: '128px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--line2)' } });
    const showPreview = () => { img.src = own || W.defaultPreview(f.title.value); };
    f.title.addEventListener('input', () => { if (!own) showPreview(); });
    const pick = el('input', { type: 'file', accept: 'image/png,image/jpeg', style: { display: 'none' }, onchange: async () => {
      if (!pick.files[0]) return;
      try { own = await loadImage(pick.files[0]); showPreview(); } catch (e) { DS.toast('That file is not an image', 'error'); }
      pick.value = '';
    } });
    const status = el('div', { class: 'srv-info' }, 'Checking Steam…');
    const out = el('div');
    const linkRow = el('div');
    const publishBtn = el('button', { class: 'btn primary' }, '☁ Publish');
    let busy = false;

    const drawTags = (all) => {
      tagBox.replaceChildren();
      tagBox.append(el('span', { class: 'chip on', title: 'Always set - the DayZ launcher lists items tagged Mod' }, 'Mod'));
      all.forEach((t) => tagBox.append(el('button', { class: 'chip' + (tags.has(t) ? ' on' : ''), onclick: () => { tags.has(t) ? tags.delete(t) : tags.add(t); drawTags(all); } }, t)));
    };
    const drawLink = () => {
      linkRow.replaceChildren();
      if (!w.id) {
        linkRow.append(el('div', { class: 'ins-help' }, 'Not published yet - the first publish creates a new Workshop item. Studio remembers it, so later publishes update the same item.'));
        f.note.disabled = true;
        f.note.placeholder = 'Change notes can be added from the second publish on';
        return;
      }
      f.note.disabled = false;
      linkRow.append(el('div', { class: 'btn-row', style: { alignItems: 'center' } },
        el('span', null, 'Workshop item ', el('b', null, w.id)),
        el('a', { class: 'btn', href: itemUrl(w.id), target: '_blank' }, '↗ Open on Steam'),
        el('button', { class: 'btn', title: 'Forget the item: the next publish creates a new Workshop item', onclick: () => {
          if (!confirm('Forget Workshop item ' + w.id + '? The next publish creates a NEW item. (The old one stays on Steam - delete it there if you want.)')) return;
          delete w.id;
          S.commit();
          drawLink();
        } }, 'Publish as a new item…')));
    };

    const save = () => {
      w.title = f.title.value.trim();
      w.description = f.desc.value;
      w.overview = plain(f.desc.value).split('\n')[0].slice(0, 600);
      w.tags = [...tags];
      w.visibility = f.vis.value;
      if (own) w.preview = own; else delete w.preview;
      S.commit();
    };

    const say = (cls, text) => { out.replaceChildren(); if (text) out.append(el('div', { class: cls }, text)); };
    const publish = async () => {
      if (busy) return;
      save();
      if (!w.title) return say('problem error', 'Give the item a title.');
      busy = true;
      publishBtn.disabled = true;
      try {
        say('ins-help', 'Building the mod…');
        const payload = DS.exporters.modPayload();
        const bad = DS.exporters.checkScripts ? DS.exporters.checkScripts(payload) : [];
        if (bad.length) {
          say('problem error', 'The scripts would not compile in DayZ, so nothing was published:');
          bad.slice(0, 10).forEach((e) => out.append(el('div', { class: 'problem error' }, e.text)));
          return;
        }
        const b = await api('/api/mod/build', payload);
        if (!b.ok) return say('problem error', 'Build failed: ' + (b.error || 'unknown error'));
        if (!b.signed) out.append(el('div', { class: 'warn-text' }, `The mod is not signed (${b.signNote || 'DayZ Tools missing'}) - servers that check signatures will refuse it.`));
        const r = await api('/api/workshop/publish', { name: b.name, id: w.id || '', title: w.title, description: w.description, tags: w.tags,
          visibility: w.visibility, changeNote: w.id ? f.note.value : '', preview: own || W.defaultPreview(w.title) });
        if (!r.ok) return say('problem error', r.error || 'Could not start the upload');
        const bar = el('div', { class: 'bar', style: { width: '0%' } });
        const line = el('div', { class: 'ins-help' }, 'Talking to Steam…');
        out.replaceChildren();
        out.append(line, el('div', { class: 'progress' }, bar));
        const STAGES = { starting: 'Starting Steam…', creating: 'Creating the Workshop item…', created: 'Item created', preparing: 'Preparing the files…',
          uploading: 'Uploading', preview: 'Uploading the preview image…', committing: 'Finishing on Steam…' };
        for (;;) {
          await new Promise((res) => setTimeout(res, 500));
          const j = (await api('/api/workshop/progress')).job;
          if (j.id && j.id !== '0' && w.id !== j.id && !j.dryRun) { w.id = j.id; S.commit(); }   // keep it even if the upload fails later
          line.textContent = (STAGES[j.stage] || j.stage) + (j.stage === 'uploading' && j.total ? ` ${kb(j.done)} of ${kb(j.total)}` : '');
          bar.style.width = (j.stage === 'done' ? 100 : j.total ? Math.round((j.done / j.total) * 90) : { creating: 5, created: 8, preparing: 10, preview: 92, committing: 96 }[j.stage] || 2) + '%';
          if (j.stage === 'error') return say('problem error', 'Not published: ' + (j.error || 'unknown error'));
          if (j.stage === 'done') {
            if (j.dryRun) return say('ok-box', '✔ Steam test passed - nothing was uploaded (dry run).');
            say('ok-box', `✔ Published “${w.title}” to the Steam Workshop (${VIS.find((v) => v[0] === w.visibility)[1].split(' - ')[0].toLowerCase()}).`);
            if (j.legal) out.append(el('p', { class: 'warn-text' }, 'Steam needs you to accept the Workshop legal agreement once before the item can be seen by anyone: ',
              el('a', { href: 'https://steamcommunity.com/sharedfiles/workshoplegalagreement', target: '_blank' }, 'open the agreement')));
            if (w.visibility === 'private') out.append(el('p', { class: 'ins-help' }, 'It is private: check the page, subscribe to test it, then set it to Public here (or on Steam) and publish again.'));
            out.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn primary', href: itemUrl(w.id), target: '_blank' }, '↗ Open the Workshop page')));
            f.note.value = '';
            drawLink();
            return;
          }
        }
      } catch (e) {
        say('problem error', 'The studio server is not running (start run_desktop.bat or run_studio.bat).');
      } finally {
        busy = false;
        publishBtn.disabled = false;
      }
    };
    publishBtn.onclick = publish;

    const row = (label, input, help) => el('div', { class: 'ins-row' }, el('div', { class: 'ins-label' }, label), input, help ? el('div', { class: 'ins-help' }, help) : null);
    const body = el('div', { style: { display: 'grid', gap: '10px' } },
      status,
      linkRow,
      row('Title', f.title),
      el('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } }, img,
        el('div', { style: { display: 'grid', gap: '6px', flex: 1 } },
          el('div', { class: 'ins-label' }, 'Preview image'),
          el('div', { class: 'ins-help' }, 'Shown on the Workshop and in the DayZ launcher. Without your own image Studio makes one from the title.'),
          el('div', { class: 'btn-row' }, el('button', { class: 'btn', onclick: () => pick.click() }, '🖼 Choose image…'),
            el('button', { class: 'btn', onclick: () => { own = null; showPreview(); } }, 'Use the generated one')), pick)),
      row('Description', f.desc, 'Steam formatting works: [b]bold[/b], [h2]heading[/h2], [list][*]item[/list], [url=…]link[/url]. The first line is also shown in the DayZ launcher.'),
      row('Mod type tags', tagBox),
      row('Visibility', f.vis),
      row('Change notes', f.note),
      out);
    showPreview();
    drawLink();
    DS.app.modal({ title: 'Publish to Steam Workshop', wide: true, body, onClose: () => { if (!busy) save(); },
      buttons: (close) => [el('span', { class: 'ins-help', style: { flex: 1 } }, `Uploads @${nm}: the PBO, its signature, your public .bikey and mod.cpp. Your private key never leaves this PC.`),
        el('button', { class: 'btn', onclick: close }, 'Close'), publishBtn] });

    api('/api/workshop/status').then((s) => {
      drawTags(s.tags || []);
      status.replaceChildren();
      if (!s.dll) { status.append(el('span', { class: 'warn-text' }, '✖ DayZ was not found - Studio uses its Steam library to upload. Install DayZ from Steam.')); publishBtn.disabled = true; }
      else if (!s.steam) status.append(el('span', { class: 'warn-text' }, '⚠ Steam does not seem to be running. Start Steam and log in with the account that should own the Workshop item.'));
      else status.append('✔ Uses the Steam account you are logged in with. While it uploads, Steam shows you as “playing DayZ” for a moment.');
      if (s.job && s.job.running) { busy = true; publishBtn.disabled = true; say('ins-help', 'An upload is already running…'); }
    }).catch(() => { status.textContent = 'The studio server is not running (start run_desktop.bat or run_studio.bat).'; publishBtn.disabled = true; });
  };
})();
