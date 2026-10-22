# NPC tab and behaviour graphs - plan

Owner decisions (2026-10-22):

- NPCs get their **own tab** (a view like Quests) with its own **node graph**, separate from quests but usable by them.
- NPCs that live inside quests today (Talk to NPC nodes) are **converted automatically** when a project opens.
- Behaviour graphs are **events → actions**, like quests: event nodes start chains of action nodes. An ongoing
  activity (patrol, wander, follow …) runs until an event interrupts it, then resumes.
- First version adds **wander and schedules, say lines, emotes and animations, follow and escort**, plus a
  **custom script module** so advanced users can write their own behaviour nodes.

## Data model

```
project.npcs = [{
  id, name, cls,                    // character (face / body)
  gear: [{c, n}], hands, outfit,    // worn / carried, item in hands
  pos: {x, y, z, ref}, yaw,          // where it spawns (can follow a placed object)
  radius,                            // interaction distance
  faction, trader, cond, nomark,     // as on Talk to NPC today
  stops: true,                       // stops and turns to a player within 3 m
  graph: { nodes: [], links: [] },   // behaviour (same shape as a quest's nodes / links)
}]
```

Quest **Talk to NPC** nodes get `p.npc` (an NPC id). The quest-specific parts stay on the quest node: the
conversation (offer / active / done / locked), the quick greeting. Everything about the character itself moves
to the NPC.

### Conversion (on project open, once per NPC)

Every Talk to NPC node without `p.npc` becomes an NPC: name, character, outfit, gear, hands, position, facing,
interaction distance, faction, trader, appears-while, hide-from-map. Its patrol becomes a **Spawned → Patrol**
behaviour. Nodes of a quest chain that share a character (same class within 1.5 m, or "Use the same NPC as…")
become one NPC used by several quests. The old fields are kept on the node, unused, so nothing is lost.

## Editor

- **NPCs view** (dockable like Quests): a bar with the NPC picker, + New NPC, + Add node, Auto-layout, Fit,
  Preview / Play-test; the behaviour graph below.
- The quest node editor becomes a reusable **graph editor** (`DS.GraphEditor.make(config)`) used by both views:
  node types, categories, link rules, the bar and the empty state come from the config.
- **Inspector**: with nothing selected in the graph it shows the NPC (character, outfit, gear, hands, position,
  facing, faction, trader, appears while, stops for players, "used by quests"). A selected behaviour node shows its
  settings, with the same field widgets as quest nodes (points on the map, waypoints, conditions, items, sounds).
- **Map**: every NPC is drawn with its name; selecting one shows its routes (patrol waypoints, wander area, walk-to
  points, escort destination).
- **NPC list panel** (dockable, like the Quest list) for quick access and search.
- Talk to NPC (quests): an **NPC** picker (+ "New NPC here"), the conversation, the greeting.

## Behaviour nodes (first version)

Events (start a chain):
- **Spawned** - when the NPC appears.
- **Player comes near** - within N m (once per player, cooldown).
- **Talked to** - a player pressed F (when no quest conversation took it).
- **Hostile player seen** - faction standing Hostile within N m, line of sight.
- **Time of day** - between two hours (schedules: fires when the window starts, and at spawn inside it).
- **Condition** - a server variable / weather / any world condition becomes true.
- **Custom event** - script check (advanced).

Activities (run until something else replaces them):
- **Patrol** (waypoints, wait, loop / back and forth, walk / jog)
- **Wander** (inside a circle, pause between moves)
- **Stand at** (a point, facing a direction, optional emote loop)
- **Follow player** (the player who started the chain; stop distance; gives up beyond N m)
- **Escort** (walk to a destination while the player keeps up; continues the chain on arrival)
- **Guard** (stand / patrol and aim + fire at Hostile players - today's faction guard behaviour as a node)

Steps (one after another):
- **Walk to**, **Wait**, **Face player**, **Say** (text above the NPC for nearby players, optional voice line),
  **Emote** (wave, salute, point, sit, warm hands …), **Give item**, **Set server variable**, **Leave** (despawn),
  **Only if** (condition gate), **Random** (picks one outgoing wire), **Custom action** (script).

## Runtime

- quests.json gets `npcs: [DSNpcDef]` with the compiled behaviour graph. The server spawns every NPC from this list
  (appears-while still applies); quest Talk to NPC nodes find their NPC by id. The talk / trade / guard code keeps
  working on the exported fields.
- `DSNpcBrain` per NPC: current activity, a running chain (step index + timers), event cooldowns. Ticked once a
  second; movement and turning per frame by one script command (`DSNpcMoveCmd`, from today's DSPatrolCmd: walk / jog
  to a point, face a point, stop).
- Say: RPC to players within range → floating text above the NPC (+ sound set). Emotes: the game's gesture commands
  on the character (to be measured in game).
- Custom NPC nodes: the existing custom-node library gets two more kinds - **NPC action** `(PlayerBase npc,
  PlayerBase player, args)` and **NPC event** (a check run every second).

## Phases

1. **Foundation** - data model, conversion, NPCs view with the shared graph editor, NPC inspector, map drawing,
   quest NPC picker, export of standalone NPCs; runtime spawns NPCs from `npcs`. Showcase converts and plays.
2. **Behaviour runtime** - DSNpcBrain + DSNpcMoveCmd; Spawned / Player near / Talked to / Time of day / Condition;
   Patrol / Wander / Stand at / Walk to / Wait / Face / Say / Give / Set variable / Leave / Only if / Random.
3. **Emotes, follow and escort, guard node.**
4. **Custom NPC script nodes.**
5. Showcase NPCs, README, release.

Each phase is tested on the local server before the next.

## Status

- **Phase 1 - done** (commit b8b4464), tested in game.
- **Phase 2 - done, tested in game** (2026-10-22): `DSBrain` per character (quests.json `brains`, linked by
  `npcId`), events → step queue (every wire runs, in order; Random picks one), activities drive DSPatrolCmd.
  Verified: Spawned, Player comes near, Talked to (NPCs no quest uses; custom prompt), Only if, Face player,
  Say (text above the head, RPC 77430016), Escort (waits when the player falls behind, the chain goes on at the
  destination), Give item, Set server variable, Follow, Wander, Stand at, Patrol.
  Built but not yet tried in game: Hostile player seen, Time of day, Condition, Walk to, Wait, Random, Leave.
  Emotes are a no-op until phase 3; Guard just holds position (the faction guard logic does the aiming).
- **Phase 3 - done, tested in game** (2026-10-22): emotes on NPCs. Upper-body gestures
  (`AddCommandModifier_Action`, over the movement command - the NPC stands up first) and full-body ones
  (`StartCommand_Action` with the emote's own stance mask: sitting ones crouch). Emote step (plays N seconds), Stand at
  loops its emote (restarts after another gesture). A gesture is over when its callback went back to "no state" or its
  action finished - nobody controls the character, so the script must hand it back. Say / Face player hold the NPC
  still; Follow continues its chain when it gives up; Guard turns to / aims at Hostile players in range.
  Verified by the owner in game: sit by the fire loop, stands up and waves, salute, follow.
  Not yet tried in game: Follow giving up, Guard node, Hostile player seen, Time of day, Condition, Walk to, Wait,
  Random, Leave. Dropped emotes the game has no class for (kneel, lie down) and surrender (needs its own exit).
- **Phase 4 - done, tested in game** (2026-10-22): custom NPC script nodes. The custom-node system has two more
  kinds: **NPC action** (`cnb_*`, `static void CNB_X(PlayerBase npc, PlayerBase player, array<string> args)`, a step;
  `player` can be null) and **NPC event** (`cne_*`, `static bool CNE_X(PlayerBase npc, PlayerBase player, …)`, checked
  every second for each player within the node's range, fires once per player with a cooldown). They register into
  the NPC node table, show in the NPC graph's add menu ("Make your own node…"), share the library / project copies /
  wizard with the quest kinds, and DSCustom always gets `RunNpcNode` / `CheckNpcNode`. Four NPC examples (Heal the
  Player, Drop an Item, Player Holds an Item, Player Is Hurt). Verified: a custom event (player holds an apple) started
  a chain that said a line and ran a custom step on the server. Play-test progress logs every step a brain runs.
- Phase 5 to do: Showcase NPCs, README, release (0.1.0-alpha.6).
