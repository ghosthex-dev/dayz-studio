/* DayZ Studio - server utilities: serverDZ.cfg editor (with a day / night length calculator), loot economy
   multipliers for types.xml, and PBO tools (browse, inspect, unpack, pack, use a mod's classes + models in Studio).
   The files are read and written by the studio server (tools/server_tools.py). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const T = (DS.ServerTools = {});

  const api = (path, body) => fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ ok: false, error: 'The studio server is not running (start run_desktop.bat or run_studio.bat).' }));
  const qs = (o) => Object.keys(o).map((k) => k + '=' + encodeURIComponent(o[k])).join('&');
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const sec = (title, ...kids) => el('div', { class: 'ins-sec' }, el('div', { class: 'ins-sec-title' }, title), kids);
  const help = (t) => el('span', { class: 'ins-help' }, t);
  /** replace a node's children (arrays are flattened, null / false skipped - like el()) */
  const fill = (node, ...kids) => {
    node.replaceChildren();
    kids.flat(Infinity).forEach((k) => { if (k != null && k !== false) node.append(k.nodeType ? k : String(k)); });
  };
  const row = (label, input, h) => el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, label), input, h ? help(h) : null);

  /* ================================================================ serverDZ.cfg ================================================================ */
  // the text stays the source of truth: every edit rewrites one "key = value;" line, unknown lines and comments are kept
  const Cfg = {
    re: (k) => new RegExp('^([ \\t]*' + k.replace(/[[\]]/g, '\\$&') + '[ \\t]*=[ \\t]*)([^;\\n]*?|\\{[^}]*\\})([ \\t]*;)', 'mi'),
    get(text, k) {
      const m = text.match(Cfg.re(k));
      if (!m) return undefined;
      const v = m[2].trim();
      return v.startsWith('"') ? v.slice(1, -1) : v;
    },
    set(text, k, v, str) {
      const lit = str ? '"' + String(v).replace(/"/g, '') + '"' : String(v);
      const re = Cfg.re(k);
      if (re.test(text)) return text.replace(re, (m, a, b, c) => a + lit + c);
      const line = k + ' = ' + lit + ';';
      const mi = text.search(/^\s*class\s+Missions/mi);
      if (mi >= 0) return text.slice(0, mi) + line + '\n' + text.slice(mi);
      return text.replace(/\s*$/, '\n') + line + '\n';
    },
    getArr(text, k) {
      const m = text.match(Cfg.re(k + '[]'));
      if (!m) return [];
      return [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    },
    setArr(text, k, arr) {
      return Cfg.set(text, k + '[]', '{' + arr.map((s) => '"' + s.replace(/"/g, '') + '"').join(', ') + '}');
    },
    getTemplate(text) {
      const m = text.match(/template\s*=\s*"([^"]*)"/i);
      return m ? m[1] : '';
    },
    setTemplate(text, t) {
      if (/template\s*=\s*"[^"]*"/i.test(text)) return text.replace(/(template\s*=\s*")[^"]*(")/i, '$1' + t + '$2');
      return text.replace(/\s*$/, '\n') + '\nclass Missions\n{\n    class DayZ\n    {\n        template = "' + t + '";\n    };\n};\n';
    },
  };
  T.Cfg = Cfg;

  // a fresh file when the server has none yet
  const BLANK_CFG = 'hostname = "My DayZ server";\npassword = "";\npasswordAdmin = "";\ndescription = "";\nenableWhitelist = 0;\nmaxPlayers = 60;\n' +
    'verifySignatures = 2;\nforceSameBuild = 1;\nBattlEye = 1;\ndisableVoN = 0;\nvonCodecQuality = 20;\ndisable3rdPerson = 0;\ndisableCrosshair = 0;\n' +
    'disablePersonalLight = 1;\nlightingConfig = 0;\nserverTime = "SystemTime";\nserverTimeAcceleration = 12;\nserverNightTimeAcceleration = 1;\n' +
    'serverTimePersistent = 0;\nguaranteedUpdates = 1;\nloginQueueConcurrentPlayers = 5;\nloginQueueMaxPlayers = 500;\ninstanceId = 1;\nstorageAutoFix = 1;\n' +
    '\nclass Missions\n{\n    class DayZ\n    {\n        template = "dayzOffline.chernarusplus";\n    };\n};\n';

  // Bohemia's documented defaults, and two rule-of-thumb presets
  const PERF = {
    default: { simulatedPlayersBatch: 20, multithreadedReplication: 1, networkRangeClose: 20, networkRangeNear: 150, networkRangeFar: 1000, networkRangeDistantEffect: 4000, defaultVisibility: 1375, defaultObjectViewDistance: 1375, speedhackDetection: 1 },
    performance: { simulatedPlayersBatch: 10, multithreadedReplication: 1, networkRangeClose: 20, networkRangeNear: 120, networkRangeFar: 800, networkRangeDistantEffect: 3000, defaultVisibility: 1200, defaultObjectViewDistance: 1100, speedhackDetection: 1 },
    quality: { simulatedPlayersBatch: 20, multithreadedReplication: 1, networkRangeClose: 20, networkRangeNear: 150, networkRangeFar: 1200, networkRangeDistantEffect: 4500, defaultVisibility: 1600, defaultObjectViewDistance: 1600, speedhackDetection: 1 },
  };
  // about how many hours the sun is up in each month at Chernarus' latitude (adjustable)
  const DAYLIGHT = [8, 9.5, 11.5, 13.5, 15.5, 16.5, 16, 14.5, 12.5, 10.5, 8.5, 7.5];

  /** day / night lengths -> serverTimeAcceleration + serverNightTimeAcceleration */
  T.timeCalc = function (dayGameH, dayRealMin, nightRealMin) {
    const nightGameH = 24 - dayGameH;
    let acc = dayGameH * 60 / Math.max(1, dayRealMin);
    const warn = [];
    if (acc > 24) { acc = 24; warn.push('the day is as short as DayZ allows (acceleration 24)'); }
    if (acc < 0.1) { acc = 0.1; warn.push('the day is as long as DayZ allows'); }
    let night = (nightGameH * 60 / Math.max(1, nightRealMin)) / acc;
    if (night > 64) { night = 64; warn.push('the night is as short as DayZ allows (night multiplier 64)'); }
    if (night < 0.1) { night = 0.1; warn.push('the night is as long as DayZ allows'); }
    acc = Math.round(acc * 100) / 100;
    night = Math.round(night * 100) / 100;
    const realDay = dayGameH * 60 / acc, realNight = nightGameH * 60 / (acc * night);
    return { acc, night, realDay, realNight, warn };
  };
  const hm = (min) => (min >= 60 ? Math.floor(min / 60) + ' h' + (Math.round(min % 60) ? ' ' + Math.round(min % 60) + ' min' : '') : Math.round(min) + ' min');

  T.cfgEditor = async function () {
    const body = el('div', {}, help('Loading…'));
    let close = DS.app.modal({ title: 'Server settings (serverDZ.cfg)', wide: true, body, buttons: (c) => [el('button', { class: 'btn', onclick: c }, 'Close')] });
    let st = await api('/api/servercfg');
    let text = '';
    const pathInp = el('input', { class: 'inp', type: 'text', value: st.path || '', placeholder: 'C:\\...\\DayZServer\\serverDZ.cfg' });
    const status = el('div', {});
    const form = el('div', {});
    const raw = el('textarea', { class: 'inp code', rows: 14, spellcheck: 'false' });
    raw.addEventListener('input', () => { text = raw.value; draw(); });

    async function load(path) {
      st = await api('/api/servercfg?' + qs({ path: path || '' }));
      if (!st.ok) { fill(status, el('div', { class: 'problem error' }, st.error)); fill(form); return; }
      text = st.exists ? st.text : BLANK_CFG;
      pathInp.value = st.path;
      fill(status, st.exists ? help('Editing ' + st.path) : el('div', { class: 'problem warn' }, 'No serverDZ.cfg there yet - saving creates one with these settings.'));
      draw();
    }
    const set = (k, v, str) => { text = Cfg.set(text, k, v, str); raw.value = text; };
    const num = (k, def, opts) => {
      const cur = Cfg.get(text, k);
      const i = el('input', { class: 'inp', type: 'number', value: cur === undefined ? def : cur, step: (opts && opts.step) || 1, style: { width: '110px' } });
      if (opts && opts.min != null) i.min = opts.min;
      if (opts && opts.max != null) i.max = opts.max;
      i.addEventListener('change', () => { set(k, i.value === '' ? def : +i.value); draw(); });
      return i;
    };
    const str = (k, ph) => {
      const i = el('input', { class: 'inp', type: 'text', value: Cfg.get(text, k) || '', placeholder: ph || '' });
      i.addEventListener('change', () => set(k, i.value, true));
      return i;
    };
    const tog = (k, label, def, on, off) => {
      const cur = Cfg.get(text, k);
      const v = cur === undefined ? def : String(cur) === String(on === undefined ? 1 : on);
      const i = el('input', { type: 'checkbox', checked: v });
      i.addEventListener('change', () => { set(k, i.checked ? (on === undefined ? 1 : on) : (off === undefined ? 0 : off)); draw(); });
      return el('label', { class: 'chk' }, i, el('span', null, label));
    };
    const slider = (k, def, min, max, step, fmt) => {
      const cur = Cfg.get(text, k);
      const v = cur === undefined ? def : +cur;
      const out = el('span', { class: 'ins-help', style: { minWidth: '70px' } }, fmt ? fmt(v) : String(v));
      const i = el('input', { type: 'range', min, max, step, value: v, style: { flex: '1 1 200px' } });
      i.addEventListener('input', () => { out.textContent = fmt ? fmt(+i.value) : i.value; });
      i.addEventListener('change', () => { set(k, +i.value); draw(); });
      return el('div', { class: 'btn-row st-row' }, i, out);
    };

    function timeSection() {
      const sv = Cfg.get(text, 'serverTime') || 'SystemTime';
      const sys = /^systemtime$/i.test(sv);
      const parts = sys ? [2015, 6, 15, 8, 0] : sv.split('/').map(Number);
      const month = parts[1] || 6;
      const acc = +(Cfg.get(text, 'serverTimeAcceleration') || 1);
      const nacc = +(Cfg.get(text, 'serverNightTimeAcceleration') || 1);
      const dayH = T._dayH || DAYLIGHT[(month - 1 + 12) % 12];
      const realDay = dayH * 60 / acc, realNight = (24 - dayH) * 60 / (acc * nacc);
      // the strip: one real-time cycle, day gold and night blue
      const tot = realDay + realNight;
      const strip = el('div', { style: { display: 'flex', height: '22px', borderRadius: '5px', overflow: 'hidden', border: '1px solid var(--line2)' } },
        el('div', { style: { flex: realDay / tot, background: 'linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b)', color: '#111', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, 'day ' + hm(realDay)),
        el('div', { style: { flex: realNight / tot, background: 'linear-gradient(90deg,#1e3a8a,#312e81,#1e3a8a)', color: '#dbeafe', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, 'night ' + hm(realNight)));
      // calculator
      const dayLen = el('input', { type: 'range', min: 15, max: 720, step: 5, value: Math.round(Math.min(720, Math.max(15, realDay))), style: { flex: '1 1 200px' } });
      const nightLen = el('input', { type: 'range', min: 5, max: 360, step: 5, value: Math.round(Math.min(360, Math.max(5, realNight))), style: { flex: '1 1 200px' } });
      const dayOut = help(hm(+dayLen.value)), nightOut = help(hm(+nightLen.value));
      const res = el('div', { class: 'ins-help' });
      const calc = () => {
        dayOut.textContent = hm(+dayLen.value);
        nightOut.textContent = hm(+nightLen.value);
        const c = T.timeCalc(dayH, +dayLen.value, +nightLen.value);
        res.textContent = `→ serverTimeAcceleration = ${c.acc}, serverNightTimeAcceleration = ${c.night}. A full in-game day takes ${hm(c.realDay + c.realNight)} of real time.` + (c.warn.length ? ' Note: ' + c.warn.join('; ') + '.' : '');
        return c;
      };
      dayLen.addEventListener('input', calc);
      nightLen.addEventListener('input', calc);
      calc();
      const dayHInp = el('input', { class: 'inp', type: 'number', min: 4, max: 20, step: 0.5, value: dayH, style: { width: '80px' } });
      dayHInp.addEventListener('change', () => { T._dayH = Math.max(4, Math.min(20, +dayHInp.value || 12)); draw(); });
      // start time
      const startHour = el('input', { type: 'range', min: 0, max: 1435, step: 5, value: (parts[3] || 0) * 60 + (parts[4] || 0), disabled: sys, style: { flex: '1 1 200px' } });
      const startOut = help(sys ? 'the PC clock' : String(parts[3]).padStart(2, '0') + ':' + String(parts[4] || 0).padStart(2, '0'));
      const writeTime = () => {
        const m = +startHour.value;
        const p = [parts[0] || 2015, parts[1] || 6, parts[2] || 15, Math.floor(m / 60), m % 60];
        set('serverTime', p.join('/'), true);
      };
      startHour.addEventListener('input', () => { const m = +startHour.value; startOut.textContent = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); });
      startHour.addEventListener('change', () => { writeTime(); draw(); });
      const monthSel = el('select', { class: 'inp', disabled: sys, style: { width: 'auto' } },
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((n, i) => el('option', { value: i + 1, selected: i + 1 === month }, n)));
      monthSel.addEventListener('change', () => { parts[1] = +monthSel.value; T._dayH = 0; writeTime(); draw(); });
      const sysChk = el('input', { type: 'checkbox', checked: sys });
      sysChk.addEventListener('change', () => { if (sysChk.checked) set('serverTime', 'SystemTime', true); else writeTime(); draw(); });
      return sec('Time of day',
        strip,
        help(`Now: acceleration ${acc} × (night ${nacc} × on top). Daylight ≈ ${dayH} in-game hours in ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]}.`),
        el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Real-time length of the day'), el('div', { class: 'btn-row st-row' }, dayLen, dayOut)),
        el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Real-time length of the night'), el('div', { class: 'btn-row st-row' }, nightLen, nightOut)),
        res,
        el('div', { class: 'btn-row st-row' },
          el('button', { class: 'btn primary', onclick: () => { const c = calc(); set('serverTimeAcceleration', c.acc); set('serverNightTimeAcceleration', c.night); draw(); } }, 'Use these speeds'),
          el('span', { class: 'ins-help' }, 'in-game daylight hours'), dayHInp),
        el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Start time'),
          el('div', { class: 'btn-row st-row' }, el('label', { class: 'chk' }, sysChk, el('span', null, 'Use the server PC’s clock')), monthSel, startHour, startOut)),
        tog('serverTimePersistent', 'Keep the in-game time across restarts', false),
        help('DayZ allows an acceleration of 0.1–24 and a night multiplier of 0.1–64 on top of it.'));
    }

    function draw() {
      if (!st.ok) return;
      raw.value = text;
      const missions = st.missions || [];
      const tpl = Cfg.getTemplate(text);
      const tplSel = el('select', { class: 'inp' }, (missions.includes(tpl) || !tpl ? missions : [tpl].concat(missions)).map((m) => el('option', { value: m, selected: m === tpl }, m)));
      tplSel.addEventListener('change', () => { text = Cfg.setTemplate(text, tplSel.value); raw.value = text; });
      const motd = el('textarea', { class: 'inp', rows: 3, placeholder: 'One message per line' });
      motd.value = Cfg.getArr(text, 'motd').join('\n');
      motd.addEventListener('change', () => { text = Cfg.setArr(text, 'motd', motd.value.split('\n').map((s) => s.trim()).filter(Boolean)); raw.value = text; });
      const be = String(Cfg.get(text, 'BattlEye')) !== '0';
      fill(form, 
        sec('General',
          row('Server name', str('hostname', 'My DayZ server')),
          row('Join password', str('password', 'empty = public')),
          row('Admin password', str('passwordAdmin'), '#login <password> in the chat makes you admin.'),
          row('Description', str('description')),
          row('Max players', slider('maxPlayers', 60, 1, 127, 1)),
          row('Map / mission', tplSel, 'Folders in mpmissions next to the cfg.'),
          row('Message of the day', motd),
          row('Seconds between messages', num('motdInterval', 1, { min: 1 }))),
        sec('Security',
          tog('BattlEye', 'BattlEye anti-cheat', true),
          !be ? el('div', { class: 'problem warn' }, 'BattlEye off: players can join without anti-cheat. Only for private / test servers.') : null,
          tog('verifySignatures', 'Check mod signatures (verifySignatures = 2)', true, 2, 0),
          tog('forceSameBuild', 'Players must run the same game version', true),
          tog('enableWhitelist', 'Whitelist only (whitelist.txt)', false),
          tog('allowFilePatching', 'Allow file patching (only for development)', false)),
        sec('Gameplay',
          tog('disable3rdPerson', 'First person only', false),
          tog('disableCrosshair', 'No crosshair', false),
          tog('disablePersonalLight', 'No personal light at night', true),
          row('Night brightness', (() => { const s = el('select', { class: 'inp' }, el('option', { value: 0, selected: String(Cfg.get(text, 'lightingConfig')) !== '1' }, 'Bright nights'), el('option', { value: 1, selected: String(Cfg.get(text, 'lightingConfig')) === '1' }, 'Dark nights')); s.addEventListener('change', () => set('lightingConfig', +s.value)); return s; })()),
          tog('disableBaseDamage', 'Bases can’t be damaged', false),
          tog('disableContainerDamage', 'Tents and barrels can’t be damaged', false),
          tog('disableRespawnDialog', 'No respawn choice (always a fresh spawn)', false),
          row('Respawn delay (s)', num('respawnTime', 5, { min: 0 })),
          tog('disableVoN', 'Voice chat off', false),
          row('Voice quality (0–30)', num('vonCodecQuality', 20, { min: 0, max: 30 })),
          tog('enableCfgGameplayFile', 'Use cfggameplay.json from the mission', false)),
        timeSection(),
        sec('Performance',
          el('div', { class: 'btn-row st-row' },
            el('span', { class: 'ins-help' }, 'Presets:'),
            el('button', { class: 'btn', onclick: () => applyPerf('default') }, 'DayZ defaults'),
            el('button', { class: 'btn', onclick: () => applyPerf('performance') }, '⚡ Busy server / weaker PC'),
            el('button', { class: 'btn', onclick: () => applyPerf('quality') }, '👁 Small server / long view')),
          help('Rules of thumb, not magic: shorter network ranges and view distances mean less to sync per player. Test with your own player count.'),
          row('Players simulated per frame', num('simulatedPlayersBatch', 20, { min: 1 })),
          tog('multithreadedReplication', 'Multithreaded replication', true),
          row('Network range: close / near / far / distant effects (m)', el('div', { class: 'btn-row st-row' }, num('networkRangeClose', 20), num('networkRangeNear', 150), num('networkRangeFar', 1000), num('networkRangeDistantEffect', 4000))),
          row('View distance: terrain / objects (m)', el('div', { class: 'btn-row st-row' }, num('defaultVisibility', 1375), num('defaultObjectViewDistance', 1375))),
          row('Login queue: at once / max', el('div', { class: 'btn-row st-row' }, num('loginQueueConcurrentPlayers', 5, { min: 1 }), num('loginQueueMaxPlayers', 500, { min: 1 }))),
          tog('speedhackDetection', 'Speed-hack detection', true),
          row('Kick players above ping (ms)', num('maxPing', 200, { min: 0 })),
          tog('storageAutoFix', 'Repair damaged storage files automatically', true),
          row('Instance id (storage_N folder)', num('instanceId', 1, { min: 1 }))),
        sec('Text (everything above edits this; other settings stay as they are)', raw));
    }
    function applyPerf(k) {
      Object.entries(PERF[k]).forEach(([key, v]) => set(key, v));
      draw();
      DS.toast('Applied “' + k + '” network and view settings', 'ok', 2000);
    }
    const save = async () => {
      const r = await api('/api/servercfg/save', { path: pathInp.value.trim(), text });
      if (r.ok) DS.toast('Saved ' + r.path + (r.backup ? ' (old file kept as ' + r.backup.split(/[\\/]/).pop() + ')' : ''), 'ok', 4500);
      else DS.toast('Not saved: ' + r.error, 'error', 6000);
    };
    const download = () => U.download ? U.download('serverDZ.cfg', text) : (() => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'serverDZ.cfg' }); a.click(); })();
    fill(body, 
      el('div', { class: 'btn-row st-row' }, pathInp, el('button', { class: 'btn', onclick: () => load(pathInp.value.trim()) }, 'Open')),
      status, form);
    close();
    close = DS.app.modal({
      title: 'Server settings (serverDZ.cfg)', wide: true, body,
      buttons: (c) => [help('Restart the server to apply. The previous file is kept as .bak-<date>.'),
        el('button', { class: 'btn', onclick: download }, '⇩ Download'),
        el('button', { class: 'btn primary', onclick: save }, '💾 Save to server'),
        el('button', { class: 'btn', onclick: c }, 'Close')],
    });
    load(st.path || '');
  };

  /* ================================================================ loot economy ================================================================ */
  const CATS = ['weapons', 'explosives', 'clothes', 'containers', 'tools', 'food', 'books', 'lootdispatch'];
  const USAGES = ['Military', 'Police', 'Medic', 'Firefighter', 'Industrial', 'Farm', 'Coast', 'Town', 'Village', 'Hunting', 'Office', 'School', 'Prison', 'Lunapark', 'SeasonalEvent', 'ContaminatedArea', 'Historical'];
  const TIERS = ['Tier1', 'Tier2', 'Tier3', 'Tier4', 'Unique'];
  const ECO_PRESETS = [
    { label: 'Military ×1.5', r: { usage: 'Military', mult: 1.5 } },
    { label: 'Weapons ×2', r: { cat: 'weapons', mult: 2 } },
    { label: 'Food −50%', r: { cat: 'food', mult: 0.5 } },
    { label: 'Medical ×1.5', r: { usage: 'Medic', mult: 1.5 } },
    { label: 'Tier 4 (NWAF etc.) ×0.5', r: { tier: 'Tier4', mult: 0.5 } },
    { label: 'Ammo ×1.5', r: { name: 'Ammo_*', mult: 1.5 } },
  ];

  T.economy = async function () {
    const P = S.project;
    if (!P.economy) P.economy = { rules: [], mission: '', path: '' };
    const E = P.economy;
    const ch = () => S.changed('meta');
    const body = el('div', {});
    const cfg = await api('/api/servercfg');
    const missions = (cfg.ok && cfg.missions) || [];
    const root = cfg.ok ? cfg.path.replace(/[\\/][^\\/]*$/, '') : '';
    const worldMission = 'dayzOffline.' + P.meta.world;
    if (!E.mission && !E.path) E.mission = missions.includes(worldMission) ? worldMission : missions[0] || '';
    const pathOf = () => E.path || (root && E.mission ? root + '\\mpmissions\\' + E.mission + '\\db\\types.xml' : '');
    const info = el('div', {});
    const rulesBox = el('div', {});
    const preview = el('div', {});
    let src = null, timer = null, last = null;

    async function refreshSource() {
      src = await api('/api/types/source?' + qs({ path: pathOf() }));
      fill(info, !pathOf() ? el('div', { class: 'problem warn' }, 'DayZ Server not found - enter the path to a types.xml.')
        : src.exists ? help((src.hasOriginal ? 'Studio changed this file before; rules are applied to the untouched copy (types.xml.studio-original), so applying twice never stacks. ' : 'The first time you write, Studio keeps the untouched file as types.xml.studio-original. ') + pathOf())
          : el('div', { class: 'problem error' }, 'No types.xml at ' + pathOf()));
      schedule();
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(runPreview, 350); };
    async function runPreview() {
      if (!src || !src.exists) { fill(preview); return; }
      const r = await api('/api/types/apply', { path: pathOf(), rules: E.rules, action: 'preview' });
      last = r;
      if (!r.ok) { fill(preview, el('div', { class: 'problem error' }, r.error)); return; }
      const cats = Object.entries(r.totals).sort((a, b) => b[1][0] - a[1][0]);
      const max = Math.max(1, ...cats.map(([, v]) => Math.max(v[0], v[1])));
      fill(preview, 
        el('div', { class: 'ins-sec-title' }, `Preview - ${r.changed} of ${r.types} item types change (total nominal per category)`),
        el('div', {}, cats.map(([c, [a, b]]) => el('div', { class: 'btn-row st-row', style: { gap: '8px' } },
          el('span', { style: { width: '110px' } }, c),
          el('div', { style: { flex: '1 1 200px', position: 'relative', height: '14px', background: 'var(--panel2)', borderRadius: '3px' } },
            el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: (a / max * 100) + '%', background: '#475569', borderRadius: '3px' } }),
            el('div', { style: { position: 'absolute', left: 0, top: '4px', height: '6px', width: (b / max * 100) + '%', background: b > a ? '#22c55e' : b < a ? '#f97316' : '#94a3b8', borderRadius: '3px' } })),
          el('span', { class: 'ins-help', style: { width: '130px' } }, `${a} → ${b}` + (a ? ` (${b >= a ? '+' : ''}${Math.round((b / a - 1) * 100)}%)` : ''))))),
        r.changes.length ? el('details', {}, el('summary', { class: 'ins-help', style: { cursor: 'pointer' } }, `Show the ${Math.min(r.changes.length, 400)} first changed items`),
          el('div', { style: { maxHeight: '220px', overflow: 'auto', fontSize: '12px' } },
            el('table', { style: { width: '100%', borderCollapse: 'collapse' } },
              el('tr', {}, ['Item', 'Category', 'Nominal', 'Min'].map((h) => el('th', { style: { textAlign: 'left', color: 'var(--muted)' } }, h))),
              r.changes.slice(0, 400).map((c) => el('tr', {}, el('td', {}, c[0]), el('td', {}, c[1]), el('td', {}, `${c[2]} → ${c[3]}`), el('td', {}, `${c[4]} → ${c[5]}`)))))) : null);
    }

    function drawRules() {
      const sel = (v, list, ph, on) => {
        const s = el('select', { class: 'inp' }, el('option', { value: '' }, ph), list.map((x) => el('option', { value: x, selected: x === v }, x)));
        s.addEventListener('change', () => { on(s.value); ch(); S.commit(); schedule(); });
        return s;
      };
      fill(rulesBox, 
        E.rules.length ? null : help('No rules yet - add one below. Rules multiply: “Military ×1.5” and “Weapons ×2” make military weapons ×3.'),
        E.rules.map((r, i) => {
          const pct = el('span', { class: 'ins-help', style: { width: '64px' } }, '×' + (+r.mult).toFixed(2));
          const rng = el('input', { type: 'range', min: 0, max: 5, step: 0.05, value: r.mult, style: { flex: '1 1 160px' } });
          rng.addEventListener('input', () => { r.mult = +rng.value; pct.textContent = '×' + r.mult.toFixed(2); schedule(); });
          rng.addEventListener('change', () => { ch(); S.commit(); });
          const nm = el('input', { class: 'inp', type: 'text', value: r.name || '', placeholder: 'name filter (Ammo_*, AK)', style: { flex: '0 1 170px' } });
          nm.addEventListener('change', () => { r.name = nm.value.trim(); ch(); S.commit(); schedule(); });
          const on = el('input', { type: 'checkbox', checked: r.on !== false, title: 'Rule on / off' });
          on.addEventListener('change', () => { r.on = on.checked; ch(); S.commit(); schedule(); });
          const mt = el('input', { type: 'checkbox', checked: r.minToo !== false });
          mt.addEventListener('change', () => { r.minToo = mt.checked; ch(); S.commit(); schedule(); });
          return el('div', { class: 'btn-row st-row', style: { borderBottom: '1px solid var(--line)', paddingBottom: '6px' } },
            on,
            sel(r.cat, CATS, 'any category', (v) => { r.cat = v; }),
            sel(r.usage, USAGES, 'any area', (v) => { r.usage = v; }),
            sel(r.tier, TIERS, 'any tier', (v) => { r.tier = v; }),
            nm, rng, pct,
            el('label', { class: 'chk', title: 'Also scale <min> (the count the economy refills to)' }, mt, el('span', null, 'min too')),
            el('button', { class: 'btn icon', title: 'Delete this rule', onclick: () => { E.rules.splice(i, 1); ch(); S.commit(); drawRules(); schedule(); } }, '🗑'));
        }),
        el('div', { class: 'btn-row st-row pad' },
          el('button', { class: 'btn primary', onclick: () => { E.rules.push({ cat: '', usage: '', tier: '', name: '', mult: 1.5, minToo: true, on: true }); ch(); S.commit(); drawRules(); } }, '+ Add rule'),
          ECO_PRESETS.map((p) => el('button', { class: 'btn', onclick: () => { E.rules.push(Object.assign({ cat: '', usage: '', tier: '', name: '', minToo: true, on: true }, p.r)); ch(); S.commit(); drawRules(); schedule(); } }, '+ ' + p.label))));
    }

    const misSel = el('select', { class: 'inp' }, missions.map((m) => el('option', { value: m, selected: m === E.mission && !E.path }, m)), el('option', { value: '@path', selected: !!E.path }, 'Another types.xml…'));
    const pathInp = el('input', { class: 'inp', type: 'text', value: E.path || '', placeholder: 'C:\\...\\db\\types.xml', style: { display: E.path ? '' : 'none' } });
    misSel.addEventListener('change', () => {
      if (misSel.value === '@path') { pathInp.style.display = ''; pathInp.focus(); return; }
      E.mission = misSel.value; E.path = ''; pathInp.style.display = 'none'; ch(); S.commit(); refreshSource();
    });
    pathInp.addEventListener('change', () => { E.path = pathInp.value.trim(); ch(); S.commit(); refreshSource(); });

    const act = async (action) => {
      if (action === 'write' && !confirm('Write the scaled types.xml to\n' + pathOf() + '\n\nThe untouched file is kept as types.xml.studio-original. Restart the server afterwards.')) return;
      if (action === 'restore' && !confirm('Put the untouched types.xml back (types.xml.studio-original)?')) return;
      const r = await api('/api/types/apply', { path: pathOf(), rules: E.rules, action });
      if (!r.ok) return DS.toast(r.error, 'error', 6000);
      if (action === 'download') {
        const a = el('a', { href: URL.createObjectURL(new Blob([r.xml], { type: 'text/xml' })), download: 'types.xml' });
        a.click();
      } else DS.toast(action === 'write' ? `types.xml written - ${r.changed} item types changed. Restart the server.` : 'Original types.xml restored.', 'ok', 5000);
      refreshSource();
    };
    body.append(
      el('div', { class: 'hint-box' }, 'Scale whole groups of loot instead of editing items one by one. “nominal” is how many of an item the economy keeps on the map, “min” the count it refills to. Items with nominal 0 (not spawned) stay 0. Changes apply after a server restart; loot already lying around stays until it despawns.'),
      el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'types.xml of'), el('div', { class: 'btn-row st-row' }, misSel, pathInp)),
      info, sec('Rules', rulesBox), preview);
    DS.app.modal({
      title: 'Loot economy multipliers', wide: true, body,
      buttons: (c) => [
        el('button', { class: 'btn', onclick: () => act('restore'), title: 'Undo everything Studio wrote to this types.xml' }, '↺ Restore original'),
        el('button', { class: 'btn', onclick: () => act('download') }, '⇩ Download types.xml'),
        el('button', { class: 'btn primary', onclick: () => act('write') }, '💾 Write to server'),
        el('button', { class: 'btn', onclick: c }, 'Close')],
    });
    drawRules();
    refreshSource();
  };

  /* ================================================================ PBO tools ================================================================ */
  T.pbo = async function (startDir) {
    const body = el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(300px, 1.3fr)', gap: '12px', minHeight: '420px' } });
    const left = el('div', { style: { display: 'grid', gap: '8px', alignContent: 'start' } });
    const right = el('div', { style: { display: 'grid', gap: '8px', alignContent: 'start' } });
    body.append(left, right);
    const srcs = await api('/api/pbo/sources');
    const dirInp = el('input', { class: 'inp', type: 'text', placeholder: 'Folder…' });
    const listBox = el('div', { style: { maxHeight: '360px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '6px' } });
    let cur = null;
    const item = (icon, label, sub, on, active) => el('div', { class: 'asset' + (active ? ' active' : ''), onclick: on }, el('span', {}, icon), el('span', { class: 'asset-name' }, label), sub ? el('span', { class: 'asset-sub' }, sub) : null);

    async function go(dir) {
      const r = await api('/api/fs/list?' + qs({ dir }));
      if (!r.ok) { DS.toast(r.error, 'error', 4000); return; }
      cur = r;
      T._lastDir = dir;
      dirInp.value = r.dir;
      fill(listBox, 
        r.parent ? item('⬆', '..', '', () => go(r.parent)) : null,
        r.dirs.map((d) => item('📁', d.name, d.label, () => go(r.dir.replace(/[\\/]$/, '') + '\\' + d.name))),
        r.pbos.map((p) => item('📦', p.name, kb(p.size), () => showPbo(r.dir.replace(/[\\/]$/, '') + '\\' + p.name))),
        !r.dirs.length && !r.pbos.length ? help(r.files ? r.files + ' other files' : 'Empty folder') : null);
      showFolder(r);
    }
    dirInp.addEventListener('change', () => go(dirInp.value.trim()));

    function result(r, okText) {
      if (!r.ok) return el('div', { class: 'problem error' }, r.error);
      return el('div', { class: 'ok-box' }, okText);
    }
    const openBtn = (path, label) => el('button', { class: 'btn', onclick: () => api('/api/fs/open', { path }) }, label || '📂 Show in Explorer');

    function useModBox(dir) {
      const out = el('div', {});
      return el('div', {},
        el('button', { class: 'btn', title: 'Adds the classes of these PBOs to the asset list and lets the 3D view load their models', onclick: async () => {
          fill(out, help('Reading the configs…'));
          const r = await api('/api/pbo/models', { path: dir });
          fill(out, result(r, r.ok ? `✔ ${r.classes} classes with a model from ${r.pbos} PBO(s) are now in the asset list (Assets ▸ ${''}the mod’s folders). Their 3D models load when you place them.` : ''),
            r.ok && r.errors.length ? help('Skipped: ' + r.errors.join('; ')) : null);
          if (r.ok && DS.Classes) { await DS.Classes.reload(); S.emit('classes'); }
        } }, '🧩 Use this mod in Studio (asset list + 3D)'), out);
    }

    // the game's own PBOs are in Studio already
    const isVanilla = (d) => (srcs.sources || []).some((s) => s.vanilla && d.toLowerCase().startsWith(s.path.toLowerCase()));

    function showFolder(r) {
      const name = r.dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      const pname = el('input', { class: 'inp', type: 'text', value: name.replace(/^@/, '').replace(/[^A-Za-z0-9_\-]/g, '') });
      const prefix = el('input', { class: 'inp', type: 'text', value: r.prefix || '', placeholder: r.prefix ? '' : 'e.g. MyMod\\data (default: the name)' });
      const bin = el('input', { type: 'checkbox', checked: true });
      const key = el('input', { class: 'inp', type: 'text', placeholder: 'key name to sign with (optional)' });
      const out = el('div', {});
      fill(right, 
        el('div', { class: 'ins-sec-title' }, '📁 ' + name),
        r.pbos.length ? el('div', { class: 'ins-sec' }, help(`${r.pbos.length} PBO(s) here. Pick one on the left to look inside or unpack it.`), isVanilla(r.dir) ? null : useModBox(r.dir)) : null,
        r.pbos.length ? null : el('div', { class: 'ins-sec' },
          el('div', { class: 'ins-sec-title' }, 'Pack this folder into a PBO'),
          r.hasConfig ? null : help('No config.cpp in this folder - fine for data-only PBOs.'),
          row('PBO name', pname),
          row('Prefix', prefix, 'The virtual path other files use (\\MyMod\\data\\…). Taken from $PBOPREFIX$ when there is one.'),
          el('label', { class: 'chk' }, bin, el('span', null, 'Binarize config.cpp (DayZ Tools CfgConvert; also checks it for errors)')),
          row('Sign', key, 'Signs with a DayZ Studio key from Documents/DayZStudio/Keys (made on first use) and puts the .bikey into the mod.'),
          el('button', { class: 'btn primary', onclick: async () => {
            fill(out, help('Packing…'));
            const res = await api('/api/pbo/pack', { src: r.dir, name: pname.value.trim(), prefix: prefix.value.trim(), binarize: bin.checked, key: key.value.trim() });
            fill(out, result(res, res.ok ? `✔ ${res.pbo} (${kb(res.size)}, prefix ${res.prefix}${res.binarized ? ', config binarized' : ''})` : ''),
              res.ok && res.note ? help(res.note) : null,
              res.ok && res.sign ? help(res.sign.signed ? '🔏 Signed - ' + res.sign.bikey : 'Not signed: ' + res.sign.why) : null,
              res.ok ? openBtn(res.pbo) : null);
          } }, '📦 Pack'), out));
    }

    async function showPbo(path) {
      fill(right, help('Reading…'));
      const r = await api('/api/pbo/info?' + qs({ path }));
      if (!r.ok) { fill(right, el('div', { class: 'problem error' }, r.error)); return; }
      const name = path.split(/[\\/]/).pop();
      const dest = el('input', { class: 'inp', type: 'text', placeholder: 'default: Documents\\DayZStudio\\Unpacked\\' + name.replace(/\.pbo$/i, '') });
      const out = el('div', {});
      const exts = Object.entries(r.exts).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${n} ${x}`).join(' · ');
      fill(right, 
        el('div', { class: 'ins-sec-title' }, '📦 ' + name),
        help(`${r.count} files, ${kb(r.size)}${r.props.prefix ? ' · prefix ' + r.props.prefix : ''}`), help(exts),
        el('details', {}, el('summary', { class: 'ins-help', style: { cursor: 'pointer' } }, 'Files'),
          el('div', { style: { maxHeight: '160px', overflow: 'auto', fontSize: '12px', fontFamily: 'ui-monospace, Consolas, monospace' } },
            r.files.slice(0, 600).map((f) => el('div', {}, f[0] + '  ' + kb(f[1]) + (f[2] ? ' (compressed)' : ''))))),
        el('div', { class: 'ins-sec' },
          row('Unpack to', dest),
          el('button', { class: 'btn primary', onclick: async () => {
            fill(out, help('Unpacking…'));
            const u = await api('/api/pbo/unpack', { path, dest: dest.value.trim() });
            fill(out, result(u, u.ok ? `✔ ${u.written} files → ${u.dest}` : ''),
              u.ok && u.configs.length ? help('config.bin turned into a readable config.cpp (' + u.configs.map((c) => c.file + ' via ' + c.how).join(', ') + ').') : null,
              u.ok && u.skipped.length ? help('Skipped: ' + u.skipped.join(', ')) : null,
              u.ok ? el('div', { class: 'btn-row' }, openBtn(u.dest), el('button', { class: 'btn', onclick: () => go(u.dest) }, 'Browse it here')) : null);
          } }, '📤 Unpack'), out),
        isVanilla(path) ? null : el('div', { class: 'ins-sec' }, help('Use the classes and models of this PBO and the others next to it:'), useModBox(path.replace(/[\\/][^\\/]+$/, ''))));
    }

    const mods = await api('/api/mods');
    const modsInfo = el('div', {}, mods.ok && mods.pbos.length
      ? el('div', { class: 'btn-row st-row' }, help(`${mods.classes} mod classes from ${mods.pbos.length} PBO(s) are in Studio.`),
        el('button', { class: 'btn sm', onclick: async () => { if (!confirm('Remove all mod classes from the asset list? (The mods themselves are not touched.)')) return; await api('/api/mods/clear', {}); if (DS.Classes) await DS.Classes.reload(); fill(modsInfo, help('Mod classes removed.')); } }, 'Remove from Studio'))
      : null);
    left.append(
      el('div', { class: 'btn-row st-row' }, (srcs.sources || []).map((s) => el('button', { class: 'btn sm', title: s.path, onclick: () => go(s.path) }, s.label))),
      el('div', { class: 'btn-row st-row' }, dirInp),
      listBox, modsInfo,
      help('Uses DayZ Tools when installed (CfgConvert for configs, DsUtils for signing). Unpack other people’s mods to read and learn from them - don’t re-upload their files without permission. Protected (obfuscated) PBOs can’t be read.'));
    DS.app.modal({ title: 'PBO tools', wide: true, body, buttons: (c) => [el('button', { class: 'btn', onclick: c }, 'Close')] });
    const first = startDir || T._lastDir || (srcs.sources && srcs.sources[0] && srcs.sources[0].path);
    if (first) go(first);
  };
})();
