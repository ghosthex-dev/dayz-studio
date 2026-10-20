/* DayZ Studio - NPC conversations: the dialogue editor (a Skyrim-style preview included) and voice-line files.
   node.p.dialog = { offer, active, done }  each  { start, lines: [ { id, text, sound, next, options: [ { text, next, accept } ] } ] }
   sound = { id, ext, name } - the file itself lives on the studio server (data/_audio/<id>.<ext>) */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const D = (DS.Dialog = {});
  const Snd = (DS.Sounds = {});

  /* ---------------------------------------------------------------- voice files */
  const bytesCache = new Map();
  Snd.ACCEPT = '.ogg,.wav';

  Snd.url = (s) => `data/_audio/${s.id}.${s.ext}`;

  Snd.upload = async function (file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['ogg', 'wav'].includes(ext)) throw new Error('Voice files must be .ogg or .wav (DayZ cannot play mp3). Convert it with Audacity or any audio converter.');
    if (file.size > 12 * 1024 * 1024) throw new Error('That file is larger than 12 MB.');
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const r = await fetch('/api/audio/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, data: btoa(bin) }) }).then((x) => x.json());
    if (!r.ok) throw new Error(r.error || 'Upload failed (is the studio server running?)');
    bytesCache.set(r.id, buf);
    return { id: r.id, ext: r.ext, name: file.name };
  };

  Snd.bytes = (s) => (s && bytesCache.get(s.id)) || null;

  /** every voice file used by the project: [{id, ext, name}] */
  Snd.all = function () {
    const out = new Map();
    S.project.quests.forEach((q) => q.nodes.forEach((n) => {
      const d = n.p && n.p.dialog;
      if (!d) return;
      ALL_KINDS.forEach((k) => d[k] && d[k].lines.forEach((l) => { if (l.sound && l.sound.id) out.set(l.sound.id, l.sound); }));
    }));
    return [...out.values()];
  };

  Snd.preload = function () {
    Snd.all().forEach((s) => {
      if (bytesCache.has(s.id)) return;
      fetch(Snd.url(s)).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => { if (b) bytesCache.set(s.id, new Uint8Array(b)); }).catch(() => {});
    });
  };
  S.on('project', () => setTimeout(Snd.preload, 300));
  setTimeout(Snd.preload, 1500);

  let audio = null;
  Snd.play = function (s) {
    if (audio) { audio.pause(); audio = null; }
    if (!s) return;
    audio = new Audio(Snd.url(s));
    audio.play().catch(() => DS.toast('Could not play that file', 'warn'));
  };
  Snd.stop = function () { if (audio) { audio.pause(); audio = null; } };

  /* ---------------------------------------------------------------- data helpers */
  const KINDS = [
    ['offer', 'Before the quest', 'Said when the player talks to the NPC and has not taken the quest yet. Put an “accept” option here.'],
    ['active', 'While it is running', 'Said when the player comes back before finishing the quest.'],
    ['done', 'After completing', 'Said when the quest is finished.'],
    ['locked', 'Not available yet', 'Said while this quest is still locked because the quests it needs are not finished (Quest settings ▸ Unlocks after).'],
  ];
  const ALL_KINDS = KINDS.map((k) => k[0]);

  /* reply conditions: option.if = a condition (see conditions.js) */

  /** short text describing what a reply needs / does, e.g. "if carrying 2× Rag · gives 1× Apple" */
  D.optionTags = function (o) {
    const t = [];
    const ct = DS.Cond ? DS.Cond.text(o.if) : '';
    if (ct) t.push(ct);
    const list = (a) => a.filter((i) => i.c).map((i) => `${i.n || 1}× ${i.c}`).join(', ');
    if ((o.take || []).some((i) => i.c)) t.push('takes ' + list(o.take));
    if ((o.give || []).some((i) => i.c)) t.push('gives ' + list(o.give) + ((o.take || []).some((i) => i.c) ? '' : ' (once)'));
    if (o.accept) t.push('accepts quest');
    return t.join(' · ');
  };

  function newLine(d, text) {
    let n = d.lines.length + 1;
    while (d.lines.some((l) => l.id === 'l' + n)) n++;
    const l = { id: 'l' + n, text: text || '', sound: null, next: '', options: [] };
    d.lines.push(l);
    if (!d.start) d.start = l.id;
    return l;
  }
  const emptyDialog = () => ({ start: '', lines: [] });

  /** the conversation object of a node, created on demand */
  D.get = function (p) {
    if (!p.dialog) p.dialog = { offer: emptyDialog(), active: emptyDialog(), done: emptyDialog(), locked: emptyDialog() };
    ALL_KINDS.forEach((k) => { if (!p.dialog[k]) p.dialog[k] = emptyDialog(); });
    return p.dialog;
  };

  D.summary = function (p) {
    const d = p.dialog;
    if (!d) return p.text ? 'Uses the quick greeting only' : 'No conversation yet';
    const n = ALL_KINDS.reduce((s, k) => s + (d[k] ? d[k].lines.length : 0), 0);
    const v = Snd.all().length;
    return n ? `${n} line${n === 1 ? '' : 's'}${v ? ` · ${v} voice file${v === 1 ? '' : 's'}` : ''}` : 'No conversation yet';
  };

  /** starter conversation built from what the node already says */
  function starter(p, kind) {
    const d = emptyDialog();
    if (kind === 'offer') {
      const l = newLine(d, p.text || 'Hey, survivor. I need a favour...');
      l.options = [{ text: 'I will help.', next: '', accept: true }, { text: 'Not right now.', next: '', accept: false }];
    } else if (kind === 'active') {
      const l = newLine(d, 'Still working on it? Come back when the job is done.');
      l.options = [{ text: 'I am on it.', next: '', accept: false }];
    } else if (kind === 'locked') {
      const l = newLine(d, 'I have nothing for you right now. Come back later.');
      l.options = [{ text: 'Alright.', next: '', accept: false }];
    } else {
      const l = newLine(d, 'Thank you, survivor. I will not forget this.');
      l.options = [{ text: 'Take care.', next: '', accept: false }];
    }
    return d;
  }

  /** the "only show if… / gives / takes" panel of one reply */
  function replyExtras(o, onChange, redraw) {
    const box = el('div', { class: 'dlg-extra' });
    const condRow = DS.Cond.widget(o.if || (o.if = { kind: '' }), { label: 'Show this reply', onChange, redraw });
    if (!o.take) o.take = [];
    if (!o.give) o.give = [];
    const changedItems = () => { onChange(); };
    box.append(condRow,
      el('div', { class: 'dlg-items' },
        el('div', null, el('div', { class: 'ins-help' }, 'Takes from the player (reply only shows when they carry it)'), DS.itemsWidget(o.take, changedItems)),
        el('div', null, el('div', { class: 'ins-help' }, 'Gives to the player (once per player, unless it also takes something)'), DS.itemsWidget(o.give, changedItems))));
    return box;
  }

  /* ---------------------------------------------------------------- the editor */
  D.open = function (node, onChange) {
    const p = node.p;
    const dlg = D.get(p);
    let kind = 'offer';
    let selId = null;
    let pv = null; // preview line id
    const openExtras = new Set(); // replies whose "conditions & items" panel is open
    const quest = S.project.quests.find((q) => q.nodes.includes(node));
    const root = el('div', { class: 'dlg-ed' });
    let close;

    const changed = () => { onChange && onChange(); };
    const cur = () => dlg[kind];
    const sel = () => cur().lines.find((l) => l.id === selId) || null;
    const lineLabel = (l, i) => `${i + 1}. ${(l.text || '(empty)').slice(0, 34)}`;

    function draw() {
      const d = cur();
      if (!sel() && d.lines.length) selId = d.start || d.lines[0].id;
      root.innerHTML = '';

      const tabs = el('div', { class: 'dlg-tabs' });
      const chained = quest && (quest.requires || []).length > 0;
      KINDS.filter(([k]) => k !== 'locked' || chained || dlg.locked.lines.length || kind === 'locked').forEach(([k, label]) => tabs.append(el('button', { class: 'btn sm' + (k === kind ? ' primary' : ''), onclick: () => { kind = k; selId = null; pv = null; openExtras.clear(); draw(); } },
        label + (dlg[k].lines.length ? ` (${dlg[k].lines.length})` : ''))));
      root.append(tabs, el('div', { class: 'ins-help' }, KINDS.find((k) => k[0] === kind)[2]));

      if (!d.lines.length) {
        root.append(el('div', { class: 'hint-box' }, 'Nothing written here yet. When empty, the game uses a simple built-in line' + (kind === 'offer' ? ' made from your quick greeting.' : '.')),
          el('div', { class: 'btn-row' },
            el('button', { class: 'btn primary', onclick: () => { dlg[kind] = starter(p, kind); changed(); S.commit(); selId = null; draw(); } }, 'Start a conversation'),
            el('button', { class: 'btn', onclick: () => { newLine(d, ''); changed(); S.commit(); selId = d.lines[0].id; draw(); } }, 'Write it from scratch')));
        return;
      }

      const list = el('div', { class: 'dlg-list' });
      d.lines.forEach((l, i) => list.append(el('div', { class: 'dlg-item' + (l.id === selId ? ' active' : '') + (l.id === d.start ? ' start' : ''), onclick: () => { selId = l.id; pv = null; draw(); } },
        el('span', null, lineLabel(l, i)), l.sound ? el('span', { class: 'dlg-snd', title: l.sound.name }, '🔊') : null)));
      list.append(el('button', { class: 'btn sm', onclick: () => { const l = newLine(d, ''); selId = l.id; changed(); S.commit(); draw(); } }, '+ Add line'));

      const l = sel();
      const form = el('div', { class: 'dlg-form' });
      if (l) {
        const idx = d.lines.indexOf(l);
        const targets = (cur2) => [['', 'End of conversation'], ...d.lines.filter((x) => x !== cur2).map((x, j) => [x.id, `Line ${d.lines.indexOf(x) + 1}: ${(x.text || '').slice(0, 30)}`])];
        const text = el('textarea', { class: 'inp', rows: 4, placeholder: 'What the NPC says…' });
        text.value = l.text;
        text.addEventListener('input', () => { l.text = text.value; changed(); });
        text.addEventListener('change', () => { S.commit(); draw(); });
        form.append(
          el('div', { class: 'dlg-head' }, el('b', null, `Line ${idx + 1}`),
            l.id === d.start ? el('span', { class: 'dlg-badge' }, 'starts here') : el('button', { class: 'btn sm', onclick: () => { d.start = l.id; changed(); S.commit(); draw(); } }, 'Make this the first line'),
            el('button', { class: 'btn sm danger', onclick: () => {
              d.lines.splice(idx, 1);
              d.lines.forEach((x) => { if (x.next === l.id) x.next = ''; x.options.forEach((o) => { if (o.next === l.id) o.next = ''; }); });
              if (d.start === l.id) d.start = d.lines.length ? d.lines[0].id : '';
              selId = null; changed(); S.commit(); draw();
            } }, 'Delete line')),
          el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'NPC says'), text));

        // voice file
        const snd = el('div', { class: 'dlg-voice' });
        if (l.sound) {
          snd.append(el('span', { class: 'dlg-fname' }, '🔊 ' + l.sound.name),
            el('button', { class: 'btn sm', onclick: () => Snd.play(l.sound) }, '▶ Play'),
            el('button', { class: 'btn sm', onclick: () => { Snd.stop(); l.sound = null; changed(); S.commit(); draw(); } }, 'Remove'));
        } else {
          const file = el('input', { type: 'file', accept: Snd.ACCEPT, class: 'hidden' });
          file.addEventListener('change', async () => {
            if (!file.files[0]) return;
            try {
              l.sound = await Snd.upload(file.files[0]);
              changed(); S.commit(); draw();
              DS.toast('Voice file attached', 'ok', 1500);
            } catch (e) {
              DS.toast(String(e.message || e), 'error', 6000);
            }
          });
          snd.append(file, el('button', { class: 'btn sm', onclick: () => file.click() }, '🎙 Attach voice file (.ogg / .wav)…'),
            el('span', { class: 'ins-help' }, 'Plays when this line appears.'));
        }
        form.append(el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Voice'), snd));
        // the NPC reacts first: open the conversation with this line when a condition holds
        form.append(el('div', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'Open with this line when'),
          DS.Cond.widget(l.openIf || (l.openIf = { kind: '' }), { onChange: changed, redraw: draw }),
          el('span', { class: 'ins-help' }, 'Optional. E.g. “If the player is bleeding” → “You’re bleeding! Sit down, let me help.” The first line whose condition holds opens the conversation; otherwise it starts at the first line.')));

        // replies
        form.append(el('div', { class: 'ins-sec-title' }, 'Player replies'));
        const opts = el('div', { class: 'dlg-opts' });
        l.options.forEach((o, oi) => {
          const t = el('input', { class: 'inp', type: 'text', value: o.text, placeholder: 'What the player can say…' });
          t.addEventListener('input', () => { o.text = t.value; changed(); });
          t.addEventListener('change', () => { S.commit(); });
          const sl = el('select', { class: 'inp' });
          targets(l).forEach(([v, lab]) => sl.append(el('option', { value: v, selected: o.next === v }, lab)));
          sl.addEventListener('change', () => { o.next = sl.value; changed(); S.commit(); });
          const ac = el('input', { type: 'checkbox', checked: !!o.accept });
          ac.addEventListener('change', () => { o.accept = ac.checked; changed(); S.commit(); });
          const key = l.id + ':' + oi;
          const tags = D.optionTags(Object.assign({}, o, { accept: false }));
          const moreBtn = el('button', { class: 'btn sm' + (tags ? ' on' : ''), title: 'Only show this reply when…, give or take items', onclick: () => { if (openExtras.has(key)) openExtras.delete(key); else openExtras.add(key); draw(); } },
            openExtras.has(key) ? '▴ Conditions & items' : '▾ Conditions & items');
          opts.append(el('div', { class: 'dlg-opt' }, t,
            el('div', { class: 'dlg-opt-row' }, el('span', { class: 'ins-help' }, 'then'), sl,
              el('label', { class: 'chk', title: 'Choosing this reply accepts the quest' }, ac, el('span', null, 'accepts quest')),
              moreBtn,
              el('button', { class: 'btn icon', onclick: () => { l.options.splice(oi, 1); openExtras.clear(); changed(); S.commit(); draw(); } }, '✕')),
            tags && !openExtras.has(key) ? el('div', { class: 'dlg-tags' }, tags) : null,
            openExtras.has(key) ? replyExtras(o, changed, draw) : null));
        });
        if (l.options.length < 6) opts.append(el('button', { class: 'btn sm', onclick: () => { l.options.push({ text: '', next: '', accept: false }); changed(); S.commit(); draw(); } }, '+ Add reply'));
        form.append(opts);
        if (!l.options.length) {
          const sl = el('select', { class: 'inp' });
          targets(l).forEach(([v, lab]) => sl.append(el('option', { value: v, selected: l.next === v }, lab)));
          sl.addEventListener('change', () => { l.next = sl.value; changed(); S.commit(); });
          form.append(el('label', { class: 'ins-row' }, el('span', { class: 'ins-label' }, 'No replies: the player presses Continue, then'), sl));
        }
      }

      // Skyrim-style preview
      const pl = (pv && d.lines.find((x) => x.id === pv)) || l;
      const prev = el('div', { class: 'dlg-preview' });
      if (pl) {
        prev.append(el('div', { class: 'dlg-pv-name' }, p.name || p.npc || 'NPC'), el('div', { class: 'dlg-pv-text' }, pl.text || '…'));
        const go = (nxt) => { if (nxt && d.lines.some((x) => x.id === nxt)) { pv = nxt; draw(); } else { pv = null; draw(); } };
        if (pl.options.length) pl.options.forEach((o, i) => {
          const tg = D.optionTags(o);
          prev.append(el('div', { class: 'dlg-pv-opt', onclick: () => go(o.next) }, `${i + 1}.  ${o.text || '…'}`, tg ? el('span', { class: 'dlg-pv-tag' }, '   ' + tg) : null));
        });
        else prev.append(el('div', { class: 'dlg-pv-opt', onclick: () => go(pl.next) }, '1.  Continue'));
        if (pl.sound) prev.append(el('button', { class: 'btn sm', onclick: () => Snd.play(pl.sound) }, '🔊 Hear this line'));
      }
      root.append(el('div', { class: 'dlg-cols' }, list, form), el('div', { class: 'mini-title' }, 'Preview (click replies to walk through it; in game, replies whose condition is not met are hidden)'), prev);
    }
    draw();
    close = DS.app.modal({ title: `Conversation — ${p.name || p.npc || 'NPC'}`, body: root, wide: true, onClose: () => { Snd.stop(); changed(); }, buttons: (c) => el('button', { class: 'btn primary', onclick: c }, 'Done') });
  };
})();
