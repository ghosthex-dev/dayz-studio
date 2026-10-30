# Add-ons

DayZ Studio loads feature packs from this folder: `addons/<id>/` (and from `addons/` in Studio's data folder).
Studio itself ships without any; a pack adds features of its own.

```
addons/<id>/
  addon.json      { "id", "name", "version", "edition", "js": [...], "css": [...], "server": "server.py",
                    "pip": [...], "updates": { "mode": "manual", "note", "url" } }
  js/, css/       loaded by the editor before it starts (js/addons.js) - they can register dock panels,
                  hooks (DS.Hooks.add) and File menu items
  server.py       setup(helpers) -> { "POST name": fn(body), "GET name": fn(query) },
                  served at /api/addons/<id>/<name> (tools/addons.py)
```

- Hooks the editor offers: `dialog.tools`, `dialog.voice`, `menu.file`, `help.about` (see `js/addons.js`).
- `pip` packages are bundled into the installer's Python: `python tools/make_installer.py --addon <folder>`.
- `updates.mode = "manual"` keeps the desktop app from replacing the build with the free one from GitHub.
- An add-on keeps its own settings and downloads in `<Studio data>/addons-data/<id>/`.
