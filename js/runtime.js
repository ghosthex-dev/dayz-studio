/* DayZ Studio - Enforce Script sources for the standalone quest framework (no third-party mods needed).
   These are plain text templates written into the exported mod / mission file. */
(function () {
  const DS = (window.DS = window.DS || {});
  const R = (DS.RUNTIME = {});

  R.core = String.raw`// ============================================================================
// DayZ Studio Quest Runtime  -  standalone, no third-party mod required.
// Reads  $profile:DZStudioQuests/quests.json  and drives quests per player.
// Per-player progress is stored in  $profile:DZStudioQuests/players/<steam64>.json
// ============================================================================

class DSItem
{
	string c;
	int n;
	float chance;
}

// ---- NPC conversations ------------------------------------------------------
const int DSQ_RPC_NPCS = 77430001;     // server -> client: list of quest NPCs
const int DSQ_RPC_OPEN = 77430002;     // server -> client: open a conversation
const int DSQ_RPC_TALK = 77430003;     // client -> server: player pressed the interact key on an NPC
const int DSQ_RPC_ACCEPT = 77430004;   // client -> server: player accepted the quest in the conversation

const int DSQ_RPC_JOURNAL = 77430005;  // server -> client: the player's quest log
const int DSQ_RPC_ABANDON = 77430006;  // client -> server: abandon a quest from the journal
const int DSQ_RPC_HELLO = 77430007;    // client -> server: (re)send me the NPC list and journal
const int DSQ_RPC_OPTION = 77430008;   // client -> server: picked a reply that gives / takes items
const int DSQ_RPC_FX = 77430009;       // server -> client: which effects are switched on ("id,id,...")
const int DSQ_RPC_USE = 77430010;      // client -> server: pressed F on a usable object (quest, node)
const int DSQ_RPC_MSG = 77430011;      // server -> client: a short message for the tracker banner ("title|text")
const int DSQ_RPC_REP = 77430012;      // server -> client: a faction standing changed ("faction|value|tierId|tierName|tierColor|changed")
const float GUARD_AIM_X = -40;        // side-to-side aim (AimX) of a shouldered gun that points it along the body's heading (measured in game)
const int DSQ_RPC_TRADE = 77430014;    // client -> server: trader screen ("open|node", "buy|node|row|qty", "sell|node|row|qty")
const int DSQ_RPC_TRADEUI = 77430015;  // server -> client: the trader screen (DSTradePacket)
const int DSQ_RPC_SHOT = 77430013;     // server -> client: a hostile faction NPC fired ("netLow|netHigh|soundset|ammo")
const int DSQ_RPC_SAY = 77430016;      // server -> client: an NPC says a line ("lo|hi|x|z|seconds|name|text")
const int DSQ_RPC_LAST = 77430016;     // the highest id above: PlayerBase.OnRPC hands everything up to it to DSQuests

class DSJObjective
{
	string text;
	float progress;
	float target;
	bool done;
	bool hasPos;
	float x;
	float z;
	bool optional;   // bonus objective
	bool missed;     // bonus objective not done when the quest was finished
}

class DSJQuest
{
	string id;
	string name;
	string description;
	int status;           // 1 running, 2 completed
	bool canAbandon;
	ref array<ref DSJObjective> objectives;

	void DSJQuest()
	{
		objectives = new array<ref DSJObjective>;
	}
}

class DSJMark
{
	string name;
	float x;
	float z;
}

// one of the player's stats as the client sees it (HUD, character sheet, item requirements)
class DSJStat
{
	string id;
	string name;
	float v;
	float min;
	float max;
	bool sheet;
	int color;
}

// one faction standing as the client sees it (tracker, HUD, character sheet, conditions)
class DSJRep
{
	string id;
	string name;
	int v;
	int min;
	int max;
	int color;
	string tier;
	string tierName;
	int tierColor;
}

class DSJournal
{
	ref array<ref DSJQuest> quests;
	ref array<ref DSJMark> givers;    // NPCs with a quest this player can take now (map markers)
	ref array<ref DSJStat> stats;     // the player's stats
	ref array<string> uses;           // "quest|node" of objects this player can use right now
	ref array<ref DSJRep> reps;       // the player's faction standings

	void DSJournal()
	{
		reps = new array<ref DSJRep>;
		quests = new array<ref DSJQuest>;
		givers = new array<ref DSJMark>;
		stats = new array<ref DSJStat>;
		uses = new array<string>;
	}

	DSJRep Rep(string fid)
	{
		if (!reps)
			return null;
		for (int i = 0; i < reps.Count(); i++)
		{
			if (reps.Get(i).id == fid)
				return reps.Get(i);
		}
		return null;
	}

	DSJStat Stat(string id)
	{
		for (int i = 0; i < stats.Count(); i++)
		{
			if (stats.Get(i).id == id)
				return stats.Get(i);
		}
		return null;
	}
}

// small widget helpers shared by the tracker and the journal
TextWidget DSQText(float x, float y, float w, float h, int size, int color, int sort)
{
	WorkspaceWidget ws = GetGame().GetWorkspace();
	Widget wd = ws.CreateWidget(TextWidgetTypeID, x, y, w, h, WidgetFlags.VISIBLE | WidgetFlags.EXACTSIZE | WidgetFlags.EXACTPOS, 0xFFFFFFFF, sort);
	TextWidget t = TextWidget.Cast(wd);
	if (t)
	{
		t.SetTextExactSize(size);
		t.SetOutline(1, 0xFF000000);
		t.SetColor(color);
	}
	return t;
}

Widget DSQRect(float x, float y, float w, float h, int color, int sort)
{
	WorkspaceWidget ws = GetGame().GetWorkspace();
	Widget r = ws.CreateWidget(ImageWidgetTypeID, x, y, w, h, WidgetFlags.VISIBLE | WidgetFlags.EXACTSIZE | WidgetFlags.EXACTPOS, color, sort);
	int a = (color >> 24) & 0xFF;   // CreateWidget ignores the alpha byte
	r.SetAlpha(a / 255.0);
	return r;
}

void DSQWrap(string text, int maxChars, array<string> lines)
{
	lines.Clear();
	TStringArray words = new TStringArray;
	text.Split(" ", words);
	string cur = "";
	for (int i = 0; i < words.Count(); i++)
	{
		string word = words.Get(i);
		if (cur == "")
			cur = word;
		else if (cur.Length() + 1 + word.Length() <= maxChars)
			cur = cur + " " + word;
		else
		{
			lines.Insert(cur);
			cur = word;
		}
	}
	if (cur != "")
		lines.Insert(cur);
}

// one condition, used by replies, opening lines, "Condition Met" / "Wait Until" / "Meet a Condition" nodes,
// quest availability and NPCs that only appear sometimes.
//   kind: has_item | lacks_item | quest_done | quest_active | quest_new | var | player | time | uptime | weather
class DSCond
{
	string kind;
	string cls;      // item class (has_item / lacks_item)
	int n;           // item amount
	string quest;    // quest id (quest_*)
	string var;      // server variable name (var)
	string op;       // == != > >= < <=   (player / weather: also "is" / "not")
	float value;     // compare value; time: from hour; uptime: from minute
	float to;        // time: to hour (may wrap past midnight); uptime: to minute
	string stat;     // player: bleeding sick fracture unconscious blood health water energy | weather: storm rain fog overcast clear
	bool neg;        // NOT: the condition holds when the check fails
}

class DSDlgOption
{
	string text;
	string next;     // id of the next line, "" = end of conversation
	bool accept;     // choosing this accepts the quest
	ref DSCond when; // the reply is only offered when this holds
	ref array<ref DSItem> give;   // handed to the player (once per player unless items are also taken)
	ref array<ref DSItem> take;   // taken from the player; the reply only shows when they carry them
	bool hide;       // filled in by the server for the player it is sent to

	void DSDlgOption()
	{
		give = new array<ref DSItem>;
		take = new array<ref DSItem>;
	}
}

class DSDlgLine
{
	string id;
	string text;
	string sound;    // sound id -> CfgSoundSets DSQ_<id>_SoundSet
	string next;     // used when the line has no options ("" = end)
	ref DSCond openIf;   // the conversation opens with this line when it holds (first match wins)
	ref array<ref DSDlgOption> options;

	void DSDlgLine()
	{
		options = new array<ref DSDlgOption>;
	}
}

class DSDialog
{
	string start;
	ref array<ref DSDlgLine> lines;

	void DSDialog()
	{
		lines = new array<ref DSDlgLine>;
	}

	DSDlgLine Find(string lineId)
	{
		for (int i = 0; i < lines.Count(); i++)
		{
			if (lines.Get(i).id == lineId)
				return lines.Get(i);
		}
		return null;
	}
}

class DSNpcInfo
{
	string quest;
	string node;
	string name;
	string faction;     // the NPC's faction (Studio ▸ Player stats ▸ Factions) or ""
	float x;
	float y;
	float z;
	float radius;
	int netLow;         // the character's network id: players follow a patrolling NPC with it
	int netHigh;
	bool talk;          // F talks to it: a quest's NPC, or one with a "Talked to" behaviour
	string prompt;      // its own talk prompt ("Trade", "Ask about the road") instead of "Talk to"
}

// where a patrolling NPC is on its route (point 0 = where it spawned, then the waypoints)
class DSPatrolState
{
	int leg = 1;        // the point it walks to
	int dir = 1;        // back-and-forth routes: 1 outwards, -1 on the way back
	float wait;         // seconds waited at the point it reached
	float stuck;        // seconds without getting anywhere
	vector last;
}

// a placed object the player can use (F) for a "Use Object" trigger or objective
class DSUseInfo
{
	string quest;
	string node;
	string prompt;
	float x;
	float y;
	float z;
	float radius;
}

class DSNpcList
{
	ref array<ref DSNpcInfo> npcs;
	ref array<ref DSUseInfo> uses;

	void DSNpcList()
	{
		npcs = new array<ref DSNpcInfo>;
		uses = new array<ref DSUseInfo>;
	}
}

class DSDialogPacket
{
	string quest;
	string node;
	string name;
	string state;    // offer | active | done | locked
	string trader;   // the NPC trades: the conversation offers a "Let's trade." reply
	float x;
	float y;
	float z;
	ref DSDialog dialog;
}

class DSNode
{
	string id;
	string type;
	string title;
	string text;
	string cls;
	string mode;
	string stat;
	float x;
	float y;
	float z;
	float yaw;
	float radius;
	int count;
	float seconds;
	float amount;
	bool flag;
	ref array<string> classes;
	ref array<ref DSItem> items;
	ref array<string> next;
	ref DSDialog offer;     // conversation before the quest is taken
	ref DSDialog active;    // while the quest is running
	ref DSDialog done;      // after it was completed
	ref DSDialog locked;    // the quest is not available yet (its required quests are not done)
	string hands;           // NPC: weapon / tool held in the hands
	bool nomark;            // no map / screen marker for this objective or quest giver
	bool optional;          // bonus objective: never needed to finish the quest
	ref DSCond cond;        // trg_cond / logic_wait / obj_cond: the condition; trg_npc: the NPC only appears while it holds
	string var;             // act_setvar: server variable name; act_pvar: stat id; act_fx: effect id
	string varOp;           // act_setvar: set | add | sub | toggle; act_pvar: add | sub | set
	float varValue;
	ref array<string> args; // custom nodes (cna_* / cno_*): their settings, in order
	string faction;         // trg_npc: the NPC's faction; act_rep: the faction whose standing changes
	string ammo;            // trg_npc: what a hostile faction NPC shoots (from its weapon in hands)
	string shot;            // trg_npc: the sound set of its shot (generated by Studio from the game's own samples)
	string prompt;          // trg_object / obj_use: the interaction prompt ("Open the gate")
	string okText;          // trg_object / obj_use: message when it worked
	bool removeObj;         // trg_object / obj_use: remove the placed object once used
	string trader;          // trg_npc: id of the trader it runs (trade.json)
	string npcId;           // trg_npc / npc: the NPC (NPCs tab) - its behaviour is DSQuestFile.brains
	ref array<float> patrol;   // trg_npc: waypoints x, z, x, z ... it walks from its own position
	float pwait;            // trg_npc: seconds it waits at each waypoint
	bool pback;             // trg_npc: walks the route back and forth instead of looping back to the start
	bool prun;              // trg_npc: jogs instead of walking

	void DSNode()
	{
		patrol = new array<float>;
		classes = new array<string>;
		items = new array<ref DSItem>;
		next = new array<string>;
	}
}

class DSQuest
{
	string id;
	string name;
	string description;
	bool repeatable;
	float cooldown;
	bool failOnDeath;
	ref array<string> requires;   // quest chain: these quests must be completed first
	ref DSCond avail;             // server-wide condition (variable / time / weather) for the quest to be available
	ref array<ref DSNode> nodes;

	void DSQuest()
	{
		nodes = new array<ref DSNode>;
		requires = new array<string>;
	}
}

// a per-player stat (XP, reputation, skills) defined in Studio
class DSStatDef
{
	string id;
	string name;
	float start;
	float min;
	float max;           // max <= min: no limits
	bool resetOnDeath;
	bool sheet;          // shown on the character sheet
	int color;
}


// ---- NPC behaviour (Studio's NPCs tab): events start chains of steps, activities run until replaced ----
class DSBNode
{
	string id;
	string type;        // ev_* events, act_* activities, st_* steps, fl_* flow
	float x;            // a point: wander centre, stand spot, walk-to / escort destination
	float z;
	float a;            // numbers by type: radius, seconds, hours, distances, value
	float b;
	bool flag;          // patrol: back and forth
	bool run;           // jogs
	string text;        // say: the line; talk: the prompt; stand / emote: the emote
	string var;         // set variable: name
	string op;          // set variable: set | add
	ref array<float> pts;   // patrol waypoints x, z, x, z ...
	ref array<ref DSItem> items;
	ref DSCond cond;
	ref array<string> next;

	void DSBNode()
	{
		pts = new array<float>;
		items = new array<ref DSItem>;
		next = new array<string>;
	}
}

class DSBrainDef
{
	string npc;         // the NPC's id in Studio (DSNode.npcId)
	bool stops;         // stops and turns to a player within 3 m
	ref array<ref DSBNode> nodes;

	void DSBrainDef()
	{
		nodes = new array<ref DSBNode>;
	}

	DSBNode Find(string id)
	{
		foreach (DSBNode n : nodes)
		{
			if (n.id == id)
				return n;
		}
		return null;
	}
}

// what one NPC is doing right now (server)
class DSBrain
{
	DSBrainDef def;
	PlayerBase npc;
	string faction;
	vector home;          // where it spawned (point 0 of a patrol)
	bool started;
	// the activity: patrol / wander / stand / follow / escort / guard
	DSBNode act;
	PlayerBase actWho;    // the player who started it (follow, escort)
	int leg = 1;
	int dir = 1;
	float wait;
	bool hasGoal;
	vector goal;
	vector lastGoal;
	float stuck;
	vector last;
	// the chain of steps: the one running, and the ones waiting
	DSBNode step;
	PlayerBase stepWho;
	float stepT;
	ref array<DSBNode> queue;
	ref array<PlayerBase> queueWho;
	// events
	ref map<string, float> fired;   // "node|player" -> when it last fired
	ref map<string, bool> inside;   // "node|player" -> in range last tick
	ref map<string, bool> was;      // time windows / conditions: true last tick

	void DSBrain()
	{
		queue = new array<DSBNode>;
		queueWho = new array<PlayerBase>;
		fired = new map<string, float>;
		inside = new map<string, bool>;
		was = new map<string, bool>;
	}
}

// a line an NPC says, shown above its head (client)
class DSSay
{
	int lo;
	int hi;
	vector at;          // where it was said (when this PC doesn't know the character)
	float left;
	TextWidget w;
}

class DSQuestFile
{
	ref array<ref DSQuest> quests;
	ref array<ref DSStatDef> stats;
	ref array<ref DSNode> npcs;   // NPCs of the NPCs tab that no quest uses (type "npc", settings like a Talk to NPC node)
	ref array<ref DSBrainDef> brains;   // the behaviour of every NPC of the NPCs tab

	void DSQuestFile()
	{
		quests = new array<ref DSQuest>;
		stats = new array<ref DSStatDef>;
		npcs = new array<ref DSNode>;
		brains = new array<ref DSBrainDef>;
	}
}

// ---- server-wide persistent variables ($profile:DZStudioQuests/globals.json) ---------------
class DSGVar
{
	string k;
	float v;
}

class DSGlobalFile
{
	ref array<ref DSGVar> vars;

	void DSGlobalFile()
	{
		vars = new array<ref DSGVar>;
	}
}

// ---- traders & money ($profile:DZStudioQuests/trade.json, written by Studio) ----------------
// A currency is paid in items (the quest mod's dollar bills, or a modded money item: denominations with a value,
// largest first) or is a player stat (a balance saved on the server).
class DSCurrencyItem
{
	string c;
	int value;
}

class DSCurrency
{
	string id;
	string name;
	string symbol;   // "$" -> "$1,250"; empty -> "1,250 Rubles"
	string kind;     // items | stat
	string stat;     // kind stat: the stat id
	ref array<ref DSCurrencyItem> items;

	void DSCurrency()
	{
		items = new array<ref DSCurrencyItem>;
	}
}

class DSTradeItem
{
	string c;
	string name;     // shown instead of the game's name (optional)
	int buy;         // what the player pays per purchase (0: not for sale)
	int sell;        // what the player gets per sale (0: the trader doesn't buy it)
	int n;           // pieces per purchase / sale (ammo: 20 rounds)
	int stock;       // purchases in stock after a restart (-1: endless)
	string cat;      // category shown as a heading
	ref DSCond need; // only sold to players who meet this
	string needText;
}

class DSTrader
{
	string id;
	string name;
	string currency;
	ref array<ref DSTradeItem> items;

	void DSTrader()
	{
		items = new array<ref DSTradeItem>;
	}
}

class DSTradeFile
{
	ref array<ref DSCurrency> currencies;
	ref array<ref DSTrader> traders;

	void DSTradeFile()
	{
		currencies = new array<ref DSCurrency>;
		traders = new array<ref DSTrader>;
	}
}

// what the trader screen shows (server -> client)
class DSTradeRow
{
	int i;
	string name;
	string cat;
	int n;
	string buy;      // price text, "" = not for sale
	string sell;     // price text, "" = not bought
	int stock;       // -1 endless
	int have;        // sales the player can make (n pieces each)
	bool canBuy;
	bool canSell;
	string why;      // why it can't be bought
}

class DSTradePacket
{
	string quest;
	string node;
	string title;
	string money;
	int disc;
	string tier;
	string msg;
	bool good;
	ref array<ref DSTradeRow> rows;

	void DSTradePacket()
	{
		rows = new array<ref DSTradeRow>;
	}
}

// ---- factions & reputation ($profile:DZStudioQuests/factions.json, written by Studio) ----------------
// A standing is a whole number between DSFactionFile.min and .max; the tiers split that range into named bands
// (Hostile / Neutral / Friendly ...), each with a stance that NPCs of the faction act on and a trade discount.
class DSTier
{
	string id;
	string name;
	int min;
	int max;
	int color;
	string stance;      // hostile | neutral | friendly
	int discount;       // % off the items a faction NPC's trade replies take
}

class DSTerritory
{
	string name;
	float x;
	float z;
	float radius;
}

// "killing X (in / outside the territory) changes the standing by amount"
class DSKillRule
{
	string victim;      // @infected | @animal | @player | a class name (inherited classes count)
	string where;       // anywhere | territory | outside
	string victimTier;  // @player only: the victim's own tier with this faction ("" = any)
	int amount;
	string text;        // message to the killer ("" = only tier changes are announced)
}

// how the faction's NPCs act on players in a hostile tier
class DSGuard
{
	float warn;         // m: turns to the player and warns
	float attack;       // m: shoots (needs a weapon in the NPC's hands)
	float damage;       // 0..1 of a full hit of that bullet
	float interval;     // s between shots
	string warnText;
	string refuseText;  // what the NPC says instead of talking
}

class DSFaction
{
	string id;
	string name;
	int color;
	int start;
	ref array<ref DSTerritory> territories;
	ref array<ref DSKillRule> kills;
	ref DSGuard guard;

	void DSFaction()
	{
		territories = new array<ref DSTerritory>;
		kills = new array<ref DSKillRule>;
		guard = new DSGuard();
	}
}

// gaining standing with "from" also changes "to" by amount * factor (one step, so it can't loop)
class DSRelation
{
	string from;
	string to;
	float factor;
}

class DSFactionFile
{
	int version;
	int min;
	int max;
	ref array<ref DSTier> tiers;
	ref array<ref DSFaction> factions;
	ref array<ref DSRelation> relations;

	void DSFactionFile()
	{
		min = -1000;
		max = 1000;
		tiers = new array<ref DSTier>;
		factions = new array<ref DSFaction>;
		relations = new array<ref DSRelation>;
	}
}

// ---- per-player persisted state -------------------------------------------
class DSNodeState
{
	string id;
	int status;     // 0 idle, 1 active, 2 done
	float progress;
}

class DSQuestState
{
	string quest;
	int status;     // 0 not started, 1 running, 2 completed
	float doneAt;
	int times;      // how often it was completed (kept when a repeatable quest resets)
	ref array<ref DSNodeState> nodes;

	void DSQuestState()
	{
		nodes = new array<ref DSNodeState>;
	}

	bool EverDone()
	{
		return times > 0 || status == 2;
	}

	DSNodeState Node(string nodeId)
	{
		for (int i = 0; i < nodes.Count(); i++)
		{
			if (nodes.Get(i).id == nodeId)
				return nodes.Get(i);
		}
		DSNodeState s = new DSNodeState();
		s.id = nodeId;
		nodes.Insert(s);
		return s;
	}

	void Reset()
	{
		status = 0;
		nodes.Clear();
	}
}

class DSPlayerData
{
	string id;
	float play;     // accumulated play seconds (used for cooldowns)
	ref array<ref DSQuestState> quests;
	ref array<string> used;   // one-time conversation gifts already received
	ref array<ref DSGVar> stats;   // the player's stats (XP, reputation, skills)
	ref array<ref DSGVar> rep;     // faction standings: k = faction id, v = points

	void DSPlayerData()
	{
		quests = new array<ref DSQuestState>;
		used = new array<string>;
		stats = new array<ref DSGVar>;
		rep = new array<ref DSGVar>;
	}

	DSGVar FindRep(string fid)
	{
		if (!rep)
			rep = new array<ref DSGVar>;
		for (int i = 0; i < rep.Count(); i++)
		{
			if (rep.Get(i).k == fid)
				return rep.Get(i);
		}
		return null;
	}

	DSGVar FindStat(string sid)
	{
		for (int i = 0; i < stats.Count(); i++)
		{
			if (stats.Get(i).k == sid)
				return stats.Get(i);
		}
		return null;
	}

	DSQuestState FindQuest(string questId)
	{
		for (int i = 0; i < quests.Count(); i++)
		{
			if (quests.Get(i).quest == questId)
				return quests.Get(i);
		}
		return null;
	}

	DSQuestState GetQuest(string questId)
	{
		DSQuestState s = FindQuest(questId);
		if (s)
			return s;
		s = new DSQuestState();
		s.quest = questId;
		quests.Insert(s);
		return s;
	}
}

// ---- play-test progress (written only while Studio's play-test flag file exists) ----------
class DSProgressNode
{
	string id;
	int status;
	float progress;
}

class DSProgressQuest
{
	string id;
	string name;
	int status;
	ref array<ref DSProgressNode> nodes;

	void DSProgressQuest()
	{
		nodes = new array<ref DSProgressNode>;
	}
}

class DSProgress
{
	float time;
	int loaded;
	bool hasPlayer;
	float px;
	float py;
	float pz;
	ref array<ref DSProgressQuest> quests;
	ref array<string> log;
	ref array<string> vars;   // server variables "name = value"
	ref array<string> npcs;   // "name x z" - where each NPC stands now (patrols move)

	void DSProgress()
	{
		npcs = new array<string>;
		quests = new array<ref DSProgressQuest>;
		log = new array<string>;
		vars = new array<string>;
	}
}



// ---- the manager ------------------------------------------------------------
class DSQuests
{
	static ref DSQuests s_Instance;
	static const string ROOT = "$profile:DZStudioQuests";

	ref DSQuestFile m_File;
	ref map<string, ref DSPlayerData> m_Players;
	ref map<string, float> m_Session;
	float m_Acc;
	bool m_Ready;
	bool m_Debug;
	bool m_Warned;
	float m_Retry;
	float m_ProgT;
	ref array<string> m_LogLines;
	ref array<ref DSNpcInfo> m_NpcInfo;    // quest NPCs (server: spawned ones, client: received list)
	ref array<ref DSUseInfo> m_UseInfo;    // usable objects ("Use Object" nodes)
	ref DSFactionFile m_Fac;
	ref DSTradeFile m_Trade;                        // traders & currencies (server)
	ref map<string, ref array<int>> m_Stock;       // trader id -> purchases left per item (since the restart)               // factions, tiers, relations (server)
	ref map<string, float> m_GuardWarn;    // "player|npc" -> when a hostile NPC last warned
	ref map<string, float> m_GuardShot;    // "player|npc" -> when it last fired
	ref map<Object, ref DSPatrolState> m_Patrols;   // patrolling NPCs: where on their route they are
	ref map<Object, ref DSBrain> m_Brains;          // NPCs with a behaviour (NPCs tab)
	ref map<string, bool> m_Left;                   // NPCs whose behaviour made them leave ("quest|node")
	ref array<ref DSSay> m_Says;                    // client: lines NPCs say, above their heads
	ref array<Object> m_Raised;             // faction NPCs with their gun up, and when they last aimed
	ref array<float> m_RaisedT;
	ref map<string, float> m_MsgT;         // server: last requirement message per player + item (no spam)
	ref array<Object> m_NpcObjs;           // server only, same order as m_NpcInfo
	ref map<string, bool> m_NpcSent;
	ref DSDialogUI m_UI;
	bool m_TalkKey;
	int m_Looked;
	ref map<string, string> m_JournalLast;   // server: last snapshot sent per player
	ref DSJournal m_Journal;                 // client: the player's quest log
	ref DSJournalUI m_JUI;
	ref DSTradeUI m_TUI;
	bool m_GotNpcs;                          // client: NPC list received
	float m_HelloT;
	int m_HelloTries;
	ref map<string, string> m_Talk;          // server: the conversation each player has open ("quest|node|state")
	float m_SaveT;
	ref map<int, string> m_Chunks;
	ref map<string, float> m_Globals;        // server: persistent server-wide variables
	float m_FxT;
	ref map<string, string> m_FxSent;        // server: what each player was told last
	float m_NpcT;           // client: pieces of a long message still arriving

	void DSQuests()
	{
		m_Talk = new map<string, string>;
		m_Chunks = new map<int, string>;
		m_Globals = new map<string, float>;
		m_FxSent = new map<string, string>;
		m_Players = new map<string, ref DSPlayerData>;
		m_Session = new map<string, float>;
		m_LogLines = new array<string>;
		m_NpcInfo = new array<ref DSNpcInfo>;
		m_UseInfo = new array<ref DSUseInfo>;
		m_Fac = new DSFactionFile();
		m_GuardWarn = new map<string, float>;
		m_GuardShot = new map<string, float>;
		m_Raised = new array<Object>;
		m_Patrols = new map<Object, ref DSPatrolState>;
		m_Brains = new map<Object, ref DSBrain>;
		m_Left = new map<string, bool>;
		m_Says = new array<ref DSSay>;
		m_RaisedT = new array<float>;
		m_MsgT = new map<string, float>;
		m_NpcObjs = new array<Object>;
		m_NpcSent = new map<string, bool>;
		m_JournalLast = new map<string, string>;
		m_Looked = -1;
	}

	static DSQuests Get()
	{
		if (!s_Instance)
			s_Instance = new DSQuests();
		return s_Instance;
	}

	void Init()
	{
		if (m_Ready)
			return;

		MakeDirectory(ROOT);
		MakeDirectory(ROOT + "/players");
		LoadGlobals();

		string path = ROOT + "/quests.json";
		if (!FileExist(path))
		{
			if (!m_Warned)
			{
				m_Warned = true;
				Print("[DZStudio] quests.json not found at " + path + " - copy it from the export package.");
			}
			return;
		}

		m_File = new DSQuestFile();
		JsonFileLoader<DSQuestFile>.JsonLoadFile(path, m_File);
		LoadFactions();
		LoadTrade();
		SpawnNpcs();
		CollectUses();
		m_Ready = true;
		m_Debug = FileExist(ROOT + "/playtest.flag");
		Print("[DZStudio] Loaded " + m_File.quests.Count() + " quest(s).");
	}

	void Say(string line)
	{
		m_LogLines.Insert(line);
		while (m_LogLines.Count() > 14)
			m_LogLines.RemoveOrdered(0);
	}

	// play-test: pick up a re-exported quests.json without restarting the game
	void Reload()
	{
		string path = ROOT + "/quests.json";
		if (!FileExist(path))
			return;
		DSQuestFile f = new DSQuestFile();
		JsonFileLoader<DSQuestFile>.JsonLoadFile(path, f);
		m_File = f;
		m_Ready = true;
		Say("quests reloaded (" + m_File.quests.Count() + ")");
		Print("[DZStudio] Reloaded " + m_File.quests.Count() + " quest(s).");
	}

	void ResetAll()
	{
		// forget the saved files too, otherwise the next tick loads the old progress again
		for (int i = 0; i < m_Players.Count(); i++)
			DeleteFile(ROOT + "/players/" + m_Players.GetKey(i) + ".json");
		m_JournalLast.Clear();
		m_Globals.Clear();
		SaveGlobals();
		m_Players.Clear();
		m_Session.Clear();
		DeleteFile(ROOT + "/players/local.json");
		Say("progress reset");
	}

	// play-test: flag files written by Studio
	void PollFlags(PlayerBase p)
	{
		if (FileExist(ROOT + "/setvar.flag"))
		{
			// play-test helper: "name value" per line
			FileHandle vh = OpenFile(ROOT + "/setvar.flag", FileMode.READ);
			string vl;
			array<string> sets = new array<string>;
			if (vh)
			{
				while (FGets(vh, vl) > 0)
				{
					vl.Trim();
					if (vl != "")
						sets.Insert(vl);
				}
				CloseFile(vh);
			}
			DeleteFile(ROOT + "/setvar.flag");
			for (int si = 0; si < sets.Count(); si++)
			{
				TStringArray vp = new TStringArray;
				sets.Get(si).Split(" ", vp);
				float vv = 1;
				if (vp.Count() > 1)
					vv = vp.Get(1).ToFloat();
				SetVar(vp.Get(0), "set", vv);
			}
		}
		if (FileExist(ROOT + "/reload.flag"))
		{
			DeleteFile(ROOT + "/reload.flag");
			Reload();
		}
		if (FileExist(ROOT + "/reset.flag"))
		{
			DeleteFile(ROOT + "/reset.flag");
			ResetAll();
		}
		if (FileExist(ROOT + "/talk.flag") && p)
		{
			// the file may hold the index of the NPC (default: the first one)
			int which = 0;
			FileHandle th = OpenFile(ROOT + "/talk.flag", FileMode.READ);
			if (th)
			{
				string tl;
				if (FGets(th, tl) > 0)
					which = tl.ToInt();
				CloseFile(th);
			}
			DeleteFile(ROOT + "/talk.flag");
			if (which < 0 || which >= m_NpcInfo.Count())
				which = 0;
			if (m_NpcInfo.Count() > 0)
			{
				// teleport next to the NPC and talk to it (play-test helper)
				DSNpcInfo ti = m_NpcInfo.Get(which);
				float npcYaw = 0;
				if (which < m_NpcObjs.Count() && m_NpcObjs.Get(which))
					npcYaw = m_NpcObjs.Get(which).GetOrientation()[0];
				vector npcAt = NpcPos(which);   // where it stands now (a patrol moves it)
				vector spot = ClearSpotNear(npcAt[0], npcAt[2], 2.5, npcYaw);
				p.SetPosition(spot);
				vector look = Vector(npcAt[0], spot[1], npcAt[2]) - spot;
				p.SetOrientation(Vector(look.VectorToAngles()[0], 0, 0));
				ServerTalk(p, ti.quest, ti.node);
			}
		}
		if (FileExist(ROOT + "/give.flag") && p)
		{
			// play-test helper: "ClassName amount" per line ("ClassName 1 hands": put it in the hands like a player would, "ClassName 5 ground": on the ground in front, "@die": die)
			FileHandle gh = OpenFile(ROOT + "/give.flag", FileMode.READ);
			string gl;
			array<string> gives = new array<string>;
			if (gh)
			{
				while (FGets(gh, gl) > 0)
				{
					gl.Trim();
					if (gl != "")
						gives.Insert(gl);
				}
				CloseFile(gh);
			}
			DeleteFile(ROOT + "/give.flag");
			for (int gi = 0; gi < gives.Count(); gi++)
			{
				TStringArray gp = new TStringArray;
				gives.Get(gi).Split(" ", gp);
				if (gp.Get(0) == "@tp" && gp.Count() >= 3)
				{
					p.SetPosition(GroundPos(gp.Get(1).ToFloat(), 0, gp.Get(2).ToFloat()));   // play-test: "@tp x z"
					Say("teleported to " + gp.Get(1) + " " + gp.Get(2));
					continue;
				}
				if (gp.Get(0) == "@talk" && gp.Count() >= 2)
				{
					// play-test: "@talk Name" - talk to that NPC as if the player looked at it and pressed F
					bool talked = false;
					for (int tqi = 0; tqi < m_File.quests.Count() && !talked; tqi++)
					{
						DSQuest tq = m_File.quests.Get(tqi);
						for (int tni = 0; tni < tq.nodes.Count() && !talked; tni++)
						{
							DSNode tn = tq.nodes.Get(tni);
							if (tn.type == "trg_npc" && tn.title == gp.Get(1))
							{
								// stand next to it first (wherever its patrol took it), facing it
								for (int tii = 0; tii < m_NpcInfo.Count(); tii++)
								{
									if (m_NpcInfo.Get(tii).quest != tq.id || m_NpcInfo.Get(tii).node != tn.id)
										continue;
									vector talkAt = NpcPos(tii);
									vector talkSpot = ClearSpotNear(talkAt[0], talkAt[2], 2.0, 0);
									p.SetPosition(talkSpot);
									vector talkLook = Vector(talkAt[0], talkSpot[1], talkAt[2]) - talkSpot;
									p.SetOrientation(Vector(talkLook.VectorToAngles()[0], 0, 0));
								}
								ServerTalk(p, tq.id, tn.id);
								talked = true;
							}
						}
					}
					// an NPC no quest uses ("Talked to" behaviour)
					for (int fni = 0; fni < m_NpcInfo.Count() && !talked; fni++)
					{
						if (m_NpcInfo.Get(fni).quest != "" || m_NpcInfo.Get(fni).name != gp.Get(1))
							continue;
						vector freeAt = NpcPos(fni);
						vector freeSpot = ClearSpotNear(freeAt[0], freeAt[2], 2.0, 0);
						p.SetPosition(freeSpot);
						vector freeLook = Vector(freeAt[0], freeSpot[1], freeAt[2]) - freeSpot;
						p.SetOrientation(Vector(freeLook.VectorToAngles()[0], 0, 0));
						BrainTalk(p, m_NpcInfo.Get(fni).node);
						talked = true;
					}
					Say("talk to " + gp.Get(1) + ": " + talked);
					continue;
				}
				if (gp.Get(0) == "@die")
				{
					p.SetHealth("", "", 0);   // play-test: die (stats that reset on death, quests that fail on death)
					Say("killed the player");
					continue;
				}
				int gn = 1;
				if (gp.Count() > 1)
					gn = gp.Get(1).ToInt();
				if (gn < 1)
					gn = 1;
				if (gp.Count() > 2 && gp.Get(2) == "hands")
				{
					EntityAI he = EntityAI.Cast(GetGame().CreateObjectEx(gp.Get(0), p.GetPosition(), ECE_PLACE_ON_SURFACE));
					if (he && p.GetHumanInventory().CanAddEntityInHands(he))
					{
						p.ServerTakeEntityToHands(he);
						Say("took " + gp.Get(0) + " into the hands");
					}
					else
					{
						Say("hands refused " + gp.Get(0));
						if (he)
							he.Delete();
					}
					continue;
				}
				if (gp.Count() > 2 && gp.Get(2) == "ground")
				{
					// play-test: "ClassName amount ground" - on the ground in front of the player
					vector gpos = p.GetPosition() + p.GetDirection() * 1.2;
					EntityAI ge = EntityAI.Cast(GetGame().CreateObjectEx(gp.Get(0), gpos, ECE_PLACE_ON_SURFACE));
					ItemBase gib = ItemBase.Cast(ge);
					if (gib && gib.ConfigGetBool("canBeSplit"))
						gib.SetQuantity(gn);
					Say("dropped " + gp.Get(0) + " on the ground");
					continue;
				}
				GiveItem(p, gp.Get(0), gn);
				Say("gave " + gn + "x " + gp.Get(0));
			}
		}
		if (FileExist(ROOT + "/choose.flag"))
		{
			DeleteFile(ROOT + "/choose.flag");
			if (m_UI)
				m_UI.Choose(0);
		}
		if (FileExist(ROOT + "/simkill.flag") && p)
		{
			FileHandle fh = OpenFile(ROOT + "/simkill.flag", FileMode.READ);
			string line;
			array<string> kills = new array<string>;
			if (fh)
			{
				while (FGets(fh, line) > 0)
				{
					line.Trim();
					if (line != "")
						kills.Insert(line);
				}
				CloseFile(fh);
			}
			DeleteFile(ROOT + "/simkill.flag");
			for (int i = 0; i < kills.Count(); i++)
				SimKill(p, kills.Get(i));
		}
	}

	// a spot on the ground "dist" metres from (x, z) with nothing but plants in the way; tries the direction "yaw" first
	static vector ClearSpotNear(float x, float z, float dist, float yaw)
	{
		float y0 = yaw * Math.DEG2RAD;
		vector best = Vector(x + Math.Sin(y0) * dist, 0, z + Math.Cos(y0) * dist);
		best[1] = GetGame().SurfaceY(best[0], best[2]);
		for (int a = 0; a < 8; a++)
		{
			float ang = y0 + a * Math.PI * 0.25;
			float cx = x + Math.Sin(ang) * dist;
			float cz = z + Math.Cos(ang) * dist;
			vector c = Vector(cx, GetGame().SurfaceY(cx, cz), cz);
			array<Object> near = new array<Object>;
			GetGame().GetObjectsAtPosition3D(c + Vector(0, 0.9, 0), 1.6, near, null);
			bool blocked = false;
			for (int i = 0; i < near.Count(); i++)
			{
				Object o = near.Get(i);
				if (o && !o.IsMan() && !o.IsTree() && !o.IsBush() && !o.IsInherited(InventoryItem))
					blocked = true;
			}
			if (!blocked)
				return c;
		}
		return best;
	}

	// play-test: count a kill of class "cls" ("@infected", "@animal", "@player" or a class name) without combat
	void SimKill(PlayerBase p, string cls)
	{
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			DSQuestState qs = data.FindQuest(q.id);
			if (!qs || qs.status != 1)
				continue;
			for (int j = 0; j < q.nodes.Count(); j++)
			{
				DSNode n = q.nodes.Get(j);
				if (n.type != "obj_kill")
					continue;
				DSNodeState ns = qs.Node(n.id);
				if (ns.status != 1)
					continue;
				bool hit = false;
				if (n.classes.Count() == 0 && cls == "@infected")
					hit = true;
				for (int k = 0; k < n.classes.Count(); k++)
				{
					if (n.classes.Get(k) == cls)
						hit = true;
				}
				if (!hit)
					continue;
				ns.progress += 1;
				int done = ns.progress;
				Say(q.name + ": " + done + "/" + n.count + " (simulated kill)");
				if (ns.progress >= n.count)
					CompleteNode(p, data, q, qs, n, 0);
			}
		}
		// faction kill rules need a real victim (its class and where it lay): a short-lived stand-in at the player
		string standIn = cls;
		if (cls == "@infected")
			standIn = "ZmbM_CitizenASkinny_Grey";
		else if (cls == "@animal")
			standIn = "Animal_CervusElaphus";
		if (cls == "@player" || standIn == "")
			return;
		Object victim = GetGame().CreateObject(standIn, p.GetPosition() + "2 0 2", false, false);
		if (!victim)
		{
			Say("simulated kill: could not create " + standIn);
			return;
		}
		RepOnKill(p, data, victim);
		GetGame().ObjectDelete(victim);
		Say("simulated kill of " + standIn + " checked against the faction kill rules");
	}

	void WriteProgress(PlayerBase p)
	{
		DSProgress pr = new DSProgress();
		pr.time = GetGame().GetTickTime();
		pr.loaded = m_File.quests.Count();
		if (p)
		{
			pr.hasPlayer = true;
			vector pos = p.GetPosition();
			pr.px = pos[0];
			pr.py = pos[1];
			pr.pz = pos[2];
		}
		DSPlayerData data = null;
		if (p)
			data = GetData(p);
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			DSProgressQuest pq = new DSProgressQuest();
			pq.id = q.id;
			pq.name = q.name;
			if (data)
			{
				DSQuestState qs = data.FindQuest(q.id);
				if (qs)
				{
					pq.status = qs.status;
					for (int j = 0; j < qs.nodes.Count(); j++)
					{
						DSProgressNode pn = new DSProgressNode();
						pn.id = qs.nodes.Get(j).id;
						pn.status = qs.nodes.Get(j).status;
						pn.progress = qs.nodes.Get(j).progress;
						pq.nodes.Insert(pn);
					}
				}
			}
			pr.quests.Insert(pq);
		}
		for (int k = 0; k < m_LogLines.Count(); k++)
			pr.log.Insert(m_LogLines.Get(k));
		for (int gv = 0; gv < m_Globals.Count(); gv++)
			pr.vars.Insert(m_Globals.GetKey(gv) + " = " + m_Globals.GetElement(gv));
		for (int ni = 0; ni < m_NpcInfo.Count(); ni++)
		{
			vector np = NpcPos(ni);
			string facing = "";
			if (ni < m_NpcObjs.Count() && m_NpcObjs.Get(ni))
			{
				facing = " " + Math.Round(m_NpcObjs.Get(ni).GetOrientation()[0]);
				PlayerBase pnpc = PlayerBase.Cast(m_NpcObjs.Get(ni));
				if (pnpc && pnpc.m_DSPatrolCmd)
					facing = facing + " wants " + Math.Round(pnpc.m_DSPatrolCmd.m_Yaw);
			}
			pr.npcs.Insert(m_NpcInfo.Get(ni).name + " " + Math.Round(np[0] * 10) / 10 + " " + Math.Round(np[2] * 10) / 10 + facing);
		}
		JsonFileLoader<DSProgress>.JsonSaveFile(ROOT + "/progress.json", pr);
	}

	// ---------------- helpers ----------------
	static float Dist2D(vector a, float bx, float bz)
	{
		float dx = a[0] - bx;
		float dz = a[2] - bz;
		return Math.Sqrt(dx * dx + dz * dz);
	}

	static vector GroundPos(float x, float y, float z)
	{
		vector p = Vector(x, y, z);
		if (y == 0)
			p[1] = GetGame().SurfaceY(x, z);
		return p;
	}

	void Notify(PlayerBase p, string title, string text, bool chat)
	{
		if (!p)
			return;
		Say(title + ": " + text);
		if (p.GetIdentity())
			NotificationSystem.SendNotificationToPlayerIdentityExtended(p.GetIdentity(), 8, title, text, "");
		if (chat || !p.GetIdentity())
			p.MessageStatus(title + ": " + text);
	}

	static void DeleteObj(Object o)
	{
		if (o)
			GetGame().ObjectDelete(o);
	}

	DSNode FindNode(DSQuest q, string nodeId)
	{
		for (int i = 0; i < q.nodes.Count(); i++)
		{
			if (q.nodes.Get(i).id == nodeId)
				return q.nodes.Get(i);
		}
		return null;
	}

	int CountIncoming(DSQuest q, string nodeId)
	{
		int c = 0;
		for (int i = 0; i < q.nodes.Count(); i++)
		{
			DSNode n = q.nodes.Get(i);
			for (int j = 0; j < n.next.Count(); j++)
			{
				if (n.next.Get(j) == nodeId)
					c++;
			}
		}
		return c;
	}

	bool IsTrigger(string t)
	{
		return t == "start" || t == "trg_zone" || t == "trg_npc" || t == "trg_item" || t == "trg_time" || t == "trg_cond" || t == "trg_object";
	}

	// ---------------- player data ----------------
	string PlayerId(PlayerBase p)
	{
		if (p.GetIdentity())
			return p.GetIdentity().GetPlainId();
		return "local";   // offline / single-player test
	}

	DSPlayerData GetData(PlayerBase p)
	{
		if (!p)
			return null;
		string id = PlayerId(p);
		if (m_Players.Contains(id))
			return m_Players.Get(id);

		DSPlayerData d = new DSPlayerData();
		string path = ROOT + "/players/" + id + ".json";
		if (FileExist(path))
			JsonFileLoader<DSPlayerData>.JsonLoadFile(path, d);
		d.id = id;
		m_Players.Insert(id, d);
		m_Session.Set(id, 0);
		return d;
	}

	void SaveData(DSPlayerData d)
	{
		if (d)
			JsonFileLoader<DSPlayerData>.JsonSaveFile(ROOT + "/players/" + d.id + ".json", d);
	}

	void OnDisconnect(PlayerBase p)
	{
		if (!p || !p.GetIdentity())
			return;
		string id = PlayerId(p);
		if (m_Players.Contains(id))
		{
			SaveData(m_Players.Get(id));
			m_Players.Remove(id);
		}
		m_Session.Remove(id);
		m_NpcSent.Remove(id);
		m_JournalLast.Remove(id);
		m_FxSent.Remove(id);
	}

	// where NPC i stands now (a patrolling NPC moves): its character when this machine knows it, else its spawn point
	vector NpcPos(int i)
	{
		DSNpcInfo info = m_NpcInfo.Get(i);
		Object o = null;
		if (i < m_NpcObjs.Count())
			o = m_NpcObjs.Get(i);
		if (!o && (info.netLow != 0 || info.netHigh != 0))
			o = GetGame().GetObjectByNetworkId(info.netLow, info.netHigh);
		if (o)
			return o.GetPosition();
		return Vector(info.x, info.y, info.z);
	}

	// once a second: patrolling NPCs walk their route and wait at each waypoint. One stops and turns to a player who
	// comes within 3 m (so players can always talk to it) and walks on when they leave; one that gets stuck for a
	// few seconds (a wall, a fence) is put at its waypoint so the patrol never ends.
	void TickPatrols(float step, array<Man> men)
	{
		map<Object, bool> moved = new map<Object, bool>;   // a quest chain shares one NPC: the first route moves it
		for (int i = 0; i < m_NpcInfo.Count() && i < m_NpcObjs.Count(); i++)
		{
			PlayerBase npc = PlayerBase.Cast(m_NpcObjs.Get(i));
			if (!npc || !npc.IsAlive())
				continue;
			DSNode pn = NpcNode(i);
			if (!pn || pn.patrol.Count() < 2 || moved.Contains(npc) || m_Brains.Contains(npc))
				continue;
			moved.Set(npc, true);
			DSPatrolState st;
			if (!m_Patrols.Find(npc, st))
			{
				st = new DSPatrolState();
				st.last = npc.GetPosition();
				m_Patrols.Set(npc, st);
			}
			int count = pn.patrol.Count() / 2 + 1;   // its spawn point + the waypoints
			vector me = npc.GetPosition();
			// a player next to it: stop and turn to them
			PlayerBase near = null;
			for (int m = 0; m < men.Count(); m++)
			{
				PlayerBase who = PlayerBase.Cast(men.Get(m));
				if (who && who != npc && who.IsAlive() && vector.Distance(who.GetPosition(), me) < 3)
					near = who;
			}
			npc.m_DSPatrolWant = true;
			npc.m_DSPatrolRun = pn.prun;
			if (near)
			{
				npc.m_DSPatrolGo = false;
				npc.m_DSPatrolFace = true;
				npc.m_DSPatrolTo = near.GetPosition();
				st.last = me;
				st.stuck = 0;
				continue;
			}
			vector to = PatrolPoint(pn, st.leg);
			npc.m_DSPatrolFace = false;
			if (Dist2D(me, to[0], to[2]) < 0.8)
			{
				npc.m_DSPatrolGo = false;
				st.wait += step;
				if (st.wait < pn.pwait)
					continue;
				st.wait = 0;
				if (pn.pback)
				{
					if (st.leg + st.dir < 0 || st.leg + st.dir >= count)
						st.dir = -st.dir;
					st.leg += st.dir;
				}
				else
					st.leg = (st.leg + 1) % count;
				to = PatrolPoint(pn, st.leg);
				// face the next leg before setting off: the engine turns a character nobody controls only within half
				// a circle of where its orientation was last set, so steering alone can't make every turn
				vector nextDir = Vector(to[0], me[1], to[2]) - me;
				npc.SetOrientation(Vector(nextDir.VectorToAngles()[0], 0, 0));
			}
			npc.m_DSPatrolGo = true;
			npc.m_DSPatrolTo = to;
			if (vector.Distance(me, st.last) < 0.2 * step)
			{
				st.stuck += step;
				if (st.stuck > 6)
				{
					npc.SetPosition(GroundPos(to[0], 0, to[2]));
					st.stuck = 0;
					if (m_Debug)
						Say(npc.GetType() + " was stuck on its patrol - moved to its next waypoint");
				}
			}
			else
				st.stuck = 0;
			st.last = me;
		}
	}

	// ================================================================ NPC behaviour (NPCs tab)
	DSBrainDef BrainDef(string npcId)
	{
		if (npcId == "")
			return null;
		foreach (DSBrainDef d : m_File.brains)
		{
			if (d.npc == npcId)
				return d;
		}
		return null;
	}

	// a character just spawned (or a quest chain registered it again): its behaviour starts once per character
	void StartBrain(DSQuest q, DSNode n, Object o)
	{
		PlayerBase pb = PlayerBase.Cast(o);
		if (!pb)
			return;
		DSBrainDef d = BrainDef(n.npcId);
		if (!d)
			return;
		// an NPC no quest uses can be talked to when it has a "Talked to" event
		if (!q && m_NpcInfo.Count() > 0)
		{
			DSNpcInfo info = m_NpcInfo.Get(m_NpcInfo.Count() - 1);
			foreach (DSBNode tn : d.nodes)
			{
				if (tn.type == "ev_talk")
				{
					info.talk = true;
					if (tn.text != "" && tn.text != "Talk")
						info.prompt = tn.text;
				}
			}
		}
		if (m_Brains.Contains(o) || d.nodes.Count() == 0)
			return;
		DSBrain br = new DSBrain();
		br.def = d;
		br.npc = pb;
		br.faction = n.faction;
		br.home = pb.GetPosition();
		br.last = br.home;
		m_Brains.Set(o, br);
	}

	void TickBrains(float dt, array<Man> men)
	{
		array<Object> gone = new array<Object>;
		for (int i = 0; i < m_Brains.Count(); i++)
		{
			Object key = m_Brains.GetKey(i);
			DSBrain br = m_Brains.GetElement(i);
			if (!key || !br.npc || !br.npc.IsAlive())
			{
				gone.Insert(key);
				continue;
			}
			BrainEvents(br, men);
			BrainSteps(br, dt);
			if (br.npc)
				BrainMove(br, dt, men);
		}
		foreach (Object g : gone)
			m_Brains.Remove(g);
	}

	static string WhoKey(PlayerBase p)
	{
		if (p && p.GetIdentity())
			return p.GetIdentity().GetId();
		return "local";
	}

	static bool TimeIn(float from, float to)
	{
		int year, month, day, hour, minute;
		GetGame().GetWorld().GetDate(year, month, day, hour, minute);
		float h = hour + minute / 60.0;
		if (from <= to)
		{
			if (h >= from && h < to)
				return true;
			return false;
		}
		if (h >= from)
			return true;
		if (h < to)
			return true;
		return false;
	}

	// events: who comes near, Hostile players in sight, time windows, conditions, the first tick (Spawned)
	void BrainEvents(DSBrain br, array<Man> men)
	{
		float now = GetGame().GetTickTime();
		vector me = br.npc.GetPosition();
		foreach (DSBNode e : br.def.nodes)
		{
			if (e.type == "ev_spawn")
			{
				if (!br.started)
					Fire(br, e, null);
			}
			else if (e.type == "ev_near" || e.type == "ev_hostile")
			{
				float cool = e.b;
				if (e.type == "ev_hostile")
					cool = 30;
				foreach (Man m : men)
				{
					PlayerBase p = PlayerBase.Cast(m);
					if (!p || p == br.npc || !p.IsAlive())
						continue;
					string key = e.id + "|" + WhoKey(p);
					bool inRange = vector.Distance(p.GetPosition(), me) <= e.a;
					if (inRange && e.type == "ev_hostile")
						inRange = HostileTo(br, p);
					bool wasIn = false;
					br.inside.Find(key, wasIn);
					br.inside.Set(key, inRange);
					if (!inRange || wasIn)
						continue;
					float last = -100000;
					br.fired.Find(key, last);
					if (now - last < cool)
						continue;
					br.fired.Set(key, now);
					Fire(br, e, p);
				}
			}
			else if (e.type == "ev_time" || e.type == "ev_cond")
			{
				bool on = false;
				if (e.type == "ev_time")
					on = TimeIn(e.a, e.b);
				else
					on = CondOk(null, null, e.cond);
				bool before = false;
				br.was.Find(e.id, before);
				br.was.Set(e.id, on);
				if (on && !before)
					Fire(br, e, null);
			}
		}
		br.started = true;
	}

	bool HostileTo(DSBrain br, PlayerBase p)
	{
		if (br.faction == "")
			return false;
		DSPlayerData data = GetData(p);
		if (!data)
			return false;
		DSTier t = TierOf(RepVal(data, br.faction));
		if (!t || t.stance != "hostile")
			return false;
		return LineOfSight(br.npc, p);
	}

	// a player pressed F on an NPC no quest uses
	void BrainTalk(PlayerBase p, string npcNode)
	{
		for (int i = 0; i < m_NpcInfo.Count() && i < m_NpcObjs.Count(); i++)
		{
			if (m_NpcInfo.Get(i).quest != "" || m_NpcInfo.Get(i).node != npcNode)
				continue;
			Object o = m_NpcObjs.Get(i);
			DSBrain br;
			if (!o || !m_Brains.Find(o, br))
				return;
			if (vector.Distance(p.GetPosition(), o.GetPosition()) > m_NpcInfo.Get(i).radius + 4)
				return;
			foreach (DSBNode e : br.def.nodes)
			{
				if (e.type == "ev_talk")
					Fire(br, e, p);
			}
			return;
		}
	}

	void Fire(DSBrain br, DSBNode e, PlayerBase who)
	{
		if (m_Debug)
			Say(br.npc.GetType() + ": " + e.type);
		Continue(br, e, who);
	}

	// what comes after a node: every wire, in order (Random: one of them)
	void Continue(DSBrain br, DSBNode n, PlayerBase who)
	{
		if (n.type == "fl_random")
		{
			if (n.next.Count() > 0)
				Enqueue(br, n.next.Get(Math.RandomInt(0, n.next.Count())), who);
			return;
		}
		foreach (string id : n.next)
			Enqueue(br, id, who);
	}

	void Enqueue(DSBrain br, string id, PlayerBase who)
	{
		DSBNode n = br.def.Find(id);
		if (!n || br.queue.Count() > 40)
			return;
		br.queue.Insert(n);
		br.queueWho.Insert(who);
	}

	// the steps: the running one until it is done, then the waiting ones in order
	void BrainSteps(DSBrain br, float dt)
	{
		if (br.step)
		{
			if (!StepDone(br, dt))
				return;
			DSBNode doneStep = br.step;
			PlayerBase doneWho = br.stepWho;
			br.step = null;
			Continue(br, doneStep, doneWho);
		}
		int guard = 0;
		while (br.queue.Count() > 0 && !br.step && br.npc && guard < 50)
		{
			guard++;
			DSBNode n = br.queue.Get(0);
			PlayerBase who = br.queueWho.Get(0);
			br.queue.RemoveOrdered(0);
			br.queueWho.RemoveOrdered(0);
			RunStep(br, n, who);
		}
	}

	bool StepDone(DSBrain br, float dt)
	{
		DSBNode n = br.step;
		if (n.type == "st_wait")
		{
			br.stepT += dt;
			return br.stepT >= n.a;
		}
		if (n.type == "st_walkto")
			return Dist2D(br.npc.GetPosition(), n.x, n.z) < 0.8;
		return true;
	}

	void RunStep(DSBrain br, DSBNode n, PlayerBase who)
	{
		string t = n.type;
		if (t.IndexOf("act_") == 0)
		{
			br.act = n;
			br.actWho = who;
			br.leg = 1;
			br.dir = 1;
			br.wait = 0;
			br.hasGoal = false;
			br.stuck = 0;
			return;   // an activity runs until another one replaces it (Escort goes on when it arrives)
		}
		if (t == "st_walkto" || t == "st_wait")
		{
			br.step = n;
			br.stepWho = who;
			br.stepT = 0;
			return;
		}
		if (t == "st_face")
		{
			if (who)
			{
				vector toP = who.GetPosition() - br.npc.GetPosition();
				br.npc.SetOrientation(Vector(toP.VectorToAngles()[0], 0, 0));
			}
		}
		else if (t == "st_say")
			BrainSay(br, n);
		else if (t == "st_give")
		{
			if (who)
			{
				foreach (DSItem it : n.items)
				{
					int amount = it.n;
					if (amount < 1)
						amount = 1;
					if (it.c != "")
						GiveItem(who, it.c, amount);
				}
			}
		}
		else if (t == "st_setvar")
			SetVar(n.var, n.op, n.a);
		else if (t == "st_leave")
		{
			BrainLeave(br);
			return;
		}
		else if (t == "fl_if")
		{
			DSPlayerData data = null;
			if (who)
				data = GetData(who);
			if (!CondOk(who, data, n.cond))
				return;
		}
		else if (t == "st_emote" && m_Debug)
			Say(br.npc.GetType() + " would " + n.text + " (emotes come next)");
		Continue(br, n, who);
	}

	// the line goes to every player within range; their PC shows it above the NPC's head
	void BrainSay(DSBrain br, DSBNode n)
	{
		if (n.text == "")
			return;
		int lo, hi;
		br.npc.GetNetworkID(lo, hi);
		vector at = br.npc.GetPosition();
		string name = br.npc.GetType();
		for (int i = 0; i < m_NpcObjs.Count() && i < m_NpcInfo.Count(); i++)
		{
			if (m_NpcObjs.Get(i) == br.npc)
				name = m_NpcInfo.Get(i).name;
		}
		string pkt = lo.ToString() + "|" + hi.ToString() + "|" + at[0].ToString() + "|" + at[2].ToString() + "|" + n.b.ToString() + "|" + name + "|" + n.text;
		array<Man> men = new array<Man>;
		GetGame().GetPlayers(men);
		if (men.Count() == 0)
		{
			PlayerBase solo = PlayerBase.Cast(GetGame().GetPlayer());
			if (solo)
				men.Insert(solo);
		}
		foreach (Man m : men)
		{
			PlayerBase p = PlayerBase.Cast(m);
			if (p && p != br.npc && vector.Distance(p.GetPosition(), at) <= n.a)
				SendToClient(p, DSQ_RPC_SAY, pkt);
		}
	}

	// the NPC leaves: gone until the server restarts (or its appearance condition was false once)
	void BrainLeave(DSBrain br)
	{
		Object o = br.npc;
		for (int i = m_NpcObjs.Count() - 1; i >= 0; i--)
		{
			if (m_NpcObjs.Get(i) != o)
				continue;
			m_Left.Set(m_NpcInfo.Get(i).quest + "|" + m_NpcInfo.Get(i).node, true);
			m_NpcInfo.Remove(i);
			m_NpcObjs.Remove(i);
		}
		br.npc = null;
		br.step = null;
		br.queue.Clear();
		br.queueWho.Clear();
		DeleteNpc(o);
		m_NpcSent.Clear();
	}

	// ---- moving: the activity (or a Walk to step) sets where the feet go (DSPatrolCmd walks there)
	void Stand(PlayerBase npc, vector look, bool face)
	{
		npc.m_DSPatrolWant = true;
		npc.m_DSPatrolGo = false;
		npc.m_DSPatrolFace = face;
		npc.m_DSPatrolTo = look;
	}

	void MoveTo(DSBrain br, vector goal, bool run, float dt)
	{
		PlayerBase npc = br.npc;
		vector me = npc.GetPosition();
		if (Dist2D(goal, br.lastGoal[0], br.lastGoal[2]) > 0.5)
		{
			// a new goal: face it first (the engine only turns a character nobody controls within half a circle of
			// where its orientation was last set)
			br.lastGoal = goal;
			vector dir = Vector(goal[0], me[1], goal[2]) - me;
			npc.SetOrientation(Vector(dir.VectorToAngles()[0], 0, 0));
		}
		npc.m_DSPatrolWant = true;
		npc.m_DSPatrolGo = true;
		npc.m_DSPatrolFace = false;
		npc.m_DSPatrolRun = run;
		npc.m_DSPatrolTo = goal;
		if (vector.Distance(me, br.last) < 0.2 * dt)
		{
			br.stuck += dt;
			if (br.stuck > 6)
			{
				npc.SetPosition(GroundPos(goal[0], 0, goal[2]));   // stuck on a fence or a rock: put it there
				br.stuck = 0;
			}
		}
		else
			br.stuck = 0;
		br.last = me;
	}

	PlayerBase NearestPlayer(array<Man> men, vector at, float within, PlayerBase not)
	{
		PlayerBase best = null;
		float bd = within;
		foreach (Man m : men)
		{
			PlayerBase p = PlayerBase.Cast(m);
			if (!p || p == not || !p.IsAlive())
				continue;
			float d = vector.Distance(p.GetPosition(), at);
			if (d < bd)
			{
				bd = d;
				best = p;
			}
		}
		return best;
	}

	void BrainMove(DSBrain br, float dt, array<Man> men)
	{
		PlayerBase npc = br.npc;
		vector me = npc.GetPosition();
		if (br.step && br.step.type == "st_walkto")
		{
			MoveTo(br, Vector(br.step.x, 0, br.step.z), br.step.run, dt);
			return;
		}
		DSBNode a = br.act;
		bool follows = false;
		if (a && (a.type == "act_follow" || a.type == "act_escort"))
			follows = true;
		if (br.def.stops && !follows)
		{
			PlayerBase near = NearestPlayer(men, me, 3, npc);
			if (near)
			{
				Stand(npc, near.GetPosition(), true);
				br.last = me;
				br.stuck = 0;
				return;
			}
		}
		if (!a || a.type == "act_guard")
		{
			Stand(npc, me, false);
			return;
		}
		if (a.type == "act_patrol")
		{
			int count = a.pts.Count() / 2 + 1;
			if (count < 2)
			{
				Stand(npc, me, false);
				return;
			}
			vector pt = br.home;
			if (br.leg > 0)
				pt = Vector(a.pts.Get((br.leg - 1) * 2), 0, a.pts.Get((br.leg - 1) * 2 + 1));
			if (Dist2D(me, pt[0], pt[2]) < 0.8)
			{
				Stand(npc, me, false);
				br.wait += dt;
				if (br.wait < a.a)
					return;
				br.wait = 0;
				if (a.flag)
				{
					if (br.leg + br.dir < 0 || br.leg + br.dir >= count)
						br.dir = -br.dir;
					br.leg += br.dir;
				}
				else
					br.leg = (br.leg + 1) % count;
				return;
			}
			MoveTo(br, pt, a.run, dt);
		}
		else if (a.type == "act_wander")
		{
			vector centre = Vector(a.x, 0, a.z);
			if (a.x == 0 && a.z == 0)
				centre = br.home;
			if (!br.hasGoal)
			{
				float ang = Math.RandomFloat(0, Math.PI2);
				float r = Math.Sqrt(Math.RandomFloat(0, 1)) * a.a;
				br.goal = Vector(centre[0] + Math.Cos(ang) * r, 0, centre[2] + Math.Sin(ang) * r);
				br.hasGoal = true;
				br.wait = 0;
			}
			if (Dist2D(me, br.goal[0], br.goal[2]) < 0.8)
			{
				Stand(npc, me, false);
				br.wait += dt;
				if (br.wait >= a.b)
					br.hasGoal = false;
				return;
			}
			MoveTo(br, br.goal, a.run, dt);
		}
		else if (a.type == "act_stand")
		{
			if (Dist2D(me, a.x, a.z) > 0.8)
			{
				MoveTo(br, Vector(a.x, 0, a.z), false, dt);
				br.hasGoal = false;
				return;
			}
			Stand(npc, me, false);
			if (!br.hasGoal)
			{
				npc.SetOrientation(Vector(a.a, 0, 0));   // arrived: face the way it was told
				br.hasGoal = true;
			}
		}
		else if (a.type == "act_follow")
		{
			PlayerBase who = br.actWho;
			if (!who || !who.IsAlive() || vector.Distance(me, who.GetPosition()) > a.b)
			{
				br.act = null;   // lost them: stands where it is
				Stand(npc, me, false);
				return;
			}
			float fd = vector.Distance(me, who.GetPosition());
			if (fd <= a.a + 0.5)
			{
				Stand(npc, who.GetPosition(), true);
				br.last = me;
				return;
			}
			bool hurry = a.run;
			if (fd > 8)
				hurry = true;
			MoveTo(br, who.GetPosition(), hurry, dt);
		}
		else if (a.type == "act_escort")
		{
			if (Dist2D(me, a.x, a.z) < 1.0)
			{
				DSBNode done = a;
				PlayerBase escorted = br.actWho;
				br.act = null;   // arrived: the chain goes on
				Stand(npc, me, false);
				Continue(br, done, escorted);
				return;
			}
			if (br.actWho && vector.Distance(me, br.actWho.GetPosition()) > a.a)
			{
				Stand(npc, br.actWho.GetPosition(), true);   // waits for them to catch up
				br.last = me;
				return;
			}
			MoveTo(br, Vector(a.x, 0, a.z), a.run, dt);
		}
	}

	// ---- client: lines above NPCs' heads
	void ClientSay(string pkt)
	{
		TStringArray f = new TStringArray;
		pkt.Split("|", f);
		if (f.Count() < 7)
			return;
		string text = f.Get(6);
		for (int i = 7; i < f.Count(); i++)
			text = text + "|" + f.Get(i);
		DSSay sy = new DSSay();
		sy.lo = f.Get(0).ToInt();
		sy.hi = f.Get(1).ToInt();
		sy.at = Vector(f.Get(2).ToFloat(), 0, f.Get(3).ToFloat());
		sy.left = f.Get(4).ToFloat();
		if (sy.left < 1)
			sy.left = 5;
		sy.w = DSQText(0, 0, 640, 30, 22, 0xFFFFF2C2, 900);
		if (sy.w)
		{
			sy.w.SetText(f.Get(5) + ":  " + text);
			sy.w.Show(false);
		}
		// one line per NPC at a time
		for (int k = m_Says.Count() - 1; k >= 0; k--)
		{
			if (m_Says.Get(k).lo == sy.lo && m_Says.Get(k).hi == sy.hi)
			{
				if (m_Says.Get(k).w)
					m_Says.Get(k).w.Unlink();
				m_Says.Remove(k);
			}
		}
		m_Says.Insert(sy);
	}

	void ClientSays(float dt)
	{
		for (int i = m_Says.Count() - 1; i >= 0; i--)
		{
			DSSay sy = m_Says.Get(i);
			sy.left -= dt;
			if (sy.left <= 0 || !sy.w)
			{
				if (sy.w)
					sy.w.Unlink();
				m_Says.Remove(i);
				continue;
			}
			vector head = sy.at + Vector(0, GetGame().SurfaceY(sy.at[0], sy.at[2]) + 2.1, 0);
			Object o = null;
			if (sy.lo != 0 || sy.hi != 0)
				o = GetGame().GetObjectByNetworkId(sy.lo, sy.hi);
			if (o)
				head = o.GetPosition() + "0 2.1 0";
			vector sp = GetGame().GetScreenPos(head);
			PlayerBase me = PlayerBase.Cast(GetGame().GetPlayer());
			bool show = false;
			if (sp[2] > 0 && sp[2] < 60)
				show = true;
			if (me && vector.Distance(me.GetPosition(), head) > 60)
				show = false;
			if (show)
				sy.w.SetPos(sp[0] - 320, sp[1] - 15, true);
			sy.w.Show(show);
		}
	}

	// point k of an NPC's patrol: 0 = where it spawned, then its waypoints
	vector PatrolPoint(DSNode n, int k)
	{
		if (k <= 0)
			return Vector(n.x, n.y, n.z);
		return Vector(n.patrol.Get((k - 1) * 2), 0, n.patrol.Get((k - 1) * 2 + 1));
	}

	// server: is the player close enough to talk to / trade with this NPC (wherever its patrol took it)?
	bool NearNpc(PlayerBase p, DSQuest q, DSNode n, float extra)
	{
		vector at = Vector(n.x, n.y, n.z);
		for (int i = 0; i < m_NpcInfo.Count(); i++)
		{
			if (m_NpcInfo.Get(i).quest == q.id && m_NpcInfo.Get(i).node == n.id)
				at = NpcPos(i);
		}
		return Dist2D(p.GetPosition(), at[0], at[2]) <= n.radius + extra;
	}

	// ---------------- NPC spawn ----------------
	void RegisterNpc(DSQuest q, DSNode n, vector pos, Object o)
	{
		DSNpcInfo info = new DSNpcInfo();
		info.quest = "";
		if (q)
			info.quest = q.id;   // no quest: an NPC of the NPCs tab on its own
		info.talk = q != null;
		info.node = n.id;
		info.name = n.title;
		if (info.name == "")
			info.name = "Survivor";
		info.x = pos[0];
		info.y = pos[1];
		info.z = pos[2];
		info.radius = n.radius;
		info.faction = n.faction;
		if (o)
			o.GetNetworkID(info.netLow, info.netHigh);
		if (info.radius < 2.5)
			info.radius = 2.5;
		if (info.radius > 12)
			info.radius = 12;
		m_NpcInfo.Insert(info);
		m_NpcObjs.Insert(o);
	}

	void SpawnNpcs()
	{
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			for (int j = 0; j < q.nodes.Count(); j++)
			{
				DSNode n = q.nodes.Get(j);
				if (n.type != "trg_npc" || n.cls == "")
					continue;
				if (n.cond && n.cond.kind != "" && !CondOk(null, null, n.cond))
					continue;   // appears later (see UpdateNpcs)
				SpawnNpc(q, n);
			}
		}
		for (int f = 0; f < m_File.npcs.Count(); f++)
		{
			DSNode fn = m_File.npcs.Get(f);
			if (fn.cls == "")
				continue;
			if (fn.cond && fn.cond.kind != "" && !CondOk(null, null, fn.cond))
				continue;
			SpawnNpc(null, fn);
		}
	}

	// the node behind NPC i: its quest's Talk to NPC node, or the NPC itself when no quest uses it
	DSNode NpcNode(int i)
	{
		DSNpcInfo info = m_NpcInfo.Get(i);
		if (info.quest == "")
		{
			for (int f = 0; f < m_File.npcs.Count(); f++)
			{
				if (m_File.npcs.Get(f).id == info.node)
					return m_File.npcs.Get(f);
			}
			return null;
		}
		DSQuest q = FindQuestById(info.quest);
		if (!q)
			return null;
		return FindNode(q, info.node);
	}

	void SpawnNpc(DSQuest q, DSNode n)
	{
		vector pos = GroundPos(n.x, n.y, n.z);
		// the same NPC in several quests (a quest chain): one character who talks about all of them
		Object shared = null;
		for (int s = 0; s < m_NpcObjs.Count(); s++)
		{
			Object other = m_NpcObjs.Get(s);
			if (other && other.GetType() == n.cls && vector.Distance(other.GetPosition(), pos) < 1.5)
				shared = other;
		}
		if (shared)
		{
			RegisterNpc(q, n, shared.GetPosition(), shared);
			StartBrain(q, n, shared);
			return;
		}
		Object o = GetGame().CreateObject(n.cls, pos);
		if (!o)
			return;
		o.SetPosition(pos);
		o.SetOrientation(Vector(n.yaw, 0, 0));
		RegisterNpc(q, n, pos, o);
		StartBrain(q, n, o);
		EntityAI e = EntityAI.Cast(o);
		if (e)
		{
			e.SetAllowDamage(false);
			for (int k = 0; k < n.items.Count(); k++)
				e.GetInventory().CreateInInventory(n.items.Get(k).c);
			Man npcMan = Man.Cast(e);
			if (npcMan && n.hands != "")
			{
				EntityAI inHands = npcMan.GetHumanInventory().CreateInHands(n.hands);
				Weapon_Base npcGun = Weapon_Base.Cast(inHands);
				if (npcGun && n.ammo != "")
					npcGun.SpawnAmmo("", Weapon_Base.SAMF_DEFAULT);   // a faction guard's gun is loaded and chambered
			}
		}
	}

	// an NPC that leaves takes its clothes and gear along (deleting only the body leaves them floating in the world)
	static void DeleteNpc(Object o)
	{
		EntityAI e = EntityAI.Cast(o);
		if (e)
		{
			array<EntityAI> gear = new array<EntityAI>;
			e.GetInventory().EnumerateInventory(InventoryTraversalType.POSTORDER, gear);
			for (int i = 0; i < gear.Count(); i++)
			{
				if (gear.Get(i) && gear.Get(i) != e)
					GetGame().ObjectDelete(gear.Get(i));
			}
		}
		GetGame().ObjectDelete(o);
	}

	// every few seconds: NPCs with an appearance condition come and go (e.g. a faction that shows up once a
	// server variable is set, a night trader, a storm hermit)
	void UpdateNpcs()
	{
		bool changed = false;
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			for (int j = 0; j < q.nodes.Count(); j++)
			{
				if (q.nodes.Get(j).type == "trg_npc" && UpdateNpc(q, q.nodes.Get(j)))
					changed = true;
			}
		}
		for (int f = 0; f < m_File.npcs.Count(); f++)
		{
			if (UpdateNpc(null, m_File.npcs.Get(f)))
				changed = true;
		}
		if (changed)
			m_NpcSent.Clear();   // every player gets the new NPC list on the next tick
	}

	// one NPC with an appearance condition: spawn it or let it leave. true when something changed
	bool UpdateNpc(DSQuest q, DSNode n)
	{
		if (n.cls == "" || !n.cond || n.cond.kind == "")
			return false;
		string qid = "";
		string where = "NPCs tab";
		if (q)
		{
			qid = q.id;
			where = q.name;
		}
		int at = -1;
		for (int a = 0; a < m_NpcInfo.Count(); a++)
		{
			if (m_NpcInfo.Get(a).quest == qid && m_NpcInfo.Get(a).node == n.id)
				at = a;
		}
		bool want = CondOk(null, null, n.cond);
		if (!want)
			m_Left.Remove(qid + "|" + n.id);
		if (want && at < 0 && !m_Left.Contains(qid + "|" + n.id))
		{
			SpawnNpc(q, n);
			Print("[DZStudio] NPC " + n.title + " appears (" + where + ")");
			return true;
		}
		if (!want && at >= 0)
		{
			Object gone = null;
			if (at < m_NpcObjs.Count())
				gone = m_NpcObjs.Get(at);
			m_NpcInfo.Remove(at);
			if (at < m_NpcObjs.Count())
				m_NpcObjs.Remove(at);
			if (gone && m_NpcObjs.Find(gone) < 0)
				DeleteNpc(gone);
			Print("[DZStudio] NPC " + n.title + " leaves (" + where + ")");
			return true;
		}
		return false;
	}

	// ---------------- main tick ----------------
	void Tick(float dt)
	{
		if (!m_Ready)
		{
			m_Retry -= dt;
			if (m_Retry <= 0)
			{
				m_Retry = 4;
				Init();
			}
			if (!m_Ready)
				return;
		}
		m_Acc += dt;
		if (m_Acc < 1.0)
			return;
		float step = m_Acc;
		m_Acc = 0;

		array<Man> men = new array<Man>;
		GetGame().GetPlayers(men);
		if (men.Count() == 0)
		{
			PlayerBase edPlayer = PlayerBase.Cast(GetGame().GetPlayer());   // single-player / editor session
			if (edPlayer)
				men.Insert(edPlayer);
		}
		PlayerBase first = null;
		for (int i = 0; i < men.Count(); i++)
		{
			PlayerBase pb = PlayerBase.Cast(men.Get(i));
			if (!pb || !pb.IsAlive())
				continue;
			if (!first)
				first = pb;
			TickPlayer(pb, step);
		}
		TickPatrols(step, men);
		TickBrains(step, men);

		if (m_Raised.Count() > 0)
			LowerGuns(GetGame().GetTickTime());
		m_NpcT += step;
		if (m_NpcT >= 5)
		{
			m_NpcT = 0;
			UpdateNpcs();
		}
		m_SaveT += step;
		if (m_SaveT >= 120)
		{
			m_SaveT = 0;
			SaveAll();
		}

		if (m_Debug)
		{
			PollFlags(first);
			WriteProgress(first);
		}
	}

	void TickPlayer(PlayerBase p, float step)
	{
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		data.play += step;
		string id = data.id;
		m_Session.Set(id, m_Session.Get(id) + step);
		SendNpcList(p, id);
		SendFx(p, data);
		TickGuards(p, data);

		for (int i = 0; i < m_File.quests.Count(); i++)
			ProcessQuest(p, data, m_File.quests.Get(i), step);
		SendJournal(p, data);
	}

	void ProcessQuest(PlayerBase p, DSPlayerData data, DSQuest q, float step)
	{
		DSQuestState qs = data.GetQuest(q.id);

		if (qs.status == 2)
		{
			if (q.repeatable && (data.play - qs.doneAt) >= q.cooldown)
			{
				qs.Reset();
				SaveData(data);
			}
			else
				return;
		}

		if (qs.status == 0)
		{
			if (!PrereqsMet(data, q))
				return;
			for (int i = 0; i < q.nodes.Count(); i++)
			{
				DSNode t = q.nodes.Get(i);
				if (!IsTrigger(t.type))
					continue;
				if (CheckTrigger(p, data, t))
				{
					StartQuest(p, data, q, qs, t);
					break;
				}
			}
			return;
		}

		Repair(p, data, q, qs);
		// running: tick every active node
		for (int k = 0; k < q.nodes.Count(); k++)
		{
			DSNode n = q.nodes.Get(k);
			DSNodeState ns = qs.Node(n.id);
			if (ns.status != 1)
				continue;
			TickNode(p, data, q, qs, n, ns, step);
			if (qs.status != 1)
				return;
		}
	}

	// ---------------- server variables ----------------
	void LoadGlobals()
	{
		m_Globals.Clear();
		string path = ROOT + "/globals.json";
		if (!FileExist(path))
			return;
		DSGlobalFile gf = new DSGlobalFile();
		JsonFileLoader<DSGlobalFile>.JsonLoadFile(path, gf);
		for (int i = 0; i < gf.vars.Count(); i++)
			m_Globals.Set(gf.vars.Get(i).k, gf.vars.Get(i).v);
	}

	void SaveGlobals()
	{
		DSGlobalFile gf = new DSGlobalFile();
		for (int i = 0; i < m_Globals.Count(); i++)
		{
			DSGVar g = new DSGVar();
			g.k = m_Globals.GetKey(i);
			g.v = m_Globals.GetElement(i);
			gf.vars.Insert(g);
		}
		JsonFileLoader<DSGlobalFile>.JsonSaveFile(ROOT + "/globals.json", gf);
	}

	float GetVar(string name)
	{
		float v = 0;
		m_Globals.Find(name, v);
		return v;
	}

	void SetVar(string name, string op, float value)
	{
		if (name == "")
			return;
		float cur = GetVar(name);
		float nv = value;
		if (op == "add")
			nv = cur + value;
		else if (op == "sub")
			nv = cur - value;
		else if (op == "toggle")
		{
			nv = 1;
			if (cur != 0)
				nv = 0;
		}
		m_Globals.Set(name, nv);
		SaveGlobals();
		Say("server variable " + name + " = " + nv);
		Print("[DZStudio] Server variable " + name + " = " + nv);
	}

	// ---------------- conditions ----------------
	static bool Cmp(float a, string op, float b)
	{
		if (op == "!=")
			return a != b;
		if (op == ">")
			return a > b;
		if (op == ">=")
			return a >= b;
		if (op == "<")
			return a < b;
		if (op == "<=")
			return a <= b;
		return a == b;
	}

	// does c hold? p / data may be null (NPC appearance, quest availability): then only world conditions can hold
	bool CondOk(PlayerBase p, DSPlayerData data, DSCond c)
	{
		if (!c || c.kind == "")
			return true;
		bool r = CondRaw(p, data, c);
		if (c.neg)
			return !r;
		return r;
	}

	bool CondRaw(PlayerBase p, DSPlayerData data, DSCond c)
	{
		string k = c.kind;
		if (k == "var")
			return Cmp(GetVar(c.var), c.op, c.value);
		if (k == "rep")
		{
			if (!data)
				return false;
			return Cmp(RepVal(data, c.var), c.op, c.value);
		}
		if (k == "reptier")
		{
			if (!data)
				return false;
			DSTier condTier = TierOf(RepVal(data, c.var));
			if (!condTier)
				return false;
			return condTier.id == c.stat;
		}
		if (k == "pvar")
		{
			if (!data)
				return false;
			return Cmp(StatVal(data, c.var), c.op, c.value);
		}
		if (k == "time")
		{
			int yr, mo, dy, hr, mi;
			GetGame().GetWorld().GetDate(yr, mo, dy, hr, mi);
			float h = hr + mi / 60.0;
			// (plain ifs: Enforce mis-evaluates some && chains)
			if (c.value <= c.to)
			{
				if (h < c.value)
					return false;
				if (h >= c.to)
					return false;
				return true;
			}
			if (h >= c.value)
				return true;   // a window that runs past midnight, e.g. 23:00 - 01:00
			if (h < c.to)
				return true;
			return false;
		}
		if (k == "uptime")
		{
			float up = GetGame().GetTickTime() / 60.0;
			if (up < c.value)
				return false;
			if (c.to > 0 && up >= c.to)
				return false;
			return true;
		}
		if (k == "weather")
		{
			Weather w = GetGame().GetWeather();
			float rain = w.GetRain().GetActual();
			float over = w.GetOvercast().GetActual();
			float fog = w.GetFog().GetActual();
			bool yes = false;
			if (c.stat == "storm")
				yes = over >= 0.85;                  // lightning starts at overcast 0.9 on Chernarus
			else if (c.stat == "clear")
			{
				if (over < 0.3)
				{
					if (rain < 0.05)
						yes = true;
				}
			}
			else
			{
				float wv = over;
				if (c.stat == "rain")
					wv = rain;
				else if (c.stat == "fog")
					wv = fog;
				return Cmp(wv, c.op, c.value);
			}
			if (c.op == "not")
				return !yes;
			return yes;
		}
		if (k == "has_item" || k == "lacks_item")
		{
			if (!p)
				return false;
			int need = c.n;
			if (need < 1)
				need = 1;
			int have = CountItems(p, c.cls);
			if (k == "has_item")
				return have >= need;
			return have < need;
		}
		if (k == "quest_done" || k == "quest_active" || k == "quest_new")
		{
			if (!data)
				return false;
			DSQuestState cs = data.FindQuest(c.quest);
			bool everDone = false;
			bool running = false;
			if (cs)
			{
				everDone = cs.EverDone();
				if (cs.status == 1)
					running = true;
			}
			if (k == "quest_done")
				return everDone;
			if (k == "quest_active")
				return running;
			if (everDone || running)
				return false;
			return true;
		}
		if (k == "player")
		{
			if (!p)
				return false;
			bool flag = false;
			bool isFlag = true;
			float pv = 0;
			if (c.stat == "bleeding")
				flag = p.IsBleeding();
			else if (c.stat == "sick")
				flag = p.GetAgents() != 0;
			else if (c.stat == "fracture")
				flag = p.GetBrokenLegs() == eBrokenLegs.BROKEN_LEGS;
			else if (c.stat == "unconscious")
				flag = p.IsUnconscious();
			else
			{
				isFlag = false;
				if (c.stat == "blood")
					pv = p.GetHealth("", "Blood");
				else if (c.stat == "water")
					pv = p.GetStatWater().Get();
				else if (c.stat == "energy")
					pv = p.GetStatEnergy().Get();
				else
					pv = p.GetHealth("", "Health");
			}
			if (!isFlag)
				return Cmp(pv, c.op, c.value);
			if (c.op == "not")
				return !flag;
			return flag;
		}
		return true;
	}

	// ---------------- placed effects (sound / particle / light) ----------------
	// per player: an effect can be on for one player and off for another (their quests, stats, condition)
	bool FxOn(DSFxDef d, PlayerBase p, DSPlayerData data)
	{
		float v = GetVar("fx_" + d.id);
		if (d.startOff)
		{
			if (v != 1)
				return false;
		}
		else if (v == -1)
			return false;
		if (d.cond && d.cond.kind != "" && !CondOk(p, data, d.cond))
			return false;
		return true;
	}

	string FxActiveList(PlayerBase p, DSPlayerData data)
	{
		DSFx.Defs();
		string active = ",";   // never empty, so "nothing on" is a real state
		for (int i = 0; i < DSFx.s_Defs.Count(); i++)
		{
			DSFxDef d = DSFx.s_Defs.Get(i);
			if (FxOn(d, p, data))
				active = active + d.id + ",";
		}
		return active;
	}

	void SendFx(PlayerBase p, DSPlayerData data)
	{
		string now = FxActiveList(p, data);
		string last;
		if (m_FxSent.Find(data.id, last) && last == now)
			return;
		m_FxSent.Set(data.id, now);
		SendToClient(p, DSQ_RPC_FX, now);
	}

	// ---------------- player stats (XP, reputation, skills) ----------------
	DSStatDef StatDef(string id)
	{
		if (!m_File)
			return null;
		for (int i = 0; i < m_File.stats.Count(); i++)
		{
			if (m_File.stats.Get(i).id == id)
				return m_File.stats.Get(i);
		}
		return null;
	}

	float StatVal(DSPlayerData data, string id)
	{
		DSGVar v = data.FindStat(id);
		if (v)
			return v.v;
		DSStatDef sd = StatDef(id);
		if (sd)
			return sd.start;
		return 0;
	}

	void SetStat(PlayerBase p, DSPlayerData data, string id, string op, float value, string msg)
	{
		if (id == "")
			return;
		float nv = value;
		if (op == "add")
			nv = StatVal(data, id) + value;
		else if (op == "sub")
			nv = StatVal(data, id) - value;
		DSStatDef sd = StatDef(id);
		if (sd && sd.max > sd.min)
		{
			if (nv < sd.min)
				nv = sd.min;
			if (nv > sd.max)
				nv = sd.max;
		}
		DSGVar v = data.FindStat(id);
		if (!v)
		{
			v = new DSGVar();
			v.k = id;
			data.stats.Insert(v);
		}
		v.v = nv;
		SaveData(data);
		string title = id;
		if (sd && sd.name != "")
			title = sd.name;
		Say(title + " = " + nv);
		if (msg != "")
			Notify(p, title, msg, false);
	}

	// ======================= factions & reputation =======================
	void LoadFactions()
	{
		m_Fac = new DSFactionFile();
		string path = ROOT + "/factions.json";
		if (FileExist(path))
			JsonFileLoader<DSFactionFile>.JsonLoadFile(path, m_Fac);
		if (m_Fac.max <= m_Fac.min)
		{
			m_Fac.min = -1000;
			m_Fac.max = 1000;
		}
		if (m_Fac.factions.Count() > 0)
			Print("[DZStudio] Factions: " + m_Fac.factions.Count() + ", tiers: " + m_Fac.tiers.Count());
	}

	DSFaction Faction(string fid)
	{
		if (!m_Fac || fid == "")
			return null;
		for (int i = 0; i < m_Fac.factions.Count(); i++)
		{
			if (m_Fac.factions.Get(i).id == fid)
				return m_Fac.factions.Get(i);
		}
		return null;
	}

	// the tier a standing falls into (tiers share one scale for every faction)
	DSTier TierOf(int value)
	{
		if (!m_Fac)
			return null;
		for (int i = 0; i < m_Fac.tiers.Count(); i++)
		{
			DSTier t = m_Fac.tiers.Get(i);
			if (value >= t.min && value <= t.max)
				return t;
		}
		return null;
	}

	int RepVal(DSPlayerData data, string fid)
	{
		if (!data)
			return 0;
		DSGVar v = data.FindRep(fid);
		if (v)
			return v.v;
		DSFaction f = Faction(fid);
		if (f)
			return f.start;
		return 0;
	}

	// the tier of the player with an NPC's faction (null: the NPC has no faction)
	DSTier NpcTier(DSPlayerData data, DSNode n)
	{
		if (!n || n.faction == "" || !Faction(n.faction))
			return null;
		return TierOf(RepVal(data, n.faction));
	}

	int TierDiscount(DSPlayerData data, DSNode n)
	{
		DSTier t = NpcTier(data, n);
		if (!t)
			return 0;
		int d = t.discount;
		if (d < 0)
			d = 0;
		if (d > 90)
			d = 90;
		return d;
	}

	// a price after the discount: never below 1 when there was a price
	static int Discounted(int count, int disc)
	{
		if (disc <= 0 || count <= 0)
			return count;
		int c = Math.Ceil(count * (100 - disc) / 100.0);
		if (c < 1)
			c = 1;
		return c;
	}

	bool InTerritory(DSFaction f, vector pos)
	{
		for (int i = 0; i < f.territories.Count(); i++)
		{
			DSTerritory t = f.territories.Get(i);
			if (Dist2D(pos, t.x, t.z) <= t.radius)
				return true;
		}
		return false;
	}

	PlayerBase OnlinePlayer(string playerId)
	{
		array<Man> men = new array<Man>;
		GetGame().GetPlayers(men);
		for (int i = 0; i < men.Count(); i++)
		{
			PlayerBase pb = PlayerBase.Cast(men.Get(i));
			if (pb && PlayerId(pb) == playerId)
				return pb;
		}
		PlayerBase me = PlayerBase.Cast(GetGame().GetPlayer());
		if (me && PlayerId(me) == playerId)
			return me;
		return null;
	}

	// a player's data by id: the loaded copy when online, otherwise read from players/<id>.json
	DSPlayerData DataById(string playerId)
	{
		if (playerId == "")
			return null;
		if (m_Players.Contains(playerId))
			return m_Players.Get(playerId);
		string path = ROOT + "/players/" + playerId + ".json";
		if (!FileExist(path))
			return null;
		DSPlayerData d = new DSPlayerData();
		JsonFileLoader<DSPlayerData>.JsonLoadFile(path, d);
		d.id = playerId;
		return d;
	}

	// ---- the public API (also handy from Custom Script nodes: DSQuests.Get().AddPlayerReputation(...)) ----
	int GetPlayerReputation(string playerId, string factionId)
	{
		return RepVal(DataById(playerId), factionId);
	}

	void AddPlayerReputation(string playerId, string factionId, int amount)
	{
		DSPlayerData d = DataById(playerId);
		if (!d)
			return;
		ChangeRepData(OnlinePlayer(playerId), d, factionId, amount, true, "", true);
		SaveData(d);
	}

	void SetPlayerReputation(string playerId, string factionId, int value)
	{
		DSPlayerData d = DataById(playerId);
		if (!d)
			return;
		ChangeRepData(OnlinePlayer(playerId), d, factionId, value - RepVal(d, factionId), false, "", true);
		SaveData(d);
	}

	// changes one faction's standing and, with spread, the factions related to it (one step: no chains, no loops).
	// The caller saves the player data.
	void ChangeRepData(PlayerBase p, DSPlayerData data, string factionId, int amount, bool spread, string reason, bool tell)
	{
		if (!data || amount == 0)
			return;
		ApplyRep(p, data, factionId, amount, reason, tell);
		if (!spread)
			return;
		for (int i = 0; i < m_Fac.relations.Count(); i++)
		{
			DSRelation r = m_Fac.relations.Get(i);
			if (r.from != factionId || r.to == factionId)
				continue;
			int d = Math.Round(amount * r.factor);
			if (d != 0)
				ApplyRep(p, data, r.to, d, "", tell);
		}
	}

	void ApplyRep(PlayerBase p, DSPlayerData data, string factionId, int amount, string reason, bool tell)
	{
		DSFaction f = Faction(factionId);
		if (!f)
			return;
		int before = RepVal(data, factionId);
		int after = before + amount;
		if (after < m_Fac.min)
			after = m_Fac.min;
		if (after > m_Fac.max)
			after = m_Fac.max;
		if (after == before)
			return;
		DSGVar v = data.FindRep(factionId);
		if (!v)
		{
			v = new DSGVar();
			v.k = factionId;
			data.rep.Insert(v);
		}
		v.v = after;
		DSTier t0 = TierOf(before);
		DSTier t1 = TierOf(after);
		bool tierChanged = t0 != t1;
		Say(f.name + " standing " + before + " -> " + after);
		if (!p)
			return;
		SendRep(p, f, after, t1, tierChanged);
		int shown = after - before;
		string sign = "";
		if (shown > 0)
			sign = "+";
		string line = sign + shown.ToString() + " " + f.name;
		if (reason != "")
			line = reason + " (" + line + ")";
		if (tell || reason != "")
			Notify(p, f.name, line, false);
		if (tierChanged && t1)
			Notify(p, f.name, "You are now " + t1.name + " with " + f.name + ".", true);
	}

	void SendRep(PlayerBase p, DSFaction f, int value, DSTier t, bool changed)
	{
		string tid = "";
		string tname = "";
		int tcol = 0;
		if (t)
		{
			tid = t.id;
			tname = t.name;
			tcol = t.color;
		}
		int ch = 0;
		if (changed)
			ch = 1;
		SendToClient(p, DSQ_RPC_REP, f.id + "|" + value.ToString() + "|" + tid + "|" + tname + "|" + tcol.ToString() + "|" + ch.ToString());
	}

	// kill rules of every faction (Studio ▸ Factions ▸ Kills)
	void RepOnKill(PlayerBase p, DSPlayerData data, Object victim)
	{
		if (!m_Fac || m_Fac.factions.Count() == 0)
			return;
		DSPlayerData vdata = null;
		PlayerBase vp = PlayerBase.Cast(victim);
		if (vp && m_NpcObjs.Find(vp) < 0)
			vdata = GetData(vp);
		bool changed = false;
		for (int i = 0; i < m_Fac.factions.Count(); i++)
		{
			DSFaction f = m_Fac.factions.Get(i);
			bool inside = InTerritory(f, victim.GetPosition());
			for (int j = 0; j < f.kills.Count(); j++)
			{
				DSKillRule r = f.kills.Get(j);
				if (!MatchCls(r.victim, victim))
					continue;
				if (r.where == "territory" && !inside)
					continue;
				if (r.where == "outside" && inside)
					continue;
				if (r.victimTier != "")
				{
					if (!vdata)
						continue;
					DSTier vt = TierOf(RepVal(vdata, f.id));
					if (!vt || vt.id != r.victimTier)
						continue;
				}
				ChangeRepData(p, data, f.id, r.amount, true, r.text, false);
				changed = true;
			}
		}
		if (changed)
			SaveData(data);
	}

	// faction NPCs and players in a hostile tier: warn, face them and - with a weapon in hand - shoot
	void TickGuards(PlayerBase p, DSPlayerData data)
	{
		if (!m_Fac || m_Fac.factions.Count() == 0 || !p.IsAlive())
			return;
		float now = GetGame().GetTickTime();
		array<Object> seen = new array<Object>;
		for (int i = 0; i < m_NpcInfo.Count() && i < m_NpcObjs.Count(); i++)
		{
			DSNpcInfo gi = m_NpcInfo.Get(i);
			Object go = m_NpcObjs.Get(i);
			if (!go || gi.faction == "" || seen.Find(go) >= 0)
				continue;
			seen.Insert(go);
			DSFaction gf = Faction(gi.faction);
			if (!gf || !gf.guard || gf.guard.warn <= 0)
				continue;
			DSTier gt = TierOf(RepVal(data, gf.id));
			if (!gt || gt.stance != "hostile")
				continue;
			float gd = vector.Distance(p.GetPosition(), go.GetPosition());
			if (gd > gf.guard.warn)
				continue;
			string key = data.id + "|" + i.ToString();
			float lastWarn = -1000;
			m_GuardWarn.Find(key, lastWarn);
			if (now - lastWarn > 30)
			{
				m_GuardWarn.Set(key, now);
				string wt = gf.guard.warnText;
				if (wt == "")
					wt = "Stay back! You're not welcome here.";
				Notify(p, gi.name, wt, false);
			}
			PlayerBase gnpc = PlayerBase.Cast(go);
			Weapon_Base gw = null;
			if (gnpc)
				gw = Weapon_Base.Cast(gnpc.GetHumanInventory().GetEntityInHands());
			if (gw)
				AimGun(gnpc, p, now);   // turns, shoulders the gun and points it at the player (DSGuardCmd)
			else
			{
				vector toP = p.GetPosition() - go.GetPosition();
				go.SetOrientation(Vector(toP.VectorToAngles()[0], 0, 0));
			}
			if (gd > gf.guard.attack)
				continue;
			DSNode gn = NpcNode(i);
			if (!gn || gn.ammo == "")
				continue;   // no weapon in hand: warnings only
			float lastShot = -1000;
			m_GuardShot.Find(key, lastShot);
			float every = gf.guard.interval;
			if (every < 1)
				every = 1;
			if (now - lastShot < every)
				continue;
			m_GuardShot.Set(key, now);
			if (!LineOfSight(go, p))
			{
				if (m_Debug)
					Say(gi.name + " (" + gf.name + ") has no line of fire");
				continue;
			}
			if (gw)
			{
				gnpc.m_DSGuardFire = true;   // recoil animation
				ShotFx(gnpc, gn);            // muzzle flash + gunshot on every player's PC nearby
			}
			float hitChance = 1.0 - (gd / gf.guard.attack) * 0.6;
			if (hitChance < 0.25)
				hitChance = 0.25;
			if (hitChance > 0.95)
				hitChance = 0.95;
			// the damage comes from the faction settings: a hit of the gun's own bullet, scaled
			bool hitP = Math.RandomFloat01() <= hitChance;
			if (hitP)
				p.ProcessDirectDamage(DamageType.FIRE_ARM, EntityAI.Cast(go), "Torso", gn.ammo, "0 0 0", gf.guard.damage);
			if (m_Debug)
			{
				string hitWord = "missed";
				if (hitP)
					hitWord = "hit";
				Say(gi.name + " (" + gf.name + ") fired and " + hitWord + ", health " + p.GetHealth("", ""));
			}
		}
	}

	bool LineOfSight(Object from, PlayerBase to)
	{
		vector b = to.GetPosition() + "0 1.3 0";
		vector a = from.GetPosition() + "0 1.5 0";
		// start just outside the NPC so its own body, clothes and gun don't block the ray
		vector dirAB = b - a;
		dirAB.Normalize();
		a = a + dirAB * 0.7;
		vector cpos;
		vector cdir;
		int ccomp;
		set<Object> hits = new set<Object>;
		// fire geometry: bullets go through bushes and leaves, not through walls, rocks and tree trunks
		if (!DayZPhysics.RaycastRV(a, b, cpos, cdir, ccomp, hits, null, from, false, false, ObjIntersectFire, 0.05))
			return true;
		for (int i = 0; i < hits.Count(); i++)
		{
			Object h = hits.Get(i);
			if (h == to)
				return true;
			EntityAI he = EntityAI.Cast(h);
			if (he && he.GetHierarchyRootPlayer() == to)
				return true;   // the target's own clothes or gear
		}
		if (vector.Distance(cpos, b) < 1.0)
			return true;
		if (m_Debug)
		{
			string what = "terrain";
			if (hits.Count() > 0 && hits.Get(0))
				what = hits.Get(0).GetType();
			Say("line of fire blocked by " + what + " " + vector.Distance(a, cpos).ToString() + " m from the NPC");
		}
		return false;
	}

	// shoulder the gun and aim it at the target's chest; the character's own command does the animation (DSGuardCmd)
	void AimGun(PlayerBase npc, PlayerBase target, float now)
	{
		vector eye = npc.GetPosition() + "0 1.5 0";
		vector chest = target.GetPosition() + "0 1.2 0";
		float flat = vector.Distance(Vector(eye[0], 0, eye[2]), Vector(chest[0], 0, chest[2]));
		npc.m_DSGuardAimY = Math.Atan2(chest[1] - eye[1], flat) * Math.RAD2DEG;
		vector toT = target.GetPosition() - npc.GetPosition();
		npc.m_DSGuardHeading = DSHeadingTo(toT);
		npc.m_DSGuardWant = true;
		int at = m_Raised.Find(npc);
		if (at < 0)
		{
			m_Raised.Insert(npc);
			m_RaisedT.Insert(now);
		}
		else
			m_RaisedT.Set(at, now);
	}

	// guns go down again a few seconds after the last hostile player left
	void LowerGuns(float now)
	{
		for (int i = m_Raised.Count() - 1; i >= 0; i--)
		{
			if (now - m_RaisedT.Get(i) < 4)
				continue;
			PlayerBase npc = PlayerBase.Cast(m_Raised.Get(i));
			if (npc)
				npc.m_DSGuardWant = false;
			if (npc && m_Debug)
				Say(npc.GetType() + " lowers its gun");
			m_Raised.Remove(i);
			m_RaisedT.Remove(i);
		}
	}

	// a faction NPC fires: every player within 800 m sees the muzzle flash of its gun and hears the shot.
	// (The shot itself is scripted: vanilla can't make a character nobody controls raise and fire a weapon.)
	void ShotFx(PlayerBase npc, DSNode n)
	{
		int low, high;
		npc.GetNetworkID(low, high);
		string pkt = low.ToString() + "|" + high.ToString() + "|" + n.shot + "|" + n.ammo;
		array<Man> men = new array<Man>;
		GetGame().GetPlayers(men);
		for (int i = 0; i < men.Count(); i++)
		{
			PlayerBase pb = PlayerBase.Cast(men.Get(i));
			if (pb && vector.Distance(pb.GetPosition(), npc.GetPosition()) < 800)
				SendToClient(pb, DSQ_RPC_SHOT, pkt);
		}
		if (m_Debug)
			Say(npc.GetType() + " fired (" + n.shot + ")");
	}

	// ---------------- short messages on the player's tracker banner ----------------
	void SendMsg(PlayerBase p, string title, string text)
	{
		SendToClient(p, DSQ_RPC_MSG, title + "|" + text);
	}

	// on the player's PC: the same pop-up as the server's quest messages
	void ShowMsg(string title, string text)
	{
		NotificationSystem.AddNotificationExtended(5, title, text, "");
	}

	// ---------------- item requirements (both sides: the client for instant feedback, the server decides) ----------------
	bool CondFor(PlayerBase p, DSCond c)
	{
		if (!c || c.kind == "")
			return true;
		if (GetGame().IsDedicatedServer() || !GetGame().IsMultiplayer())
		{
			if (!m_Ready)
				return true;
			return CondOk(p, GetData(p), c);
		}
		bool r = ClientCond(p, c);
		if (c.neg)
			return !r;
		return r;
	}

	// what the client can know about itself: its stats and quests (from the journal), inventory, health, weather
	bool ClientCond(PlayerBase p, DSCond c)
	{
		string k = c.kind;
		if (k == "var" || k == "uptime")
			return true;            // server-only; the server checks it again anyway
		if (!m_Journal)
			return true;            // nothing received yet: do not block
		if (k == "rep" || k == "reptier")
		{
			DSJRep jr = m_Journal.Rep(c.var);
			if (!jr)
				return false;
			if (k == "rep")
				return Cmp(jr.v, c.op, c.value);
			return jr.tier == c.stat;
		}
		if (k == "pvar")
		{
			DSJStat st = m_Journal.Stat(c.var);
			float v = 0;
			if (st)
				v = st.v;
			return Cmp(v, c.op, c.value);
		}
		if (k == "quest_done" || k == "quest_active" || k == "quest_new")
		{
			int status = 0;
			for (int i = 0; i < m_Journal.quests.Count(); i++)
			{
				if (m_Journal.quests.Get(i).id == c.quest)
					status = m_Journal.quests.Get(i).status;
			}
			if (k == "quest_done")
				return status == 2;
			if (k == "quest_active")
				return status == 1;
			return status == 0;
		}
		return CondRaw(p, null, c);
	}

	// ---------------- usable objects ("Use Object" trigger / objective) ----------------
	void CollectUses()
	{
		m_UseInfo.Clear();
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			for (int j = 0; j < q.nodes.Count(); j++)
			{
				DSNode n = q.nodes.Get(j);
				if (n.type != "trg_object" && n.type != "obj_use")
					continue;
				DSUseInfo u = new DSUseInfo();
				u.quest = q.id;
				u.node = n.id;
				u.prompt = n.prompt;
				if (u.prompt == "")
					u.prompt = "Use";
				u.x = n.x;
				u.y = GroundPos(n.x, n.y, n.z)[1];
				u.z = n.z;
				u.radius = n.radius;
				if (u.radius < 1.5)
					u.radius = 1.5;
				m_UseInfo.Insert(u);
			}
		}
	}

	// can this player use node n of quest q right now?
	bool UseReady(DSPlayerData data, DSQuest q, DSNode n)
	{
		if (n.type == "trg_object")
			return TalkState(data, q) == "offer";
		DSQuestState qs = data.FindQuest(q.id);
		if (!qs || qs.status != 1)
			return false;
		return qs.Node(n.id).status == 1;
	}

	// server: the player pressed F on a usable object
	void ServerUse(PlayerBase p, string questId, string nodeId)
	{
		if (!m_Ready || !p)
			return;
		DSQuest q = FindQuestById(questId);
		if (!q)
			return;
		DSNode n = FindNode(q, nodeId);
		if (!n || (n.type != "trg_object" && n.type != "obj_use"))
			return;
		if (Dist2D(p.GetPosition(), n.x, n.z) > n.radius + 4)
			return;
		DSPlayerData data = GetData(p);
		if (!data || !UseReady(data, q, n))
			return;
		string title = n.prompt;
		if (title == "")
			title = q.name;
		if (!CondOk(p, data, n.cond))
		{
			string why = n.text;
			if (why == "")
				why = "You can't do that yet.";
			Notify(p, title, why, false);
			return;
		}
		// pay with the required item (e.g. a key) when asked to
		if (n.flag && n.cond && n.cond.kind == "has_item")
		{
			int need = n.cond.n;
			if (need < 1)
				need = 1;
			RemoveItems(p, n.cond.cls, need);
		}
		if (n.removeObj && n.cls != "")
		{
			array<Object> near = new array<Object>;
			GetGame().GetObjectsAtPosition(Vector(n.x, n.y, n.z), 2.5, near, null);
			for (int i = 0; i < near.Count(); i++)
			{
				if (near.Get(i) && near.Get(i).GetType() == n.cls)
				{
					GetGame().ObjectDelete(near.Get(i));
					break;
				}
			}
		}
		if (n.okText != "")
			Notify(p, title, n.okText, false);
		DSQuestState qs = data.GetQuest(q.id);
		if (n.type == "trg_object")
			StartQuest(p, data, q, qs, n);
		else
			CompleteNode(p, data, q, qs, n, 0);
		m_JournalLast.Remove(data.id);   // usable objects changed
	}

	// quest chains: every required quest has been completed at least once
	bool PrereqsMet(DSPlayerData data, DSQuest q)
	{
		if (q.avail && q.avail.kind != "" && !CondOk(null, data, q.avail))
			return false;   // server-wide condition (variable / time / weather)
		if (!q.requires)
			return true;
		for (int i = 0; i < q.requires.Count(); i++)
		{
			DSQuestState rs = data.FindQuest(q.requires.Get(i));
			if (!rs || !rs.EverDone())
				return false;
		}
		return true;
	}

	bool CheckTrigger(PlayerBase p, DSPlayerData data, DSNode n)
	{
		float session = m_Session.Get(data.id);
		if (n.type == "start")
			return session >= n.seconds;
		if (n.type == "trg_npc")
			return false;   // started from the conversation (interact key), see ServerAccept
		if (n.type == "trg_zone")
			return Dist2D(p.GetPosition(), n.x, n.z) <= n.radius;
		if (n.type == "trg_item")
			return CountItems(p, n.cls) >= n.count;
		if (n.type == "trg_cond")
			return CondOk(p, data, n.cond);
		if (n.type == "trg_object")
			return false;   // started by using the object (F), see ServerUse
		if (n.type == "trg_time")
		{
			if (n.mode == "hour")
			{
				int yr, mo, dy, hr, mi;
				GetGame().GetWorld().GetDate(yr, mo, dy, hr, mi);
				return hr == (int)n.amount;
			}
			return session >= n.seconds;
		}
		return false;
	}

	void StartQuest(PlayerBase p, DSPlayerData data, DSQuest q, DSQuestState qs, DSNode trigger)
	{
		qs.Reset();
		qs.status = 1;
		DSNodeState ts = qs.Node(trigger.id);
		ts.status = 2;

		string msg = q.description;
		if (trigger.text != "" && trigger.type != "trg_npc" && trigger.type != "trg_object")   // trg_object: text is the "locked" message
			msg = trigger.text;
		Notify(p, "New quest: " + q.name, msg, true);

		for (int i = 0; i < trigger.next.Count(); i++)
		{
			DSNode nx = FindNode(q, trigger.next.Get(i));
			if (nx)
				ActivateNode(p, data, q, qs, nx, 0);
		}
		SaveData(data);   // after the first objectives are active, so a server crash cannot leave the quest without any
	}

	// a running quest with nothing active (old saves, or a crash between two saves): wake up what follows the finished steps
	void Repair(PlayerBase p, DSPlayerData data, DSQuest q, DSQuestState qs)
	{
		for (int i = 0; i < q.nodes.Count(); i++)
		{
			if (qs.Node(q.nodes.Get(i).id).status == 1)
				return;
		}
		int woke = 0;
		for (int j = 0; j < q.nodes.Count() && qs.status == 1; j++)
		{
			DSNode d = q.nodes.Get(j);
			if (qs.Node(d.id).status != 2)
				continue;
			for (int k = 0; k < d.next.Count(); k++)
			{
				DSNode nx = FindNode(q, d.next.Get(k));
				if (nx && qs.Node(nx.id).status == 0)
				{
					ActivateNode(p, data, q, qs, nx, 0);
					woke++;
				}
			}
		}
		if (woke == 0)
			return;
		Print("[DZStudio] Repaired quest " + q.name + " for " + data.id);
		SaveData(data);
	}

	// periodic save of everyone online (kill counts, timers) and on server shutdown
	void SaveAll()
	{
		for (int i = 0; i < m_Players.Count(); i++)
			SaveData(m_Players.GetElement(i));
	}

	void ActivateNode(PlayerBase p, DSPlayerData data, DSQuest q, DSQuestState qs, DSNode n, int depth)
	{
		if (depth > 24)
			return;
		DSNodeState ns = qs.Node(n.id);

		if (n.type == "logic_join")
		{
			ns.progress += 1;
			if (ns.progress < CountIncoming(q, n.id))
				return;
			ns.progress = 0;
		}
		else
		{
			if (ns.status != 0)
				return;
			ns.progress = 0;
		}

		ns.status = 1;

		if (IsObjectiveType(n.type))
		{
			string label = n.title;
			if (label == "")
				label = n.type;
			if (n.optional)
				Notify(p, "Bonus objective", label, false);
			else
				Notify(p, "Objective", label, false);
			p.MessageStatus("[Quest] " + q.name + " - " + label);
			return;
		}
		if (n.type == "logic_delay" || n.type == "logic_wait")
			return;

		// instant nodes
		RunInstant(p, q, n);
		CompleteNode(p, data, q, qs, n, depth + 1);
	}

	void CompleteNode(PlayerBase p, DSPlayerData data, DSQuest q, DSQuestState qs, DSNode n, int depth)
	{
		DSNodeState ns = qs.Node(n.id);
		ns.status = 2;

		if (n.type == "end")
		{
			qs.status = 2;
			qs.doneAt = data.play;
			qs.times++;
			string t = n.text;
			if (t == "")
				t = "Quest complete!";
			Notify(p, q.name, t, true);
			SaveData(data);
			return;
		}

		for (int i = 0; i < n.next.Count(); i++)
		{
			DSNode nx = FindNode(q, n.next.Get(i));
			if (nx)
				ActivateNode(p, data, q, qs, nx, depth);
		}
		SaveData(data);
	}

	void TickNode(PlayerBase p, DSPlayerData data, DSQuest q, DSQuestState qs, DSNode n, DSNodeState ns, float step)
	{
		if (n.type == "obj_travel")
		{
			if (Dist2D(p.GetPosition(), n.x, n.z) <= n.radius)
				CompleteNode(p, data, q, qs, n, 0);
		}
		else if (n.type == "obj_collect")
		{
			if (CountItems(p, n.cls) >= n.count)
			{
				if (n.flag)
					RemoveItems(p, n.cls, n.count);
				CompleteNode(p, data, q, qs, n, 0);
			}
		}
		else if (n.type == "obj_deliver")
		{
			if (Dist2D(p.GetPosition(), n.x, n.z) <= n.radius && CountItems(p, n.cls) >= n.count)
			{
				RemoveItems(p, n.cls, n.count);
				CompleteNode(p, data, q, qs, n, 0);
			}
		}
		else if (n.type == "obj_cond" || n.type == "logic_wait")
		{
			if (CondOk(p, data, n.cond))
				CompleteNode(p, data, q, qs, n, 0);
		}
		else if (n.type == "obj_survive" || n.type == "logic_delay")
		{
			ns.progress += step;
			if (ns.progress >= n.seconds)
				CompleteNode(p, data, q, qs, n, 0);
		}
		else if (n.type == "obj_kill")
		{
			if (ns.progress >= n.count)
				CompleteNode(p, data, q, qs, n, 0);
		}
		else if (n.type.IndexOf("cno_") == 0)
		{
			// custom check node (Studio ▸ Custom nodes): done when its code returns true
			if (DSCustom.CheckNode(n.type, p, Vector(n.x, n.y, n.z), n.args))
				CompleteNode(p, data, q, qs, n, 0);
		}
	}

	// ---------------- instant node actions ----------------
	void RunInstant(PlayerBase p, DSQuest q, DSNode n)
	{
		if (n.type == "act_pvar")
		{
			DSPlayerData sdata = GetData(p);
			if (sdata)
				SetStat(p, sdata, n.var, n.varOp, n.varValue, n.text);
		}
		else if (n.type == "act_fx")
		{
			// effects remember their switch in a server variable, so it survives restarts
			SetVar("fx_" + n.var, "set", n.varValue);
		}
		else if (n.type == "act_setvar")
		{
			SetVar(n.var, n.varOp, n.varValue);
			if (n.text != "")
				Notify(p, q.name, n.text, true);
		}
		else if (n.type == "rew_notify")
		{
			Notify(p, n.title, n.text, n.flag);
		}
		else if (n.type == "rew_item")
		{
			for (int i = 0; i < n.items.Count(); i++)
				GiveItem(p, n.items.Get(i).c, n.items.Get(i).n);
		}
		else if (n.type == "rew_crate")
		{
			vector pos = GroundPos(n.x, n.y, n.z);
			Object o = GetGame().CreateObject(n.cls, pos);
			EntityAI crate = EntityAI.Cast(o);
			if (crate)
			{
				for (int j = 0; j < n.items.Count(); j++)
				{
					DSItem it = n.items.Get(j);
					if (Math.RandomFloat01() > it.chance)
						continue;
					int amt = it.n;
					if (amt > 20)
						amt = 20;
					for (int a = 0; a < amt; a++)
						crate.GetInventory().CreateInInventory(it.c);
				}
				if (n.seconds > 0)
					GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(DSQuests.DeleteObj, n.seconds * 1000, false, o);
			}
			if (n.text != "")
				Notify(p, q.name, n.text, true);
		}
		else if (n.type == "rew_modifier")
		{
			ApplyStat(p, n.stat, n.amount);
		}
		else if (n.type == "rew_spawn")
		{
			for (int s = 0; s < n.count; s++)
			{
				float px = n.x + Math.RandomFloat(-n.radius, n.radius);
				float pz = n.z + Math.RandomFloat(-n.radius, n.radius);
				vector sp = GroundPos(px, n.y, pz);
				GetGame().CreateObject(n.cls, sp, false, true);
			}
			if (n.text != "")
				Notify(p, q.name, n.text, true);
		}
		else if (n.type == "rew_script")
		{
			DSCustom.Run(n.id, p, Vector(n.x, n.y, n.z));
		}
		else if (n.type == "act_rep")
		{
			DSPlayerData repData = GetData(p);
			if (repData)
			{
				int repAmount = n.varValue;
				if (n.varOp == "sub")
					repAmount = -repAmount;
				else if (n.varOp == "set")
					repAmount = n.varValue - RepVal(repData, n.var);
				ChangeRepData(p, repData, n.var, repAmount, n.flag, n.text, true);
				SaveData(repData);
			}
		}
		else if (n.type.IndexOf("cna_") == 0)
		{
			// custom action node (Studio ▸ Custom nodes)
			DSCustom.RunNode(n.type, p, Vector(n.x, n.y, n.z), n.args);
		}
	}

	void ApplyStat(PlayerBase p, string stat, float amount)
	{
		if (stat == "heal")
		{
			p.SetHealth("", "", p.GetMaxHealth("", ""));
			p.SetHealth("", "Blood", p.GetMaxHealth("", "Blood"));
			p.SetHealth("", "Shock", p.GetMaxHealth("", "Shock"));
			p.GetBleedingManagerServer().RemoveAllSources();
		}
		else if (stat == "health")
			p.AddHealth("", "Health", amount);
		else if (stat == "blood")
			p.AddHealth("", "Blood", amount);
		else if (stat == "shock")
			p.AddHealth("", "Shock", amount);
		else if (stat == "water")
			p.GetStatWater().Add(amount);
		else if (stat == "energy")
			p.GetStatEnergy().Add(amount);
	}

	void GiveItem(PlayerBase p, string cls, int amount)
	{
		if (cls == "")
			return;
		// splittable items (dollar bills, rags, nails ...): the amount is the quantity, in stacks of up to their maximum
		int maxQ = GetGame().ConfigGetInt("CfgVehicles " + cls + " varQuantityMax");
		if (GetGame().ConfigGetInt("CfgVehicles " + cls + " canBeSplit") == 1 && maxQ > 1)
		{
			int left = amount;
			int guard = 0;
			while (left > 0 && guard < 50)
			{
				guard++;
				EntityAI se = p.GetInventory().CreateInInventory(cls);
				if (!se)
					se = EntityAI.Cast(GetGame().CreateObject(cls, p.GetPosition()));
				ItemBase sib = ItemBase.Cast(se);
				if (!sib)
					return;
				int q = left;
				if (q > maxQ)
					q = maxQ;
				sib.SetQuantity(q);
				left = left - q;
			}
			return;
		}
		if (amount > 30)
			amount = 30;
		for (int i = 0; i < amount; i++)
		{
			EntityAI e = p.GetInventory().CreateInInventory(cls);
			if (!e)
				e = EntityAI.Cast(GetGame().CreateObject(cls, p.GetPosition()));
			Magazine mag = Magazine.Cast(e);
			if (mag && mag.IsAmmoPile() && amount > 1)
			{
				mag.ServerSetAmmoCount(amount);
				return;
			}
		}
	}

	// ---------------- inventory ----------------
	// onlySellable: skip what a trader shouldn't take (ruined, worn, or holding other items) - see Sellable
	int CountItems(PlayerBase p, string cls, bool onlySellable = false)
	{
		if (cls == "")
			return 0;
		array<EntityAI> all = new array<EntityAI>;
		p.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, all);
		int total = 0;
		for (int i = 0; i < all.Count(); i++)
		{
			EntityAI e = all.Get(i);
			if (!e || e == p || !e.IsKindOf(cls))
				continue;
			if (onlySellable && !Sellable(p, e))
				continue;
			Magazine m = Magazine.Cast(e);
			ItemBase ib = ItemBase.Cast(e);
			if (m && m.IsAmmoPile())
				total += m.GetAmmoCount();
			else if (ib && StackCount(ib) > 0)
				total += StackCount(ib);
			else
				total++;
		}
		return total;
	}

	// pieces in a stack of a splittable item (rags, nails, bandages ...), 0 for everything else
	static int StackCount(ItemBase ib)
	{
		if (!ib || !ib.ConfigGetBool("canBeSplit"))
			return 0;
		return (int)Math.Round(ib.GetQuantity());
	}

	void RemoveItems(PlayerBase p, string cls, int amount, bool onlySellable = false)
	{
		array<EntityAI> all = new array<EntityAI>;
		p.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, all);
		int left = amount;
		for (int i = 0; i < all.Count() && left > 0; i++)
		{
			EntityAI e = all.Get(i);
			if (!e || e == p || !e.IsKindOf(cls))
				continue;
			if (onlySellable && !Sellable(p, e))
				continue;
			Magazine m = Magazine.Cast(e);
			if (m && m.IsAmmoPile())
			{
				int c = m.GetAmmoCount();
				if (c <= left)
				{
					left -= c;
					GetGame().ObjectDelete(e);
				}
				else
				{
					m.ServerSetAmmoCount(c - left);
					left = 0;
				}
			}
			else if (StackCount(ItemBase.Cast(e)) > 0)
			{
				ItemBase ib = ItemBase.Cast(e);
				int q = StackCount(ib);
				if (q <= left)
				{
					left -= q;
					GetGame().ObjectDelete(e);
				}
				else
				{
					ib.SetQuantity(q - left);
					left = 0;
				}
			}
			else
			{
				left--;
				GetGame().ObjectDelete(e);
			}
		}
	}

	// ---------------- events from game hooks ----------------
	PlayerBase ResolveKiller(Object killer)
	{
		if (!killer)
			return null;
		PlayerBase pb = PlayerBase.Cast(killer);
		if (pb)
			return pb;
		EntityAI ent = EntityAI.Cast(killer);
		if (ent)
			return PlayerBase.Cast(ent.GetHierarchyRootPlayer());
		return null;
	}

	bool MatchesKill(DSNode n, Object victim)
	{
		if (n.classes.Count() == 0)
			return ZombieBase.Cast(victim) != null;
		for (int i = 0; i < n.classes.Count(); i++)
		{
			if (MatchCls(n.classes.Get(i), victim))
				return true;
		}
		return false;
	}

	// "@infected", "@animal", "@player" or a class name (inherited classes count)
	bool MatchCls(string c, Object victim)
	{
		if (c == "" || !victim)
			return false;
		if (c == "@infected")
			return ZombieBase.Cast(victim) != null;
		if (c == "@animal")
			return AnimalBase.Cast(victim) != null;
		if (c == "@player")
		{
			PlayerBase vp = PlayerBase.Cast(victim);
			if (!vp)
				return false;
			return m_NpcObjs.Find(vp) < 0;
		}
		if (c.Substring(0, 1) == "@")
			return false;
		return victim.IsKindOf(c);
	}

	void OnKill(Object victim, Object killer)
	{
		if (!m_Ready || !victim)
			return;
		PlayerBase p = ResolveKiller(killer);
		if (!p || p == victim)
			return;
		if (m_NpcObjs.Find(p) >= 0)
			return;   // a hostile faction NPC shot someone: NPCs keep no score
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		RepOnKill(p, data, victim);

		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			DSQuestState qs = data.FindQuest(q.id);
			if (!qs || qs.status != 1)
				continue;
			for (int j = 0; j < q.nodes.Count(); j++)
			{
				DSNode n = q.nodes.Get(j);
				if (n.type != "obj_kill")
					continue;
				DSNodeState ns = qs.Node(n.id);
				if (ns.status != 1 || !MatchesKill(n, victim))
					continue;
				if (n.flag && Dist2D(victim.GetPosition(), n.x, n.z) > n.radius)
					continue;
				ns.progress += 1;
				int done = ns.progress;
				p.MessageStatus("[Quest] " + q.name + ": " + done + "/" + n.count);
				if (ns.progress >= n.count)
					CompleteNode(p, data, q, qs, n, 0);
				else
					SaveData(data);
			}
		}
	}

	void OnPlayerDeath(PlayerBase p)
	{
		if (!m_Ready || !p)
			return;
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			DSQuestState qs = data.FindQuest(q.id);
			if (qs && qs.status == 1 && q.failOnDeath)
				qs.Reset();
		}
		// stats that reset on death go back to their start value
		for (int s = 0; s < m_File.stats.Count(); s++)
		{
			DSStatDef sd = m_File.stats.Get(s);
			if (!sd.resetOnDeath)
				continue;
			DSGVar v = data.FindStat(sd.id);
			if (v)
				data.stats.RemoveItem(v);
		}
		SaveData(data);
	}

	// ======================= journal / tracker =======================
	bool IsObjectiveType(string t)
	{
		if (t.IndexOf("cno_") == 0)
			return true;
		return t == "obj_kill" || t == "obj_travel" || t == "obj_collect" || t == "obj_deliver" || t == "obj_survive" || t == "obj_cond" || t == "obj_use";
	}

	string ObjectiveLabel(DSNode n)
	{
		if (n.title != "")
			return n.title;
		if (n.type == "obj_kill")
			return "Kill " + n.count + " targets";
		if (n.type == "obj_travel")
			return "Travel to the marked location";
		if (n.type == "obj_collect")
			return "Collect " + n.count + " x " + n.cls;
		if (n.type == "obj_deliver")
			return "Deliver " + n.count + " x " + n.cls;
		return "Survive for " + (int)n.seconds + " seconds";
	}

	void SendJournal(PlayerBase p, DSPlayerData data)
	{
		DSJournal jn = new DSJournal();
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			DSQuest q = m_File.quests.Get(i);
			DSQuestState qs = data.FindQuest(q.id);
			if (!qs || qs.status == 0)
				continue;
			DSJQuest jq = new DSJQuest();
			jq.id = q.id;
			jq.name = q.name;
			jq.description = q.description;
			jq.status = qs.status;
			for (int a = 0; a < q.nodes.Count(); a++)
			{
				DSNode t = q.nodes.Get(a);
				if (t.type == "trg_npc")
					jq.canAbandon = true;
			}
			for (int j = 0; j < q.nodes.Count(); j++)
			{
				DSNode n = q.nodes.Get(j);
				if (!IsObjectiveType(n.type))
					continue;
				DSNodeState ns = qs.Node(n.id);
				if (ns.status == 0 && qs.status == 1)
					continue;    // objectives that were not reached yet stay hidden
				if (n.optional && ns.status == 0)
					continue;    // a bonus the player never got to
				DSJObjective jo = new DSJObjective();
				jo.text = ObjectiveLabel(n);
				jo.optional = n.optional;
				jo.done = false;
				jo.missed = false;
				if (ns.status == 2)
					jo.done = true;
				else if (qs.status == 2)
				{
					if (n.optional)
						jo.missed = true;   // bonus not done when the quest was finished
					else
						jo.done = true;
				}
				if (n.type == "obj_kill")
				{
					jo.target = n.count;
					jo.progress = ns.progress;
					if (n.flag && !n.nomark)
					{
						jo.hasPos = true;
						jo.x = n.x;
						jo.z = n.z;
					}
				}
				else if (n.type == "obj_survive")
				{
					jo.target = n.seconds;
					jo.progress = ns.progress;
				}
				else if (n.type == "obj_collect" || n.type == "obj_deliver")
				{
					jo.target = n.count;
					jo.progress = CountItems(p, n.cls);
					if (n.type == "obj_deliver" && !n.nomark)
					{
						jo.hasPos = true;
						jo.x = n.x;
						jo.z = n.z;
					}
				}
				else if (n.type == "obj_use")
				{
					jo.target = 1;
					jo.hasPos = !n.nomark;
					jo.x = n.x;
					jo.z = n.z;
				}
				else if (n.type == "obj_travel")
				{
					jo.target = 1;
					jo.hasPos = !n.nomark;
					jo.x = n.x;
					jo.z = n.z;
				}
				if (jo.target > 0 && jo.progress > jo.target)
					jo.progress = jo.target;
				if (jo.done && jo.target > 0)
					jo.progress = jo.target;
				jq.objectives.Insert(jo);
			}
			jn.quests.Insert(jq);
		}
		// the player's stats
		for (int st = 0; st < m_File.stats.Count(); st++)
		{
			DSStatDef sd = m_File.stats.Get(st);
			DSJStat js1 = new DSJStat();
			js1.id = sd.id;
			js1.name = sd.name;
			js1.v = StatVal(data, sd.id);
			js1.min = sd.min;
			js1.max = sd.max;
			js1.sheet = sd.sheet;
			js1.color = sd.color;
			jn.stats.Insert(js1);
		}
		// faction standings
		for (int jFr = 0; jFr < m_Fac.factions.Count(); jFr++)
		{
			DSFaction jFac = m_Fac.factions.Get(jFr);
			DSJRep jRep = new DSJRep();
			jRep.id = jFac.id;
			jRep.name = jFac.name;
			jRep.v = RepVal(data, jFac.id);
			jRep.min = m_Fac.min;
			jRep.max = m_Fac.max;
			jRep.color = jFac.color;
			DSTier jTier = TierOf(jRep.v);
			if (jTier)
			{
				jRep.tier = jTier.id;
				jRep.tierName = jTier.name;
				jRep.tierColor = jTier.color;
			}
			jn.reps.Insert(jRep);
		}
		// objects this player can use right now
		for (int uq = 0; uq < m_File.quests.Count(); uq++)
		{
			DSQuest uqq = m_File.quests.Get(uq);
			for (int un = 0; un < uqq.nodes.Count(); un++)
			{
				DSNode unn = uqq.nodes.Get(un);
				if ((unn.type == "trg_object" || unn.type == "obj_use") && UseReady(data, uqq, unn))
					jn.uses.Insert(uqq.id + "|" + unn.id);
			}
		}
		// quest givers with something to offer this player right now
		for (int g = 0; g < m_NpcInfo.Count(); g++)
		{
			DSNpcInfo gi = m_NpcInfo.Get(g);
			DSQuest gq = FindQuestById(gi.quest);
			if (!gq)
				continue;
			DSNode gn = FindNode(gq, gi.node);
			if (!gn || gn.nomark || TalkState(data, gq) != "offer")
				continue;
			bool dup = false;
			for (int m = 0; m < jn.givers.Count(); m++)
			{
				if (Math.AbsFloat(jn.givers.Get(m).x - gi.x) < 1.5 && Math.AbsFloat(jn.givers.Get(m).z - gi.z) < 1.5)
					dup = true;
			}
			if (dup)
				continue;
			DSJMark mk = new DSJMark();
			mk.name = gi.name;
			mk.x = gi.x;
			mk.z = gi.z;
			jn.givers.Insert(mk);
		}
		string json;
		JsonSerializer js = new JsonSerializer();
		js.WriteToString(jn, false, json);
		string last;
		if (m_JournalLast.Find(data.id, last) && last == json)
			return;
		m_JournalLast.Set(data.id, json);
		SendToClient(p, DSQ_RPC_JOURNAL, json);
		if (m_Debug)
		{
			FileHandle jf = OpenFile(ROOT + "/journal_last.json", FileMode.WRITE);   // play-test: what the player was sent
			if (jf)
			{
				FPrintln(jf, json);
				CloseFile(jf);
			}
		}
	}

	void ServerAbandon(PlayerBase p, string questId)
	{
		if (!m_Ready || !p)
			return;
		DSQuest q = FindQuestById(questId);
		if (!q)
			return;
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		DSQuestState qs = data.GetQuest(q.id);
		if (qs.status != 1)
			return;
		bool viaNpc = false;
		for (int i = 0; i < q.nodes.Count(); i++)
		{
			if (q.nodes.Get(i).type == "trg_npc")
				viaNpc = true;
		}
		if (!viaNpc)
			return;     // automatic quests would simply start again
		qs.Reset();
		SaveData(data);
		Notify(p, "Quest abandoned", q.name, false);
		m_JournalLast.Remove(data.id);
	}

	// ======================= NPC conversations =======================
	DSQuest FindQuestById(string questId)
	{
		for (int i = 0; i < m_File.quests.Count(); i++)
		{
			if (m_File.quests.Get(i).id == questId)
				return m_File.quests.Get(i);
		}
		return null;
	}

	// ======================= traders & money =======================
	void LoadTrade()
	{
		m_Trade = new DSTradeFile();
		m_Stock = new map<string, ref array<int>>;
		string path = ROOT + "/trade.json";
		if (FileExist(path))
			JsonFileLoader<DSTradeFile>.JsonLoadFile(path, m_Trade);
		for (int i = 0; i < m_Trade.traders.Count(); i++)
		{
			DSTrader tr = m_Trade.traders.Get(i);
			array<int> stockLeft = new array<int>;
			for (int j = 0; j < tr.items.Count(); j++)
				stockLeft.Insert(tr.items.Get(j).stock);
			m_Stock.Set(tr.id, stockLeft);
		}
		if (m_Trade.traders.Count() > 0)
			Print("[DZStudio] Traders: " + m_Trade.traders.Count() + ", currencies: " + m_Trade.currencies.Count());
	}

	DSTrader FindTrader(string id)
	{
		if (!m_Trade)
			return null;
		for (int i = 0; i < m_Trade.traders.Count(); i++)
		{
			if (m_Trade.traders.Get(i).id == id)
				return m_Trade.traders.Get(i);
		}
		return null;
	}

	DSCurrency FindCurrency(string id)
	{
		if (!m_Trade)
			return null;
		for (int i = 0; i < m_Trade.currencies.Count(); i++)
		{
			if (m_Trade.currencies.Get(i).id == id)
				return m_Trade.currencies.Get(i);
		}
		if (m_Trade.currencies.Count() > 0)
			return m_Trade.currencies.Get(0);
		return null;
	}

	// 1250 -> "1,250"
	static string Thousands(int v)
	{
		string sign = "";
		int a = v;
		if (a < 0)
		{
			sign = "-";
			a = -a;
		}
		string digits = a.ToString();
		string res = "";
		int cnt = 0;
		for (int i = digits.Length() - 1; i >= 0; i--)
		{
			res = digits.Get(i) + res;
			cnt++;
			if (cnt % 3 == 0 && i > 0)
				res = "," + res;
		}
		return sign + res;
	}

	static string MoneyText(DSCurrency cur, int v)
	{
		if (!cur)
			return Thousands(v);
		if (cur.symbol != "")
			return cur.symbol + Thousands(v);
		return Thousands(v) + " " + cur.name;
	}

	int Money(PlayerBase p, DSPlayerData data, DSCurrency cur)
	{
		if (!cur)
			return 0;
		if (cur.kind == "stat")
			return (int)StatVal(data, cur.stat);
		int total = 0;
		for (int i = 0; i < cur.items.Count(); i++)
			total += CountItems(p, cur.items.Get(i).c) * cur.items.Get(i).value;
		return total;
	}

	// pay out an amount: a stat goes up, or bills are handed over - the largest that fit first
	void Earn(PlayerBase p, DSPlayerData data, DSCurrency cur, int amount)
	{
		if (!cur || amount <= 0)
			return;
		if (cur.kind == "stat")
		{
			SetStat(p, data, cur.stat, "add", amount, "");
			return;
		}
		int rest = amount;
		for (int i = 0; i < cur.items.Count(); i++)
		{
			DSCurrencyItem ci = cur.items.Get(i);
			if (ci.value <= 0)
				continue;
			int k = rest / ci.value;
			if (k > 0)
			{
				GiveItem(p, ci.c, k);
				rest = rest - k * ci.value;
			}
		}
	}

	// take an amount: the largest bills that fit first; what is still missing is paid with one bigger bill and the
	// change comes back. False (nothing taken) when the player doesn't have enough.
	bool Pay(PlayerBase p, DSPlayerData data, DSCurrency cur, int amount)
	{
		if (amount <= 0)
			return true;
		if (!cur || Money(p, data, cur) < amount)
			return false;
		if (cur.kind == "stat")
		{
			SetStat(p, data, cur.stat, "sub", amount, "");
			return true;
		}
		int cnt = cur.items.Count();
		array<int> have = new array<int>;
		array<int> take = new array<int>;
		int rest = amount;
		for (int i = 0; i < cnt; i++)
		{
			DSCurrencyItem ci = cur.items.Get(i);
			int h = CountItems(p, ci.c);
			have.Insert(h);
			int k = 0;
			if (ci.value > 0)
				k = rest / ci.value;
			if (k > h)
				k = h;
			take.Insert(k);
			rest = rest - k * ci.value;
		}
		int change = 0;
		if (rest > 0)
		{
			for (int j = cnt - 1; j >= 0; j--)
			{
				DSCurrencyItem cj = cur.items.Get(j);
				if (cj.value >= rest && have.Get(j) - take.Get(j) > 0)
				{
					take.Set(j, take.Get(j) + 1);
					change = cj.value - rest;
					rest = 0;
					break;
				}
			}
		}
		if (rest > 0)
			return false;
		for (int m = 0; m < cnt; m++)
		{
			if (take.Get(m) > 0)
				RemoveItems(p, cur.items.Get(m).c, take.Get(m));
		}
		if (change > 0)
			Earn(p, data, cur, change);
		return true;
	}

	// what a trader may take: not ruined, not worn (the item in the hands is fine), not holding other items
	// (a full backpack or a rifle with a magazine is not sold together with its contents)
	bool Sellable(PlayerBase p, EntityAI e)
	{
		if (!e || e == p || e.IsRuined())
			return false;
		if (e.GetHierarchyParent() == p && p.GetHumanInventory().GetEntityInHands() != e)
			return false;
		array<EntityAI> inner = new array<EntityAI>;
		e.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, inner);
		if (inner.Count() > 1)
			return false;
		return true;
	}

	static string TradeName(DSTradeItem it)
	{
		if (it.name != "")
			return it.name;
		return ItemName(it.c);
	}

	// server: the trader screen. questId + "open|node", "buy|node|row|qty" or "sell|node|row|qty"
	void ServerTrade(PlayerBase p, string questId, string cmd)
	{
		if (!m_Ready || !p || !m_Trade)
			return;
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		TStringArray parts = new TStringArray;
		cmd.Split("|", parts);
		if (parts.Count() < 2)
			return;
		DSQuest q = FindQuestById(questId);
		if (!q)
			return;
		DSNode n = FindNode(q, parts.Get(1));
		if (!n || n.trader == "" || !NearNpc(p, q, n, 6))
			return;
		DSTier tier = NpcTier(data, n);
		if (tier && tier.stance == "hostile")
			return;
		DSTrader tr = FindTrader(n.trader);
		if (!tr)
			return;
		DSCurrency cur = FindCurrency(tr.currency);
		int disc = TierDiscount(data, n);
		string act = parts.Get(0);
		string msg = "";
		bool good = true;
		if (parts.Count() >= 4)
		{
			int row = parts.Get(2).ToInt();
			int qty = parts.Get(3).ToInt();
			if (qty < 1)
				qty = 1;
			if (qty > 10)
				qty = 10;
			if (row < 0 || row >= tr.items.Count())
				return;
			DSTradeItem it = tr.items.Get(row);
			array<int> stock = m_Stock.Get(tr.id);
			string label = TradeName(it);
			int per = it.n;
			if (per < 1)
				per = 1;
			if (act == "buy")
			{
				int price = Discounted(it.buy, disc);
				if (stock && stock.Get(row) >= 0 && stock.Get(row) < qty)
					qty = stock.Get(row);
				if (it.buy <= 0)
				{
					msg = "That is not for sale.";
					good = false;
				}
				else if (it.need && it.need.kind != "" && !CondOk(p, data, it.need))
				{
					msg = it.needText;
					if (msg == "")
						msg = "You can't buy that yet.";
					good = false;
				}
				else if (qty <= 0)
				{
					msg = label + " is sold out.";
					good = false;
				}
				else if (!Pay(p, data, cur, price * qty))
				{
					msg = "Not enough money - that costs " + MoneyText(cur, price * qty) + ".";
					good = false;
				}
				else
				{
					GiveItem(p, it.c, per * qty);
					if (stock && stock.Get(row) >= 0)
						stock.Set(row, stock.Get(row) - qty);
					msg = "Bought " + (per * qty) + "x " + label + " for " + MoneyText(cur, price * qty) + ".";
				}
			}
			else if (act == "sell")
			{
				int can = CountItems(p, it.c, true) / per;
				if (can < qty)
					qty = can;
				if (it.sell <= 0)
				{
					msg = "The trader doesn't buy that.";
					good = false;
				}
				else if (qty <= 0)
				{
					msg = "You have no " + label + " to sell (ruined, worn or full items don't count).";
					good = false;
				}
				else
				{
					RemoveItems(p, it.c, per * qty, true);
					Earn(p, data, cur, it.sell * qty);
					if (stock && stock.Get(row) >= 0)
						stock.Set(row, stock.Get(row) + qty);
					msg = "Sold " + (per * qty) + "x " + label + " for " + MoneyText(cur, it.sell * qty) + ".";
				}
			}
			SaveData(data);
			Say(msg);
		}
		SendTrade(p, data, q, n, tr, cur, disc, msg, good);
	}

	void SendTrade(PlayerBase p, DSPlayerData data, DSQuest q, DSNode n, DSTrader tr, DSCurrency cur, int disc, string msg, bool good)
	{
		DSTradePacket pk = new DSTradePacket();
		pk.quest = q.id;
		pk.node = n.id;
		pk.title = tr.name;
		if (pk.title == "")
			pk.title = n.title;
		int cash = Money(p, data, cur);
		pk.money = MoneyText(cur, cash);
		pk.disc = disc;
		DSTier t = NpcTier(data, n);
		if (t)
			pk.tier = t.name;
		pk.msg = msg;
		pk.good = good;
		array<int> stock = m_Stock.Get(tr.id);
		for (int i = 0; i < tr.items.Count(); i++)
		{
			DSTradeItem it = tr.items.Get(i);
			DSTradeRow r = new DSTradeRow();
			r.i = i;
			r.name = TradeName(it);
			r.cat = it.cat;
			r.n = it.n;
			if (r.n < 1)
				r.n = 1;
			r.stock = -1;
			if (stock)
				r.stock = stock.Get(i);
			int price = Discounted(it.buy, disc);
			if (it.buy > 0)
			{
				r.buy = MoneyText(cur, price);
				r.canBuy = cash >= price;
				if (r.stock == 0)
					r.canBuy = false;
				if (it.need && it.need.kind != "" && !CondOk(p, data, it.need))
				{
					r.canBuy = false;
					r.why = it.needText;
					if (r.why == "")
						r.why = "locked";
				}
			}
			if (it.sell > 0)
			{
				r.sell = MoneyText(cur, it.sell);
				r.have = CountItems(p, it.c, true) / r.n;
				r.canSell = r.have > 0;
			}
			pk.rows.Insert(r);
		}
		string json;
		JsonSerializer js = new JsonSerializer();
		js.WriteToString(pk, false, json);
		SendToClient(p, DSQ_RPC_TRADEUI, json);
	}

	void SendToClient(PlayerBase p, int rpc, string json)
	{
		if (!GetGame().IsMultiplayer())
		{
			ClientReceive(rpc, json);   // offline: server and client are the same process
			return;
		}
		if (!p || !p.GetIdentity())
			return;
		// one network string holds only about 1 KB: send long messages in pieces (reliable RPCs keep their order)
		int size = 800;
		int len = json.Length();
		int total = (len + size - 1) / size;
		if (total < 1)
			total = 1;
		for (int c = 0; c < total; c++)
		{
			int take = len - c * size;
			if (take > size)
				take = size;
			if (take < 0)
				take = 0;
			GetGame().RPCSingleParam(p, rpc, new Param3<int, int, string>(c, total, json.Substring(c * size, take)), true, p.GetIdentity());
		}
	}

	void SendToServer(int rpc, string a, string b)
	{
		PlayerBase me = PlayerBase.Cast(GetGame().GetPlayer());
		if (!me)
			return;
		if (!GetGame().IsMultiplayer())
		{
			if (rpc == DSQ_RPC_TALK)
				ServerTalk(me, a, b);
			else if (rpc == DSQ_RPC_ACCEPT)
				ServerAccept(me, a, b);
			else if (rpc == DSQ_RPC_ABANDON)
				ServerAbandon(me, a);
			else if (rpc == DSQ_RPC_OPTION)
				ServerOption(me, a, b);
			else if (rpc == DSQ_RPC_USE)
				ServerUse(me, a, b);
			else if (rpc == DSQ_RPC_TRADE)
				ServerTrade(me, a, b);
			return;
		}
		GetGame().RPCSingleParam(me, rpc, new Param2<string, string>(a, b), true);
	}

	void SendNpcList(PlayerBase p, string id)
	{
		if (!GetGame().IsMultiplayer() || !p || !p.GetIdentity())
			return;
		if (m_NpcSent.Contains(id))
			return;
		m_NpcSent.Set(id, true);
		DSNpcList list = new DSNpcList();
		for (int i = 0; i < m_NpcInfo.Count(); i++)
			list.npcs.Insert(m_NpcInfo.Get(i));
		for (int u = 0; u < m_UseInfo.Count(); u++)
			list.uses.Insert(m_UseInfo.Get(u));
		string json;
		JsonSerializer js = new JsonSerializer();
		js.WriteToString(list, false, json);
		SendToClient(p, DSQ_RPC_NPCS, json);
	}

	DSDialog DefaultDialog(DSQuest q, DSNode n, string state)
	{
		DSDialog d = new DSDialog();
		DSDlgLine ln = new DSDlgLine();
		ln.id = "d1";
		d.start = "d1";
		if (state == "offer")
		{
			ln.text = n.text;
			if (ln.text == "")
				ln.text = q.description;
			if (ln.text == "")
				ln.text = "Hey, survivor. I could use your help.";
			DSDlgOption yes = new DSDlgOption();
			yes.text = "I will help.";
			yes.accept = true;
			DSDlgOption no = new DSDlgOption();
			no.text = "Not right now.";
			ln.options.Insert(yes);
			ln.options.Insert(no);
		}
		else if (state == "active")
		{
			ln.text = "Still working on it? Come back when the job is done.";
			DSDlgOption ok = new DSDlgOption();
			ok.text = "I am on it.";
			ln.options.Insert(ok);
		}
		else if (state == "locked")
		{
			ln.text = "I have nothing for you right now. Come back later.";
			DSDlgOption later = new DSDlgOption();
			later.text = "Alright.";
			ln.options.Insert(later);
		}
		else
		{
			ln.text = "Thank you, survivor. I will not forget this.";
			DSDlgOption bye = new DSDlgOption();
			bye.text = "Take care.";
			ln.options.Insert(bye);
		}
		d.lines.Insert(ln);
		return d;
	}

	// what a quest NPC has to say about quest q to this player: offer | active | done | locked
	string TalkState(DSPlayerData data, DSQuest q)
	{
		DSQuestState qs = data.FindQuest(q.id);
		if (qs && qs.status == 1)
			return "active";
		if (qs && qs.status == 2 && !(q.repeatable && (data.play - qs.doneAt) >= q.cooldown))
			return "done";
		if (!PrereqsMet(data, q))
			return "locked";
		return "offer";
	}

	DSDialog DialogFor(DSQuest q, DSNode n, string state)
	{
		DSDialog dlg = n.offer;
		if (state == "active")
			dlg = n.active;
		else if (state == "done")
			dlg = n.done;
		else if (state == "locked")
			dlg = n.locked;
		if (!dlg || dlg.lines.Count() == 0)
			dlg = DefaultDialog(q, n, state);
		return dlg;
	}

	static string OptionKey(string questId, string nodeId, string state, string lineId, int idx)
	{
		return questId + "/" + nodeId + "/" + state + "/" + lineId + "/" + idx;
	}

	// may this player pick reply o (its condition holds and the items it takes are on them)?
	bool OptionOk(PlayerBase p, DSPlayerData data, DSDlgOption o, string key, int disc)
	{
		if (o.when && !CondOk(p, data, o.when))
			return false;
		if (o.take)
		{
			for (int i = 0; i < o.take.Count(); i++)
			{
				if (CountItems(p, o.take.Get(i).c) < Discounted(o.take.Get(i).n, disc))
					return false;
			}
		}
		// a gift without a price is handed out once per player
		if (o.give && o.give.Count() > 0 && (!o.take || o.take.Count() == 0) && data.used.Find(key) >= 0)
			return false;
		return true;
	}

	// server: the player pressed the interact key on a quest NPC.  Several quests can share one NPC (a quest chain);
	// the NPC then talks about the most relevant one: running > available > last finished > not available yet.
	void ServerTalk(PlayerBase p, string questId, string nodeId)
	{
		if (!m_Ready || !p)
			return;
		if (questId == "")
		{
			BrainTalk(p, nodeId);   // an NPC of the NPCs tab with a "Talked to" behaviour
			return;
		}
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		int at = -1;
		for (int g = 0; g < m_NpcInfo.Count(); g++)
		{
			if (m_NpcInfo.Get(g).quest == questId && m_NpcInfo.Get(g).node == nodeId)
				at = g;
		}
		DSQuest q = null;
		DSNode n = null;
		string state = "";
		if (at >= 0 && at < m_NpcObjs.Count() && m_NpcObjs.Get(at))
		{
			Object who = m_NpcObjs.Get(at);
			int rank = 0;
			float bestDone = -1;
			for (int c = 0; c < m_NpcInfo.Count() && c < m_NpcObjs.Count(); c++)
			{
				if (m_NpcObjs.Get(c) != who)
					continue;
				DSQuest cq = FindQuestById(m_NpcInfo.Get(c).quest);
				if (!cq)
					continue;
				DSNode cn = FindNode(cq, m_NpcInfo.Get(c).node);
				if (!cn)
					continue;
				string cst = TalkState(data, cq);
				int r = 1;
				if (cst == "active")
					r = 4;
				else if (cst == "offer")
					r = 3;
				else if (cst == "done")
					r = 2;
				DSQuestState cqs = data.FindQuest(cq.id);
				bool better = r > rank;
				if (r == rank && r == 2 && cqs && cqs.doneAt > bestDone)
					better = true;
				if (better)
				{
					rank = r;
					q = cq;
					n = cn;
					state = cst;
					if (cqs)
						bestDone = cqs.doneAt;
				}
			}
		}
		if (!q)
		{
			q = FindQuestById(questId);
			if (!q)
				return;
			n = FindNode(q, nodeId);
			state = TalkState(data, q);
		}
		if (!n || n.type != "trg_npc")
			return;
		if (!NearNpc(p, q, n, 4))
			return;
		// a faction NPC that sees this player as hostile won't talk
		DSTier talkTier = NpcTier(data, n);
		if (talkTier && talkTier.stance == "hostile")
		{
			string refuse = "Get lost. You're not welcome here.";
			DSFaction talkFac = Faction(n.faction);
			if (talkFac && talkFac.guard && talkFac.guard.refuseText != "")
				refuse = talkFac.guard.refuseText;
			Notify(p, n.title, refuse, false);
			return;
		}
		int disc = TierDiscount(data, n);
		DSQuestState qs = data.GetQuest(q.id);
		if (state == "offer" && qs.status == 2)
		{
			qs.Reset();   // repeatable quest whose cooldown is over
			SaveData(data);
		}

		DSDialog dlg = DialogFor(q, n, state);
		string normalStart = dlg.start;
		for (int ol = 0; ol < dlg.lines.Count(); ol++)
		{
			DSDlgLine cand = dlg.lines.Get(ol);
			if (cand.openIf && cand.openIf.kind != "" && CondOk(p, data, cand.openIf))
			{
				dlg.start = cand.id;   // e.g. "You're bleeding! Sit down." when the player is hurt
				break;
			}
		}
		for (int li = 0; li < dlg.lines.Count(); li++)
		{
			DSDlgLine dl = dlg.lines.Get(li);
			for (int oi = 0; oi < dl.options.Count(); oi++)
				dl.options.Get(oi).hide = !OptionOk(p, data, dl.options.Get(oi), OptionKey(q.id, n.id, state, dl.id, oi), disc);
		}
		m_Talk.Set(data.id, q.id + "|" + n.id + "|" + state);

		DSDialogPacket pk = new DSDialogPacket();
		pk.quest = q.id;
		pk.node = n.id;
		pk.name = n.title;
		if (pk.name == "")
			pk.name = "Survivor";
		pk.state = state;
		pk.dialog = dlg;
		if (n.trader != "" && FindTrader(n.trader))
			pk.trader = n.trader;
		pk.x = n.x;
		pk.y = GroundPos(n.x, n.y, n.z)[1];
		pk.z = n.z;

		// the NPC turns to the player
		for (int i = 0; i < m_NpcInfo.Count(); i++)
		{
			if (m_NpcInfo.Get(i).quest == q.id && m_NpcInfo.Get(i).node == n.id && i < m_NpcObjs.Count())
			{
				Object npc = m_NpcObjs.Get(i);
				if (npc)
				{
					vector toPlayer = p.GetPosition() - npc.GetPosition();
					npc.SetOrientation(Vector(toPlayer.VectorToAngles()[0], 0, 0));
				}
			}
		}

		// trade replies show the faction discount ("Trade 2 rags (-20%)"); the texts are restored right after
		array<string> plainTexts = new array<string>;
		array<DSDlgOption> marked = new array<DSDlgOption>;
		if (disc > 0)
		{
			for (int dli = 0; dli < dlg.lines.Count(); dli++)
			{
				DSDlgLine dlx = dlg.lines.Get(dli);
				for (int doi = 0; doi < dlx.options.Count(); doi++)
				{
					DSDlgOption dox = dlx.options.Get(doi);
					if (!dox.take || dox.take.Count() == 0)
						continue;
					marked.Insert(dox);
					plainTexts.Insert(dox.text);
					dox.text = dox.text + " (-" + disc.ToString() + "%)";
				}
			}
		}
		string json;
		JsonSerializer js = new JsonSerializer();
		js.WriteToString(pk, false, json);
		for (int mi = 0; mi < marked.Count(); mi++)
			marked.Get(mi).text = plainTexts.Get(mi);
		dlg.start = normalStart;   // the dialog object is shared by every player
		SendToClient(p, DSQ_RPC_OPEN, json);
	}

	// server: the player chose an "accept" option
	void ServerAccept(PlayerBase p, string questId, string nodeId)
	{
		if (!m_Ready || !p)
			return;
		DSQuest q = FindQuestById(questId);
		if (!q)
			return;
		DSNode n = FindNode(q, nodeId);
		if (!n || n.type != "trg_npc")
			return;
		if (!NearNpc(p, q, n, 6))
			return;
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		DSQuestState qs = data.GetQuest(q.id);
		if (qs.status != 0 || !PrereqsMet(data, q))
			return;
		StartQuest(p, data, q, qs, n);
	}

	// server: the player picked a reply that gives or takes items.  rest = "node|state|line|index"
	void ServerOption(PlayerBase p, string questId, string rest)
	{
		if (!m_Ready || !p)
			return;
		DSPlayerData data = GetData(p);
		if (!data)
			return;
		TStringArray parts = new TStringArray;
		rest.Split("|", parts);
		if (parts.Count() < 4)
			return;
		string nodeId = parts.Get(0);
		string state = parts.Get(1);
		string lineId = parts.Get(2);
		int idx = parts.Get(3).ToInt();
		string open;
		if (!m_Talk.Find(data.id, open) || open != questId + "|" + nodeId + "|" + state)
			return;   // only replies of the conversation the server opened for this player
		DSQuest q = FindQuestById(questId);
		if (!q)
			return;
		DSNode n = FindNode(q, nodeId);
		if (!n || !NearNpc(p, q, n, 6))
			return;
		DSDlgLine line = DialogFor(q, n, state).Find(lineId);
		if (!line || idx < 0 || idx >= line.options.Count())
			return;
		DSDlgOption o = line.options.Get(idx);
		string key = OptionKey(q.id, n.id, state, lineId, idx);
		int disc = TierDiscount(data, n);
		if (!OptionOk(p, data, o, key, disc))
			return;
		int i;
		for (i = 0; i < o.take.Count(); i++)
			RemoveItems(p, o.take.Get(i).c, Discounted(o.take.Get(i).n, disc));
		string got = "";
		for (i = 0; i < o.give.Count(); i++)
		{
			GiveItem(p, o.give.Get(i).c, o.give.Get(i).n);
			if (got != "")
				got = got + ", ";
			got = got + o.give.Get(i).n.ToString() + "x " + ItemName(o.give.Get(i).c);
		}
		if (o.give.Count() > 0 && o.take.Count() == 0)
			data.used.Insert(key);
		SaveData(data);
		if (got != "")
			Notify(p, "Received", got, false);
	}

	static string ItemName(string cls)
	{
		string nm;
		if (GetGame().ConfigIsExisting("CfgVehicles " + cls))
			GetGame().ConfigGetText("CfgVehicles " + cls + " displayName", nm);
		else if (GetGame().ConfigIsExisting("CfgWeapons " + cls))
			GetGame().ConfigGetText("CfgWeapons " + cls + " displayName", nm);
		else if (GetGame().ConfigIsExisting("CfgMagazines " + cls))
			GetGame().ConfigGetText("CfgMagazines " + cls + " displayName", nm);
		if (nm == "" || nm.IndexOf("$") == 0)
			return cls;
		return nm;
	}

	void ClientReceive(int rpc, string json)
	{
		string err;
		JsonSerializer js = new JsonSerializer();
		if (rpc == DSQ_RPC_NPCS)
		{
			DSNpcList list = new DSNpcList();
			if (js.ReadFromString(list, json, err))
			{
				m_NpcInfo = list.npcs;
				m_UseInfo = list.uses;
				m_GotNpcs = true;
				Print("[DZStudio] client: " + m_NpcInfo.Count() + " quest NPC(s)");
			}
			else
				Print("[DZStudio] client: could not read the NPC list: " + err);
		}
		else if (rpc == DSQ_RPC_FX)
		{
			DSFx.SetActive(json);
		}
		else if (rpc == DSQ_RPC_REP)
		{
			// "faction|value|tierId|tierName|tierColor|changed": update the standing right away (HUD, sheet, conditions)
			TStringArray rp = new TStringArray;
			json.Split("|", rp);
			if (rp.Count() >= 6 && m_Journal)
			{
				DSJRep cr = m_Journal.Rep(rp.Get(0));
				if (cr)
				{
					cr.v = rp.Get(1).ToInt();
					cr.tier = rp.Get(2);
					cr.tierName = rp.Get(3);
					cr.tierColor = rp.Get(4).ToInt();
				}
			}
		}
		else if (rpc == DSQ_RPC_SHOT)
		{
			// "netLow|netHigh|soundset|ammo": a hostile faction NPC fired
			TStringArray sp = new TStringArray;
			json.Split("|", sp);
			if (sp.Count() >= 4)
			{
				PlayerBase shooter = PlayerBase.Cast(GetGame().GetObjectByNetworkId(sp.Get(0).ToInt(), sp.Get(1).ToInt()));
				if (shooter)
				{
					vector at = shooter.GetPosition() + "0 1.4 0";
					ItemBase gun = ItemBase.Cast(shooter.GetHumanInventory().GetEntityInHands());
					if (gun)
					{
						ItemBase.PlayFireParticles(gun, 0, sp.Get(3), gun, null, "CfgWeapons");
						at = gun.GetPosition();
					}
					if (sp.Get(2) != "")
						SEffectManager.PlaySound(sp.Get(2), at);
				}
			}
		}
		else if (rpc == DSQ_RPC_MSG)
		{
			TStringArray mp = new TStringArray;
			json.Split("|", mp);
			if (mp.Count() >= 2)
				ShowMsg(mp.Get(0), mp.Get(1));
		}
		else if (rpc == DSQ_RPC_JOURNAL)
		{
			DSJournal jn = new DSJournal();
			if (!js.ReadFromString(jn, json, err))
				Print("[DZStudio] client: could not read the journal: " + err);
			else
			{
				if (!m_JUI)
					m_JUI = new DSJournalUI();
				m_JUI.OnJournal(jn);
				m_Journal = jn;
				m_JUI.Refresh();
			}
		}
		else if (rpc == DSQ_RPC_SAY)
		{
			ClientSay(json);
			return;
		}
		else if (rpc == DSQ_RPC_TRADEUI)
		{
			DSTradePacket tp = new DSTradePacket();
			if (!js.ReadFromString(tp, json, err))
			{
				Print("[DZStudio] client: could not read the trader screen (" + json.Length() + " chars): " + err);
				return;
			}
			if (m_UI && m_UI.IsOpen())
				m_UI.Close();
			if (!m_TUI)
				m_TUI = new DSTradeUI();
			m_TUI.Show(tp);
		}
		else if (rpc == DSQ_RPC_OPEN)
		{
			DSDialogPacket pk = new DSDialogPacket();
			if (!js.ReadFromString(pk, json, err) || !pk.dialog)
			{
				Print("[DZStudio] client: could not read a conversation (" + json.Length() + " chars): " + err);
				return;
			}
			if (!m_UI)
				m_UI = new DSDialogUI();
			m_UI.Open(pk);
		}
	}

	void HandleRPC(PlayerBase p, PlayerIdentity sender, int rpc, ParamsReadContext ctx)
	{
		if (rpc == DSQ_RPC_NPCS || rpc == DSQ_RPC_OPEN || rpc == DSQ_RPC_JOURNAL || rpc == DSQ_RPC_FX || rpc == DSQ_RPC_MSG || rpc == DSQ_RPC_REP || rpc == DSQ_RPC_SHOT || rpc == DSQ_RPC_TRADEUI || rpc == DSQ_RPC_SAY)
		{
			// long messages arrive in pieces (see SendToClient): put them back together
			Param3<int, int, string> a = new Param3<int, int, string>(0, 1, "");
			if (!ctx.Read(a))
				return;
			string sofar = "";
			if (a.param1 > 0)
				m_Chunks.Find(rpc, sofar);
			sofar = sofar + a.param3;
			if (a.param1 + 1 < a.param2)
			{
				m_Chunks.Set(rpc, sofar);
				return;
			}
			m_Chunks.Remove(rpc);
			ClientReceive(rpc, sofar);
		}
		else if (rpc == DSQ_RPC_TALK || rpc == DSQ_RPC_ACCEPT || rpc == DSQ_RPC_ABANDON || rpc == DSQ_RPC_HELLO || rpc == DSQ_RPC_OPTION || rpc == DSQ_RPC_USE || rpc == DSQ_RPC_TRADE)
		{
			if (!GetGame().IsServer())
				return;
			Param2<string, string> b = new Param2<string, string>("", "");
			if (!ctx.Read(b))
				return;
			if (rpc == DSQ_RPC_TALK)
				ServerTalk(p, b.param1, b.param2);
			else if (rpc == DSQ_RPC_ACCEPT)
				ServerAccept(p, b.param1, b.param2);
			else if (rpc == DSQ_RPC_OPTION)
				ServerOption(p, b.param1, b.param2);
			else if (rpc == DSQ_RPC_USE)
				ServerUse(p, b.param1, b.param2);
			else if (rpc == DSQ_RPC_TRADE)
				ServerTrade(p, b.param1, b.param2);
			else if (rpc == DSQ_RPC_HELLO)
			{
				// the client was not ready when we first sent these: send them again on the next tick
				if (p)
				{
					m_NpcSent.Remove(PlayerId(p));
					m_JournalLast.Remove(PlayerId(p));
					m_FxSent.Remove(PlayerId(p));
				}
			}
			else
				ServerAbandon(p, b.param1);
		}
	}

	// client, every frame: interaction prompt + conversation UI
	void ClientTick(float dt)
	{
		if (GetGame().IsDedicatedServer())
			return;
		DSFx.ClientUpdate(dt);
		if (!m_UI)
			m_UI = new DSDialogUI();
		if (!m_JUI)
			m_JUI = new DSJournalUI();
		if (!m_TUI)
			m_TUI = new DSTradeUI();
		m_UI.Update(dt);
		m_TUI.Update(dt);
		ClientSays(dt);
		bool talking = m_UI.IsOpen();
		if (m_TUI.IsOpen())
			talking = true;
		m_JUI.Update(dt, talking);
		if (m_JUI.IsOpen() || m_TUI.IsOpen())
			m_UI.HidePrompt();
		if (GetGame().IsMultiplayer() && (!m_GotNpcs || !m_Journal) && m_HelloTries < 12 && GetGame().GetPlayer())
		{
			m_HelloT -= dt;
			if (m_HelloT <= 0)
			{
				m_HelloT = 5;
				m_HelloTries++;
				SendToServer(DSQ_RPC_HELLO, "", "");
			}
		}
		bool covered = m_UI.IsOpen() || m_JUI.IsOpen() || m_TUI.IsOpen() || GetGame().GetUIManager().GetMenu() != null;
		DSHud.Update(dt, covered, m_Journal);
		DSSheet.Update(dt, covered, m_Journal);
		if (m_UI.IsOpen() || m_JUI.IsOpen() || m_TUI.IsOpen())
			return;

		bool key = KeyState(KeyCode.KC_F) != 0;
		PlayerBase me = PlayerBase.Cast(GetGame().GetPlayer());
		int best = -1;
		if (me && me.IsAlive() && m_NpcInfo.Count() > 0 && !GetGame().GetUIManager().GetMenu())
		{
			vector cp = GetGame().GetCurrentCameraPosition();
			vector cd = GetGame().GetCurrentCameraDirection();
			float bestDot = 0.955;
			for (int i = 0; i < m_NpcInfo.Count(); i++)
			{
				DSNpcInfo info = m_NpcInfo.Get(i);
				if (!info.talk)
					continue;
				vector head = NpcPos(i) + "0 1.5 0";
				vector to = head - cp;
				float dist = to.Length();
				if (dist > info.radius + 1.5 || dist < 0.2)
					continue;
				to.Normalize();
				float dot = vector.Dot(to, cd);
				if (dot > bestDot)
				{
					bestDot = dot;
					best = i;
				}
			}
		}
		m_Looked = best;
		// usable objects ("Use Object" nodes): only the ones this player can use right now
		int bestUse = -1;
		if (me && me.IsAlive() && m_UseInfo.Count() > 0 && m_Journal && !GetGame().GetUIManager().GetMenu())
		{
			vector up = GetGame().GetCurrentCameraPosition();
			vector ud = GetGame().GetCurrentCameraDirection();
			float useDot = 0.94;
			if (best >= 0)
				useDot = 0.985;   // an NPC in view wins unless the object is right in the centre
			for (int ui = 0; ui < m_UseInfo.Count(); ui++)
			{
				DSUseInfo uinfo = m_UseInfo.Get(ui);
				if (m_Journal.uses.Find(uinfo.quest + "|" + uinfo.node) < 0)
					continue;
				vector at = Vector(uinfo.x, uinfo.y + 1.0, uinfo.z);
				vector uto = at - up;
				float udist = uto.Length();
				if (udist > uinfo.radius + 2.5 || udist < 0.2)
					continue;
				uto.Normalize();
				float udot = vector.Dot(uto, ud);
				if (udot > useDot)
				{
					useDot = udot;
					bestUse = ui;
				}
			}
		}
		if (bestUse >= 0)
		{
			DSUseInfo pick = m_UseInfo.Get(bestUse);
			m_UI.ShowPrompt("[F]  " + pick.prompt);
			if (key && !m_TalkKey)
				SendToServer(DSQ_RPC_USE, pick.quest, pick.node);
		}
		else if (best >= 0)
		{
			string talkLabel = "[F]  Talk to " + m_NpcInfo.Get(best).name;
			if (m_NpcInfo.Get(best).prompt != "")
				talkLabel = "[F]  " + m_NpcInfo.Get(best).prompt + "  (" + m_NpcInfo.Get(best).name + ")";
			string npcFac = m_NpcInfo.Get(best).faction;
			if (npcFac != "" && m_Journal)
			{
				DSJRep pr = m_Journal.Rep(npcFac);
				if (pr && pr.tierName != "")
					talkLabel = talkLabel + "  (" + pr.name + ": " + pr.tierName + ")";
			}
			m_UI.ShowPrompt(talkLabel);
			if (key && !m_TalkKey)
				SendToServer(DSQ_RPC_TALK, m_NpcInfo.Get(best).quest, m_NpcInfo.Get(best).node);
		}
		else
			m_UI.HidePrompt();
		m_TalkKey = key;
	}

	void ClientAccept(string questId, string nodeId)
	{
		SendToServer(DSQ_RPC_ACCEPT, questId, nodeId);
	}

	// ---------------- in-game map ----------------
	bool m_WantMap;     // the journal asked for the map (opened by the mission script, it knows MapMenu)
	vector m_MapAt;

	// quest markers on the vanilla map: open objectives (the tracked quest in gold) and NPCs with a quest to offer
	void AddMapMarks(MapWidget w)
	{
		if (!w || !m_Journal)
			return;
		string tracked = "";
		if (m_JUI)
			tracked = m_JUI.m_Tracked;
		for (int i = 0; i < m_Journal.quests.Count(); i++)
		{
			DSJQuest q = m_Journal.quests.Get(i);
			if (q.status != 1)
				continue;
			int col = ARGB(255, 120, 200, 255);
			if (q.id == tracked)
				col = ARGB(255, 255, 214, 90);
			for (int j = 0; j < q.objectives.Count(); j++)
			{
				DSJObjective o = q.objectives.Get(j);
				if (o.done || !o.hasPos)
					continue;
				int oc = col;
				if (o.optional)
					oc = ARGB(255, 217, 194, 122);
				w.AddUserMark(Vector(o.x, 0, o.z), q.name + ": " + DSJournalUI.ObjText(o), oc, "\\DZ\\gear\\navigation\\data\\map_viewpoint_ca.paa");
			}
		}
		for (int k = 0; k < m_Journal.givers.Count(); k++)
		{
			DSJMark g = m_Journal.givers.Get(k);
			w.AddUserMark(Vector(g.x, 0, g.z), g.name + " (quest)", ARGB(255, 120, 230, 120), "\\DZ\\gear\\navigation\\data\\map_tourism_ca.paa");
		}
	}

	// the journal's "show on map": centre on the first open objective of quest q (or the player)
	void RequestMap(DSJQuest q)
	{
		PlayerBase me = PlayerBase.Cast(GetGame().GetPlayer());
		if (me)
			m_MapAt = me.GetPosition();
		if (q)
		{
			for (int i = 0; i < q.objectives.Count(); i++)
			{
				DSJObjective o = q.objectives.Get(i);
				if (!o.done && o.hasPos)
				{
					m_MapAt = Vector(o.x, 0, o.z);
					break;
				}
			}
		}
		m_WantMap = true;
	}

	// Esc closes our screens; the game must not also open its pause menu with that key press
	bool BlockPause()
	{
		if (DSSheet.IsOpen())
			return true;
		if (m_TUI && m_TUI.IsOpen())
			return true;
		return (m_UI && m_UI.IsOpen()) || (m_JUI && m_JUI.IsOpen());
	}

	void ClientOption(string questId, string nodeId, string state, string lineId, int idx)
	{
		SendToServer(DSQ_RPC_OPTION, questId, nodeId + "|" + state + "|" + lineId + "|" + idx);
	}
}

// ---- Skyrim-style conversation screen (client only) -------------------------------
class DSDialogUI
{
	bool m_Open;
	ref DSDialogPacket m_Pkt;
	DSDlgLine m_Line;
	ref array<Widget> m_All;
	ref array<TextWidget> m_TextRows;
	ref array<TextWidget> m_OptRows;
	TextWidget m_Name;
	TextWidget m_Prompt;
	ref array<string> m_Wrapped;
	ref map<int, bool> m_Prev;
	float m_RevealAcc;
	int m_Sel;
	int m_OptCount;
	float m_Age;
	float m_PanelX;
	float m_PanelY;
	float m_OptY;
	float m_PanelW;
	Camera m_Cam;
	vector m_CamFrom;
	vector m_CamTo;
	vector m_OriFrom;
	vector m_OriTo;
	float m_CamT;
	EffectSound m_Voice;
	bool m_MouseDown;
	ref array<int> m_Vis;     // indexes of the replies this player may pick (-1: "Let's trade.", -2: "Continue")
	string m_StartId;         // the line the conversation opened with (it gets the trade reply)

	void DSDialogUI()
	{
		m_Vis = new array<int>;
		m_All = new array<Widget>;
		m_TextRows = new array<TextWidget>;
		m_OptRows = new array<TextWidget>;
		m_Wrapped = new array<string>;
		m_Prev = new map<int, bool>;
	}

	bool IsOpen()
	{
		return m_Open;
	}

	TextWidget MakeText(float x, float y, float w, float h, int size, int color)
	{
		WorkspaceWidget ws = GetGame().GetWorkspace();
		Widget wd = ws.CreateWidget(TextWidgetTypeID, x, y, w, h, WidgetFlags.VISIBLE | WidgetFlags.EXACTSIZE | WidgetFlags.EXACTPOS, 0xFFFFFFFF, 1002);
		TextWidget t = TextWidget.Cast(wd);
		if (t)
		{
			t.SetTextExactSize(size);
			t.SetOutline(1, 0xFF000000);
			t.SetColor(color);
		}
		return t;
	}

	void ShowPrompt(string text)
	{
		if (!m_Prompt)
		{
			int sw, sh;
			GetScreenSize(sw, sh);
			m_Prompt = MakeText(sw * 0.5 - 300, sh * 0.64, 600, 44, 34, 0xFFFFFFFF);
		}
		if (m_Prompt)
		{
			m_Prompt.SetText(text);
			m_Prompt.Show(true);
		}
	}

	void HidePrompt()
	{
		if (m_Prompt)
			m_Prompt.Show(false);
	}

	bool Pressed(int key)
	{
		bool now = KeyState(key) != 0;
		bool was = false;
		m_Prev.Find(key, was);
		m_Prev.Set(key, now);
		return now && !was;
	}

	void Wrap(string text, int maxChars)
	{
		m_Wrapped.Clear();
		TStringArray words = new TStringArray;
		text.Split(" ", words);
		string cur = "";
		for (int i = 0; i < words.Count(); i++)
		{
			string word = words.Get(i);
			if (cur == "")
				cur = word;
			else if (cur.Length() + 1 + word.Length() <= maxChars)
				cur = cur + " " + word;
			else
			{
				m_Wrapped.Insert(cur);
				cur = word;
			}
		}
		if (cur != "")
			m_Wrapped.Insert(cur);
	}

	void Open(DSDialogPacket pk)
	{
		Close();
		m_Pkt = pk;
		m_Open = true;
		m_Age = 0;
		HidePrompt();

		int sw, sh;
		GetScreenSize(sw, sh);
		m_PanelW = sw * 0.56;
		m_PanelX = (sw - m_PanelW) * 0.5;
		float ph = sh * 0.33;
		m_PanelY = sh - ph - sh * 0.05;

		WorkspaceWidget ws = GetGame().GetWorkspace();
		Widget bg = ws.CreateWidget(ImageWidgetTypeID, m_PanelX, m_PanelY, m_PanelW, ph, WidgetFlags.VISIBLE | WidgetFlags.EXACTSIZE | WidgetFlags.EXACTPOS, 0xC0101010, 1000);
		if (bg)
			m_All.Insert(bg);
		Widget rule = ws.CreateWidget(ImageWidgetTypeID, m_PanelX + 24, m_PanelY + 52, m_PanelW - 48, 2, WidgetFlags.VISIBLE | WidgetFlags.EXACTSIZE | WidgetFlags.EXACTPOS, 0xFFC8A864, 1001);
		if (rule)
			m_All.Insert(rule);

		m_Name = MakeText(m_PanelX + 24, m_PanelY + 12, m_PanelW - 48, 36, 30, 0xFFE8D29A);
		if (m_Name)
		{
			m_Name.SetText(pk.name);
			m_All.Insert(m_Name);
		}
		m_TextRows.Clear();
		for (int r = 0; r < 4; r++)
		{
			TextWidget tr = MakeText(m_PanelX + 24, m_PanelY + 62 + r * 30, m_PanelW - 48, 30, 24, 0xFFFFFFFF);
			if (tr)
			{
				m_TextRows.Insert(tr);
				m_All.Insert(tr);
			}
		}
		m_OptY = m_PanelY + 62 + 4 * 30 + 12;
		m_OptRows.Clear();
		for (int o = 0; o < 5; o++)
		{
			TextWidget orow = MakeText(m_PanelX + 40, m_OptY + o * 30, m_PanelW - 80, 30, 23, 0xFFCCCCCC);
			if (orow)
			{
				m_OptRows.Insert(orow);
				m_All.Insert(orow);
			}
		}

		// take the player out of the world and look at the NPC
		GetGame().GetMission().PlayerControlDisable(INPUT_EXCLUDE_ALL);
		GetGame().GetUIManager().ShowUICursor(true);
		SetupCamera();

		// swallow keys that are still held (the interact key that opened us)
		Pressed(KeyCode.KC_F);
		Pressed(KeyCode.KC_RETURN);
		Pressed(KeyCode.KC_SPACE);
		Pressed(KeyCode.KC_UP);
		Pressed(KeyCode.KC_DOWN);
		Pressed(KeyCode.KC_ESCAPE);
		for (int k = 0; k < 9; k++)
			Pressed(KeyCode.KC_1 + k);
		m_MouseDown = (GetMouseState(MouseState.LEFT) & MB_PRESSED_MASK) != 0;

		DSDlgLine first = pk.dialog.Find(pk.dialog.start);
		if (!first && pk.dialog.lines.Count() > 0)
			first = pk.dialog.lines.Get(0);
		if (!first)
		{
			Close();
			return;
		}
		m_StartId = first.id;
		ShowLine(first);
	}

	void SetupCamera()
	{
		vector cp = GetGame().GetCurrentCameraPosition();
		vector cd = GetGame().GetCurrentCameraDirection();
		vector head = Vector(m_Pkt.x, m_Pkt.y + 1.55, m_Pkt.z);
		vector away = cp - head;
		away[1] = 0;
		if (away.Length() < 0.3)
			away = Vector(0, 0, -1);
		away.Normalize();
		vector side = Vector(away[2], 0, -away[0]);
		vector target = head + away * 1.9 + side * 0.55;
		target[1] = head[1] - 0.08;
		vector look = head + side * 0.12;
		look[1] = head[1] - 0.05;

		m_CamFrom = cp;
		m_OriFrom = cd.VectorToAngles();
		m_CamTo = target;
		m_OriTo = (look - target).VectorToAngles();
		m_CamT = 0;
		m_Cam = Camera.Cast(GetGame().CreateObjectEx("StaticCamera", cp, ECE_LOCAL));
		if (m_Cam)
		{
			m_Cam.SetPosition(m_CamFrom);
			m_Cam.SetOrientation(m_OriFrom);
			m_Cam.SetActive(true);
		}
	}

	void ShowLine(DSDlgLine line)
	{
		m_Line = line;
		Wrap(line.text, 58);
		m_RevealAcc = 0;
		m_Sel = 0;
		m_Vis.Clear();
		for (int v = 0; v < line.options.Count(); v++)
		{
			if (!line.options.Get(v).hide)
				m_Vis.Insert(v);
		}
		// a trader NPC: its first line also offers to trade (and keeps "Continue" when it had no replies)
		if (m_Pkt.trader != "" && line.id == m_StartId)
		{
			if (m_Vis.Count() == 0)
				m_Vis.Insert(-2);
			m_Vis.Insert(-1);
		}
		m_OptCount = m_Vis.Count();
		if (m_OptCount == 0)
			m_OptCount = 1;
		if (m_OptCount > 5)
			m_OptCount = 5;
		if (m_Voice)
		{
			m_Voice.SoundStop();
			m_Voice = null;
		}
		if (line.sound != "")
			m_Voice = SEffectManager.PlaySound("DSQ_" + line.sound + "_SoundSet", Vector(m_Pkt.x, m_Pkt.y + 1.6, m_Pkt.z));
		Render();
	}

	int TotalChars()
	{
		int n = 0;
		for (int i = 0; i < m_Wrapped.Count() && i < 4; i++)
			n = n + m_Wrapped.Get(i).Length();
		return n;
	}

	bool TextDone()
	{
		return (int)m_RevealAcc >= TotalChars();
	}

	void Render()
	{
		int left = (int)m_RevealAcc;
		for (int i = 0; i < m_TextRows.Count(); i++)
		{
			string row = "";
			if (i < m_Wrapped.Count())
			{
				string full = m_Wrapped.Get(i);
				int take = full.Length();
				if (take > left)
					take = left;
				if (take < 0)
					take = 0;
				row = full.Substring(0, take);
				left = left - full.Length();
			}
			m_TextRows.Get(i).SetText(row);
		}
		bool showOpts = TextDone();
		for (int j = 0; j < m_OptRows.Count(); j++)
		{
			TextWidget ow = m_OptRows.Get(j);
			if (!showOpts || j >= m_OptCount)
			{
				ow.SetText("");
				continue;
			}
			string label = "Continue";
			if (m_Vis.Count() > 0)
			{
				int pv = m_Vis.Get(j);
				if (pv == -1)
					label = "Let's trade.";
				else if (pv >= 0)
					label = m_Line.options.Get(pv).text;
			}
			string mark = "   ";
			int col = 0xFFB8B8B8;
			if (j == m_Sel)
			{
				mark = ">  ";
				col = 0xFFFFE9A8;
			}
			ow.SetColor(col);
			ow.SetText(mark + (j + 1) + ".  " + label);
		}
	}

	void Choose(int idx)
	{
		if (!m_Open || !m_Line)
			return;
		string next = m_Line.next;
		if (m_Vis.Count() > 0)
		{
			if (idx < 0 || idx >= m_Vis.Count())
				return;
			int pick = m_Vis.Get(idx);
			if (pick == -1)
			{
				// "Let's trade.": the server answers with the trader screen
				string tq = m_Pkt.quest;
				string tn = m_Pkt.node;
				Close();
				DSQuests.Get().SendToServer(DSQ_RPC_TRADE, tq, "open|" + tn);
				return;
			}
			if (pick >= 0)
			{
				DSDlgOption opt = m_Line.options.Get(pick);
				next = opt.next;
				if ((opt.give && opt.give.Count() > 0) || (opt.take && opt.take.Count() > 0))
				{
					DSQuests.Get().ClientOption(m_Pkt.quest, m_Pkt.node, m_Pkt.state, m_Line.id, pick);
					if (opt.give.Count() > 0 && opt.take.Count() == 0)
						opt.hide = true;   // a one-time gift: gone if the conversation comes back to this line
				}
				if (opt.accept)
					DSQuests.Get().ClientAccept(m_Pkt.quest, m_Pkt.node);
			}
		}
		if (next == "")
		{
			Close();
			return;
		}
		DSDlgLine nl = m_Pkt.dialog.Find(next);
		if (!nl)
		{
			Close();
			return;
		}
		ShowLine(nl);
	}

	void Close()
	{
		if (m_Voice)
		{
			m_Voice.SoundStop();
			m_Voice = null;
		}
		for (int i = 0; i < m_All.Count(); i++)
		{
			Widget w = m_All.Get(i);
			if (w)
				w.Unlink();
		}
		m_All.Clear();
		m_TextRows.Clear();
		m_OptRows.Clear();
		m_Name = null;
		if (m_Cam)
		{
			// give the view back to the player; the camera object is removed a moment later
			// (deleting it in the same frame leaves the view frozen on the NPC)
			m_Cam.SetActive(false);
			PlayerBase me = PlayerBase.Cast(GetGame().GetPlayer());
			if (me)
				GetGame().SelectPlayer(null, me);
			GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(DSQuests.DeleteObj, 600, false, m_Cam);
			m_Cam = null;
		}
		if (m_Open)
		{
			GetGame().GetMission().PlayerControlEnable(true);
			GetGame().GetUIManager().ShowUICursor(false);
		}
		m_Open = false;
		m_Line = null;
	}

	void Update(float dt)
	{
		if (!m_Open)
			return;
		m_Age += dt;

		// camera blend (smooth cut towards the NPC)
		if (m_Cam && m_CamT < 1)
		{
			m_CamT = m_CamT + dt / 0.7;
			if (m_CamT > 1)
				m_CamT = 1;
			float s = m_CamT * m_CamT * (3 - 2 * m_CamT);
			vector cp = vector.Lerp(m_CamFrom, m_CamTo, s);
			float dyaw = m_OriTo[0] - m_OriFrom[0];
			while (dyaw > 180)
				dyaw = dyaw - 360;
			while (dyaw < -180)
				dyaw = dyaw + 360;
			vector co = Vector(m_OriFrom[0] + dyaw * s, Math.Lerp(m_OriFrom[1], m_OriTo[1], s), 0);
			m_Cam.SetPosition(cp);
			m_Cam.SetOrientation(co);
		}

		// typewriter
		if (!TextDone())
		{
			m_RevealAcc = m_RevealAcc + dt * 60;
			if ((int)m_RevealAcc > TotalChars())
				m_RevealAcc = TotalChars();
			Render();
		}

		bool up = Pressed(KeyCode.KC_UP);
		bool down = Pressed(KeyCode.KC_DOWN);
		bool enter = Pressed(KeyCode.KC_RETURN);
		bool space = Pressed(KeyCode.KC_SPACE);
		bool interact = Pressed(KeyCode.KC_F);
		bool esc = Pressed(KeyCode.KC_ESCAPE);
		int number = -1;
		for (int k = 0; k < 9; k++)
		{
			if (Pressed(KeyCode.KC_1 + k))
				number = k;
		}

		if (esc)
		{
			Close();
			return;
		}
		if (m_Age < 0.25)
			return;
		if (!TextDone())
		{
			if (enter || space || interact || number >= 0)
			{
				m_RevealAcc = TotalChars();
				Render();
			}
			if (number < 0)
				return;   // a number key skips the typing and picks that reply right away
		}
		if (up && m_Sel > 0)
		{
			m_Sel--;
			Render();
		}
		if (down && m_Sel < m_OptCount - 1)
		{
			m_Sel++;
			Render();
		}
		if (number >= 0 && number < m_OptCount)
		{
			Choose(number);
			return;
		}
		if (enter || space || interact)
		{
			Choose(m_Sel);
			return;
		}

		// mouse: hover selects, click confirms
		int mx, my;
		GetMousePos(mx, my);
		for (int j = 0; j < m_OptCount; j++)
		{
			float ry = m_OptY + j * 30;
			if (mx >= m_PanelX && mx <= m_PanelX + m_PanelW && my >= ry && my < ry + 30)
			{
				if (m_Sel != j)
				{
					m_Sel = j;
					Render();
				}
			}
		}
		bool down2 = (GetMouseState(MouseState.LEFT) & MB_PRESSED_MASK) != 0;
		if (down2 && !m_MouseDown)
		{
			if (my >= m_OptY && my < m_OptY + m_OptCount * 30 && mx >= m_PanelX && mx <= m_PanelX + m_PanelW)
			{
				m_MouseDown = down2;
				Choose(m_Sel);
				return;
			}
		}
		m_MouseDown = down2;
	}
}

// ---- trader screen: buy and sell (client only) -------------------------------
// Two columns - what the trader sells (left) and what the player can sell to it (right) - with category headings.
// Click or Enter trades one, Shift trades ten; the server answers every trade with a fresh screen (DSTradePacket).
class DSTradeUI
{
	bool m_Open;
	ref DSTradePacket m_Pkt;
	ref array<Widget> m_All;
	ref array<TextWidget> m_Name0;
	ref array<TextWidget> m_Price0;
	ref array<TextWidget> m_Name1;
	ref array<TextWidget> m_Price1;
	ref array<int> m_Lines0;    // left column: packet row per line (-1: a category heading)
	ref array<int> m_Lines1;    // right column
	ref array<string> m_Head0;  // heading text per line ("" for item lines)
	ref array<string> m_Head1;
	Widget m_Hi0;
	Widget m_Hi1;
	TextWidget m_Title;
	TextWidget m_Sub;
	TextWidget m_Msg;
	TextWidget m_Hint;
	int m_Side;
	int m_Sel0;
	int m_Sel1;
	int m_Top0;
	int m_Top1;
	int m_Rows;
	float m_X;
	float m_Y;
	float m_W;
	float m_H;
	float m_RowY;
	float m_ColW;
	float m_Age;
	bool m_MouseDown;
	int m_MX;
	int m_MY;
	ref map<int, bool> m_Prev;

	void DSTradeUI()
	{
		m_All = new array<Widget>;
		m_Name0 = new array<TextWidget>;
		m_Price0 = new array<TextWidget>;
		m_Name1 = new array<TextWidget>;
		m_Price1 = new array<TextWidget>;
		m_Lines0 = new array<int>;
		m_Lines1 = new array<int>;
		m_Head0 = new array<string>;
		m_Head1 = new array<string>;
		m_Prev = new map<int, bool>;
	}

	bool IsOpen()
	{
		return m_Open;
	}

	bool Pressed(int key)
	{
		bool now = KeyState(key) != 0;
		bool was = false;
		m_Prev.Find(key, was);
		m_Prev.Set(key, now);
		return now && !was;
	}

	TextWidget Keep(TextWidget t)
	{
		if (t)
			m_All.Insert(t);
		return t;
	}

	void Show(DSTradePacket pk)
	{
		bool fresh = !m_Open;
		m_Pkt = pk;
		if (fresh)
			Build();
		Fill();
		Render();
	}

	void Build()
	{
		Close();
		m_Open = true;
		m_Age = 0;
		m_Side = 0;
		m_Sel0 = 0;
		m_Sel1 = 0;
		m_Top0 = 0;
		m_Top1 = 0;
		int sw, sh;
		GetScreenSize(sw, sh);
		m_W = sw * 0.66;
		m_H = sh * 0.76;
		m_X = (sw - m_W) * 0.5;
		m_Y = (sh - m_H) * 0.5;
		m_ColW = m_W * 0.5 - 40;
		m_RowY = m_Y + 150;
		m_Rows = (int)((m_H - 150 - 96) / 30);
		if (m_Rows < 4)
			m_Rows = 4;
		Widget bg = DSQRect(m_X, m_Y, m_W, m_H, 0xE40E1012, 1000);
		if (bg)
			m_All.Insert(bg);
		Widget rule = DSQRect(m_X + 24, m_Y + 96, m_W - 48, 2, 0xFFC8A864, 1001);
		if (rule)
			m_All.Insert(rule);
		Widget mid = DSQRect(m_X + m_W * 0.5, m_RowY - 36, 2, m_Rows * 30 + 36, 0x80C8A864, 1001);
		if (mid)
			m_All.Insert(mid);
		m_Hi0 = DSQRect(m_X + 20, m_RowY, m_ColW + 8, 30, 0x50C8A864, 1001);
		m_Hi1 = DSQRect(m_X + m_W * 0.5 + 12, m_RowY, m_ColW + 8, 30, 0x50C8A864, 1001);
		if (m_Hi0)
			m_All.Insert(m_Hi0);
		if (m_Hi1)
			m_All.Insert(m_Hi1);
		m_Title = Keep(DSQText(m_X + 28, m_Y + 14, m_W - 56, 44, 36, 0xFFE8D29A, 1002));
		m_Sub = Keep(DSQText(m_X + 28, m_Y + 58, m_W - 56, 32, 24, 0xFFCCCCCC, 1002));
		TextWidget h0 = Keep(DSQText(m_X + 28, m_RowY - 36, m_ColW, 32, 26, 0xFFE8D29A, 1002));
		TextWidget h1 = Keep(DSQText(m_X + m_W * 0.5 + 20, m_RowY - 36, m_ColW, 32, 26, 0xFFE8D29A, 1002));
		if (h0)
			h0.SetText("BUY");
		if (h1)
			h1.SetText("SELL");
		m_Name0.Clear();
		m_Price0.Clear();
		m_Name1.Clear();
		m_Price1.Clear();
		for (int r = 0; r < m_Rows; r++)
		{
			float ry = m_RowY + r * 30;
			m_Name0.Insert(Keep(DSQText(m_X + 28, ry, m_ColW * 0.64, 30, 23, 0xFFFFFFFF, 1002)));
			m_Price0.Insert(Keep(DSQText(m_X + 28 + m_ColW * 0.66, ry, m_ColW * 0.34, 30, 23, 0xFFFFFFFF, 1002)));
			m_Name1.Insert(Keep(DSQText(m_X + m_W * 0.5 + 20, ry, m_ColW * 0.64, 30, 23, 0xFFFFFFFF, 1002)));
			m_Price1.Insert(Keep(DSQText(m_X + m_W * 0.5 + 20 + m_ColW * 0.66, ry, m_ColW * 0.34, 30, 23, 0xFFFFFFFF, 1002)));
		}
		m_Msg = Keep(DSQText(m_X + 28, m_Y + m_H - 84, m_W - 56, 32, 24, 0xFFFFFFFF, 1002));
		m_Hint = Keep(DSQText(m_X + 28, m_Y + m_H - 46, m_W - 56, 30, 20, 0xFF9A9A9A, 1002));
		if (m_Hint)
			m_Hint.SetText("Click or Enter: trade one   -   Shift: ten   -   Left / Right: buy or sell   -   Esc: close");
		GetGame().GetMission().PlayerControlDisable(INPUT_EXCLUDE_ALL);
		GetGame().GetUIManager().ShowUICursor(true);
		// keys still held from the conversation must not trade right away
		Pressed(KeyCode.KC_RETURN);
		Pressed(KeyCode.KC_SPACE);
		Pressed(KeyCode.KC_ESCAPE);
		Pressed(KeyCode.KC_F);
		Pressed(KeyCode.KC_UP);
		Pressed(KeyCode.KC_DOWN);
		Pressed(KeyCode.KC_LEFT);
		Pressed(KeyCode.KC_RIGHT);
		m_MouseDown = (GetMouseState(MouseState.LEFT) & MB_PRESSED_MASK) != 0;
		GetMousePos(m_MX, m_MY);
	}

	// the two columns from the packet: items grouped under their category headings
	void Fill()
	{
		m_Lines0.Clear();
		m_Lines1.Clear();
		m_Head0.Clear();
		m_Head1.Clear();
		string cat0 = "-";
		string cat1 = "-";
		for (int i = 0; i < m_Pkt.rows.Count(); i++)
		{
			DSTradeRow r = m_Pkt.rows.Get(i);
			if (r.buy != "")
			{
				if (r.cat != cat0 && r.cat != "")
				{
					m_Lines0.Insert(-1);
					m_Head0.Insert(r.cat);
				}
				cat0 = r.cat;
				m_Lines0.Insert(i);
				m_Head0.Insert("");
			}
			if (r.sell != "")
			{
				if (r.cat != cat1 && r.cat != "")
				{
					m_Lines1.Insert(-1);
					m_Head1.Insert(r.cat);
				}
				cat1 = r.cat;
				m_Lines1.Insert(i);
				m_Head1.Insert("");
			}
		}
		m_Sel0 = FixSel(m_Lines0, m_Sel0, 1);
		m_Sel1 = FixSel(m_Lines1, m_Sel1, 1);
		if (m_Lines0.Count() == 0)
			m_Side = 1;
		if (m_Lines1.Count() == 0)
			m_Side = 0;
	}

	// the nearest item line (not a heading) from sel, looking in direction dir first
	int FixSel(array<int> lines, int sel, int dir)
	{
		int cnt = lines.Count();
		if (cnt == 0)
			return 0;
		if (sel < 0)
			sel = 0;
		if (sel >= cnt)
			sel = cnt - 1;
		int k = sel;
		while (k >= 0 && k < cnt && lines.Get(k) < 0)
			k = k + dir;
		if (k >= 0 && k < cnt)
			return k;
		k = sel;
		while (k >= 0 && k < cnt && lines.Get(k) < 0)
			k = k - dir;
		if (k >= 0 && k < cnt)
			return k;
		return 0;
	}

	void RenderColumn(array<int> lines, array<string> heads, array<TextWidget> names, array<TextWidget> prices, int top, int sel, bool buy, bool active)
	{
		for (int k = 0; k < m_Rows; k++)
		{
			TextWidget nw = names.Get(k);
			TextWidget pw = prices.Get(k);
			if (!nw || !pw)
				continue;
			int line = top + k;
			if (line >= lines.Count())
			{
				nw.SetText("");
				pw.SetText("");
				continue;
			}
			int ri = lines.Get(line);
			if (ri < 0)
			{
				nw.SetColor(0xFFC8A864);
				nw.SetText("- " + heads.Get(line) + " -");
				pw.SetText("");
				continue;
			}
			DSTradeRow r = m_Pkt.rows.Get(ri);
			string label = r.name;
			if (r.n > 1)
				label = label + "  x" + r.n;
			string price;
			bool ok;
			if (buy)
			{
				price = r.buy;
				if (r.why != "")
					price = price + "  (locked)";
				else if (r.stock == 0)
					price = price + "  (sold out)";
				else if (r.stock > 0)
					price = price + "  (" + r.stock + " left)";
				ok = r.canBuy;
			}
			else
			{
				price = r.sell + "  (you have " + r.have + ")";
				ok = r.canSell;
			}
			int col = 0xFF8A8A8A;
			if (ok)
				col = 0xFFFFFFFF;
			if (active && line == sel)
				col = 0xFFFFE9A8;
			nw.SetColor(col);
			pw.SetColor(col);
			nw.SetText(label);
			pw.SetText(price);
		}
	}

	void Render()
	{
		if (!m_Open || !m_Pkt)
			return;
		if (m_Title)
			m_Title.SetText(m_Pkt.title);
		if (m_Sub)
		{
			string sub = "Your money: " + m_Pkt.money;
			if (m_Pkt.disc > 0)
				sub = sub + "      " + m_Pkt.tier + ": " + m_Pkt.disc + "% off";
			m_Sub.SetText(sub);
		}
		// keep the selected line on screen
		if (m_Sel0 < m_Top0)
			m_Top0 = m_Sel0;
		if (m_Sel0 >= m_Top0 + m_Rows)
			m_Top0 = m_Sel0 - m_Rows + 1;
		if (m_Sel1 < m_Top1)
			m_Top1 = m_Sel1;
		if (m_Sel1 >= m_Top1 + m_Rows)
			m_Top1 = m_Sel1 - m_Rows + 1;
		RenderColumn(m_Lines0, m_Head0, m_Name0, m_Price0, m_Top0, m_Sel0, true, m_Side == 0);
		RenderColumn(m_Lines1, m_Head1, m_Name1, m_Price1, m_Top1, m_Sel1, false, m_Side == 1);
		if (m_Hi0)
		{
			m_Hi0.Show(m_Side == 0 && m_Lines0.Count() > 0);
			m_Hi0.SetPos(m_X + 20, m_RowY + (m_Sel0 - m_Top0) * 30);
		}
		if (m_Hi1)
		{
			m_Hi1.Show(m_Side == 1 && m_Lines1.Count() > 0);
			m_Hi1.SetPos(m_X + m_W * 0.5 + 12, m_RowY + (m_Sel1 - m_Top1) * 30);
		}
		if (m_Msg)
		{
			// a locked item explains itself while it is selected; otherwise the last trade's result
			string why = "";
			if (m_Side == 0 && m_Sel0 < m_Lines0.Count() && m_Lines0.Get(m_Sel0) >= 0)
				why = m_Pkt.rows.Get(m_Lines0.Get(m_Sel0)).why;
			if (why != "")
			{
				m_Msg.SetText("Locked: " + why);
				m_Msg.SetColor(0xFFE8D29A);
			}
			else
			{
				m_Msg.SetText(m_Pkt.msg);
				if (m_Pkt.good)
					m_Msg.SetColor(0xFF9BE59B);
				else
					m_Msg.SetColor(0xFFF08A7A);
			}
		}
	}

	void Trade(int qty)
	{
		array<int> lines = m_Lines0;
		int sel = m_Sel0;
		string act = "buy";
		if (m_Side == 1)
		{
			lines = m_Lines1;
			sel = m_Sel1;
			act = "sell";
		}
		if (sel < 0 || sel >= lines.Count() || lines.Get(sel) < 0)
			return;
		DSTradeRow r = m_Pkt.rows.Get(lines.Get(sel));
		DSQuests.Get().SendToServer(DSQ_RPC_TRADE, m_Pkt.quest, act + "|" + m_Pkt.node + "|" + r.i + "|" + qty);
	}

	void Move(int dir)
	{
		if (m_Side == 0)
			m_Sel0 = FixSel(m_Lines0, m_Sel0 + dir, dir);
		else
			m_Sel1 = FixSel(m_Lines1, m_Sel1 + dir, dir);
		Render();
	}

	void Close()
	{
		for (int i = 0; i < m_All.Count(); i++)
		{
			Widget w = m_All.Get(i);
			if (w)
				w.Unlink();
		}
		m_All.Clear();
		m_Name0.Clear();
		m_Price0.Clear();
		m_Name1.Clear();
		m_Price1.Clear();
		m_Hi0 = null;
		m_Hi1 = null;
		if (m_Open)
		{
			GetGame().GetMission().PlayerControlEnable(true);
			GetGame().GetUIManager().ShowUICursor(false);
		}
		m_Open = false;
	}

	void Update(float dt)
	{
		if (!m_Open)
			return;
		m_Age += dt;
		bool esc = Pressed(KeyCode.KC_ESCAPE);
		bool up = Pressed(KeyCode.KC_UP);
		bool down = Pressed(KeyCode.KC_DOWN);
		bool left = Pressed(KeyCode.KC_LEFT);
		bool right = Pressed(KeyCode.KC_RIGHT);
		bool enter = Pressed(KeyCode.KC_RETURN);
		bool space = Pressed(KeyCode.KC_SPACE);
		int qty = 1;
		if (KeyState(KeyCode.KC_LSHIFT) != 0)
			qty = 10;
		if (KeyState(KeyCode.KC_RSHIFT) != 0)
			qty = 10;
		if (esc)
		{
			Close();
			return;
		}
		if (m_Age < 0.2)
			return;
		if (up)
			Move(-1);
		if (down)
			Move(1);
		if (left && m_Lines0.Count() > 0)
		{
			m_Side = 0;
			Render();
		}
		if (right && m_Lines1.Count() > 0)
		{
			m_Side = 1;
			Render();
		}
		if (enter || space)
		{
			Trade(qty);
			return;
		}
		// mouse: moving over a line selects it (and its side), a click trades. A cursor that just sits
		// there must not steal the selection back from the arrow keys.
		int mx, my;
		GetMousePos(mx, my);
		bool down2 = (GetMouseState(MouseState.LEFT) & MB_PRESSED_MASK) != 0;
		bool click = down2 && !m_MouseDown;
		m_MouseDown = down2;
		bool moved = mx != m_MX || my != m_MY;
		m_MX = mx;
		m_MY = my;
		if (!moved && !click)
			return;
		bool inRows = false;
		if (my >= m_RowY && my < m_RowY + m_Rows * 30 && mx >= m_X && mx <= m_X + m_W)
			inRows = true;
		if (inRows)
		{
			int k = (int)((my - m_RowY) / 30);
			int side = 0;
			if (mx > m_X + m_W * 0.5)
				side = 1;
			array<int> lines = m_Lines0;
			int top = m_Top0;
			if (side == 1)
			{
				lines = m_Lines1;
				top = m_Top1;
			}
			int line = top + k;
			if (line < lines.Count() && lines.Get(line) >= 0)
			{
				int was = m_Sel0;
				if (side == 1)
					was = m_Sel1;
				if (side != m_Side || line != was)
				{
					m_Side = side;
					if (side == 0)
						m_Sel0 = line;
					else
						m_Sel1 = line;
					Render();
				}
			}
			else
				inRows = false;
		}
		if (click && inRows)
			Trade(qty);
	}
}

// ---- quest tracker (HUD) + journal menu (client only) -------------------------------
class DSJournalUI
{
	// tracker
	ref array<Widget> m_Hud;
	TextWidget m_HudTitle;
	ref array<TextWidget> m_HudLines;
	TextWidget m_HudHint;
	TextWidget m_Marker;
	TextWidget m_Banner;
	TextWidget m_BannerSub;
	ref array<string> m_BannerQueue;
	float m_BannerT;
	string m_Tracked;
	bool m_TrackedLoaded;
	vector m_Target;
	bool m_HasTarget;

	// journal
	bool m_Open;
	ref array<Widget> m_All;
	ref array<TextWidget> m_ListRows;
	ref array<TextWidget> m_DetailRows;
	TextWidget m_TabActive;
	TextWidget m_TabDone;
	TextWidget m_Foot;
	ref array<int> m_Shown;     // indexes into the journal for the current tab
	int m_Tab;                  // 0 active, 1 completed
	int m_Sel;
	float m_PX;
	float m_PY;
	float m_PW;
	float m_PH;
	ref map<int, bool> m_Prev;
	bool m_MouseDown;
	DSJournal m_Last;           // previous snapshot, for change banners
	float m_Age;
	int m_Rows;
	bool m_ConfirmAbandon;

	void DSJournalUI()
	{
		m_Hud = new array<Widget>;
		m_HudLines = new array<TextWidget>;
		m_BannerQueue = new array<string>;
		m_All = new array<Widget>;
		m_ListRows = new array<TextWidget>;
		m_DetailRows = new array<TextWidget>;
		m_Shown = new array<int>;
		m_Prev = new map<int, bool>;
	}

	bool IsOpen()
	{
		return m_Open;
	}

	bool Pressed(int key)
	{
		bool now = KeyState(key) != 0;
		bool was = false;
		m_Prev.Find(key, was);
		m_Prev.Set(key, now);
		return now && !was;
	}

	DSJQuest Quest(int idx)
	{
		DSJournal jn = DSQuests.Get().m_Journal;
		if (!jn || idx < 0 || idx >= jn.quests.Count())
			return null;
		return jn.quests.Get(idx);
	}

	DSJQuest TrackedQuest()
	{
		DSJournal jn = DSQuests.Get().m_Journal;
		if (!jn)
			return null;
		for (int i = 0; i < jn.quests.Count(); i++)
		{
			if (jn.quests.Get(i).id == m_Tracked && jn.quests.Get(i).status == 1)
				return jn.quests.Get(i);
		}
		return null;
	}

	void SaveTracked()
	{
		MakeDirectory("$profile:DZStudioQuests");
		FileHandle fh = OpenFile("$profile:DZStudioQuests/tracked.txt", FileMode.WRITE);
		if (fh)
		{
			FPrintln(fh, m_Tracked);
			CloseFile(fh);
		}
	}

	void Banner(string title, string sub)
	{
		m_BannerQueue.Insert(title);
		m_BannerQueue.Insert(sub);
	}

	// a new snapshot arrived: diff against the previous one for banners, keep a valid tracked quest
	void OnJournal(DSJournal jn)
	{
		if (!m_TrackedLoaded)
		{
			m_TrackedLoaded = true;
			FileHandle fh = OpenFile("$profile:DZStudioQuests/tracked.txt", FileMode.READ);
			if (fh)
			{
				string line;
				if (FGets(fh, line) > 0)
				{
					line.Trim();
					m_Tracked = line;
				}
				CloseFile(fh);
			}
		}
		for (int i = 0; i < jn.quests.Count(); i++)
		{
			DSJQuest nq = jn.quests.Get(i);
			DSJQuest oq = null;
			if (m_Last)
			{
				for (int k = 0; k < m_Last.quests.Count(); k++)
				{
					if (m_Last.quests.Get(k).id == nq.id)
						oq = m_Last.quests.Get(k);
				}
			}
			if (m_Last && !oq && nq.status == 1)
			{
				Banner("New quest", nq.name);
				m_Tracked = nq.id;
				SaveTracked();
			}
			else if (oq && oq.status == 1 && nq.status == 2)
				Banner("Quest completed", nq.name);
			else if (oq && nq.status == 1)
			{
				int doneOld = 0;
				int doneNew = 0;
				int bonusOld = 0;
				int bonusNew = 0;
				for (int a = 0; a < oq.objectives.Count(); a++)
				{
					if (oq.objectives.Get(a).done && oq.objectives.Get(a).optional)
						bonusOld++;
					else if (oq.objectives.Get(a).done)
						doneOld++;
				}
				for (int b = 0; b < nq.objectives.Count(); b++)
				{
					if (nq.objectives.Get(b).done && nq.objectives.Get(b).optional)
						bonusNew++;
					else if (nq.objectives.Get(b).done)
						doneNew++;
				}
				if (bonusNew > bonusOld)
					Banner("Bonus objective completed", nq.name);
				else if (doneNew > doneOld)
					Banner("Objective completed", nq.name);
			}
		}
		// keep tracking something sensible
		bool ok = false;
		for (int j = 0; j < jn.quests.Count(); j++)
		{
			if (jn.quests.Get(j).id == m_Tracked && jn.quests.Get(j).status == 1)
				ok = true;
		}
		if (!ok)
		{
			m_Tracked = "";
			for (int c = 0; c < jn.quests.Count(); c++)
			{
				if (jn.quests.Get(c).status == 1)
					m_Tracked = jn.quests.Get(c).id;
			}
		}
		m_Last = jn;
	}

	void Refresh()
	{
		if (!m_Open)
			return;
		Rebuild();
		RenderJournal();
	}

	string Bearing(vector from, float x, float z)
	{
		float dx = x - from[0];
		float dz = z - from[2];
		float deg = Math.Atan2(dx, dz) * Math.RAD2DEG;
		if (deg < 0)
			deg = deg + 360;
		int idx = (int)((deg + 22.5) / 45) % 8;
		if (idx == 0)
			return "N";
		if (idx == 1)
			return "NE";
		if (idx == 2)
			return "E";
		if (idx == 3)
			return "SE";
		if (idx == 4)
			return "S";
		if (idx == 5)
			return "SW";
		if (idx == 6)
			return "W";
		return "NW";
	}

	static string ObjText(DSJObjective o)
	{
		string t = o.text;
		if (o.optional)
			t = "(Bonus) " + t;
		if (o.target > 1 && !o.done && !o.missed)
			t = t + "  " + (int)o.progress + "/" + (int)o.target;
		if (o.missed)
			t = t + "  - missed";
		return t;
	}

	// ---------------- tracker ----------------
	void BuildHud()
	{
		int sw, sh;
		GetScreenSize(sw, sh);
		float w = 560;
		float x = sw - w - 30;
		float y = sh * 0.16;
		m_HudTitle = DSQText(x, y, w, 38, 32, 0xFFE8D29A, 990);
		m_HudLines.Clear();
		for (int i = 0; i < 4; i++)
		{
			TextWidget tl = DSQText(x + 12, y + 42 + i * 32, w - 12, 32, 26, 0xFFFFFFFF, 990);
			m_HudLines.Insert(tl);
		}
		m_HudHint = DSQText(x, y + 42 + 4 * 32, w, 26, 20, 0xFF9A9A9A, 990);
		m_Marker = DSQText(0, 0, 240, 32, 24, 0xFFFFE9A8, 980);
		m_Banner = DSQText(sw * 0.5 - 400, sh * 0.12, 800, 44, 36, 0x00FFE9A8, 995);
		m_BannerSub = DSQText(sw * 0.5 - 400, sh * 0.12 + 46, 800, 32, 26, 0x00FFFFFF, 995);
		m_Banner.SetText("");
		m_BannerSub.SetText("");
		m_HudTitle.Show(false);
		m_Marker.Show(false);
		m_HudHint.Show(false);
		for (int k = 0; k < m_HudLines.Count(); k++)
			m_HudLines.Get(k).Show(false);
	}

	void UpdateHud(float dt, bool hide)
	{
		if (!m_HudTitle)
			BuildHud();

		// banner queue (fade in / hold / fade out)
		if (m_BannerQueue.Count() >= 2 || m_BannerT > 0)
		{
			if (m_BannerT <= 0)
			{
				m_Banner.SetText(m_BannerQueue.Get(0));
				m_BannerSub.SetText(m_BannerQueue.Get(1));
				m_BannerQueue.RemoveOrdered(0);
				m_BannerQueue.RemoveOrdered(0);
				m_BannerT = 4.2;
			}
			m_BannerT = m_BannerT - dt;
			float a = 1;
			if (m_BannerT > 3.7)
				a = (4.2 - m_BannerT) / 0.5;
			else if (m_BannerT < 0.6)
				a = m_BannerT / 0.6;
			if (a < 0)
				a = 0;
			if (a > 1)
				a = 1;
			int ai = (int)(a * 255);
			m_Banner.SetColor((ai << 24) | 0x00E8D29A);
			m_BannerSub.SetColor((ai << 24) | 0x00FFFFFF);
			if (m_BannerT <= 0)
			{
				m_Banner.SetText("");
				m_BannerSub.SetText("");
			}
		}

		DSJQuest q = TrackedQuest();
		PlayerBase me = PlayerBase.Cast(GetGame().GetPlayer());
		bool show = q != null && !hide && me != null;
		m_HudTitle.Show(show);
		m_HudHint.Show(show);
		for (int k = 0; k < m_HudLines.Count(); k++)
			m_HudLines.Get(k).Show(false);
		m_Marker.Show(false);
		if (!show)
			return;

		m_HudTitle.SetText(q.name);
		int shown = 0;
		DSJObjective target = null;
		vector pp = me.GetPosition();
		for (int i = 0; i < q.objectives.Count() && shown < 4; i++)
		{
			DSJObjective o = q.objectives.Get(i);
			if (o.done)
				continue;
			TextWidget tl = m_HudLines.Get(shown);
			string line = "- " + ObjText(o);
			if (o.hasPos)
			{
				float d = Math.Sqrt((o.x - pp[0]) * (o.x - pp[0]) + (o.z - pp[2]) * (o.z - pp[2]));
				line = line + "  [" + (int)d + " m " + Bearing(pp, o.x, o.z) + "]";
				if (!target || (target.optional && !o.optional))
					target = o;   // the on-screen marker prefers the main objective over a bonus
			}
			if (o.optional)
				tl.SetColor(0xFFD9C27A);
			else
				tl.SetColor(0xFFFFFFFF);
			tl.SetText(line);
			tl.Show(true);
			shown++;
		}
		m_HudHint.SetText("[J] Journal");

		// world marker over the objective position
		if (target)
		{
			vector wp = Vector(target.x, GetGame().SurfaceY(target.x, target.z) + 3, target.z);
			vector sp = GetGame().GetScreenPos(wp);
			if (sp[2] > 0 && sp[2] < 3000)
			{
				float dist = Math.Sqrt((target.x - pp[0]) * (target.x - pp[0]) + (target.z - pp[2]) * (target.z - pp[2]));
				m_Marker.SetText("< " + (int)dist + " m >");
				m_Marker.SetPos(sp[0] - 110, sp[1] - 14, true);
				m_Marker.Show(true);
			}
		}
	}

	// ---------------- journal menu ----------------
	void Rebuild()
	{
		m_Shown.Clear();
		DSJournal jn = DSQuests.Get().m_Journal;
		if (!jn)
			return;
		int want = 1;
		if (m_Tab == 1)
			want = 2;
		for (int i = 0; i < jn.quests.Count(); i++)
		{
			if (jn.quests.Get(i).status == want)
				m_Shown.Insert(i);
		}
		if (m_Sel >= m_Shown.Count())
			m_Sel = m_Shown.Count() - 1;
		if (m_Sel < 0)
			m_Sel = 0;
	}

	void OpenJournal()
	{
		if (m_Open)
			return;
		m_Open = true;
		m_Age = 0;
		m_Tab = 0;
		m_Sel = 0;
		int sw, sh;
		GetScreenSize(sw, sh);
		m_PW = sw * 0.62;
		m_PH = sh * 0.68;
		m_PX = (sw - m_PW) * 0.5;
		m_PY = (sh - m_PH) * 0.5;

		Widget bg = DSQRect(m_PX, m_PY, m_PW, m_PH, 0xE0101010, 1000);
		if (bg)
			m_All.Insert(bg);
		Widget rule = DSQRect(m_PX + 24, m_PY + 62, m_PW - 48, 2, 0xFFC8A864, 1001);
		if (rule)
			m_All.Insert(rule);
		Widget split = DSQRect(m_PX + m_PW * 0.36, m_PY + 76, 1, m_PH - 140, 0x60C8A864, 1001);
		if (split)
			m_All.Insert(split);
		TextWidget title = DSQText(m_PX + 24, m_PY + 12, 360, 44, 40, 0xFFE8D29A, 1002);
		title.SetText("JOURNAL");
		m_All.Insert(title);
		m_TabActive = DSQText(m_PX + m_PW * 0.36, m_PY + 18, 200, 34, 28, 0xFFFFFFFF, 1002);
		m_TabDone = DSQText(m_PX + m_PW * 0.36 + 220, m_PY + 18, 260, 34, 28, 0xFFFFFFFF, 1002);
		m_All.Insert(m_TabActive);
		m_All.Insert(m_TabDone);
		m_Rows = (int)((m_PH - 160) / 36);
		if (m_Rows > 14)
			m_Rows = 14;
		m_ListRows.Clear();
		for (int i = 0; i < m_Rows; i++)
		{
			TextWidget r = DSQText(m_PX + 24, m_PY + 80 + i * 36, m_PW * 0.36 - 40, 34, 27, 0xFFCCCCCC, 1002);
			m_ListRows.Insert(r);
			m_All.Insert(r);
		}
		m_DetailRows.Clear();
		int dr = (int)((m_PH - 160) / 34);
		for (int j = 0; j < dr; j++)
		{
			TextWidget d = DSQText(m_PX + m_PW * 0.36 + 24, m_PY + 80 + j * 34, m_PW * 0.64 - 48, 34, 26, 0xFFFFFFFF, 1002);
			m_DetailRows.Insert(d);
			m_All.Insert(d);
		}
		m_Foot = DSQText(m_PX + 24, m_PY + m_PH - 48, m_PW - 48, 34, 23, 0xFFB0B0B0, 1002);
		m_All.Insert(m_Foot);

		GetGame().GetMission().PlayerControlDisable(INPUT_EXCLUDE_ALL);
		GetGame().GetUIManager().ShowUICursor(true);
		Pressed(KeyCode.KC_J);
		Pressed(KeyCode.KC_ESCAPE);
		Pressed(KeyCode.KC_UP);
		Pressed(KeyCode.KC_DOWN);
		Pressed(KeyCode.KC_LEFT);
		Pressed(KeyCode.KC_RIGHT);
		Pressed(KeyCode.KC_T);
		Pressed(KeyCode.KC_A);
		Pressed(KeyCode.KC_M);
		Pressed(KeyCode.KC_RETURN);
		m_MouseDown = (GetMouseState(MouseState.LEFT) & MB_PRESSED_MASK) != 0;
		Rebuild();
		RenderJournal();
	}

	void CloseJournal()
	{
		if (!m_Open)
			return;
		for (int i = 0; i < m_All.Count(); i++)
		{
			Widget w = m_All.Get(i);
			if (w)
				w.Unlink();
		}
		m_All.Clear();
		m_ListRows.Clear();
		m_DetailRows.Clear();
		m_Open = false;
		GetGame().GetMission().PlayerControlEnable(true);
		GetGame().GetUIManager().ShowUICursor(false);
	}

	void RenderJournal()
	{
		DSJournal jn = DSQuests.Get().m_Journal;
		int nActive = 0;
		int nDone = 0;
		if (jn)
		{
			for (int c = 0; c < jn.quests.Count(); c++)
			{
				if (jn.quests.Get(c).status == 1)
					nActive++;
				else
					nDone++;
			}
		}
		string ta = "Active (" + nActive + ")";
		string td = "Completed (" + nDone + ")";
		if (m_Tab == 0)
			ta = "> " + ta;
		else
			td = "> " + td;
		m_TabActive.SetText(ta);
		m_TabActive.SetColor(0xFFFFE9A8);
		m_TabDone.SetText(td);
		m_TabDone.SetColor(0xFFFFE9A8);
		if (m_Tab == 0)
			m_TabDone.SetColor(0xFF9A9A9A);
		else
			m_TabActive.SetColor(0xFF9A9A9A);

		for (int i = 0; i < m_ListRows.Count(); i++)
		{
			TextWidget r = m_ListRows.Get(i);
			if (i >= m_Shown.Count())
			{
				r.SetText("");
				continue;
			}
			DSJQuest q = Quest(m_Shown.Get(i));
			string mark = "   ";
			int col = 0xFFCCCCCC;
			if (i == m_Sel)
			{
				mark = "> ";
				col = 0xFFFFE9A8;
			}
			string tr = "";
			if (q.id == m_Tracked)
				tr = "  *";
			r.SetColor(col);
			r.SetText(mark + q.name + tr);
		}

		for (int k = 0; k < m_DetailRows.Count(); k++)
			m_DetailRows.Get(k).SetText("");
		DSJQuest cur = null;
		if (m_Sel < m_Shown.Count())
			cur = Quest(m_Shown.Get(m_Sel));
		int line = 0;
		if (!cur)
		{
			if (m_DetailRows.Count() > 0)
				m_DetailRows.Get(0).SetText("No quests here yet.");
			m_Foot.SetText("[J] / [Esc] Close     [Left / Right] Switch tab     [M] Map");
			return;
		}
		array<string> wrapped = new array<string>;
		DSQWrap(cur.name, 40, wrapped);
		TextWidget h = m_DetailRows.Get(line);
		h.SetColor(0xFFE8D29A);
		h.SetText(cur.name);
		line++;
		line++;
		if (cur.description != "")
		{
			DSQWrap(cur.description, 46, wrapped);
			for (int w = 0; w < wrapped.Count() && line < m_DetailRows.Count() - 4; w++)
			{
				TextWidget dw = m_DetailRows.Get(line);
				dw.SetColor(0xFFDDDDDD);
				dw.SetText(wrapped.Get(w));
				line++;
			}
			line++;
		}
		if (cur.objectives.Count() > 0 && line < m_DetailRows.Count())
		{
			TextWidget oh = m_DetailRows.Get(line);
			oh.SetColor(0xFFC8A864);
			oh.SetText("Objectives");
			line++;
		}
		for (int o = 0; o < cur.objectives.Count() && line < m_DetailRows.Count(); o++)
		{
			DSJObjective ob = cur.objectives.Get(o);
			TextWidget ot = m_DetailRows.Get(line);
			string pre = "[ ] ";
			int oc = 0xFFFFFFFF;
			if (ob.optional)
				oc = 0xFFD9C27A;
			if (ob.done)
			{
				pre = "[x] ";
				oc = 0xFF8FCB8F;
			}
			else if (ob.missed)
			{
				pre = "[-] ";
				oc = 0xFF8A8A8A;
			}
			ot.SetColor(oc);
			ot.SetText(pre + ObjText(ob));
			line++;
		}
		string foot = "[J] Close   [Up/Down] Select   [Left/Right] Tab   [M] Map";
		if (cur.status == 1)
		{
			foot = foot + "   [T] Track";
			if (cur.canAbandon)
			{
				if (m_ConfirmAbandon)
					foot = "Abandon this quest?  Press [A] again to confirm, any other key to cancel.";
				else
					foot = foot + "   [A] Abandon";
			}
		}
		m_Foot.SetText(foot);
	}

	void Update(float dt, bool dialogOpen)
	{
		bool jKey = Pressed(KeyCode.KC_J);
		UpdateHud(dt, m_Open || dialogOpen || GetGame().GetUIManager().GetMenu() != null);   // no tracker over the map, inventory or menus
		if (dialogOpen)
			return;
		if (!m_Open)
		{
			if (jKey && DSQuests.Get().m_Journal != null && !GetGame().GetUIManager().GetMenu())
				OpenJournal();
			return;
		}
		m_Age += dt;
		bool esc = Pressed(KeyCode.KC_ESCAPE);
		bool up = Pressed(KeyCode.KC_UP);
		bool down = Pressed(KeyCode.KC_DOWN);
		bool left = Pressed(KeyCode.KC_LEFT);
		bool right = Pressed(KeyCode.KC_RIGHT);
		bool track = Pressed(KeyCode.KC_T) || Pressed(KeyCode.KC_RETURN);
		bool abandon = Pressed(KeyCode.KC_A);
		bool mapKey = Pressed(KeyCode.KC_M);
		if (esc || (jKey && m_Age > 0.2))
		{
			CloseJournal();
			return;
		}
		if (mapKey)
		{
			DSJQuest onMap = null;
			if (m_Sel < m_Shown.Count())
				onMap = Quest(m_Shown.Get(m_Sel));
			CloseJournal();
			DSQuests.Get().RequestMap(onMap);
			return;
		}
		bool changed = false;
		if (up && m_Sel > 0)
		{
			m_Sel--;
			changed = true;
		}
		if (down && m_Sel < m_Shown.Count() - 1)
		{
			m_Sel++;
			changed = true;
		}
		if ((left && m_Tab == 1) || (right && m_Tab == 0))
		{
			if (m_Tab == 0)
				m_Tab = 1;
			else
				m_Tab = 0;
			m_Sel = 0;
			Rebuild();
			changed = true;
		}

		// mouse: click a quest or a tab
		bool md = (GetMouseState(MouseState.LEFT) & MB_PRESSED_MASK) != 0;
		if (md && !m_MouseDown)
		{
			int mx, my;
			GetMousePos(mx, my);
			for (int i = 0; i < m_Shown.Count() && i < m_ListRows.Count(); i++)
			{
				float ry = m_PY + 80 + i * 36;
				if (mx >= m_PX + 24 && mx <= m_PX + m_PW * 0.36 && my >= ry && my < ry + 36)
				{
					m_Sel = i;
					changed = true;
				}
			}
			if (my >= m_PY + 14 && my <= m_PY + 58)
			{
				if (mx >= m_PX + m_PW * 0.36 && mx < m_PX + m_PW * 0.36 + 200)
				{
					m_Tab = 0;
					m_Sel = 0;
					Rebuild();
					changed = true;
				}
				else if (mx >= m_PX + m_PW * 0.36 + 220 && mx < m_PX + m_PW * 0.36 + 480)
				{
					m_Tab = 1;
					m_Sel = 0;
					Rebuild();
					changed = true;
				}
			}
		}
		m_MouseDown = md;

		DSJQuest cur = null;
		if (m_Sel < m_Shown.Count())
			cur = Quest(m_Shown.Get(m_Sel));
		if (cur && track && cur.status == 1)
		{
			if (m_Tracked == cur.id)
				m_Tracked = "";
			else
				m_Tracked = cur.id;
			SaveTracked();
			changed = true;
		}
		if (up || down || left || right || track)
			m_ConfirmAbandon = false;
		if (cur && abandon && cur.status == 1 && cur.canAbandon)
		{
			if (m_ConfirmAbandon)
			{
				m_ConfirmAbandon = false;
				DSQuests.Get().SendToServer(DSQ_RPC_ABANDON, cur.id, "");
			}
			else
				m_ConfirmAbandon = true;
			changed = true;
		}
		if (changed)
			RenderJournal();
	}
}

// a condition built by generated code (effects, item requirements)
DSCond DSMakeCond(string kind, string cls, int n, string quest, string var, string op, float value, float to, string stat, bool neg)
{
	DSCond c = new DSCond();
	c.kind = kind;
	c.cls = cls;
	c.n = n;
	c.quest = quest;
	c.var = var;
	c.op = op;
	c.value = value;
	c.to = to;
	c.stat = stat;
	c.neg = neg;
	return c;
}

// ---- placed effects: looping sounds, particles and lights at map positions ------
// Definitions are compiled into the mod (DSFxData in DSCustom.c). The server decides which are on (condition, quest
// switch) and tells the players; each player's game plays the ones within range.
class DSFxDef
{
	string id;
	vector pos;
	int particle;        // ParticleList id, -1 = none
	float repeat;        // seconds: replay a one-shot particle (sparks, explosion); 0 = play once / loops itself
	bool light;
	float r;
	float g;
	float b;
	float radius;
	float brightness;
	string soundset;     // vanilla or DSQFX_<id>_SoundSet for your own file; "" = none
	float range;         // metres: players closer than this see / hear it
	bool startOff;       // off until a "Turn Effect On" quest node switches it on
	ref DSCond cond;     // only while this holds (server-side)
}

class DSFxLight extends PointLightBase
{
	void DSFxLight()
	{
		SetVisibleDuringDaylight(true);
		SetCastShadow(false);
		SetFlareVisible(false);
	}
}

class DSFxRun
{
	ParticleSource p;
	ref EffectSound snd;
	DSFxLight light;
	float t;
}

class DSFx
{
	static ref array<ref DSFxDef> s_Defs;
	static ref map<string, bool> s_On;          // client: switched on by the server
	static ref map<string, ref DSFxRun> s_Run;  // client: playing right now
	static float s_T;

	static void Defs()
	{
		if (s_Defs)
			return;
		s_Defs = new array<ref DSFxDef>;
		DSFxData.Fill();
	}

	static DSFxDef Add(string id, float x, float y, float z, int particle, float repeat, bool light, float r, float g, float b, float radius, float brightness, string soundset, float range, bool startOff)
	{
		DSFxDef d = new DSFxDef();
		d.id = id;
		d.pos = Vector(x, y, z);
		if (y == 0)
			d.pos[1] = GetGame().SurfaceY(x, z);
		d.particle = particle;
		d.repeat = repeat;
		d.light = light;
		d.r = r;
		d.g = g;
		d.b = b;
		d.radius = radius;
		d.brightness = brightness;
		d.soundset = soundset;
		d.range = range;
		d.startOff = startOff;
		s_Defs.Insert(d);
		return d;
	}


	// client: the server's list "id,id,"
	static void SetActive(string list)
	{
		if (!s_On)
			s_On = new map<string, bool>;
		s_On.Clear();
		TStringArray ids = new TStringArray;
		list.Split(",", ids);
		for (int i = 0; i < ids.Count(); i++)
		{
			if (ids.Get(i) != "")
				s_On.Set(ids.Get(i), true);
		}
	}

	static void Stop(DSFxRun run)
	{
		if (run.p)
			run.p.StopParticle();
		if (run.snd)
			run.snd.SoundStop();
		if (run.light)
			run.light.FadeOut(1);
	}

	static void ClientUpdate(float dt)
	{
		Defs();
		if (!s_On)
			s_On = new map<string, bool>;
		if (!s_Run)
			s_Run = new map<string, ref DSFxRun>;
		s_T += dt;
		if (s_T < 0.5)
			return;
		float step = s_T;
		s_T = 0;
		vector cam = GetGame().GetCurrentCameraPosition();
		for (int i = 0; i < s_Defs.Count(); i++)
		{
			DSFxDef d = s_Defs.Get(i);
			bool want = false;   // (plain ifs: Enforce mis-evaluates && chains assigned to a bool)
			if (s_On.Contains(d.id))
			{
				if (vector.Distance(cam, d.pos) < d.range)
					want = true;
			}
			DSFxRun run = null;
			s_Run.Find(d.id, run);
			if (!want)
			{
				if (run)
				{
					Stop(run);
					s_Run.Remove(d.id);
					Print("[DZStudio] effect " + d.id + " stops");
				}
				continue;
			}
			if (!run)
			{
				run = new DSFxRun();
				s_Run.Set(d.id, run);
				Print("[DZStudio] effect " + d.id + " starts");
				if (d.particle >= 0)
					run.p = ParticleManager.GetInstance().PlayInWorld(d.particle, d.pos);
				if (d.soundset != "")
					run.snd = SEffectManager.PlaySound(d.soundset, d.pos, 1, 1, true);
				if (d.light)
				{
					run.light = DSFxLight.Cast(ScriptedLightBase.CreateLight(DSFxLight, d.pos + Vector(0, 1, 0)));
					if (run.light)
					{
						run.light.SetDiffuseColor(d.r, d.g, d.b);
						run.light.SetAmbientColor(d.r, d.g, d.b);
						run.light.SetRadiusTo(d.radius);
						run.light.SetBrightnessTo(d.brightness);
					}
				}
				continue;
			}
			// one-shot particles (sparks, explosions) replay every few seconds
			if (d.particle >= 0 && d.repeat > 0)
			{
				run.t += step;
				if (run.t >= d.repeat)
				{
					run.t = 0;
					run.p = ParticleManager.GetInstance().PlayInWorld(d.particle, d.pos);
				}
			}
		}
	}
}

// ---- item requirements: "you need Rifle skill 5 to use the M4A1" --------------------
// Rules are compiled into the mod (DSReqData in DSCustom.c). Both sides check: the player's PC for instant feedback
// (with the stats and quests it was sent), the server decides.
class DSReqDef
{
	string cls;
	bool exact;          // this class only (otherwise every class that inherits from it)
	ref DSCond cond;
	string msg;
}

class DSItemGate
{
	static ref array<ref DSReqDef> s_Reqs;
	static float s_LastT;
	static string s_LastCls;

	static void Defs()
	{
		if (s_Reqs)
			return;
		s_Reqs = new array<ref DSReqDef>;
		DSReqData.Fill();
	}

	static DSReqDef Add(string cls, bool exact, string msg)
	{
		DSReqDef d = new DSReqDef();
		d.cls = cls;
		d.exact = exact;
		d.msg = msg;
		s_Reqs.Insert(d);
		return d;
	}

	static bool Allow(PlayerBase p, EntityAI item)
	{
		Defs();
		if (s_Reqs.Count() == 0)
			return true;
		if (!item || !p)
			return true;
		DSQuests dq = DSQuests.Get();
		if (dq.m_NpcObjs.Find(p) >= 0)
			return true;   // quest NPCs wear whatever Studio gave them
		bool server = GetGame().IsServer();
		bool mp = GetGame().IsMultiplayer();
		if (server && mp && !p.GetIdentity())
			return true;   // NPCs / AI on a server
		if (server && mp)
		{
			if (!dq.m_Players.Contains(dq.PlayerId(p)))
				return true;   // the character is still loading (items restored into the hands at login)
		}
		if (!server && p != GetGame().GetPlayer())
			return true;   // a player's PC only judges its own character
		for (int i = 0; i < s_Reqs.Count(); i++)
		{
			DSReqDef r = s_Reqs.Get(i);
			bool match = false;
			if (r.exact)
			{
				if (item.GetType() == r.cls)
					match = true;
			}
			else if (item.IsKindOf(r.cls))
				match = true;
			if (!match)
				continue;
			if (dq.CondFor(p, r.cond))
				continue;
			Tell(p, item, r.msg);
			return false;
		}
		return true;
	}

	// these checks run often (looking at an item, dragging it): one message per item every few seconds
	static void Tell(PlayerBase p, EntityAI item, string msg)
	{
		if (msg == "")
			msg = "You can't use this yet.";
		float now = GetGame().GetTickTime();
		DSQuests dq = DSQuests.Get();
		if (GetGame().IsDedicatedServer())
		{
			string key = dq.PlayerId(p) + "|" + item.GetType();
			float last = -100;
			dq.m_MsgT.Find(key, last);
			if (now - last < 6)
				return;
			dq.m_MsgT.Set(key, now);
			dq.SendMsg(p, "Requirement", msg);
			return;
		}
		if (item.GetType() == s_LastCls && now - s_LastT < 6)
			return;
		s_LastCls = item.GetType();
		s_LastT = now;
		dq.ShowMsg("Requirement", msg);
	}
}

// ---- HUD widgets made in Studio (bars and text bound to the player's stats) ------------
class DSHudDef
{
	string id;
	string type;      // bar | text | panel
	float x;          // fractions of the screen
	float y;
	float w;
	float h;
	int color;
	int bg;
	int size;
	string stat;      // bar: the stat it shows
	string text;      // "{xp} / {xp.max} XP" - {id}, {id.max}, {id.name}
	float px;
	float py;
	float pw;
	float ph;
	Widget wBg;
	Widget wFill;
	TextWidget wText;
}

class DSHud
{
	static ref array<ref DSHudDef> s_Defs;
	static bool s_Built;
	static float s_T;

	static void Defs()
	{
		if (s_Defs)
			return;
		s_Defs = new array<ref DSHudDef>;
		DSHudData.Fill();
	}

	static DSHudDef Add(string id, string type, float x, float y, float w, float h, int color, int bg, int size, string stat, string text)
	{
		DSHudDef d = new DSHudDef();
		d.id = id;
		d.type = type;
		d.x = x;
		d.y = y;
		d.w = w;
		d.h = h;
		d.color = color;
		d.bg = bg;
		d.size = size;
		d.stat = stat;
		d.text = text;
		s_Defs.Insert(d);
		return d;
	}

	static void Build()
	{
		int sw, sh;
		GetScreenSize(sw, sh);
		for (int i = 0; i < s_Defs.Count(); i++)
		{
			DSHudDef d = s_Defs.Get(i);
			d.px = d.x * sw;
			d.py = d.y * sh;
			d.pw = d.w * sw;
			d.ph = d.h * sh;
			if (d.type == "bar" || d.type == "panel")
				d.wBg = DSQRect(d.px, d.py, d.pw, d.ph, d.bg, 985);
			if (d.type == "bar")
				d.wFill = DSQRect(d.px, d.py, d.pw, d.ph, d.color, 986);
			if (d.type == "text" || d.text != "")
			{
				int tc = 0xFFFFFFFF;
				if (d.type == "text")
					tc = d.color;
				d.wText = DSQText(d.px + 6, d.py, d.pw - 12, d.ph, d.size, tc, 987);
			}
		}
		s_Built = true;
	}

	// "{xp} / {xp.max} XP" -> "120 / 1000 XP"
	static string Format(string t, DSJournal jn)
	{
		string r = t;
		if (!jn)
			return r;
		for (int i = 0; i < jn.stats.Count(); i++)
		{
			DSJStat st = jn.stats.Get(i);
			int v = (int)st.v;
			int mx = (int)st.max;
			r.Replace("{" + st.id + ".max}", mx.ToString());
			r.Replace("{" + st.id + ".name}", st.name);
			r.Replace("{" + st.id + "}", v.ToString());
		}
		// faction standings: {rep.survivors} = points, {rep.survivors.tier} = "Friendly"
		for (int f = 0; f < jn.reps.Count(); f++)
		{
			DSJRep jr = jn.reps.Get(f);
			r.Replace("{rep." + jr.id + ".tier}", jr.tierName);
			r.Replace("{rep." + jr.id + ".name}", jr.name);
			r.Replace("{rep." + jr.id + "}", jr.v.ToString());
		}
		return r;
	}

	static void Show(DSHudDef d, bool on)
	{
		if (d.wBg)
			d.wBg.Show(on);
		if (d.wFill)
			d.wFill.Show(on);
		if (d.wText)
			d.wText.Show(on);
	}

	static void Update(float dt, bool covered, DSJournal jn)
	{
		Defs();
		if (s_Defs.Count() == 0)
			return;
		if (!s_Built)
			Build();
		s_T += dt;
		if (s_T < 0.25)
			return;
		s_T = 0;
		bool show = true;   // (plain ifs: Enforce mis-evaluates && chains assigned to a bool)
		if (covered)
			show = false;
		if (!jn)
			show = false;
		Man hudMe = GetGame().GetPlayer();
		if (!hudMe)
			show = false;
		else if (!hudMe.IsAlive())
			show = false;
		for (int i = 0; i < s_Defs.Count(); i++)
		{
			DSHudDef d = s_Defs.Get(i);
			Show(d, show);
			if (!show)
				continue;
			if (d.wFill)
			{
				float frac = 0;
				DSJStat st = jn.Stat(d.stat);
				if (st && st.max > st.min)
					frac = (st.v - st.min) / (st.max - st.min);
				if (frac < 0)
					frac = 0;
				if (frac > 1)
					frac = 1;
				d.wFill.SetSize(d.pw * frac, d.ph);
			}
			if (d.wText)
				d.wText.SetText(Format(d.text, jn));
		}
	}
}

// ---- character sheet (a key made in Studio): the player's stats ------------------------
class DSSheet
{
	static bool s_Open;
	static bool s_KeyWas;
	static float s_T;
	static ref array<Widget> s_All;

	static bool IsOpen()
	{
		return s_Open;
	}

	static void Close()
	{
		if (s_All)
		{
			for (int i = 0; i < s_All.Count(); i++)
			{
				if (s_All.Get(i))
					s_All.Get(i).Unlink();
			}
			s_All.Clear();
		}
		s_Open = false;
	}

	static void Open(DSJournal jn)
	{
		Close();
		if (!s_All)
			s_All = new array<Widget>;
		int sw, sh;
		GetScreenSize(sw, sh);
		int rows = 0;
		for (int c = 0; c < jn.stats.Count(); c++)
		{
			if (jn.stats.Get(c).sheet)
				rows++;
		}
		int facRows = jn.reps.Count();
		float facH = 0;
		if (facRows > 0)
			facH = 44 + facRows * 52;
		float pw = sw * 0.3;
		float ph = 110 + rows * 62 + facH;
		float px = (sw - pw) * 0.5;
		float py = (sh - ph) * 0.5;
		s_All.Insert(DSQRect(px, py, pw, ph, 0xE0101010, 1000));
		s_All.Insert(DSQRect(px + 24, py + 60, pw - 48, 2, 0xFFC8A864, 1001));
		TextWidget title = DSQText(px + 24, py + 14, pw - 48, 40, 36, 0xFFE8D29A, 1002);
		title.SetText("CHARACTER");
		s_All.Insert(title);
		float y = py + 78;
		for (int i = 0; i < jn.stats.Count(); i++)
		{
			DSJStat st = jn.stats.Get(i);
			if (!st.sheet)
				continue;
			TextWidget n = DSQText(px + 24, y, pw * 0.6, 30, 26, 0xFFFFFFFF, 1002);
			n.SetText(st.name);
			s_All.Insert(n);
			int v = (int)st.v;
			string val = v.ToString();
			if (st.max > st.min)
			{
				int mx = (int)st.max;
				val = val + " / " + mx.ToString();
			}
			TextWidget vt = DSQText(px + pw * 0.55, y, pw * 0.45 - 24, 30, 26, 0xFFFFE9A8, 1002);
			vt.SetText(val);
			s_All.Insert(vt);
			if (st.max > st.min)
			{
				float frac = (st.v - st.min) / (st.max - st.min);
				if (frac < 0)
					frac = 0;
				if (frac > 1)
					frac = 1;
				s_All.Insert(DSQRect(px + 24, y + 34, pw - 48, 10, 0xFF3A3A3A, 1001));
				int col = st.color;
				if (col == 0)
					col = 0xFFC8A864;
				s_All.Insert(DSQRect(px + 24, y + 34, (pw - 48) * frac, 10, col, 1002));
			}
			y += 62;
		}
		// faction standings: name, tier (in the tier's colour) and where the points sit on the scale
		if (facRows > 0)
		{
			TextWidget fh = DSQText(px + 24, y + 4, pw - 48, 30, 24, 0xFFE8D29A, 1002);
			fh.SetText("FACTIONS");
			s_All.Insert(fh);
			y += 44;
			for (int fi = 0; fi < facRows; fi++)
			{
				DSJRep fr = jn.reps.Get(fi);
				TextWidget fn = DSQText(px + 24, y, pw * 0.5, 28, 24, 0xFFFFFFFF, 1002);
				fn.SetText(fr.name);
				s_All.Insert(fn);
				int tc = fr.tierColor;
				if (tc == 0)
					tc = 0xFFFFE9A8;
				TextWidget ft = DSQText(px + pw * 0.45, y, pw * 0.55 - 24, 28, 24, tc, 1002);
				ft.SetText(fr.tierName + "  (" + fr.v.ToString() + ")");
				s_All.Insert(ft);
				float span = fr.max - fr.min;
				float ff = 0.5;
				if (span > 0)
					ff = (fr.v - fr.min) / span;
				if (ff < 0)
					ff = 0;
				if (ff > 1)
					ff = 1;
				s_All.Insert(DSQRect(px + 24, y + 32, pw - 48, 8, 0xFF3A3A3A, 1001));
				s_All.Insert(DSQRect(px + 24 + (pw - 48) * 0.5 - 1, y + 30, 2, 12, 0xFF9A9A9A, 1002));   // the neutral middle
				s_All.Insert(DSQRect(px + 24 + (pw - 48) * ff - 3, y + 29, 6, 14, tc, 1003));
				y += 52;
			}
		}
		TextWidget foot = DSQText(px + 24, py + ph - 34, pw - 48, 26, 20, 0xFF9A9A9A, 1002);
		foot.SetText("[Esc] Close");
		s_All.Insert(foot);
		s_Open = true;
	}

	static void Update(float dt, bool covered, DSJournal jn)
	{
		int key = DSHudData.SheetKey();
		if (key < 0)
			return;
		bool down = KeyState(key) != 0;
		bool pressed = false;
		if (down)
		{
			if (!s_KeyWas)
				pressed = true;
		}
		s_KeyWas = down;
		bool alive = false;
		Man sheetMe = GetGame().GetPlayer();
		if (sheetMe)
			alive = sheetMe.IsAlive();
		if (s_Open)
		{
			if (pressed || KeyState(KeyCode.KC_ESCAPE) != 0 || !alive)
			{
				Close();
				return;
			}
			s_T += dt;
			if (s_T >= 1 && jn)
			{
				s_T = 0;
				Open(jn);   // refresh the numbers
			}
			return;
		}
		if (pressed && !covered && jn && alive)
			Open(jn);
	}
}

// ---- removed map objects --------------------------------------------------------
// The list is compiled into the mod (DSMapEditsData in DSCustom.c), so the server and every player hide the same
// objects: matched by class or model path near the saved position, then hidden like CF's ObjectManager does it.
class DSRemovedObj
{
	string c;      // class name ("" for plain p3d objects)
	string m;      // model path as Object.GetShapeName() reports it (lower case)
	vector pos;
	bool done;

	void DSRemovedObj(string cls, string model, float x, float y, float z)
	{
		c = cls;
		m = model;
		m.ToLower();
		pos = Vector(x, y, z);
	}
}

class DSMapEdits
{
	static ref array<ref DSRemovedObj> s_List;

	static void Add(string cls, string model, float x, float y, float z)
	{
		s_List.Insert(new DSRemovedObj(cls, model, x, y, z));
	}

	// baked into the world (houses, trees, bushes, rocks, plain p3d objects) - never players, zombies or items
	static bool IsMapObject(Object o)
	{
		if (!o)
			return false;
		if (o.GetType() == "" && o.Type() == Object)
			return true;
		return o.IsKindOf("House") || o.IsTree() || o.IsBush() || o.IsRock() || o.IsInherited(Static);
	}

	static void Hide(Object o)
	{
		vector before = o.GetPosition();
		o.ClearFlags(o.GetFlags(), true);
		o.ClearEventMask(o.GetEventMask());
		vector tm[4];
		o.GetTransform(tm);
		tm[3] = tm[3] - Vector(10000, 10000, 10000);
		o.SetTransform(tm);
		o.Update();
		if (o.CanAffectPathgraph())
		{
			vector mm[2];
			float rad = o.ClippingInfo(mm);
			vector rv = Vector(rad, rad, rad);
			GetGame().UpdatePathgraphRegion(before - rv, before + rv);
		}
	}

	// safe to call several times: each entry is hidden once
	static void Apply()
	{
		if (!s_List)
		{
			s_List = new array<ref DSRemovedObj>;
			DSMapEditsData.Fill();
		}
		int hidden = 0;
		int left = 0;
		for (int i = 0; i < s_List.Count(); i++)
		{
			DSRemovedObj r = s_List.Get(i);
			if (r.done)
				continue;
			array<Object> objs = new array<Object>;
			GetGame().GetObjectsAtPosition(r.pos, 1.5, objs, null);
			Object best = null;
			float bestD = 99;
			for (int k = 0; k < objs.Count(); k++)
			{
				Object o = objs.Get(k);
				if (!IsMapObject(o))
					continue;
				bool same = false;
				if (r.c != "" && o.GetType() == r.c)
					same = true;
				if (!same && r.m != "")
				{
					string shape = o.GetShapeName();
					shape.ToLower();
					if (shape == r.m)
						same = true;
				}
				if (!same)
					continue;
				vector op = o.GetPosition();
				float dx = op[0] - r.pos[0];
				float dz = op[2] - r.pos[2];
				float d = Math.Sqrt(dx * dx + dz * dz);
				if (d < bestD)
				{
					bestD = d;
					best = o;
				}
			}
			if (best)
			{
				Hide(best);
				r.done = true;
				hidden++;
			}
			else
				left++;
		}
		if (hidden > 0 || left > 0)
			Print("[DZStudio] Removed map objects: " + hidden + " hidden now, " + left + " not found (yet)");
	}
}

modded class ZombieBase
{
	override void EEKilled(Object killer)
	{
		super.EEKilled(killer);
		DSQuests.Get().OnKill(this, killer);
	}
}

modded class AnimalBase
{
	override void EEKilled(Object killer)
	{
		super.EEKilled(killer);
		DSQuests.Get().OnKill(this, killer);
	}
}

// A faction NPC on guard: stands still with its gun shouldered, aims up / down at its target and plays the recoil
// of a shot. Nobody controls these characters, so vanilla's movement command never raises their weapon - this
// command drives the animation graph directly (variables "Raised", "AimY", command "CMD_WeaponFire").
class DSGuardCmd extends HumanCommandScript
{
	PlayerBase m_P;
	int m_VRaised;
	int m_VAimY;
	int m_VAimX;
	int m_VStance;
	int m_VSpeed;
	int m_CFire;
	float m_AimY;
	float m_Heading;
	bool m_Fire;

	void DSGuardCmd(Human pHuman)
	{
		m_P = PlayerBase.Cast(pHuman);
		HumanAnimInterface hai = pHuman.GetAnimInterface();
		m_VRaised = hai.BindVariableBool("Raised");
		m_VAimY = hai.BindVariableFloat("AimY");
		m_VAimX = hai.BindVariableFloat("AimX");
		m_VStance = hai.BindVariableInt("Stance");
		m_VSpeed = hai.BindVariableFloat("MovementSpeed");
		m_CFire = hai.BindCommand("CMD_WeaponFire");
	}

	override void PreAnimUpdate(float pDt)
	{
		PreAnim_SetBool(m_VRaised, true);
		PreAnim_SetInt(m_VStance, 0);
		PreAnim_SetFloat(m_VSpeed, 0);
		PreAnim_SetFloat(m_VAimX, GUARD_AIM_X);
		PreAnim_SetFloat(m_VAimY, m_AimY);
		SetHeading(m_Heading, 0.15, 6);   // turn smoothly towards the target
		if (m_Fire)
		{
			m_Fire = false;
			PreAnim_CallCommand(m_CFire, 0, 0);
		}
	}

	override void PrePhysUpdate(float pDt)
	{
		PrePhys_SetTranslation(vector.Zero);   // stays where it stands
	}

	override bool PostPhysUpdate(float pDt)
	{
		return true;
	}
}

// a character's heading for a direction: minus its yaw, in radians, kept within +-180 degrees so that it turns the
// short way round (a 0..360 yaw made characters spin almost a full circle for anything west of north)
float DSHeadingTo(vector dir)
{
	float yaw = dir.VectorToAngles()[0];
	if (yaw > 180)
		yaw -= 360;
	return -yaw * Math.DEG2RAD;
}

// A patrolling NPC: walks (or jogs) to the point DSQuests.TickPatrols gives it, steering towards it every frame.
// Like the guard's command it drives the animation graph itself, because nobody controls the character.
class DSPatrolCmd extends HumanCommandScript
{
	PlayerBase m_P;
	int m_VRaised;
	int m_VStance;
	int m_VSpeed;
	int m_VAimX;
	int m_VAimY;
	vector m_To;      // where it walks, or (m_Go false, m_Face true) whom it turns to
	bool m_Go;
	bool m_Face;
	bool m_Run;
	bool m_Turning;   // facing well away from where it goes: turns on the spot first
	float m_Yaw;      // the yaw (degrees) it wants to face
	float m_Turn;     // degrees it turns this frame (applied as the physics step's rotation)

	void DSPatrolCmd(Human pHuman)
	{
		m_P = PlayerBase.Cast(pHuman);
		HumanAnimInterface hai = pHuman.GetAnimInterface();
		m_VRaised = hai.BindVariableBool("Raised");
		m_VStance = hai.BindVariableInt("Stance");
		m_VSpeed = hai.BindVariableFloat("MovementSpeed");
		m_VAimX = hai.BindVariableFloat("AimX");
		m_VAimY = hai.BindVariableFloat("AimY");
		m_Yaw = m_P.GetOrientation()[0];
	}

	// the target at the character's own height: waypoints are stored at y 0, and a point hundreds of metres below
	// it would leak into x / z through any tilt of the body when turned into model space
	vector Target()
	{
		return Vector(m_To[0], m_P.GetPosition()[1], m_To[2]);
	}

	bool Walking()
	{
		if (!m_Go)
			return false;
		vector left = Target() - m_P.GetPosition();
		left[1] = 0;
		return left.Length() > 0.3;
	}

	override void PreAnimUpdate(float pDt)
	{
		bool walking = Walking();
		m_Turning = false;
		m_Turn = 0;
		if (walking || m_Face)
		{
			// turn the body from where it really faces, the short way round, at most 240 degrees a second; walk once
			// it roughly faces the target. (Neither SetHeading nor a post-physics rotation turned it reliably.)
			vector dir = Target() - m_P.GetPosition();
			m_Yaw = dir.VectorToAngles()[0];
			float diff = m_Yaw - m_P.GetOrientation()[0];
			while (diff > 180)
				diff -= 360;
			while (diff < -180)
				diff += 360;
			m_Turning = Math.AbsFloat(diff) > 40;
			float turn = 240 * pDt;
			m_Turn = Math.Clamp(diff, -turn, turn);
		}
		float speed = 0;
		if (walking && !m_Turning)
		{
			speed = 1;
			if (m_Run)
				speed = 2;
		}
		PreAnim_SetBool(m_VRaised, false);
		PreAnim_SetInt(m_VStance, 0);
		PreAnim_SetFloat(m_VSpeed, speed);
		PreAnim_SetFloat(m_VAimX, GUARD_AIM_X);   // head and upper body look where it walks (0 is not straight ahead in this graph)
		PreAnim_SetFloat(m_VAimY, 0);
	}

	override void PrePhysUpdate(float pDt)
	{
		// this frame's turn as the physics step's rotation (and none of the animation's own)
		vector mat[3];
		float q[4];
		Math3D.YawPitchRollMatrix(Vector(m_Turn, 0, 0), mat);
		Math3D.MatrixToQuat(mat, q);
		PrePhys_SetRotation(q);
		if (!Walking() || m_Turning)
		{
			PrePhys_SetTranslation(vector.Zero);
			return;
		}
		// straight at the waypoint at walking / jogging pace, stopping right on it. (The walk animation's own step
		// drifts sideways while the character turns, so it would miss the point and overshoot.)
		vector rel = m_P.WorldToModel(Target());
		rel[1] = 0;
		float left = rel.Length();
		float pace = 1.4;
		if (m_Run)
			pace = 3.0;
		float stride = pace * pDt;
		if (stride > left)
			stride = left;
		rel.Normalize();
		PrePhys_SetTranslation(rel * stride);
	}

	override bool PostPhysUpdate(float pDt)
	{
		return true;
	}
}

modded class PlayerBase
{
	// ---- patrolling NPCs (DSQuests.TickPatrols sets these)
	bool m_DSPatrolWant;
	bool m_DSPatrolGo;
	bool m_DSPatrolFace;
	bool m_DSPatrolRun;
	vector m_DSPatrolTo;
	DSPatrolCmd m_DSPatrolCmd;   // not ref: the engine owns script commands once they are started

	bool DSPatrolCommand(int pCurrentCommandID)
	{
		if (!m_DSPatrolWant)
		{
			if (m_DSPatrolCmd)
			{
				m_DSPatrolCmd.SetFlagFinished(true);
				m_DSPatrolCmd = null;
			}
			return false;
		}
		if (!m_DSPatrolCmd || pCurrentCommandID != DayZPlayerConstants.COMMANDID_SCRIPT)
			m_DSPatrolCmd = DSPatrolCmd.Cast(StartCommand_ScriptInst(DSPatrolCmd));
		if (!m_DSPatrolCmd)
			return false;
		m_DSPatrolCmd.m_To = m_DSPatrolTo;
		m_DSPatrolCmd.m_Go = m_DSPatrolGo;
		m_DSPatrolCmd.m_Face = m_DSPatrolFace;
		m_DSPatrolCmd.m_Run = m_DSPatrolRun;
		return true;
	}

	// ---- faction NPC guards (DSQuests.TickGuards sets these; the command runs in the character's own frame)
	bool m_DSGuardWant;
	bool m_DSGuardFire;
	float m_DSGuardAimY;
	float m_DSGuardHeading;
	DSGuardCmd m_DSGuardCmd;   // not ref: the engine owns script commands once they are started

	override bool ModCommandHandlerBefore(float pDt, int pCurrentCommandID, bool pCurrentCommandFinished)
	{
		if (super.ModCommandHandlerBefore(pDt, pCurrentCommandID, pCurrentCommandFinished))
			return true;
		if (!m_DSGuardWant)
		{
			if (m_DSGuardCmd)
			{
				m_DSGuardCmd.SetFlagFinished(true);   // vanilla starts the normal movement command again
				m_DSGuardCmd = null;
			}
			return DSPatrolCommand(pCurrentCommandID);   // a guard that lowered its gun goes back to its patrol
		}
		m_DSPatrolCmd = null;   // the guard's command takes over from the patrol
		if (!m_DSGuardCmd || pCurrentCommandID != DayZPlayerConstants.COMMANDID_SCRIPT)
			m_DSGuardCmd = DSGuardCmd.Cast(StartCommand_ScriptInst(DSGuardCmd));
		if (!m_DSGuardCmd)
			return false;
		m_DSGuardCmd.m_AimY = m_DSGuardAimY;
		m_DSGuardCmd.m_Heading = m_DSGuardHeading;
		if (m_DSGuardFire)
		{
			m_DSGuardCmd.m_Fire = true;
			m_DSGuardFire = false;
		}
		return true;
	}

	// item requirements (Studio ▸ Player stats ▸ Item requirements)
	override bool CanReceiveItemIntoHands(EntityAI item_to_hands)
	{
		if (!super.CanReceiveItemIntoHands(item_to_hands))
			return false;
		return DSItemGate.Allow(this, item_to_hands);
	}

	override bool CanReceiveAttachment(EntityAI attachment, int slotId)
	{
		if (!super.CanReceiveAttachment(attachment, slotId))
			return false;
		return DSItemGate.Allow(this, attachment);
	}

	override void OnRPC(PlayerIdentity sender, int rpc_type, ParamsReadContext ctx)
	{
		super.OnRPC(sender, rpc_type, ctx);
		if (rpc_type >= DSQ_RPC_NPCS && rpc_type <= DSQ_RPC_LAST)
			DSQuests.Get().HandleRPC(this, sender, rpc_type, ctx);
	}

	override void EEKilled(Object killer)
	{
		super.EEKilled(killer);
		DSQuests.Get().OnKill(this, killer);
		DSQuests.Get().OnPlayerDeath(this);
	}
}
`;

  // play-test: ticks the quest runtime from the game's own mission loop (DayZ Studio's standalone viewport)
  R.hookEditor = String.raw`modded class MissionGameplay
{
	override void OnUpdate(float timeslice)
	{
		super.OnUpdate(timeslice);
		if (FileExist("$profile:DZStudioQuests/playtest.flag"))
		{
			DSQuests.Get().Tick(timeslice);
			DSQuests.Get().ClientTick(timeslice);
		}
		DSOpenRequestedMap();
	}

	override void Pause()
	{
		if (DSQuests.Get().BlockPause())
			return;
		super.Pause();
	}
}
`;

  R.configTest = String.raw`class CfgPatches
{
	class DZStudioQuestTest
	{
		units[] = {};
		weapons[] = {};
		requiredVersion = 0.1;
		requiredAddons[] = {"DZ_Data", "DZ_Scripts"};
	};
};

class CfgMods
{
	class DZStudioQuestTest
	{
		dir = "DZStudioQuestTest";
		picture = "";
		action = "";
		hideName = 1;
		hidePicture = 1;
		name = "DZStudioQuestTest";
		credits = "";
		author = "DayZ Studio";
		authorID = "0";
		version = "1.0";
		extra = 0;
		type = "mod";
		dependencies[] = {"World", "Mission"};

		class defs
		{
			class worldScriptModule
			{
				value = "";
				files[] = {"DZStudioQuestTest/scripts/4_World"};
			};
			class missionScriptModule
			{
				value = "";
				files[] = {"DZStudioQuestTest/scripts/5_Mission"};
			};
		};
	};
};
`;

  R.hookMod = String.raw`// Hooks the quest manager into the server mission loop.
modded class MissionServer
{
	override void OnInit()
	{
		super.OnInit();
		DSQuests.Get().Init();
		DSMapEdits.Apply();
	}

	override void OnUpdate(float timeslice)
	{
		super.OnUpdate(timeslice);
		DSQuests.Get().Tick(timeslice);
	}

	override void InvokeOnDisconnect(PlayerBase player)
	{
		DSQuests.Get().OnDisconnect(player);
		super.InvokeOnDisconnect(player);
	}

	override void OnMissionFinish()
	{
		DSQuests.Get().SaveAll();   // server shutting down
		super.OnMissionFinish();
	}
}

// Clients: interaction prompt and conversation screen.  Offline play has no MissionServer, so tick the quests here too.
modded class MissionGameplay
{
	override void OnInit()
	{
		super.OnInit();
		// players hide the removed map objects too (a little later as well, in case the world was still loading)
		GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(DSMapEdits.Apply, 2000, false);
		GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(DSMapEdits.Apply, 15000, false);
	}

	override void OnUpdate(float timeslice)
	{
		super.OnUpdate(timeslice);
		DSQuests.Get().ClientTick(timeslice);
		if (!GetGame().IsMultiplayer())
			DSQuests.Get().Tick(timeslice);
		DSOpenRequestedMap();
	}

	override void Pause()
	{
		if (DSQuests.Get().BlockPause())
			return;
		super.Pause();
	}
}
`;

  // quest markers on the vanilla map (both hooks): added whenever the map screen opens, plus the journal's [M] Map
  R.hookMap = String.raw`
// opens the map when the quest journal asked for it (same way as the vanilla keyboard shortcut)
void DSOpenRequestedMap()
{
	DSQuests dq = DSQuests.Get();
	if (!dq.m_WantMap)
		return;
	dq.m_WantMap = false;
	UIManager um = GetGame().GetUIManager();
	if (!um || um.IsMenuOpen(MENU_MAP) || CfgGameplayHandler.GetUse3DMap())
		return;
	um.CloseAll();
	MapMenu mm = MapMenu.Cast(um.EnterScriptedMenu(MENU_MAP, null));
	Mission mission = GetGame().GetMission();
	mission.AddActiveInputExcludes({"map"});
	mission.AddActiveInputRestriction(EInputRestrictors.MAP);
	if (mm)
		mm.DSFocus(dq.m_MapAt);
}

modded class MapMenu
{
	override Widget Init()
	{
		Widget root = super.Init();
		if (m_MapWidgetInstance)
			DSQuests.Get().AddMapMarks(m_MapWidgetInstance);
		return root;
	}

	bool m_DSOpened;   // opened from the quest journal

	void DSFocus(vector pos)
	{
		m_DSOpened = true;
		if (!m_MapWidgetInstance)
			return;
		m_MapWidgetInstance.SetScale(0.2);
		m_MapWidgetInstance.SetMapPos(pos);
	}

	override void CloseMapMenu()
	{
		// vanilla only lifts these input locks itself on servers that allow the map without a map item
		if (m_DSOpened && !CfgGameplayHandler.GetMapIgnoreMapOwnership())
		{
			GetGame().GetMission().RemoveActiveInputExcludes({"map"});
			GetGame().GetMission().RemoveActiveInputRestriction(EInputRestrictors.MAP);
		}
		super.CloseMapMenu();
	}

	override void AddMarker(vector pos, int color, int icon = 0)
	{
		if (!m_Map)
			return;   // opened from the quest journal without a map item: nothing to store markers on
		super.AddMarker(pos, color, icon);
	}
}
`;
  R.hookEditor += R.hookMap;
  R.hookMod += R.hookMap;

  R.configCpp = (mod, author, extra) => String.raw`class CfgPatches
{
	class ${mod}
	{
		units[] = {};
		weapons[] = {};
		requiredVersion = 0.1;
		requiredAddons[] = {"DZ_Data", "DZ_Scripts"};
	};
};

class CfgMods
{
	class ${mod}
	{
		dir = "${mod}";
		picture = "";
		action = "";
		hideName = 1;
		hidePicture = 1;
		name = "${mod}";
		credits = "";
		author = "${author || 'DayZ Studio'}";
		authorID = "0";
		version = "1.0";
		extra = 0;
		type = "mod";
		dependencies[] = {"World", "Mission"};

		class defs
		{
			class worldScriptModule
			{
				value = "";
				files[] = {"${mod}/scripts/4_World"};
			};
			class missionScriptModule
			{
				value = "";
				files[] = {"${mod}/scripts/5_Mission"};
			};
		};
	};
};
${extra || ''}`;

  // dollar bills (tools/money.py writes the model and textures into <mod>\money): one stackable item per
  // denomination, all on the same mesh with their own texture. Traders and quest rewards pay in these.
  R.DOLLARS = [1, 5, 10, 20, 50, 100];
  R.dollarClass = (n) => 'DSQ_Dollar' + n;
  // (displayName must not start with $: DayZ reads that as a stringtable key)
  R.moneyConfig = (mod) => {
    const words = { 1: 'One', 5: 'Five', 10: 'Ten', 20: 'Twenty', 50: 'Fifty', 100: 'One hundred' };
    return String.raw`
class CfgVehicles
{
	class Inventory_Base;
	class DSQ_Money_Base: Inventory_Base
	{
		scope = 0;
		displayName = "Dollars";
		descriptionShort = "Paper money. Traders take it.";
		model = "${mod}\money\dollar.p3d";
		weight = 1;
		itemSize[] = {1, 1};
		absorbency = 0.5;
		varWetMax = 1;
		canBeSplit = 1;
		varQuantityInit = 1;
		varQuantityMin = 0;
		varQuantityMax = 1000;
		varQuantityDestroyOnMin = 1;
		rotationFlags = 16;
		hiddenSelections[] = {"camo"};
		soundImpactType = "textile";
		class DamageSystem
		{
			class GlobalHealth
			{
				class Health
				{
					hitpoints = 15;   // no healthLevels: their materials would replace the bills' look even when pristine
				};
			};
		};
	};
${R.DOLLARS.map((n) => String.raw`	class ${R.dollarClass(n)}: DSQ_Money_Base
	{
		scope = 2;
		displayName = "Dollars ($${n})";
		descriptionShort = "${words[n]}-dollar bills (Chernarus Reserve Notes). Traders take them.";
		hiddenSelectionsTextures[] = {"${mod}\money\dollar_${n}_co.paa"};
	};`).join('\n')}
};
`;
  };
})();
