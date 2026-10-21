# DayZ Studio

A visual map and quest editor for **vanilla DayZ servers** (Windows). Place and remove map objects on the real
terrain, edit loot, and build RPG-style quests - NPCs with conversations and voice lines, quest chains, a quest
tracker and journal, map markers and bonus objectives - then export one ready-to-install, signed mod. Players
need no other mods (no CF, no Expansion), and you can test everything in the real game or on a local dedicated
server straight from the editor.

> DayZ Studio is a fan-made tool and is not affiliated with Bohemia Interactive. The repository contains only the
> editor's own code. Terrain, models and textures are read from **your own** DayZ install on first run and stay
> on your PC - please don't redistribute them.

## Getting started

### 1. What you need (all free, from Steam)

| What | Why | Where |
|---|---|---|
| **DayZ** | the editor reads the terrain, models and objects from your game | Steam |
| **DayZ Tools** | builds (binarizes) and **signs** the mods you export | Steam ▸ Library ▸ Tools ▸ DayZ Tools |
| **DayZ Server** *(optional)* | test your mod in multiplayer from the editor | Steam ▸ Library ▸ Tools ▸ DayZ Server |

### 2. Install DayZ Studio

Download **`DayZStudio-Setup-<version>.exe`** from the
[latest release](https://github.com/ghosthex-dev/dayz-studio/releases/latest) and run it. That's all: Python and
everything else it needs are included.

- DayZ Studio is in **alpha** (versions `0.1.0-alpha.1`, `-alpha.2` …): expect rough edges, and please report what
  you find.
- You must read and accept the End User License Agreement (LICENSE) to install it.
- It installs for your Windows user only (no admin rights) and adds DayZ Studio to the Start menu and the desktop.
- **Updates:** DayZ Studio checks for a new version when it starts (**File ▸ ⟳ Check for updates…**; it can be turned
  off there). It shows what's new and only downloads and installs when you say so - then it restarts by itself
  with your project open.
- The installer isn't code-signed, so Windows may show **"Windows protected your PC"**. Click **More info ▸ Run
  anyway**.
- Data extracted from your DayZ install goes to `%LOCALAPPDATA%\DayZStudio`; your projects and mod keys are in
  `Documents\DayZStudio`. Updating or uninstalling DayZ Studio keeps both.

<details>
<summary>Running from the source instead (ZIP or git, for developers)</summary>

You also need **Python 3.10+** ([python.org](https://www.python.org/downloads/), tick **"Add python.exe to PATH"**)
with `pip install pillow numpy`, and optionally **Node.js LTS** ([nodejs.org](https://nodejs.org/)) for the
desktop app. Click **Code ▸ Download ZIP** and extract it to a normal folder such as `C:\DayZStudio`, or:

```bash
git clone https://github.com/ghosthex-dev/dayz-studio.git
```

- **`run_desktop.bat`** - the desktop app. The first start installs its shell with npm (takes a minute).
- **`run_studio.bat`** - the same editor in your web browser, no Node.js needed. Keep the black server window open
  while you work.

From the source, extracted data is kept in the `data` and `maps` folders next to the program.
`python tools\make_installer.py` builds the installer (needs Node.js). Releases: set the version in
`desktop/package.json` and push a matching tag (`v0.1.0-alpha.1`, `v0.1.0-alpha.2` … `v0.x.0-beta.N` … `v1.0.0`);
GitHub builds the installer and attaches it, with the `latest.yml` and `.blockmap` the in-app updater needs, to a
**draft** release (alpha / beta tags become pre-releases). Installed copies only see it once you press Publish.

</details>

### 3. First-time setup per map (about 10 minutes, once)

DayZ Studio contains no game data, so it builds it from your own install once per map:

1. **2D map imagery** - in the **🗺 Map** view, with nothing selected, press **⬇ Extract … imagery from DayZ**
   in the right panel (just the map you picked, a few minutes).
2. **Terrain, buildings and classes** - open the **⚙ Game setup** panel (a tab on the left) and press **⬇ Capture from the game**. DayZ
   starts, records the terrain and closes again (a few minutes). Then press **☰ Capture class list**.
3. **Everything else on the map** *(for the 3D tab)* - press **🌲 Capture world objects** (about 3 minutes).

Pick the map in the project settings (right panel, nothing selected) before capturing another map. The Map list
shows the maps your DayZ actually has: DLC maps (Sakhal, Nasdara) are marked *(DLC)*, ones you don't have
*(not installed)*, and a DLC map Bohemia releases later appears there by itself once Steam has downloaded it.

### 4. Make something

- **🗺 Map** - place objects from the asset list, edit loot and zones.
- **🧊 3D** - real models on the real terrain; **✂ Remove map objects** takes vanilla trees, walls or buildings
  away.
- **⎇ Quests** - drag triggers, objectives and rewards into a flow; NPC nodes have outfits and a conversation
  editor (**💬 Edit conversation…**).
- **▶ Play-test** in the Quests view starts the game at your quest with the quests loaded.
- **Export ▸ 🧰 Build installable mod (PBO)…** builds the mod, signs it and zips it with an `INSTALL.txt` for
  server owners. **🖧 Test on a local server** runs it on a real DayZ Server on your PC first.

New to it? **File ▸ Templates & examples… ▸ Showcase: camp, factions & RPG** drops a small working area at the
centre of the map view that uses every system: a Survivor camp with a trader and a quest, a supply container that
needs XP, a Bandit checkpoint with an armed guard, a car as a reward, XP, faction standings, a HUD and custom nodes.
Build it or run it on the local server and play through it, then open the nodes to see how each part is made.

Projects save automatically to `Documents\DayZStudio\Projects` (**File ▸ Recent projects and backups…**). Mod
signing keys are kept in `Documents\DayZStudio\Keys`. **Back them up**: future versions of your mod must be signed
with the same key, or servers have to install a new `.bikey`.

### Troubleshooting

- **"Could not start the studio server"** - another program uses port 8765, or (from the source) Python is missing
  or not on PATH. `run_studio.bat` shows the actual error in its window.
- **Black 2D map / "No terrain data yet"** - run step 3 for this map.
- **Capture buttons are greyed out** - DayZ was not found. Install it through Steam (the editor looks in every
  Steam library folder).
- **Mod built but "not signed"** - install DayZ Tools from Steam and build again.
- **Kicked from your local test server with "Game restart required"** - start the game through the editor's
  **② Join with the game** button; it launches with BattlEye, as servers require.
- Still stuck? Open an issue with the text from the server window or `run_studio.bat`.

---

## Feature guide

## What it does
- **Map editor** – to-scale canvas (Chernarus+, Livonia, Sakhal, Nasdara and any newer DLC map Studio finds in
  your DayZ install, Namalsk, Deer Isle, custom size), pan/zoom,
  place/move/rotate/group objects, prefabs, background image, optional vanilla-building layer from `mapgrouppos.xml`.
- **Quest editor** – node graph: Triggers → Objectives → Rewards (+ delay / wait-for-all / complete).
  Quest locations can be picked on the map or **linked to placed objects** and follow them.
- **Check** – plain-English validation of objects and quest graphs.
- **Export** (one ZIP with an install README):
  - vanilla object-spawner JSON (`cfggameplay.json` → `objectSpawnersArr`)
  - `init.c` spawner (ground snapping, loot tables, custom init scripts)
  - `cfgeventspawns.xml`, `cfgeventgroups.xml`, `mapgrouppos.xml`
  - **standalone Enforce Script quest framework** (PBO source + `quests.json`, or single-file mission mode) – no other mods needed
  - *optional:* DayZ Expansion `.map` + Quests JSON

## DayZ Studio Desktop - the real game inside the editor
`run_desktop.bat` opens DayZ Studio as a desktop app (Electron; first run installs it). The **Game** view
launches DayZ and docks the game window inside Studio, so you see the real building models, lighting and
terrain. By default it uses DayZ Studio's own viewport mod (`bridge/DZStudioWorld`, no other mods needed);
optionally it can drive the community DayZ Editor instead (needs CF + Dabs Framework + DayZ-Editor from the Steam
Workshop) through a small link mod (`bridge/DZStudioLink`). Both are built automatically. The link offers:
- **Live sync** - objects placed/moved/deleted in Studio appear in the Editor within a second (new objects
  sit on the real ground). **Auto-pull** brings objects created or moved in the Editor back into the project
  (they keep the Editor's uuid, so they stay linked).
- **Selection** syncs both ways. **Fly to selection** (F) moves the game camera; Shift+Alt+click on the 2D
  map flies it anywhere. The game camera is drawn on the 2D map (**Follow camera** keeps it centred).
- **Quest preview** (🧭 in the Game bar, or "Preview in game" in the Quests view) draws the active quest inside
  the running game: translucent cylinders for areas, beacon pillars per node (green trigger / blue objective /
  amber reward), floating labels and white flow lines between locations. It updates live as you edit the quest
  and flies the camera to the first location when switched on.
- **Push all / Pull** for explicit transfers. Everything else in Studio (loot, zones, quests, exports)
  keeps working on the same objects.
In a normal browser the same link works too, but the game opens in its own window instead of being docked.
Windows only. The game window is docked as an owned borderless window that tracks the placeholder area, and
is hidden automatically while dialogs/menus are open or another view is shown.

## Real building models in the 3D tab
The 3D tab shows the game's actual building and prop meshes (roofs, windows, chimneys, ships...), for your
placed objects and for every vanilla loot building. `tools/odol_reader.py` reads the game's binarized `.p3d`
models directly from your install (ODOL v54: plain face lists + LZO-compressed vertex arrays);
`tools/extract_models.py <world>` writes `data/<world>/models.json|bin` (also runs automatically after a
terrain capture, or via Game setup ▸ "Build 3D models"). Includes UVs + diffuse textures; untextured faces use wall/roof colours guessed from the
texture names. The game itself (Game view) remains the place to see true textures and lighting.

## 3D preview + capturing terrain from the game
Run `run_studio.bat` (or `python tools/studio_server.py`) and open http://localhost:8765. The **3D** tab shows
the real terrain (satellite texture on a height mesh), your objects, vanilla loot buildings as correctly sized
boxes, loot points, loot zones and quest markers. Left-drag moves objects / pans, right-drag orbits, WASD flies;
clicking with a placement tool puts objects on the actual ground.

The **⚙ Game setup** panel talks to your DayZ install:
- **Terrain from the game** - launches DayZ once with a tiny bridge mod (`bridge/DZStudioBridge`, packed
  automatically). The game samples `SurfaceY` for the whole map and measures every model with `ClippingInfo`,
  writes `data/<world>/heights.bin` + `bounds.csv`, and the server closes it. ~1 minute.
- **DayZ Editor (Dabs)** - writes your objects as an Object Spawner file into `Documents\DayZ\Editor`
  and starts DayZ with CF + Dabs Framework + DayZ-Editor. Export from the Editor as Object Spawner JSON and
  open that file here to bring changes back.
Heights are baked into exported Object Spawner JSON automatically once terrain is captured.

## Loot spawns
The **Loot** tab shows where vanilla loot spawns, straight from the game's Central Economy data
(`maps/<world>/loot.js`, built by `tools/extract_maps.py`): every building that owns loot, coloured by usage
(Military, Town, Village, ...), with its individual loot points and ranges when zoomed in.
- Click a spawn to see/edit its loot definition: usages, tiers, containers, item categories, tags and points
  (drag points on the map, or add points by clicking). Edits apply to the whole building class, like in DayZ.
- Move / rotate / delete / duplicate spawns, or place new ones from any loot group (click a group, click the map).
- **New loot group** creates a definition for a custom object class; attach it to placed objects.
- The inspector lists which item types can spawn there (needs `types.xml`, included for the built-in maps).
- Export writes full `mapgrouppos.xml` + `mapgroupproto.xml` plus a change log.
- Import your own mission's `mapgroupproto.xml`, `mapgrouppos.xml` and `types.xml` from File ▸ Import.

## Loot zones (tiers & usage areas)
The **Zones** tab shows the Central Economy's area flags (`areaflags.map`) as a colour overlay: loot **tiers**
(Tier1-Tier4, Unique) or **usage** areas (Military, Coast, ...). Draw polygons, rectangles or circles that
Set / Add / Remove tiers or usages; they are painted over the vanilla layout in list order. Drag corners to
reshape, drag the outline to move. Export writes a complete `areaflags.map` (+ `zones.json`) that replaces the
mission file. File ▸ Import can load your own server's `areaflags.map` as the base.

## Real terrain imagery
`maps/<world>/` holds satellite tiles extracted from your own DayZ install. The map shows a 4096px overview and
swaps in 512px tiles as you zoom.

Studio finds the maps itself: every `worlds_<map>_data.pbo` in `DayZ\Addons` or in a DLC folder (`DayZ\sakhal`,
`DayZ\nasdara` …) and every `dayzOffline.<map>` mission of DayZ Server. A map's size comes from its
`areaflags.map`, so a new DLC map needs no Studio update. From the command line:

    pip install pillow
    python tools/extract_maps.py                    # every map, auto-detects Steam DayZ
    python tools/extract_maps.py --world nasdara    # just one map
    python tools/worlds.py                          # which maps this PC has
    python tools/extract_maps.py --pbo "C:\path\to\worlds_xyz_data.pbo" --name xyz

The imagery comes from game files you own - keep it for personal use, do not redistribute `maps/`.

## Notes
- The built-in class list is a convenience set; import your server's `types.xml` / `mapgroupproto.xml`
  (File ▸ Import) for exact class names.
- Generated Enforce scripts have not been compiled against a live server by the author of this tool;
  check the script log on first start.
- Town labels are approximate landmarks (Chernarus+ only).

## Play-test quests in the real game
Game view → **🧪 Play-test quests**. Studio builds a small test mod (`@DZStudioQuestTest`: your exported quest runtime + an Editor hook), restarts the game with it, and the quests run inside the Editor session with the free-cam player.

* Quest nodes light up live in the node editor (orange = active, green = done, with progress counts).
* Edits in Studio are re-sent to the running game automatically (or press **↻ Reload quests**).
* Test controls: **Reset progress**, **Simulate kill**, **Spawn infected**, **Give item**; teleport via the link (`tp` op).
* Script compile errors from the game log are shown in plain English under the bar.

## Textured models in 3D
`python tools/extract_models.py [world]` now also reads each building's UVs, per-face materials and the diffuse `.paa`
textures straight from your DayZ PBOs and writes `textures.json/.bin` next to `models.json/.bin` (128 px by default,
`--tex 256` for sharper, `--no-tex` for geometry only). Faces without a readable texture keep the guessed wall/roof colour.

## Editing in the 3D view (no Dabs needed)
* **Gizmo**: select an object → move arrows / plane squares, rotate rings (yaw, pitch, roll), uniform scale. `1/2/3` switch mode, `X` world/local, `Ctrl` disables snapping, `Shift` = 1° rotation steps. Grid snap uses the toolbar's *Snap* value.
* **Selection**: click, `Shift`-click, or drag a box on empty space. Ctrl+C / V (pastes at the cursor), Ctrl+D, Delete, Ctrl+Z / Y all work in 3D.
* **Surfaces**: *Snap to surfaces* (`O`) drops dragged objects onto other objects, vanilla buildings or terrain. `End` = drop to ground, `N` = align to terrain slope. Pitch / roll use the game's own convention (measured with the engine).
* **Brushes**: pick a class in Assets, then in the 3D toolbar choose Single / Scatter / Line / Ring (radius, count, spacing, random yaw/scale, facing, align to terrain). One undo step per stroke.
* **Full class library**: Game ▸ *Capture class list* reads every class of the game (≈5000 with models). Browse or search them in Assets; their 3D models are fetched from the game files automatically the first time they appear in the 3D view (`tools/extract_models.py --add A,B,C`).

## Standalone game viewport (no Dabs / CF needed)
`bridge/DZStudioWorld` is a tiny mod (vanilla dependencies only). Studio launches the game offline with `-mod=@DZStudioWorld`
and its own mission folder; the mod creates a hidden player + free camera and executes Studio's commands (sync objects,
camera, quest preview shapes, selection highlight, teleport / spawn / give for play-test). In the game window: WASD move,
Shift fast, Q / E down / up, hold the right mouse button to look. The 3D tab camera is mirrored into the game
("3D tab drives game camera" in the Game bar). Quest play-test uses this engine too (`@DZStudioQuestTest` ticks from `MissionGameplay`).
The Dabs editor is still available from the engine dropdown next to *Launch*.

## NPC conversations (Skyrim style) + voice lines
* **Talk to NPC** nodes now start the quest through a conversation: the player walks up, looks at the NPC and presses **F**
  (a "[F] Talk to …" prompt appears). The camera moves to the NPC, the text types out, replies are picked with 1–4, Up/Down + Enter, or the mouse; Esc leaves.
* In the Quests tab select the NPC node ▸ **💬 Edit conversation…**: three conversations (before the quest, while it runs, after completing),
  lines with replies that branch, "accepts quest" replies, and a live preview. Without a conversation a simple one is generated from the quick greeting.
* **Voice lines**: attach an `.ogg` or `.wav` to any line. Export puts the files in `source/<mod>/sounds/` and writes the CfgSoundShaders/CfgSoundSets
  into the mod's config.cpp automatically (the play-test mod does the same).
* Conversations need the client to run the quest mod too (the UI is client side; the server sends each conversation over RPC). Players on a server without the mod
  simply cannot talk to the NPC.

## Quest tracker + journal (in game)
* **Tracker** (top right): the tracked quest, its current objectives with progress (`Kill 10 infected  3/10`), distance + compass bearing
  to the objective and a floating marker over it. Banners announce *New quest*, *Objective completed* and *Quest completed*.
* **Journal** (**J**): Active / Completed tabs, description, objective checklist. **T** or Enter tracks / untracks, **A** (twice) abandons
  quests that were taken from an NPC, Up/Down and Left/Right or the mouse navigate, **J** / Esc close.
* The server sends each player a snapshot of their quest log (RPC) whenever it changes; the tracked quest is remembered per client.

## Whole-world scene in the 3D tab (trees, rocks, props, buildings)
* **Game ▸ 🌲 Capture world objects** runs the game once (about 3 minutes), asks the engine for every map object
  (≈ 2.9 million on Chernarus: model, position, rotation, scale) and builds a streamed scene from it
  (`tools/build_scene.py`: low-detail textured meshes + a cell-sorted instance table, ~60 MB).
* The 3D tab streams the 250 m chunks around the camera, merged into a few textured meshes per chunk; toggle it with
  the **Map objects** layer. Buildings already shown by the detailed layer are not drawn twice.
* **Snap to surfaces** now also lands on those objects (roofs, walls, rocks…).

## Importing other editors' work
**File ▸ Import from DayZ Editor (.dze) / Expansion (.map) / init.c…** — the format is detected automatically:
* **DayZ Editor (Dabs) `.dze`**: binary saves (versions 1–8, verified against files written by the real mod) and the older JSON flavour.
  Objects keep position, yaw/pitch/roll, scale, label and lock; hidden map objects are kept in the project (`removed`).
* **Expansion `.map` / `.txt`**: `Class|x y z|yaw pitch roll|attachments`, including `-Class|…` removed objects and `Class.Trader` entries.
* **init.c**: every `SpawnObject("Class", "x y z", "yaw pitch roll", scale)` call (also plain `CreateObject` calls).
* Object spawner JSON still opens through *Open project / spawner JSON*.
You can add the objects to the current project or replace its objects; the map is switched when the file names another world.
`tools/sample_dabs_v8.dze` is a real Dabs file used to test the reader.

## Build an installable mod + projects on disk
* **Export ▸ 🧰 Build installable mod (PBO)…** packs the quest framework (runtime, your custom scripts, conversations, voice files
  with their sound config) into `@YourMod/addons/yourmod.pbo` with a binarized config, no DayZ Tools needed, and zips it with the
  `profile/DZStudioQuests/quests.json` and an `INSTALL.txt`. **▶ Test this exact mod in the game** launches the viewport with that
  PBO instead of the play-test mod, so what you test is what you ship.
* **Autosave to disk**: every edit is also written (a few seconds later) to `Documents/DayZStudio/Projects/`, with a rolling
  backup every 5 minutes (newest 25 kept) in `Documents/DayZStudio/Backups/`. **File ▸ Recent projects and backups…** opens or
  restores them; when the app starts with an empty browser copy it offers your last project.

## Test on a local server (multiplayer)

File ▸ **Test on a local server (multiplayer)…** (or the 🖧 button after *Build installable mod*) runs the free
**DayZ Server** (Steam ▸ Library ▸ Tools) on this PC with the built mod and connects your game to it:

1. **Start server**: writes `_game/server/serverDZ.cfg` (unsigned mods allowed, BattlEye on, port 2302),
   copies `quests.json` into `_game/server/profile/DZStudioQuests/` and starts `DayZServer_x64.exe` in its own console.
2. **Join with the game**: starts DayZ through `DayZ_BE.exe` (BattlEye, as players do) with `-connect=127.0.0.1`.
3. Test helpers: teleport to the first NPC and open its conversation, simulate kills, reset progress; the quest log
   from the server is shown live.

Verified on DayZ 1.30: conversation open (server → client), accept and F-to-talk (client → server), tracker and journal
updates, progress kept across a reconnect and a server restart. The client asks the server to resend the NPC list and
journal until it has them, so a player who rejoins quickly still gets the talk prompt and journal.

## Quest chains

Quest settings ▸ **Quest chain**: tick the quests that must be completed first. Until then the quest's triggers do
nothing and its NPC uses the **Not available yet** conversation (a tab in the conversation editor). Loops are
refused. Exported to quests.json as `requires`, and to Expansion as `PreQuestIDs`.

One NPC for several quests: on a Talk-to-NPC node use **Use the same NPC as…** (copies class, name, position, gear).
NPCs of the same class standing within 1.5 m become one character in game, who talks about the most relevant quest:
a running one, else one that is available, else the one finished last, else "not available yet".
Check warns when an NPC with the same name stands at two different places.

## Smarter conversations

Each reply has **Conditions & items**:
* **Show this reply**: always / player carries N× item / does not carry it / a quest is completed / in progress /
  never started. Replies whose condition fails are hidden (checked by the server for each player).
* **Takes**: items removed from the player when chosen; the reply only shows when they carry them
  (stacks such as rags count by quantity).
* **Gives**: items handed to the player. A gift without a price is given once per player (remembered across
  restarts); with a price it works as a trade every time.

Local server test helpers gained **Give item…** (e.g. `Rag 4`) and Reset progress now really resets players.

## NPC looks

Talk-to-NPC nodes have **Outfit** presets (Survivor, Hiker, Hunter, Soldier RU/US, Police, Paramedic, Doctor,
Construction worker, Farmer, Trader, Bandit, Hazmat, Sniper) and a **🎲 Random outfit** button; they fill the
clothing list and **Item in hands** (weapon or tool, no ammo). The character field suggests all 31 vanilla
survivor faces. All preset class names were checked against DayZ 1.30. In game, Esc now closes the conversation
or journal without also opening the pause menu.

## Quest markers

* The vanilla in-game map shows quest markers whenever it opens (map item or the server's no-map-needed setting):
  open objectives with a position (gold = tracked quest) and NPCs that have a quest the player can take now.
* Journal ▸ **[M] Map** opens the map centred on the selected quest's objective, even without a map item.
* Objective/NPC nodes have **Hide the marker** to keep a location secret.
* Progress is now saved right after a quest starts, every 2 minutes and on server shutdown; a quest left without
  any active step (older saves / crashes) repairs itself.
* Desktop app: its browser storage is flushed every 5 s, and at start a newer disk copy of the open project wins.

## Bonus objectives

Every objective node has **Bonus objective (optional)**. Wire it as a side branch (e.g. Talk to NPC → bonus objective
→ Give Items) next to the main path to Quest Complete. In game it is announced as "Bonus objective", shown in gold
as "(Bonus) …" in the tracker, journal and map, completing it shows "Bonus objective completed", and if the quest is
finished without it the journal shows "[-] … missed". Check warns when Quest Complete can only be reached through a
bonus, when a bonus leads straight to Quest Complete, or when "Wait For All" waits for a bonus.

Network: messages to players (conversations, journal, NPC list) are sent in 800-byte pieces, so long conversations
and big journals work (one network string holds only about 1 KB). Replies per line: up to 6, of which 4 fit on screen.

## Removing vanilla map objects

3D tab ▸ **✂ Remove map objects**: click any tree, rock, wall, lamp or building of the map (Shift adds more), then
**Remove** or press Delete (Esc leaves the mode). Loot buildings take their loot spawns with them. Removed objects
disappear from the 3D view, show as red ✕ on the 2D map, and are listed under Project ▸ Removed map objects (Restore /
Restore all; undo works too). Objects removed in a DayZ Editor (.dze) or Expansion (.map) file you import land here too.

* **Exported mod** (Build installable mod): the list is compiled into the mod (`DSMapEditsData` in DSCustom.c); the
  server and every player hide the same objects at start (matched by class or model path within 1.5 m, hidden the
  way CF's ObjectManager does it: flags off, moved away, AI path graph updated). Players need the mod.
* **Expansion export**: written as `-Class|x y z|0 0 0` delete lines in the .map file.
* **Live viewport**: the standalone editor viewport hides / shows them as you edit.

## Signed mods

Build installable mod signs the PBO with DayZ Tools: a key pair per mod name is created once in
Documents/DayZStudio/Keys (back up the .biprivatekey - new versions of the mod must use the same key), the
.bisign goes next to the PBO and the .bikey into @Mod/keys. Server owners copy the .bikey into the server's keys
folder and keep verifySignatures = 2 (INSTALL.txt says so). The local server test has "check signatures" to try
exactly that (verified: signed mod joins with verifySignatures = 2, no kick).

## Publish to the Steam Workshop

Conversations, the quest tracker, the HUD and faction standings run on the players' PCs, so players need your mod.
**File ▸ ☁ Publish to Steam Workshop…** (also a button after Build installable mod) puts it on the Workshop so
they get it automatically:

* Fill in a title, description (Steam formatting works and Studio writes a first draft from what your project
  contains), mod type tags and visibility. Pick your own preview image or use the one Studio makes from the title.
* **☁ Publish** builds the mod, checks the scripts and uploads the PBO, its signature, your public `.bikey` and a
  `mod.cpp` (the name and description the DayZ launcher shows). Your private key never leaves your PC, and the
  quests themselves stay on your server (profile/DZStudioQuests).
* It uploads through the Steam client you are logged in with - no password is asked for. DayZ must be installed
  (Studio uses its Steam library). While it uploads, Steam shows you as "playing DayZ" for a moment.
* Studio remembers the Workshop item in the project: publishing again updates the same item, with change notes.
  Start with **Private**, subscribe and test it, then switch to **Public** and publish again.
* The first time anyone publishes to the Workshop, Steam asks them to accept its Workshop legal agreement; Studio
  links to it if that's needed.
* Once a mod has a Workshop item, the INSTALL.txt and mod.cpp of every build link to the Workshop page.

## Sharing DayZ Studio

    python tools/make_dist.py      ->  dist/DayZStudio_<date>.zip  (~0.4 MB)

Contains only DayZ Studio's own files plus FIRST_RUN.txt (requirements: DayZ, DayZ Tools, Python 3.10+ with
pillow + numpy, optional Node.js for the desktop app). No data extracted from DayZ is included - it belongs to
Bohemia Interactive; every user rebuilds data/ and maps/ from their own install on first run.

## Conditions, server variables, time & weather

One condition picker is used everywhere (conversation replies, opening lines, quest availability, NPC appearance
and the condition nodes):

| Condition | Checks |
|---|---|
| Item / quest | carries an item, does not carry it, a quest is done / running / never started |
| **Player condition** | bleeding, sick (any disease or poisoning), broken legs, unconscious, blood, health, water, energy |
| **Server variable** | a server-wide value (=, ≠, >, ≥, <, ≤) |
| **Time of day** | an in-game time window; it may run past midnight (23 → 1); exactly midnight = 0 → 0.25 |
| **Weather** | thunderstorm, clear sky, or rain / fog / clouds compared with a value (0–1) |
| **Server uptime** | minutes since the server started, e.g. only in the first hour after a restart |

New nodes:
* **Set Server Variable** (reward) - set / add / subtract / toggle a variable every player shares; it survives
  restarts (`$profile:DZStudioQuests/globals.json`).
* **Condition Met** (trigger) - the quest starts when the condition holds.
* **Wait Until** (logic) - the quest waits here, invisibly, until the condition holds (only during a storm, at
  night, once a server variable is set…).
* **Meet a Condition** (objective) - shown in the tracker, done when the condition holds ("Stop the bleeding",
  "Get your blood above 4000").

Also: **Quest settings ▸ Server condition** (the quest is only available while it holds), **Talk to NPC ▸ Only
appears while** (the NPC shows up and leaves on its own, checked every 5 seconds - e.g. a faction that arrives once
a variable is set), and in the conversation editor **Open with this line when…** (the NPC reacts first, e.g. when
the player is bleeding). The local server test has **⚑ Set server variable…** and lists the server's variables.

## Prefab stamps, effects and the performance heatmap

**Prefab stamps** - select a group of placed objects (box-select / Shift+click) and use **⭐ Save as prefab
stamp…** (inspector or 3D toolbar). The stamp keeps every part's offset, rotation, tilt, scale and height above the
ground, and goes into your library in `Documents/DayZStudio/Prefabs` - shared by every project (share the .json
files with others). Pick it under **My prefab stamps** in the asset list: click the map to stamp it (Q/E rotate),
or in the 3D tab paint it with the Scatter / Line / Ring brushes.

**Effects & sounds** - asset list ▸ Effects & sounds places an effect marker (presets: campfire, burning wreck, toxic
anomaly, electric anomaly, alarm, generator hum, signal smoke, glow light, your own ambient sound). Each effect can
combine vanilla **particles** (fires, smoke, steam, toxic gas, sparks, flares; one-shots can replay every N seconds),
a coloured **light** and a looping **sound** (vanilla sound sets or your own .ogg/.wav), with a range in metres. It is
on always, **only while** a condition holds, or **starts off** and is switched by the **Turn Effect On / Off** quest
node (the switch survives restarts). The condition is checked for each player on their own, so effects can be
*phased*: a fire that only burns for players who have not finished a quest yet (**NOT** quest done), a glow only
players with Reputation ≥ 50 see, a storm sound only at night. Effects are played by the exported mod on each
player's PC; they are not spawned objects.

**Performance heatmap** - Project ▸ World ▸ **🔥 Show performance heatmap**: the 2D map shades every area by the
weighted objects within 150 m (DayZ's near network range; buildings weigh most, loot points a little) - green, yellow,
orange, red - and lists the hotspots with a jump button. **Check** warns about orange and red areas. It is a rule of
thumb to find crowded spots before they cost FPS or cause desync, not a measurement of the server.

## Player stats, item requirements, HUD and usable objects

**📊 Player stats** (Quests panel or File menu) opens one window with three tabs:

* **Stats** - XP, reputation, skill levels, a bounty… each with a start value, an optional min / max, and
  **resets on death**. Stats belong to each player and are saved with their quest progress
  (`$profile:DZStudioQuests/players/<steam id>.json`).
* **Item requirements** - "M4A1 needs XP ≥ 300", "a Ghillie suit needs the Sniper quest done". Taking the item
  into the hands or wearing / attaching it is refused with your message until the player meets the condition. Any
  condition works, and without **this class only** it also covers every variant of the class.
* **HUD & character sheet** - bars and text drawn on every player's screen (drag them in the 16:9 preview; text can
  show `{xp}`, `{xp.max}`, `{xp.name}`), and a key (K) that opens a **character sheet** with the player's stats.
  The HUD hides itself while a menu, the map, a conversation or the death screen is open.

New nodes:
* **Change Player Stat** (reward) - add / subtract / set a stat, with an automatic "+100 XP" message.
* **Use Object** (trigger and objective) - pick a placed object (a gate, a locker, a terminal); the player looks at
  it and presses **F**. It can require a key item (optionally used up), a stat or another quest, show a "locked"
  message, show a message when it works, and **remove the object** once used (a gate that opens, a crate broken
  open). As an objective it is marked on the map like other objectives.

The condition picker gained **Player stat** (wherever a player is involved) and a **NOT** box (the condition
holds when the check fails).
Stats, item rules and the HUD are compiled into the quest mod, so **Build installable mod** after changing them.

## Money: dollar bills

Vanilla DayZ has no money, so the quest mod brings its own: **dollar bills** in $1, $5, $10, $20, $50 and $100
(item classes `DSQ_Dollar1` … `DSQ_Dollar100`). They are real inventory items - they stack up to 1,000 bills,
split like rags, can be dropped, looted and lost on death - and every denomination has its own colour, so players
tell them apart at a glance. Hand them out as quest rewards or conversation gifts like any other item
(e.g. `DSQ_Dollar20` × 150 gives one stack of 150 twenties); traders will take them too.

* Every mod you build includes the bills (model + textures, about 0.8 MB). The first build takes about a minute
  longer while DayZ Tools converts them; after that they come from a cache.
* **Your own bill artwork:** put images in `Documents\DayZStudio\Assets\Currency` - `dollar_20_front.png` and
  `dollar_20_back.png` (or a single `dollar_20.png` for both sides, `.jpg` works too) - and the next build uses
  them instead of Studio's "Chernarus Reserve Notes". They stay on your PC; only the converted textures go into
  your mod, so check that your artwork's license allows that before you publish.
* Amounts for stackable items (bills, rags, nails …) in rewards and gifts are now a *quantity*: "Rag × 2" gives two
  rags, no longer two full stacks.

## Traders

**File ▸ 🛒 Traders & money** (also a tab in 📊 Player stats) sets up stores. A trader is a price list: what the NPC
sells and what it buys back. Give a quest NPC the trader in its **Trader** field (Talk to NPC node) and its
conversation gets a **"Let's trade."** reply. Picking that reply opens a two-column buy/sell screen in game.

* **The price list** - per row: item class, an optional display name, what the player pays, what the player gets
  for selling one back (0 = the trader doesn't sell it / doesn't buy it), how many pieces one trade covers
  ("5.56 rounds × 20"), a **stock** limit and a **category** heading. Leave stock empty for endless.
  Limited stock refills when the server restarts.
* **🔒 Sold only if** - any condition can lock a row, e.g. "Survivors at Friendly". A locked row shows "(locked)",
  and selecting it shows your reason ("Morphine is for friends of the camp.").
* **Paying** - prices are in dollars by default. The trader takes the biggest bills that fit first and gives change
  back in bills. Players can only sell items that aren't ruined, aren't being worn and are empty, so nobody loses
  the loot in their backpack by selling the backpack.
* **Factions** - an NPC with a faction refuses to trade with players its faction sees as Hostile. Tiers with a
  discount get it on everything the trader sells, and the store's header shows it ("Friendly: 10% off").
* **Your own currency** - if your server uses a mod that adds other money (coins, bottle caps, a ruble mod…), add a
  currency under **Custom currencies**. It can be **money items** (each class with its value, e.g. `Coin_Gold` = 100)
  or **a player stat** used as a bank balance. Then pick it in the trader's "Pays and charges in".
* **In game** - click or press Enter to trade one; hold Shift to trade ten. Use the arrow keys or the mouse to move
  around and Esc to close. The server checks every trade: the player must still stand next to the NPC and have the
  money and the items. Each trade is announced on the screen.

The Showcase template includes **Mirek's camp store**: food, bandages, ammo, Morphine for Friendly players only, and a
small stock of magazines. It also buys apples and food back. The settings go into
`profile/DZStudioQuests/trade.json`, which the studio server checks before every build.

## Factions & reputation

**📊 Player stats ▸ 🏳 Factions** sets up factions (Survivors, Bandits…) and how players stand with them:

* **Scale & tiers** - one scale for every faction (default −1000 to 1000) split into named tiers: Hostile (−1000 to
  −500), Neutral (−499 to 499), Friendly (500 to 1000), or the 5-tier set. Each tier has a colour, a **stance**
  (hostile / neutral / friendly) and a **trade discount**. Studio checks that the tiers cover the scale without gaps.
* **Factions** - name, colour, starting standing, **territories** (circles, picked on the map and drawn on it) and
  **kill rules**: e.g. +2 for every infected killed in their territory, −150 for killing a player there, +50 for
  killing a player they see as Hostile.
* **Relations** - a grid of factors: with −0.5, +100 with the Survivors means −50 with the Bandits. Applied one step,
  so it can't loop.
* **Their NPCs** - give a quest NPC a faction (Talk to NPC ▸ Faction). Players in a **Hostile** tier are warned, the
  NPC refuses to talk, turns to them and - if it holds a gun Studio knows (AKM, AK74, AKS74U, M4A1, SKS, Mosin, FAL,
  MP5, Izh18) - shoulders it, aims and fires when it has a clear line of fire (bushes don't block it, walls, rocks
  and trunks do): players see the muzzle flash and hear the gun's own shot sound.
  Players in a tier with a discount pay less on the NPC's **trade replies** ("Trade 5 apples (-20%)").

Quests use it with the **Change Faction Standing** node and two new conditions, **Faction standing** (points, e.g.
Survivors ≥ 500) and **Faction standing (tier)**, which work everywhere conditions do - conversation replies, opening
lines, quest availability, item requirements, effects. Players see their standing on the character sheet and in HUD
text (`{rep.survivors}`, `{rep.survivors.tier}`), the talk prompt shows how an NPC's faction sees them, and every
change and new tier is announced.

Standings are saved per player next to their quest progress, and the settings go into
`profile/DZStudioQuests/factions.json`, which the studio server checks before every build. Scripts can use
`DSQuests.Get().AddPlayerReputation(playerId, factionId, amount)`, `GetPlayerReputation` and `SetPlayerReputation`.
Vanilla DayZ has no combat AI for people, so faction NPCs stay where they stand and can't be hurt.

## Server utilities

File ▸ **Server**:

* **⚙ Server settings (serverDZ.cfg)** - opens the cfg of your DayZ Server install (or any path) as a form: name,
  passwords, player cap, map, messages of the day, BattlEye, signature checks, first person / crosshair / night
  brightness and the other gameplay switches, network ranges and view distances with presets (DayZ defaults, busy
  server / weaker PC, small server / long view). **Time of day** shows one real-time day as a day / night strip:
  set how long the day and the night should last in real time and Studio works out `serverTimeAcceleration` and
  `serverNightTimeAcceleration`, plus the start time (or the PC clock). Only the lines you change are rewritten -
  comments and settings Studio doesn't know stay as they are - and the old file is kept as `serverDZ.cfg.bak-<date>`.
* **⚖ Loot economy multipliers (types.xml)** - rules such as "Military ×1.5", "food −50%", "Tier 4 ×0.5" or a name
  filter ("Ammo_*"), with an optional category / usage area / tier and a slider each. Rules multiply, the preview
  shows the total per category before and after plus every changed item, and **Write to server** rewrites
  `nominal` / `min` in the mission's `db/types.xml`. The untouched file is kept as `types.xml.studio-original` and
  rules are always applied to it, so writing again never stacks; **Restore original** puts it back. Or download the
  scaled file instead.
* **📦 PBO tools** - browse the game, Workshop / launcher mods, the server and your own folders. Look inside a PBO,
  **unpack** it (into `Documents/DayZStudio/Unpacked`, `config.bin` turned into a readable `config.cpp` with DayZ
  Tools' CfgConvert), **pack** a folder into a PBO (prefix from `$PBOPREFIX$`, config binarized and checked by
  CfgConvert, optional signing with a Studio key), and **🧩 Use this mod in Studio**: the mod's classes appear in the
  asset list and their 3D models load from the mod's PBOs like vanilla ones. Unpack other people's mods to learn
  from them - don't re-upload their files without permission. Protected (obfuscated) PBOs can't be read.

## Your workspace

Arrange Studio like a game-engine editor - every tool is a panel you can put where you want, and Studio remembers
it for next time.

* **Dock panels anywhere.** Drag a panel's tab and drop it: on another panel's tab bar to add it as a tab, on the
  left / right / top / bottom of a panel to split it, or on the edge of the window. A blue box shows where it will
  land. Drag the dividers to resize. The panels are the four views (**Map, Game, 3D, Quests**), the **Inspector**,
  **Assets, Loot, Zones, Game setup, Scene, Quest list** and the **Script console**.
* **Two views at once** - e.g. the Map and the Quest graph side by side, or the Map and the 3D view. Both stay live;
  keyboard shortcuts act on the one you clicked last (its tab is underlined).
* **Maximize** an area with the □ button on its tab bar, a double-click on the empty part of the bar, or
  **Ctrl+Shift+F**. **Collapse** the outer left / right area to a slim strip with **Ctrl+B / Ctrl+Alt+B** (or a
  double-click on its divider); click the strip to bring it back. Close a panel with ✕ (middle-click works too) and
  reopen it from **▦ ▸ Panels**. Right-click a tab for more.
* **Second monitor:** right-click a tab (or ⋯) ▸ **Float in its own window** puts the Inspector, the asset panels or
  the console in a window of its own that you can move to another screen. It stays live, and the desktop app
  reopens it there next time. Close the window to dock the panel back. (Views stay in the main window.)
* **Workspaces** (**▦** button, top right): built-in layouts *Default*, *Mapping*, *Quest writing*, *Map + Quests
  side by side*, *Scripting* (console under the views) and *Focus*.
* **Profiles - your own setups.** **▦ ▸ Save as a new profile…** keeps everything about your workspace: the panel
  layout (floating windows included), the view it opens, your keyboard shortcuts, the toolbar and the interface
  size. Switch between profiles from the ▦ menu (e.g. "Quest writing on the laptop", "Two screens at home"), update
  one after changing things, or undo your changes. **▦ ▸ Profiles: manage, import, export…** renames and deletes
  them, **exports** a profile as a `.dzworkspace.json` file to share or keep, and **imports** one. Profiles are files
  in `Documents\DayZStudio\Workspaces`, so they survive updates and reinstalls and can be backed up with your
  projects. Workspaces saved by the previous version are moved there and layouts from it are converted.
* **Keyboard shortcuts:** **▦ ▸ Keyboard shortcuts…** - click a shortcut and press new keys; Studio warns when a key
  is already taken. New defaults: **Alt+1…4** Map / Game / 3D / Quests, **Ctrl+`** console, **Ctrl+Shift+W** the
  workspace menu. The help (F1) always lists your own keys.
* **Toolbar:** **▦ ▸ Customize the toolbar…** hides buttons you don't use and reorders the groups.
* **Interface size** from 80% to 150% in the desktop app (in the browser version use Ctrl + / Ctrl −).

## Enforce Script tools

* **Code editor** - Custom Script nodes, object init scripts and custom nodes get an editor with Enforce syntax
  highlighting, line numbers, auto-indent and a checker that explains, as you type, the mistakes that stop DayZ from
  loading scripts: brackets or quotes that aren't closed, a missing `;`, reserved words used as names (`out`,
  `local`…), the same variable declared twice in one function, `=` instead of `==` in an if, and `a && b` stored
  straight into a bool. ⤢ opens the code in a big window. **Check** runs the same checks over the whole project -
  including init scripts of different objects that declare the same name (they all end up in one init.c function).
* **⌨ Script console** (Quests panel or File ▸ Scripting) - a floating window that follows the local test server's
  `script.log` live (or its RPT, or the game's own log). Errors and warnings are coloured and explained in plain
  English, and errors in your code point back to the node they came from ("Custom Script in “Rescue”, line 3 of
  your code" - click to open it). **▶ Compile on local server** builds the quest mod from the project and (re)starts
  the server; if the scripts don't compile, the console stops the server for you (DayZ would otherwise sit on a
  "Compile error" box).
* **🧩 Custom nodes** - turn a small Enforce snippet into your own node block: an **action** (runs once, like a
  reward) or a **check** (an objective that is done when your code returns true). Give it settings (number, whole
  number, text, class name, yes / no, map position); they become fields in the inspector and typed variables in
  your code, next to `player` and `pos`. Start from an example (Set Player Health, Spawn Custom Vehicle, Teleport
  Player, Hold an Item, Climb Above). Custom nodes are kept in a library shared by every project
  (`Documents/DayZStudio/Nodes`, share the .json files) and a project keeps a copy of each one it uses, so it builds
  anywhere. They show up in the node menu like the built-in ones; **Make your own node…** is at the bottom of it.
* **Checked before every build** - building the mod, ▶ Compile on local server and ▶ Play-test first run the checker
  over the whole generated script. If something would stop DayZ from compiling, nothing is built and you get a list
  of the problems; click one to jump to the node it came from. (For contributors: GitHub runs the same checks on
  every push, against the Showcase project - `node tools/check_scripts.js` runs them locally, and you can pass it
  your own `.dzstudio.json` files too.)

## A Personal Note on the AI usage in creating this project
While I utilized Claude to streamline aspects of development, DayZ Studio is by no means an automated AI creation. Countless hours of my own intense effort, problem-solving, and personal dedication went into building and refining this project. Far from being generic "AI slop," this is the result of genuine work and creative passion. I ask that you please respect the time and effort that went into bringing this project to life.
