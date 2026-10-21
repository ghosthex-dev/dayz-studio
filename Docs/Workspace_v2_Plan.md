# Customizable workspace - v2 plan (docking)

v1 shipped in `js/workspace.js` (October 2026): resizable and collapsible side panels, swap sides, interface size
(desktop: real page zoom through `studioHost.setZoom` in `desktop/preload.js`), built-in presets (Default, Mapping,
Quest writing, Focus) and the user's own named workspaces. State lives in local storage:
`dzstudio.workspace` (current) and `dzstudio.workspaces` (saved), shape
`{ left, right, leftOpen, rightOpen, swap, scale, view }`.

v2 turns the fixed three-column layout into an editor-style docking workspace, the way Unity, Unreal or Blender
let people arrange their tools.

## Goals

1. **Panels as movable units.** Today `#left` holds the asset browser and its tabs (Assets, Loot, Zones, Game,
   Scene, Quests - `js/browser.js`), `#right` holds the inspector (`js/inspector.js`), `#center` holds the four views
   (Map, Quests, 3D, Game). v2 makes each of these a *panel* with an id, a title and a mount function, so it can live
   in any dock area.
2. **Dock areas with tabs and splits.** Drag a panel's tab onto the left / right / bottom edge or the centre of
   another area to dock it there; several panels in one area become tabs. Areas split horizontally or vertically
   and resize with the v1 splitters.
3. **Two views side by side.** For example the Map and the Quest graph at once (the main reason people ask for
   docking). Needs the views to stop assuming they are the only visible one (see Risks).
4. **Floating panels and a second monitor** (desktop only). Pop a panel out into its own Electron window
   (`BrowserWindow` + the same page with `?panel=<id>`), sharing state through the studio server or IPC.
5. **Custom hotkeys** - a keymap editor (File ▸ Keyboard shortcuts) stored like workspaces; today hotkeys are
   hard-coded in `js/app.js` `hotkeys()` and a few modules.
6. **Toolbar arrangement** - hide or reorder toolbar groups (the `tb-group`s in `index.html`).
7. **Workspaces stay compatible** - v1 layouts load into v2 (left / right widths and open flags map onto the default
   dock tree).

## Proposed design

- **Layout tree:** `{ type: 'split', dir: 'row' | 'col', sizes: [...], children: [...] }` and
  `{ type: 'tabs', panels: ['assets', 'loot', ...], active: 'assets' }`. Saved in the same storage keys with
  `version: 2`.
- **Panel registry:** `DS.Workspace.panel(id, { title, icon, mount(el), unmount(), onResize() })`. The current
  modules register themselves instead of grabbing `#left` / `#right` by id.
- **Renderer:** builds nested flex containers from the tree; splitters between children (generalised from v1);
  tab strips with drag handles; drop overlays (left / right / top / bottom / centre) while dragging a tab.
- **Views:** Map, Quests, 3D and Game become panels too. Only one 3D renderer and one game dock may exist at a
  time; opening a second copy focuses the existing one.
- **Floating windows (desktop):** `desktop/main.js` opens a child `BrowserWindow` per floating panel; the page in
  it renders only that panel and syncs project state over IPC (`ipcMain` relays `S.emit` events) - or, simpler
  first step, floating windows only for read-mostly panels (Script console, Problems, Quest preview).

## Risks / things to check first

- `js/mapview.js`, `js/view3d.js`, `js/nodeeditor.js` and `js/editorlink.js` assume one visible view at a time
  (`S.view`, `S.setView`, `.hidden` toggling in `syncToolbar`). Two visible views needs `S.view` to become "the
  focused view" plus per-view visibility.
- The docked DayZ game window (`desktop/winhost.js`, `host:rect`) follows one rectangle; it must follow the Game
  panel wherever it is docked and hide when its tab is not active.
- Inspector and browser render into fixed elements on events (`S.on('selection')`, `S.on('structure')`); they need
  to tolerate being unmounted and remounted.
- Keep the v1 behaviour (and its hotkeys Ctrl+B / Ctrl+Alt+B) working as the default layout.

## Suggested order

1. Panel registry + layout tree + renderer, with the default tree reproducing today's layout (no visible change).
2. Tabs and drag-to-dock between the existing areas; bottom dock area.
3. Views as panels; two views side by side.
4. Keymap editor and toolbar arrangement.
5. Floating / second-monitor windows (desktop).
6. Release as the next alpha with a README section and release notes.
