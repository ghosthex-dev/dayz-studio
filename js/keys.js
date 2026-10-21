/* DayZ Studio - keyboard shortcuts: a registry of commands with default keys that the user can change
   (▦ ▸ Keyboard shortcuts…). Changes are kept per user in local storage ('dzstudio.keys': { command: [combos] }).
   Combos look like "Ctrl+Shift+G", "Alt+1", "Delete", "F1". A few keys stay fixed: Esc, the arrow keys (nudge),
   Space / middle mouse (pan) and the 3D view's fly keys. */
(function () {
  const DS = (window.DS = window.DS || {});
  const U = DS.util;
  const el = U.el;
  const K = (DS.Keys = {});
  const KEY = 'dzstudio.keys';
  const cmds = [];          // { id, label, group, keys: [default combos], run(e) }
  let custom = {};
  try { custom = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { custom = {}; }

  const NAMES = { ' ': 'Space', escape: 'Esc', arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', '`': '`' };
  /** the combo a key event makes, e.g. "Ctrl+Shift+G" (letters as capitals, Shift+? stays "Shift+?") */
  K.combo = function (e) {
    const k = e.key || '';
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(k)) return '';
    let name = NAMES[k.toLowerCase()] || (k.length === 1 ? k.toUpperCase() : k);
    // Alt+digit and Ctrl+letter can arrive as other characters on some layouts: fall back to the physical key
    if ((e.altKey || e.ctrlKey) && /^Digit\d$/.test(e.code)) name = e.code.slice(5);
    if ((e.altKey || e.ctrlKey) && /^Key[A-Z]$/.test(e.code)) name = e.code.slice(3);
    return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', name].filter(Boolean).join('+');
  };

  K.register = function (c) { cmds.push(c); };
  /** the user's changes to the defaults ({ command: [combos] }) - what a workspace profile carries */
  K.getCustom = () => JSON.parse(JSON.stringify(custom));
  K.setCustom = function (obj) {
    custom = {};
    Object.keys(obj || {}).forEach((id) => { if (Array.isArray(obj[id])) custom[id] = obj[id].filter((k) => typeof k === 'string'); });
    save();
  };
  K.keys = (id) => { const c = cmds.find((x) => x.id === id); return c ? (custom[id] || c.keys) : []; };
  K.label = (id) => K.keys(id).join(' / ');
  K.list = () => cmds.slice();

  /** run the command bound to this key event; true when one ran */
  K.handle = function (e) {
    const combo = K.combo(e);
    if (!combo) return false;
    const c = cmds.find((x) => K.keys(x.id).includes(combo));
    if (!c) return false;
    if (c.preventDefault !== false) e.preventDefault();
    c.run(e);
    return true;
  };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch (e) { /* storage off: lasts this session */ }
    if (K.onChange) K.onChange();
  }

  /** the shortcut editor */
  K.open = function () {
    const body = el('div', { class: 'keys-ed' });
    let close;
    const draw = () => {
      body.replaceChildren(el('p', { class: 'ins-help' }, 'Click a shortcut to change it, ✕ to remove it, + to add another. Fixed keys: Esc, arrow keys (nudge), Space or middle mouse (pan the map), W A S D in the 3D view.'));
      const groups = [...new Set(cmds.map((c) => c.group))];
      groups.forEach((g) => {
        body.append(el('div', { class: 'mini-title' }, g));
        cmds.filter((c) => c.group === g).forEach((c) => {
          const keys = K.keys(c.id);
          const chips = keys.map((k, i) => el('span', { class: 'key-chip' },
            el('button', { class: 'key-btn', title: 'Click, then press the new keys', onclick: () => record(c, i) }, k),
            el('button', { class: 'key-x', title: 'Remove this shortcut', onclick: () => { custom[c.id] = keys.filter((_, j) => j !== i); save(); draw(); } }, '✕')));
          body.append(el('div', { class: 'key-row' + (custom[c.id] ? ' changed' : '') },
            el('span', { class: 'key-label' }, c.label),
            el('span', { class: 'key-chips' }, ...chips,
              el('button', { class: 'key-add', title: 'Add another shortcut', onclick: () => record(c, keys.length) }, '+'),
              custom[c.id] ? el('button', { class: 'key-add', title: 'Back to the default (' + c.keys.join(' / ') + ')', onclick: () => { delete custom[c.id]; save(); draw(); } }, '↺') : null)));
        });
      });
    };
    const record = (c, i) => {
      const tip = el('div', { class: 'key-rec' }, 'Press the new shortcut for “' + c.label + '”… (Esc cancels)');
      body.prepend(tip);
      tip.scrollIntoView({ block: 'nearest' });
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { done(); return; }
        const combo = K.combo(e);
        if (!combo) return;   // a modifier on its own: wait for the key
        if (/^(Left|Right|Up|Down|Space)$/.test(combo)) { tip.textContent = combo + ' is a fixed key - pick another'; return; }
        const other = cmds.find((x) => x.id !== c.id && K.keys(x.id).includes(combo));
        if (other && !confirm(combo + ' is already used for “' + other.label + '”. Use it for “' + c.label + '” instead?')) { done(); return; }
        if (other) custom[other.id] = K.keys(other.id).filter((k) => k !== combo);
        const keys = K.keys(c.id).slice();
        keys[i] = combo;
        custom[c.id] = keys.filter((k, j, a) => a.indexOf(k) === j);
        save();
        done();
      };
      const done = () => { window.removeEventListener('keydown', onKey, true); draw(); };
      window.addEventListener('keydown', onKey, true);
    };
    draw();
    close = DS.app.modal({ title: 'Keyboard shortcuts', wide: true, body, buttons: (c) => [
      el('button', { class: 'btn', onclick: () => { if (confirm('Put every shortcut back to its default?')) { custom = {}; save(); draw(); } } }, 'Reset all'),
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'btn primary', onclick: c }, 'Done')] });
    return close;
  };
})();
