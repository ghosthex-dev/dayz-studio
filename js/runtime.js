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

class DSJournal
{
	ref array<ref DSJQuest> quests;
	ref array<ref DSJMark> givers;    // NPCs with a quest this player can take now (map markers)

	void DSJournal()
	{
		quests = new array<ref DSJQuest>;
		givers = new array<ref DSJMark>;
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
	return ws.CreateWidget(ImageWidgetTypeID, x, y, w, h, WidgetFlags.VISIBLE | WidgetFlags.EXACTSIZE | WidgetFlags.EXACTPOS, color, sort);
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
	float x;
	float y;
	float z;
	float radius;
}

class DSNpcList
{
	ref array<ref DSNpcInfo> npcs;

	void DSNpcList()
	{
		npcs = new array<ref DSNpcInfo>;
	}
}

class DSDialogPacket
{
	string quest;
	string node;
	string name;
	string state;    // offer | active | done | locked
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
	string var;             // act_setvar: server variable name
	string varOp;           // act_setvar: set | add | sub | toggle
	float varValue;

	void DSNode()
	{
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

class DSQuestFile
{
	ref array<ref DSQuest> quests;

	void DSQuestFile()
	{
		quests = new array<ref DSQuest>;
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

	void DSPlayerData()
	{
		quests = new array<ref DSQuestState>;
		used = new array<string>;
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

	void DSProgress()
	{
		quests = new array<ref DSProgressQuest>;
		log = new array<string>;
		vars = new array<string>;
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
	ref array<Object> m_NpcObjs;           // server only, same order as m_NpcInfo
	ref map<string, bool> m_NpcSent;
	ref DSDialogUI m_UI;
	bool m_TalkKey;
	int m_Looked;
	ref map<string, string> m_JournalLast;   // server: last snapshot sent per player
	ref DSJournal m_Journal;                 // client: the player's quest log
	ref DSJournalUI m_JUI;
	bool m_GotNpcs;                          // client: NPC list received
	float m_HelloT;
	int m_HelloTries;
	ref map<string, string> m_Talk;          // server: the conversation each player has open ("quest|node|state")
	float m_SaveT;
	ref map<int, string> m_Chunks;
	ref map<string, float> m_Globals;        // server: persistent server-wide variables
	string m_FxActive;                       // server: effects switched on right now ("id,id,...")
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
		SpawnNpcs();
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
				vector spot = ClearSpotNear(ti.x, ti.z, 2.5, npcYaw);
				p.SetPosition(spot);
				vector look = Vector(ti.x, spot[1], ti.z) - spot;
				p.SetOrientation(Vector(look.VectorToAngles()[0], 0, 0));
				ServerTalk(p, ti.quest, ti.node);
			}
		}
		if (FileExist(ROOT + "/give.flag") && p)
		{
			// play-test helper: "ClassName amount" per line
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
				int gn = 1;
				if (gp.Count() > 1)
					gn = gp.Get(1).ToInt();
				if (gn < 1)
					gn = 1;
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
				if (o && !o.IsMan() && !o.IsTree() && !o.IsBush())
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
		return t == "start" || t == "trg_zone" || t == "trg_npc" || t == "trg_item" || t == "trg_time" || t == "trg_cond";
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

	// ---------------- NPC spawn ----------------
	void RegisterNpc(DSQuest q, DSNode n, vector pos, Object o)
	{
		DSNpcInfo info = new DSNpcInfo();
		info.quest = q.id;
		info.node = n.id;
		info.name = n.title;
		if (info.name == "")
			info.name = "Survivor";
		info.x = pos[0];
		info.y = pos[1];
		info.z = pos[2];
		info.radius = n.radius;
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
			return;
		}
		Object o = GetGame().CreateObject(n.cls, pos);
		if (!o)
			return;
		o.SetPosition(pos);
		o.SetOrientation(Vector(n.yaw, 0, 0));
		RegisterNpc(q, n, pos, o);
		EntityAI e = EntityAI.Cast(o);
		if (e)
		{
			e.SetAllowDamage(false);
			for (int k = 0; k < n.items.Count(); k++)
				e.GetInventory().CreateInInventory(n.items.Get(k).c);
			Man npcMan = Man.Cast(e);
			if (npcMan && n.hands != "")
				npcMan.GetHumanInventory().CreateInHands(n.hands);
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
				DSNode n = q.nodes.Get(j);
				if (n.type != "trg_npc" || n.cls == "" || !n.cond || n.cond.kind == "")
					continue;
				int at = -1;
				for (int a = 0; a < m_NpcInfo.Count(); a++)
				{
					if (m_NpcInfo.Get(a).quest == q.id && m_NpcInfo.Get(a).node == n.id)
						at = a;
				}
				bool want = CondOk(null, null, n.cond);
				if (want && at < 0)
				{
					SpawnNpc(q, n);
					Print("[DZStudio] NPC " + n.title + " appears (" + q.name + ")");
					changed = true;
				}
				else if (!want && at >= 0)
				{
					Object gone = null;
					if (at < m_NpcObjs.Count())
						gone = m_NpcObjs.Get(at);
					m_NpcInfo.Remove(at);
					if (at < m_NpcObjs.Count())
						m_NpcObjs.Remove(at);
					if (gone && m_NpcObjs.Find(gone) < 0)
						DeleteNpc(gone);
					Print("[DZStudio] NPC " + n.title + " leaves (" + q.name + ")");
					changed = true;
				}
			}
		}
		if (changed)
			m_NpcSent.Clear();   // every player gets the new NPC list on the next tick
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

		m_FxT += step;
		if (m_FxT >= 2 || m_FxActive == "")
		{
			m_FxT = 0;
			m_FxActive = FxActiveList();
		}
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
		SendFx(p, id);

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
		string k = c.kind;
		if (k == "var")
			return Cmp(GetVar(c.var), c.op, c.value);
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
	bool FxOn(DSFxDef d)
	{
		float v = GetVar("fx_" + d.id);
		if (d.startOff)
		{
			if (v != 1)
				return false;
		}
		else if (v == -1)
			return false;
		if (d.cond && d.cond.kind != "" && !CondOk(null, null, d.cond))
			return false;
		return true;
	}

	string FxActiveList()
	{
		DSFx.Defs();
		string active = ",";   // never empty, so "nothing on" is a real state
		for (int i = 0; i < DSFx.s_Defs.Count(); i++)
		{
			DSFxDef d = DSFx.s_Defs.Get(i);
			if (FxOn(d))
				active = active + d.id + ",";
		}
		return active;
	}

	void SendFx(PlayerBase p, string id)
	{
		if (m_FxActive == "")
			m_FxActive = FxActiveList();
		string last;
		if (m_FxSent.Find(id, last) && last == m_FxActive)
			return;
		m_FxSent.Set(id, m_FxActive);
		SendToClient(p, DSQ_RPC_FX, m_FxActive);
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
		if (trigger.text != "" && trigger.type != "trg_npc")
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

		if (n.type == "obj_kill" || n.type == "obj_travel" || n.type == "obj_collect" || n.type == "obj_deliver" || n.type == "obj_survive" || n.type == "obj_cond")
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
	}

	// ---------------- instant node actions ----------------
	void RunInstant(PlayerBase p, DSQuest q, DSNode n)
	{
		if (n.type == "act_fx")
		{
			// effects remember their switch in a server variable, so it survives restarts
			SetVar("fx_" + n.var, "set", n.varValue);
			m_FxActive = FxActiveList();
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
	int CountItems(PlayerBase p, string cls)
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

	void RemoveItems(PlayerBase p, string cls, int amount)
	{
		array<EntityAI> all = new array<EntityAI>;
		p.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, all);
		int left = amount;
		for (int i = 0; i < all.Count() && left > 0; i++)
		{
			EntityAI e = all.Get(i);
			if (!e || e == p || !e.IsKindOf(cls))
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
			string c = n.classes.Get(i);
			if (c == "@infected" && ZombieBase.Cast(victim))
				return true;
			if (c == "@animal" && AnimalBase.Cast(victim))
				return true;
			if (c == "@player" && PlayerBase.Cast(victim))
				return true;
			if (c != "" && c.Substring(0, 1) != "@" && victim.IsKindOf(c))
				return true;
		}
		return false;
	}

	void OnKill(Object victim, Object killer)
	{
		if (!m_Ready || !victim)
			return;
		PlayerBase p = ResolveKiller(killer);
		if (!p || p == victim)
			return;
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
		SaveData(data);
	}

	// ======================= journal / tracker =======================
	bool IsObjectiveType(string t)
	{
		return t == "obj_kill" || t == "obj_travel" || t == "obj_collect" || t == "obj_deliver" || t == "obj_survive" || t == "obj_cond";
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
	bool OptionOk(PlayerBase p, DSPlayerData data, DSDlgOption o, string key)
	{
		if (o.when && !CondOk(p, data, o.when))
			return false;
		if (o.take)
		{
			for (int i = 0; i < o.take.Count(); i++)
			{
				if (CountItems(p, o.take.Get(i).c) < o.take.Get(i).n)
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
		if (Dist2D(p.GetPosition(), n.x, n.z) > n.radius + 4)
			return;
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
				dl.options.Get(oi).hide = !OptionOk(p, data, dl.options.Get(oi), OptionKey(q.id, n.id, state, dl.id, oi));
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

		string json;
		JsonSerializer js = new JsonSerializer();
		js.WriteToString(pk, false, json);
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
		if (Dist2D(p.GetPosition(), n.x, n.z) > n.radius + 6)
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
		if (!n || Dist2D(p.GetPosition(), n.x, n.z) > n.radius + 6)
			return;
		DSDlgLine line = DialogFor(q, n, state).Find(lineId);
		if (!line || idx < 0 || idx >= line.options.Count())
			return;
		DSDlgOption o = line.options.Get(idx);
		string key = OptionKey(q.id, n.id, state, lineId, idx);
		if (!OptionOk(p, data, o, key))
			return;
		int i;
		for (i = 0; i < o.take.Count(); i++)
			RemoveItems(p, o.take.Get(i).c, o.take.Get(i).n);
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
		if (rpc == DSQ_RPC_NPCS || rpc == DSQ_RPC_OPEN || rpc == DSQ_RPC_JOURNAL || rpc == DSQ_RPC_FX)
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
		else if (rpc == DSQ_RPC_TALK || rpc == DSQ_RPC_ACCEPT || rpc == DSQ_RPC_ABANDON || rpc == DSQ_RPC_HELLO || rpc == DSQ_RPC_OPTION)
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
		m_UI.Update(dt);
		m_JUI.Update(dt, m_UI.IsOpen());
		if (m_JUI.IsOpen())
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
		if (m_UI.IsOpen() || m_JUI.IsOpen())
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
				vector head = Vector(info.x, info.y + 1.5, info.z);
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
		if (best >= 0)
		{
			m_UI.ShowPrompt("[F]  Talk to " + m_NpcInfo.Get(best).name);
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
	ref array<int> m_Vis;     // indexes of the replies this player may pick

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
		float ph = sh * 0.30;
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
		for (int o = 0; o < 4; o++)
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
		m_OptCount = m_Vis.Count();
		if (m_OptCount == 0)
			m_OptCount = 1;
		if (m_OptCount > 4)
			m_OptCount = 4;
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
				label = m_Line.options.Get(m_Vis.Get(j)).text;
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

	static DSCond C(string kind, string var, string op, float value, float to, string stat)
	{
		DSCond c = new DSCond();
		c.kind = kind;
		c.var = var;
		c.op = op;
		c.value = value;
		c.to = to;
		c.stat = stat;
		return c;
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

modded class PlayerBase
{
	override void OnRPC(PlayerIdentity sender, int rpc_type, ParamsReadContext ctx)
	{
		super.OnRPC(sender, rpc_type, ctx);
		if (rpc_type >= DSQ_RPC_NPCS && rpc_type <= DSQ_RPC_FX)
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
})();
