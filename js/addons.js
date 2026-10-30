/* DayZ Studio - add-ons: optional feature packs Studio loads from its addons/ folder.
   An add-on is a folder addons/<id>/ with addon.json = { id, name, version, edition, js: [...], css: [...],
   server: 'server.py', pip: [...], updates } (see addons/README.md). The studio server lists them (/api/addons),
   serves their files under /addons/<id>/ and runs their server.py routes; this loads their scripts before Studio
   starts, so they can register panels, hooks and menu items like a built-in module.

   Hooks: the places in Studio an add-on can add to.
     DS.Hooks.add(name, fn)          fn(ctx) returns an element, a menu item, an array of them, or nothing
     DS.Hooks.collect(name, ctx)     everything the add-ons returned for name (built-in code calls this)
   Hook names: 'dialog.tools' (buttons above a conversation: ctx { node, p, dialog, kind, changed, redraw }),
   'dialog.voice' (next to a line's voice file: ctx { node, p, line, changed, redraw }), 'menu.file' (File menu
   items { label, run }), 'help.about' (elements in Help). */
(function () {
  const DS = (window.DS = window.DS || {});
  const H = (DS.Hooks = {});
  const A = (DS.Addons = { list: [] });
  const hooks = {};

  H.add = (name, fn) => { (hooks[name] = hooks[name] || []).push(fn); };
  H.collect = function (name, ctx) {
    const out = [];
    (hooks[name] || []).forEach((fn) => {
      try {
        const r = fn(ctx);
        if (Array.isArray(r)) out.push(...r.filter(Boolean)); else if (r) out.push(r);
      } catch (e) { console.error('add-on hook ' + name, e); }
    });
    return out;
  };

  /** the edition name shown in Studio ('' = the free edition): the first add-on that names one */
  A.edition = () => (A.list.find((a) => a.edition) || {}).edition || '';

  const addScript = (src) => new Promise((res) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res(true);
    s.onerror = () => { console.error('add-on script failed to load: ' + src); res(false); };
    document.head.append(s);
  });

  /** list the add-ons and load their styles and scripts (in order); resolves when done - also without a studio
      server (a browser on file://), and never waits more than a few seconds */
  A.load = async function () {
    let r = null;
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => ctl && ctl.abort(), 3000);
      r = await fetch('/api/addons', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then((x) => (x.ok ? x.json() : null));
      clearTimeout(t);
    } catch (e) { r = null; }
    A.list = (r && r.ok && r.addons) || [];
    for (const a of A.list) {
      (a.css || []).forEach((href) => document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href })));
      for (const src of a.js || []) await addScript(src);
    }
    if (A.list.length) document.documentElement.dataset.edition = A.edition() || 'addons';
    return A.list;
  };
})();
