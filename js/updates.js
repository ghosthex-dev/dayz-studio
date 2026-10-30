/* DayZ Studio - updates (File ▸ Check for updates). The installed desktop app checks GitHub Releases at start
   (can be turned off) and offers new versions; nothing downloads or installs without the user's OK.
   Run from the source (ZIP / git) there is nothing to do here: updates come with git pull or a new download. */
(function () {
  const DS = (window.DS = window.DS || {});
  const U = DS.util;
  const el = U.el;
  const P = (DS.Updates = {});
  const host = window.studioHost && window.studioHost.update;
  const KEY_AUTO = 'dzstudio.updates.auto';
  const KEY_VER = 'dzstudio.updates.lastVersion';
  const RELEASES = 'https://github.com/ghosthex-dev/dayz-studio/releases';
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const auto = () => store(KEY_AUTO) !== '0';
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  let st = { state: host ? 'idle' : 'unsupported' };
  let redraw = null;   // the open dialog's refresh
  let toasted = false;

  P.supported = () => !!host && st.state !== 'unsupported';

  function onState(s) {
    st = s;
    if (redraw) redraw();
    if (s.state === 'available' && !redraw && !toasted) {
      toasted = true;
      const t = el('div', { class: 'toast info', style: { cursor: 'pointer' }, onclick: () => { t.remove(); P.open(); } },
        `⟳ DayZ Studio ${s.latest} is available - click to see what's new`);
      document.getElementById('toasts').append(t);
      setTimeout(() => t.remove(), 15000);
    }
  }

  P.open = function () {
    const body = el('div', { style: { display: 'grid', gap: '10px' } });
    const foot = el('div', { class: 'btn-row', style: { flex: 1, justifyContent: 'flex-end' } });
    const autoBox = el('input', { type: 'checkbox', checked: auto(), onchange: () => store(KEY_AUTO, autoBox.checked ? '1' : '0') });
    const btn = (label, primary, fn) => el('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: fn }, label);
    redraw = () => {
      body.replaceChildren();
      foot.replaceChildren();
      if (!P.supported()) {
        body.append(el('p', null, 'You are running DayZ Studio from its source files (ZIP or git), so it can\'t update itself.'),
          el('p', null, 'Get the newest version with ', el('code', null, 'git pull'), ', or install it with the setup program from the ',
            el('a', { href: RELEASES + '/latest', target: '_blank' }, 'releases page'), ' - the installed app updates itself.'));
        return;
      }
      body.append(el('div', { class: 'srv-info' }, 'Installed version: ', el('b', null, st.version || '?')));
      const s = st.state;
      if (s === 'manual') {   // an add-on updates this build itself: not from the public releases
        body.append(el('p', null, st.note || 'This build does not update itself.'),
          st.url ? el('p', null, el('a', { href: st.url, target: '_blank' }, 'Where to get updates')) : null);
        return;
      }
      if (s === 'idle' || s === 'none' || s === 'error') {
        if (s === 'none') body.append(el('div', { class: 'ok-box' }, `✔ You have the newest version${st.latest && st.latest !== st.version ? ' (' + st.latest + ')' : ''}.`));
        if (s === 'error') body.append(el('div', { class: 'problem error' }, 'Could not check for updates: ' + (st.error || 'unknown error') + ' - are you online?'));
        foot.append(btn('Check now', true, () => host.check()));
      } else if (s === 'checking') {
        body.append(el('div', { class: 'ins-help' }, 'Checking GitHub for a new version…'));
      } else if (s === 'available') {
        body.append(el('div', { class: 'ok-box' }, `DayZ Studio ${st.latest} is available.`));
        if (st.notes) body.append(el('div', { class: 'ins-label' }, "What's new"), el('div', { class: 'srv-info', style: { whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto' } }, st.notes));
        body.append(el('div', { class: 'ins-help' }, 'Your projects, keys and extracted map data are kept. ', el('a', { href: RELEASES, target: '_blank' }, 'All releases')));
        foot.append(btn('⇩ Download the update', true, () => host.download()));
      } else if (s === 'downloading') {
        const pct = Math.round(st.percent || 0);
        body.append(el('div', { class: 'ins-help' }, `Downloading ${st.latest || 'the update'}… ${pct}%${st.total ? ' of ' + mb(st.total) : ''}`),
          el('div', { class: 'progress' }, el('div', { class: 'bar', style: { width: pct + '%' } })));
      } else if (s === 'ready') {
        body.append(el('div', { class: 'ok-box' }, `✔ DayZ Studio ${st.latest} is downloaded.`),
          el('p', null, 'Restart now to install it (takes a few seconds), or keep working - it installs when you close DayZ Studio.'));
        foot.append(btn('Later', false, () => close()), btn('⟳ Restart and update', true, async () => {
          try { DS.store.save(); } catch (e) { /* ignore */ }
          if (DS.Disk && DS.Disk.saveNow) { try { await DS.Disk.saveNow(false); } catch (e) { /* autosave keeps a copy anyway */ } }
          host.install();
        }));
      }
      body.append(el('label', { class: 'chk' }, autoBox, 'Check for updates when DayZ Studio starts'));
    };
    redraw();
    const close = DS.app.modal({ title: 'Updates', body, buttons: (c) => [foot, el('button', { class: 'btn', onclick: c }, 'Close')], onClose: () => { redraw = null; } });
    if (P.supported() && (st.state === 'idle' || st.state === 'none' || st.state === 'error')) host.check();
  };

  async function init() {
    if (!host) return;
    host.onState(onState);
    st = await host.state();
    if (st.state === 'unsupported' || st.state === 'manual') return;
    // first start after an update (the installer passes --updated; the stored version is a fallback): say so
    const last = store(KEY_VER);
    store(KEY_VER, st.version);
    if (st.updated || (last && last !== st.version)) {
      const t = el('div', { class: 'toast ok', style: { cursor: 'pointer' }, onclick: () => window.open(RELEASES + '/tag/v' + st.version, '_blank') },
        `✔ DayZ Studio was updated to ${st.version} - click for what's new`);
      document.getElementById('toasts').append(t);
      setTimeout(() => t.remove(), 12000);
    }
    if (auto()) setTimeout(() => host.check(), 8000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
