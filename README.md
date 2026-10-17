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

### 1. Install what it needs (all free)

| What | Why | Where |
|---|---|---|
| **DayZ** | the editor reads the terrain, models and objects from your game | Steam |
| **DayZ Tools** | builds (binarizes) and **signs** the mods you export | Steam ▸ Library ▸ Tools ▸ DayZ Tools |
| **Python 3.10+** | runs the small local server behind the editor | [python.org](https://www.python.org/downloads/) - tick **"Add python.exe to PATH"** |
| Python packages | needed to read the game's maps, models and textures | in a terminal: `pip install pillow numpy` |
| **Node.js LTS** *(optional)* | the desktop app (game docked inside the editor) | [nodejs.org](https://nodejs.org/) - without it, use the browser version |
| **DayZ Server** *(optional)* | test your mod in multiplayer from the editor | Steam ▸ Library ▸ Tools ▸ DayZ Server |

Check it in a terminal (Command Prompt or PowerShell):

```bash
python --version
```

It should print `Python 3.10` or newer. If Windows opens the Microsoft Store instead, reinstall Python from
python.org with "Add python.exe to PATH" ticked.

### 2. Download DayZ Studio

Click **Code ▸ Download ZIP** on this page and extract it to a normal folder such as `C:\DayZStudio`
(avoid `Program Files`), or clone it:

```bash
git clone https://github.com/ghosthex-dev/dayz-studio.git
```

### 3. Start it

- **`run_desktop.bat`** - the desktop app. The first start installs its shell with npm (needs Node.js, takes a
  minute). The game window can be docked inside the editor.
- **`run_studio.bat`** - the same editor in your web browser (Chrome / Edge / Firefox), no Node.js needed. Keep the
  black server window open while you work.

### 4. First-time setup per map (about 10 minutes, once)

The download contains no game data, so build it from your own install once per map:

1. **2D map imagery** - in a terminal in the DayZ Studio folder:

   ```bash
   python tools\extract_maps.py
   ```

   (finds DayZ through Steam automatically; give the DayZ folder as an argument if it doesn't)
2. **Terrain, buildings and classes** - open the **🎮 Game** tab and press **⬇ Capture from the game**. DayZ
   starts, records the terrain and closes again (a few minutes). Then press **☰ Capture class list**.
3. **Everything else on the map** *(for the 3D tab)* - press **🌲 Capture world objects** (about 3 minutes).

Pick the map in the project settings (right panel, nothing selected) before capturing another map.

### 5. Make something

- **🗺 Map** - place objects from the asset list, edit loot and zones.
- **🧊 3D** - real models on the real terrain; **✂ Remove map objects** takes vanilla trees, walls or buildings
  away.
- **⎇ Quests** - drag triggers, objectives and rewards into a flow; NPC nodes have outfits and a conversation
  editor (**💬 Edit conversation…**).
- **▶ Play-test** in the Quests view starts the game at your quest with the quests loaded.
- **Export ▸ 🧰 Build installable mod (PBO)…** builds the mod, signs it and zips it with an `INSTALL.txt` for
  server owners. **🖧 Test on a local server** runs it on a real DayZ Server on your PC first.

Projects save automatically to `Documents\DayZStudio\Projects` (**File ▸ Recent projects and backups…**). Mod
signing keys are kept in `Documents\DayZStudio\Keys`. **Back them up**: future versions of your mod must be signed
with the same key, or servers have to install a new `.bikey`.

### Troubleshooting

- **"Could not start the studio server"** - Python is missing or not on PATH (see step 1). `run_studio.bat` shows
  the actual error in its window.
- **Black 2D map / "No terrain data yet"** - run step 4 for this map.
- **Capture buttons are greyed out** - DayZ was not found. Install it through Steam (the editor looks in every
  Steam library folder).
- **Mod built but "not signed"** - install DayZ Tools from Steam and build again.
- **Kicked from your local test server with "Game restart required"** - start the game through the editor's
  **② Join with the game** button; it launches with BattlEye, as servers require.
- Still stuck? Open an issue with the text from the server window or `run_studio.bat`.

---

## Feature guide

## What it does
- **Map editor** – to-scale canvas (Chernarus+, Livonia, Sakhal, Namalsk, Deer Isle, custom size), pan/zoom,
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
terrain capture, or via Game tab ▸ "Build 3D models"). Includes UVs + diffuse textures; untextured faces use wall/roof colours guessed from the
texture names. The game itself (Game view) remains the place to see true textures and lighting.

## 3D preview + capturing terrain from the game
Run `run_studio.bat` (or `python tools/studio_server.py`) and open http://localhost:8765. The **3D** tab shows
the real terrain (satellite texture on a height mesh), your objects, vanilla loot buildings as correctly sized
boxes, loot points, loot zones and quest markers. Left-drag moves objects / pans, right-drag orbits, WASD flies;
clicking with a placement tool puts objects on the actual ground.

The **Game** tab talks to your DayZ install:
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
`maps/<world>/` holds satellite tiles extracted from your own DayZ install (Chernarus+, Livonia, Sakhal are
included in this copy). The map shows a 4096px overview and swaps in 512px tiles as you zoom.
For another install, DLC or mod map run:

    pip install pillow
    python tools/extract_maps.py                    # auto-detects Steam DayZ
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

## Sharing DayZ Studio

    python tools/make_dist.py      ->  dist/DayZStudio_<date>.zip  (~0.4 MB)

Contains only DayZ Studio's own files plus FIRST_RUN.txt (requirements: DayZ, DayZ Tools, Python 3.10+ with
pillow + numpy, optional Node.js for the desktop app). No data extracted from DayZ is included - it belongs to
Bohemia Interactive; every user rebuilds data/ and maps/ from their own install on first run.


## A Personal Note on the AI usage in creating this project
While I utilized Claude to streamline aspects of development, DayZ Studio is by no means an automated AI creation. Countless hours of my own intense effort, problem-solving, and personal dedication went into building and refining this project. Far from being generic "AI slop," this is the result of genuine work and creative passion. I ask that you please respect the time and effort that went into bringing this project to life.
