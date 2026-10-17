// ============================================================================
// DayZ Studio - standalone game viewport (no DayZ-Editor / Dabs / CF needed).
//
// Launched with a normal offline mission (init.c returns MissionGameplay) plus the flag file
//   $profile:DZStudio/world.flag
// then this mod creates a hidden player, a free camera and the objects Studio asks for.
//
// Protocol (same files as the Dabs link, so Studio's code is shared):
//   Studio writes  $profile:DZStudio/link/cmd.json    (consumed + deleted here)
//   this mod writes $profile:DZStudio/link/state.json (~2 Hz) and objects.json (on "dump")
// ============================================================================

class DZWObj
{
	string id;
	string type;
	float x;
	float y;
	float z;
	float yaw;
	float pitch;
	float roll;
	float scale;
}

class DZWShape
{
	string kind;   // cyl | sphere | line | text
	string text;
	float x;
	float y;
	float z;
	float r;       // radius (cyl/sphere) or font size (text)
	float h;       // cylinder height
	float dy;      // metres above the ground (added to y, or to the surface height when y == 0)
	int flag;
	float x2;
	float y2;
	float z2;
	int color;
}

class DZWLabel
{
	ref TextWidget m_W;
	vector m_Pos;
}

class DZWCmd
{
	string op;
	float x;
	float y;
	float z;
	float yaw;
	float pitch;
	float roll;
	ref array<string> ids;
	ref array<ref DZWObj> objects;
	ref array<ref DZWShape> shapes;

	void DZWCmd()
	{
		ids = new array<string>;
		objects = new array<ref DZWObj>;
		shapes = new array<ref DZWShape>;
	}
}

class DZWBatch
{
	int seq;
	ref array<ref DZWCmd> cmds;

	void DZWBatch()
	{
		cmds = new array<ref DZWCmd>;
	}
}

class DZWState
{
	int seq;
	float time;
	string world;
	bool active;
	int count;
	float cx;
	float cy;
	float cz;
	float cyaw;
	float cpitch;
	int dumpToken;
	int pending;
	float hash;
	bool play;     // true = normal first-person play mode, false = free-camera editor
	ref array<string> selected;

	void DZWState()
	{
		selected = new array<string>;
	}
}

class DZWDump
{
	int token;
	string world;
	ref array<ref DZWObj> objects;

	void DZWDump()
	{
		objects = new array<ref DZWObj>;
	}
}

class DZWProbe
{
	float fx;
	float fy;
	float fz;
	float ux;
	float uy;
	float uz;
	float rx;
	float ry;
	float rz;
}

class DZW
{
	static const string DIR = "$profile:DZStudio/link";
	static ref DZW s_Instance;

	float m_Acc;
	float m_StateT;
	int m_Seq;
	int m_DumpToken;
	bool m_Ready;
	bool m_Started;
	bool m_DumpWanted;
	float m_Wait;
	ref array<ref DZWObj> m_Pending;
	ref map<string, Object> m_Objs;
	ref array<Shape> m_PvShapes;
	ref array<ref DZWLabel> m_Labels;
	ref array<Shape> m_SelShapes;
	PlayerBase m_Player;
	Camera m_Camera;
	vector m_CamPos;
	vector m_CamOri;
	float m_Speed = 25;
	float m_CamKeep;
	bool m_Play;
	bool m_KeyDown;
	bool m_God = true;

	// vanilla map objects removed in Studio (hidden like CF's ObjectManager: flags off, moved far away)
	ref array<Object> m_MapHidden;
	ref array<int> m_MapFlags;
	ref array<int> m_MapMask;

	void DZW()
	{
		m_Pending = new array<ref DZWObj>;
		m_Objs = new map<string, Object>;
		m_PvShapes = new array<Shape>;
		m_Labels = new array<ref DZWLabel>;
		m_SelShapes = new array<Shape>;
		m_MapHidden = new array<Object>;
		m_MapFlags = new array<int>;
		m_MapMask = new array<int>;
	}

	static bool IsMapObject(Object o)
	{
		if (!o)
			return false;
		if (o.GetType() == "" && o.Type() == Object)
			return true;
		return o.IsKindOf("House") || o.IsTree() || o.IsBush() || o.IsRock() || o.IsInherited(Static);
	}

	void MapUnhideAll()
	{
		for (int i = 0; i < m_MapHidden.Count(); i++)
		{
			Object o = m_MapHidden.Get(i);
			if (!o)
				continue;
			vector tm[4];
			o.GetTransform(tm);
			tm[3] = tm[3] + Vector(10000, 10000, 10000);
			o.SetTransform(tm);
			o.SetFlags(m_MapFlags.Get(i), true);
			o.SetEventMask(m_MapMask.Get(i));
			o.Update();
		}
		m_MapHidden.Clear();
		m_MapFlags.Clear();
		m_MapMask.Clear();
	}

	// d.type = class name ("" for plain p3d objects), d.id = model path
	bool MapHide(DZWObj d)
	{
		string model = d.id;
		model.ToLower();
		array<Object> objs = new array<Object>;
		GetGame().GetObjectsAtPosition(Vector(d.x, d.y, d.z), 1.5, objs, null);
		Object best = null;
		float bestD = 99;
		for (int k = 0; k < objs.Count(); k++)
		{
			Object o = objs.Get(k);
			if (!IsMapObject(o) || m_MapHidden.Find(o) >= 0)
				continue;
			bool same = false;
			if (d.type != "" && o.GetType() == d.type)
				same = true;
			if (!same && model != "")
			{
				string shape = o.GetShapeName();
				shape.ToLower();
				if (shape == model)
					same = true;
			}
			if (!same)
				continue;
			vector op = o.GetPosition();
			float dd = Math.Sqrt((op[0] - d.x) * (op[0] - d.x) + (op[2] - d.z) * (op[2] - d.z));
			if (dd < bestD)
			{
				bestD = dd;
				best = o;
			}
		}
		if (!best)
			return false;
		m_MapHidden.Insert(best);
		m_MapFlags.Insert(best.GetFlags());
		m_MapMask.Insert(best.GetEventMask());
		best.ClearFlags(best.GetFlags(), true);
		best.ClearEventMask(best.GetEventMask());
		vector bt[4];
		best.GetTransform(bt);
		bt[3] = bt[3] - Vector(10000, 10000, 10000);
		best.SetTransform(bt);
		best.Update();
		return true;
	}

	static DZW Get()
	{
		if (!s_Instance)
			s_Instance = new DZW();
		return s_Instance;
	}

	// the mod only acts when Studio launched the game for it
	static bool Active()
	{
		return FileExist("$profile:DZStudio/world.flag");
	}

	PlayerBase GetPlayerObj()
	{
		return m_Player;
	}

	// ground position at (x, z), or the nearest free spot around it when something solid is in the way (rubbish piles, walls, NPCs)
	vector FreeSpot(float x, float z)
	{
		for (int r = 0; r < 3; r++)
		{
			float dist = r * 2.0;
			int steps = 1;
			if (r > 0)
				steps = 8;
			for (int a = 0; a < steps; a++)
			{
				float ang = a * Math.PI * 0.25;
				float cx = x + Math.Sin(ang) * dist;
				float cz = z + Math.Cos(ang) * dist;
				vector c = Vector(cx, GetGame().SurfaceY(cx, cz), cz);
				array<Object> near = new array<Object>;
				GetGame().GetObjectsAtPosition3D(c + Vector(0, 0.9, 0), 1.4, near, null);
				bool blocked = false;
				for (int i = 0; i < near.Count(); i++)
				{
					Object o = near.Get(i);
					if (o && o != m_Player && !o.IsTree() && !o.IsBush())
						blocked = true;
				}
				if (!blocked)
					return c;
			}
		}
		return Vector(x, GetGame().SurfaceY(x, z), z);
	}

	void Start()
	{
		if (m_Started)
			return;
		MakeDirectory("$profile:DZStudio");
		MakeDirectory(DIR);

		vector pos = "7500 0 7500";
		TIntArray values = new TIntArray;
		GetGame().ConfigGetIntArray("CfgWorlds " + GetGame().GetWorldName() + " centerPosition", values);
		if (values.Count() >= 2)
			pos = Vector(values.Get(0), 0, values.Get(1));
		pos[1] = GetGame().SurfaceY(pos[0], pos[2]);

		// the engine streams the world around the player / active camera; keep a harmless player around
		m_Player = PlayerBase.Cast(GetGame().GetPlayer());
		if (!m_Player)
			m_Player = PlayerBase.Cast(GetGame().CreatePlayer(null, GetGame().CreateRandomPlayer(), pos, 0, string.Empty));
		if (m_Player)
		{
			m_Player.SetPosition(pos);
			m_Player.SetAllowDamage(false);
			m_Player.GetInventory().CreateInInventory("Shirt_RedCheck");
			m_Player.GetInventory().CreateInInventory("Jeans_Blue");
			m_Player.GetInventory().CreateInInventory("Sneakers_Gray");
			GetGame().SelectPlayer(null, m_Player);
			if (m_Player.GetInputController())
				m_Player.GetInputController().SetDisabled(true);
		}

		m_CamPos = Vector(pos[0], pos[1] + 120, pos[2] - 150);
		m_CamOri = Vector(0, -30, 0);
		m_Camera = Camera.Cast(GetGame().CreateObjectEx("StaticCamera", m_CamPos, ECE_LOCAL));
		if (m_Camera)
		{
			m_Camera.SetPosition(m_CamPos);
			m_Camera.SetOrientation(m_CamOri);
			m_Camera.SetActive(true);
		}

		Hud hud = GetGame().GetMission().GetHud();
		if (hud)
		{
			hud.ShowHud(false);
			hud.ShowQuickbarUI(false);
			hud.ShowQuickbarPlayer(false);
		}

		m_Started = true;
		m_Ready = true;
		Print("[DZStudioWorld] started: player=" + (m_Player != null) + " camera=" + (m_Camera != null));
	}

	void Tick(float dt)
	{
		if (!m_Started)
		{
			m_Wait += dt;
			if (m_Wait > 1.0)
				Start();
			return;
		}

		UpdateLabels();
		bool key = KeyState(KeyCode.KC_F2) != 0;
		if (key && !m_KeyDown)
			SetPlay(!m_Play, false, 0, 0);
		m_KeyDown = key;
		if (!m_Play)
			Fly(dt);

		m_Acc += dt;
		if (m_Acc < 0.2)
			return;
		float step = m_Acc;
		m_Acc = 0;
		m_StateT += step;

		// keep the editor camera on top (Camera.GetCurrentCamera() crashes the engine while none is active, so never ask it)
		m_CamKeep += step;
		if (!m_Play && m_Camera && m_CamKeep > 1.0)
		{
			m_CamKeep = 0;
			m_Camera.SetActive(true);
		}

		ProcessPending();

		string cmdPath = DIR + "/cmd.json";
		if (FileExist(cmdPath))
			HandleCmdFile(cmdPath);

		if (m_DumpWanted && m_Pending.Count() == 0)
		{
			m_DumpWanted = false;
			WriteDump();
		}

		if (m_StateT >= 0.5)
		{
			m_StateT = 0;
			WriteState();
		}
	}

	// switch between the free-camera editor and normal first-person play (the quests run the same way in both)
	void SetPlay(bool play, bool hasPos, float x, float z)
	{
		if (!m_Player || !m_Camera)
			return;
		Hud hud = GetGame().GetMission().GetHud();
		if (play)
		{
			vector at = m_Camera.GetPosition();
			if (hasPos)
				at = FreeSpot(x, z);
			at[1] = GetGame().SurfaceY(at[0], at[2]) + 0.3;
			vector co = m_Camera.GetOrientation();
			m_Player.SetPosition(at);
			m_Player.SetOrientation(Vector(co[0], 0, 0));
			m_Camera.SetActive(false);
			GetGame().SelectPlayer(null, m_Player);
			if (m_Player.GetInputController())
				m_Player.GetInputController().SetDisabled(false);
			m_Player.SetAllowDamage(!m_God);
			if (hud)
			{
				hud.ShowHud(true);
				hud.ShowQuickbarUI(true);
				hud.ShowQuickbarPlayer(true);
			}
		}
		else
		{
			vector pp = m_Player.GetPosition();
			vector po = m_Player.GetOrientation();
			vector back = Vector(Math.Sin(po[0] * Math.DEG2RAD), 0, Math.Cos(po[0] * Math.DEG2RAD));
			m_CamPos = pp - back * 6;
			m_CamPos[1] = pp[1] + 4;
			m_CamOri = Vector(po[0], -15, 0);
			m_Camera.SetPosition(m_CamPos);
			m_Camera.SetOrientation(m_CamOri);
			m_Camera.SetActive(true);
			if (m_Player.GetInputController())
				m_Player.GetInputController().SetDisabled(true);
			m_Player.SetAllowDamage(false);
			if (hud)
			{
				hud.ShowHud(false);
				hud.ShowQuickbarUI(false);
				hud.ShowQuickbarPlayer(false);
			}
		}
		m_Play = play;
		Print("[DZStudioWorld] mode: " + play);
	}

	// free camera inside the game window: WASD move, Shift fast, Q/E down/up, hold the right mouse button to look
	void Fly(float dt)
	{
		if (!m_Camera)
			return;
		float forward = GetUApi().GetInputByID(UAMoveForward).LocalValue() - GetUApi().GetInputByID(UAMoveBack).LocalValue();
		float strafe = GetUApi().GetInputByID(UAMoveRight).LocalValue() - GetUApi().GetInputByID(UAMoveLeft).LocalValue();
		float lift = 0;
		if (KeyState(KeyCode.KC_E))
			lift = lift + 1;
		if (KeyState(KeyCode.KC_Q))
			lift = lift - 1;
		bool looking = (GetMouseState(MouseState.RIGHT) & MB_PRESSED_MASK) != 0;
		vector pos = m_Camera.GetPosition();
		vector ori = m_Camera.GetOrientation();
		bool moved = false;

		if (looking)
		{
			float yawDiff = GetUApi().GetInputByID(UAAimLeft).LocalValue() - GetUApi().GetInputByID(UAAimRight).LocalValue();
			float pitchDiff = GetUApi().GetInputByID(UAAimDown).LocalValue() - GetUApi().GetInputByID(UAAimUp).LocalValue();
			if (yawDiff != 0 || pitchDiff != 0)
			{
				ori[0] = ori[0] - Math.RAD2DEG * yawDiff * dt;
				ori[1] = ori[1] - Math.RAD2DEG * pitchDiff * dt;
				if (ori[1] < -89)
					ori[1] = -89;
				if (ori[1] > 89)
					ori[1] = 89;
				moved = true;
			}
		}

		if (forward != 0 || strafe != 0 || lift != 0)
		{
			float speed = m_Speed;
			if (GetUApi().GetInputByID(UATurbo).LocalValue())
				speed = speed * 3;
			vector dir = m_Camera.GetDirection();
			vector aside = vector.Up * dir;
			pos = pos + dir * (forward * dt * speed) + aside * (strafe * dt * speed);
			pos[1] = pos[1] + lift * dt * speed;
			float yMin = GetGame().SurfaceY(pos[0], pos[2]) + 0.5;
			if (pos[1] < yMin)
				pos[1] = yMin;
			moved = true;
		}

		if (moved)
		{
			m_Camera.SetPosition(pos);
			m_Camera.SetOrientation(ori);
			m_CamPos = pos;
			m_CamOri = ori;
		}
	}

	void HandleCmdFile(string path)
	{
		string text = "";
		FileHandle fh = OpenFile(path, FileMode.READ);
		if (!fh)
			return;
		string line;
		while (FGets(fh, line) > 0)
			text = text + line;
		CloseFile(fh);
		DeleteFile(path);

		DZWBatch batch = new DZWBatch();
		string err;
		JsonSerializer js = new JsonSerializer();
		if (!js.ReadFromString(batch, text, err))
		{
			Print("[DZStudioWorld] ignored unreadable cmd.json: " + err);
			return;
		}
		m_Seq = batch.seq;

		for (int i = 0; i < batch.cmds.Count(); i++)
		{
			DZWCmd c = batch.cmds.Get(i);
			if (c.op == "sync")
			{
				for (int j = 0; j < c.objects.Count(); j++)
					m_Pending.Insert(c.objects.Get(j));
			}
			else if (c.op == "delete")
			{
				for (int k = 0; k < c.ids.Count(); k++)
					DeleteObj(c.ids.Get(k));
			}
			else if (c.op == "clear")
			{
				ClearObjects();
			}
			else if (c.op == "maphide")
			{
				// the full list of removed vanilla map objects: show the old set again, hide the new one
				MapUnhideAll();
				int hidN = 0;
				for (int mh = 0; mh < c.objects.Count(); mh++)
				{
					if (MapHide(c.objects.Get(mh)))
						hidN++;
				}
				Print("[DZStudio] map objects hidden: " + hidN + " of " + c.objects.Count());
			}
			else if (c.op == "select")
			{
				ApplySelection(c.ids);
			}
			else if (c.op == "mode")
			{
				// ids[0]: play | edit | toggle ; x,z: optional position to drop in at (when y == 1)
				string want = "toggle";
				if (c.ids.Count() > 0)
					want = c.ids.Get(0);
				bool go = m_Play;
				if (want == "play")
					go = true;
				else if (want == "edit")
					go = false;
				else
					go = !m_Play;
				SetPlay(go, c.y == 1, c.x, c.z);
			}
			else if (c.op == "goto")
			{
				// editor: fly the camera above the point; play mode: teleport the player there
				float gy = GetGame().SurfaceY(c.x, c.z);
				if (m_Play)
				{
					if (m_Player)
					{
						vector freeAt = FreeSpot(c.x, c.z);
						m_Player.SetPosition(Vector(freeAt[0], freeAt[1] + 0.3, freeAt[2]));
					}
				}
				else if (m_Camera)
				{
					m_CamPos = Vector(c.x, gy + 70, c.z - 90);
					m_CamOri = Vector(0, -35, 0);
					m_Camera.SetPosition(m_CamPos);
					m_Camera.SetOrientation(m_CamOri);
				}
			}
			else if (c.op == "god")
			{
				m_God = c.y != 0;
				if (m_Play && m_Player)
					m_Player.SetAllowDamage(!m_God);
			}
			else if (c.op == "camera")
			{
				if (m_Play)
					continue;   // the player owns the view while playing
				m_CamPos = Vector(c.x, c.y, c.z);
				m_CamOri = Vector(c.yaw, c.pitch, c.roll);
				if (m_Camera)
				{
					m_Camera.SetPosition(m_CamPos);
					m_Camera.SetOrientation(m_CamOri);
				}
			}
			else if (c.op == "probe")
			{
				if (c.ids.Count() > 0)
				{
					Object po = GetGame().CreateObject(c.ids.Get(0), Vector(c.x, c.y, c.z), true);
					if (po)
					{
						po.SetOrientation(Vector(c.yaw, c.pitch, c.roll));
						vector pp = po.GetPosition();
						vector pf = po.ModelToWorld(Vector(0, 0, 10)) - pp;
						vector pu = po.ModelToWorld(Vector(0, 10, 0)) - pp;
						vector pr = po.ModelToWorld(Vector(10, 0, 0)) - pp;
						DZWProbe pb = new DZWProbe();
						pb.fx = pf[0]; pb.fy = pf[1]; pb.fz = pf[2];
						pb.ux = pu[0]; pb.uy = pu[1]; pb.uz = pu[2];
						pb.rx = pr[0]; pb.ry = pr[1]; pb.rz = pr[2];
						JsonFileLoader<DZWProbe>.JsonSaveFile(DIR + "/probe_" + Math.Round(c.yaw) + "_" + Math.Round(c.pitch) + "_" + Math.Round(c.roll) + ".json", pb);
						GetGame().ObjectDelete(po);
					}
				}
			}
			else if (c.op == "tp")
			{
				if (m_Player)
				{
					float ty = GetGame().SurfaceY(c.x, c.z) + 0.1;
					m_Player.SetPosition(Vector(c.x, ty, c.z));
				}
			}
			else if (c.op == "spawn")
			{
				// c.ids[0] = class, c.y = amount, c.pitch = scatter radius
				if (c.ids.Count() > 0)
				{
					int amount = Math.Round(c.y);
					for (int sn = 0; sn < amount && sn < 40; sn++)
					{
						float sx = c.x + Math.RandomFloat(-c.pitch, c.pitch);
						float sz = c.z + Math.RandomFloat(-c.pitch, c.pitch);
						GetGame().CreateObject(c.ids.Get(0), Vector(sx, GetGame().SurfaceY(sx, sz), sz), false, true);
					}
				}
			}
			else if (c.op == "give")
			{
				if (m_Player && c.ids.Count() > 0)
				{
					int ga = Math.Round(c.y);
					if (ga < 1)
						ga = 1;
					for (int gi = 0; gi < ga && gi < 30; gi++)
					{
						EntityAI ge = m_Player.GetInventory().CreateInInventory(c.ids.Get(0));
						if (!ge)
							GetGame().CreateObject(c.ids.Get(0), m_Player.GetPosition());
					}
				}
			}
			else if (c.op == "shapes")
			{
				ApplyPreview(c.shapes);
			}
			else if (c.op == "dump")
			{
				m_DumpToken = Math.Round(c.x);
				m_DumpWanted = true;
			}
		}
	}

	void DeleteObj(string id)
	{
		Object o;
		if (m_Objs.Find(id, o))
		{
			if (o)
				GetGame().ObjectDelete(o);
			m_Objs.Remove(id);
		}
	}

	void ClearObjects()
	{
		for (int i = 0; i < m_Objs.Count(); i++)
		{
			Object o = m_Objs.GetElement(i);
			if (o)
				GetGame().ObjectDelete(o);
		}
		m_Objs.Clear();
		m_Pending.Clear();
	}

	// highlight the objects selected in Studio with translucent spheres
	void ApplySelection(array<string> ids)
	{
		for (int i = 0; i < m_SelShapes.Count(); i++)
		{
			Shape s = m_SelShapes.Get(i);
			if (s)
				s.Destroy();
		}
		m_SelShapes.Clear();
		ShapeFlags fl = ShapeFlags.TRANSP | ShapeFlags.NOOUTLINE | ShapeFlags.NOZWRITE | ShapeFlags.DOUBLESIDE;
		for (int k = 0; k < ids.Count() && k < 60; k++)
		{
			Object o;
			if (!m_Objs.Find(ids.Get(k), o) || !o)
				continue;
			vector mm[2];
			o.ClippingInfo(mm);
			float rad = Math.Max(Math.Max(mm[1][0] - mm[0][0], mm[1][2] - mm[0][2]), mm[1][1] - mm[0][1]) * 0.6;
			if (rad < 0.8)
				rad = 0.8;
			if (rad > 40)
				rad = 40;
			vector c = o.GetPosition();
			c[1] = c[1] + (mm[0][1] + mm[1][1]) * 0.5;
			m_SelShapes.Insert(Shape.CreateSphere(0x4022D3EE, fl, c, rad));
		}
	}

	void ClearPreview()
	{
		for (int i = 0; i < m_PvShapes.Count(); i++)
		{
			Shape sh = m_PvShapes.Get(i);
			if (sh)
				sh.Destroy();
		}
		m_PvShapes.Clear();
		for (int k = 0; k < m_Labels.Count(); k++)
		{
			DZWLabel lb = m_Labels.Get(k);
			if (lb && lb.m_W)
				lb.m_W.Unlink();
		}
		m_Labels.Clear();
	}

	// project every label from world to screen space (called each frame)
	void UpdateLabels()
	{
		if (m_Labels.Count() == 0)
			return;
		for (int i = 0; i < m_Labels.Count(); i++)
		{
			DZWLabel lb = m_Labels.Get(i);
			if (!lb || !lb.m_W)
				continue;
			vector sp = GetGame().GetScreenPos(lb.m_Pos);
			if (sp[2] <= 0 || sp[2] > 2500)
			{
				lb.m_W.Show(false);
				continue;
			}
			lb.m_W.Show(true);
			lb.m_W.SetPos(sp[0] - 210, sp[1] - 14, true);
		}
	}

	// quest overlays drawn with the engine's debug shapes (cylinders = areas, spheres = points, text labels)
	void ApplyPreview(array<ref DZWShape> list)
	{
		ClearPreview();
		ShapeFlags fl = ShapeFlags.TRANSP | ShapeFlags.NOOUTLINE | ShapeFlags.NOZWRITE | ShapeFlags.DOUBLESIDE;
		ShapeFlags flLine = ShapeFlags.TRANSP | ShapeFlags.NOZBUFFER;
		for (int i = 0; i < list.Count(); i++)
		{
			DZWShape d = list.Get(i);
			float y = d.y;
			if (y == 0)
				y = GetGame().SurfaceY(d.x, d.z);
			y = y + d.dy;
			vector pos = Vector(d.x, y, d.z);
			if (d.kind == "cyl")
			{
				Shape cyl = Shape.CreateCylinder(d.color, fl, pos, d.r, d.h);
				m_PvShapes.Insert(cyl);
			}
			else if (d.kind == "sphere")
			{
				Shape sp = Shape.CreateSphere(d.color, fl, pos, d.r);
				m_PvShapes.Insert(sp);
			}
			else if (d.kind == "line")
			{
				float y2 = d.y2;
				if (y2 == 0)
					y2 = GetGame().SurfaceY(d.x2, d.z2);
				y2 = y2 + d.dy;
				vector pts[2];
				pts[0] = pos;
				pts[1] = Vector(d.x2, y2, d.z2);
				Shape ln = Shape.CreateLines(d.color, flLine, pts, 2);
				m_PvShapes.Insert(ln);
			}
			else if (d.kind == "text")
			{
				float size = d.r;
				if (size <= 0)
					size = 22;
				WorkspaceWidget ws = GetGame().GetWorkspace();
				if (ws)
				{
					Widget w = ws.CreateWidget(TextWidgetTypeID, 0, 0, 420, 34, WidgetFlags.VISIBLE | WidgetFlags.EXACTSIZE | WidgetFlags.EXACTPOS | WidgetFlags.CENTER | WidgetFlags.VCENTER, 0xFFFFFFFF, 1000);
					TextWidget tw = TextWidget.Cast(w);
					if (tw)
					{
						tw.SetText(d.text);
						tw.SetTextExactSize(size);
						tw.SetOutline(2, 0xFF000000);
						tw.SetColor(d.color | 0xFF000000);
						DZWLabel lab = new DZWLabel();
						lab.m_W = tw;
						lab.m_Pos = pos;
						m_Labels.Insert(lab);
					}
				}
			}
		}
	}

	// create / update in small chunks so a big project does not stall a frame
	void ProcessPending()
	{
		int budget = 40;
		while (budget > 0 && m_Pending.Count() > 0)
		{
			DZWObj o = m_Pending.Get(0);
			m_Pending.RemoveOrdered(0);
			budget--;

			float y = o.y;
			if (y == 0)
				y = GetGame().SurfaceY(o.x, o.z);
			vector pos = Vector(o.x, y, o.z);
			vector ori = Vector(o.yaw, o.pitch, o.roll);
			float sc = o.scale;
			if (sc <= 0)
				sc = 1;

			Object existing;
			if (m_Objs.Find(o.id, existing) && existing)
			{
				existing.SetPosition(pos);
				existing.SetOrientation(ori);
				existing.SetScale(sc);
			}
			else
			{
				Object created;
				if (o.type.IndexOf(".p3d") != -1)
					created = GetGame().CreateStaticObjectUsingP3D(o.type, pos, ori, sc);   // objects imported from editors by model path
				else
					created = GetGame().CreateObjectEx(o.type, pos, ECE_NONE);
				if (created)
				{
					created.SetPosition(pos);
					created.SetOrientation(ori);
					created.SetScale(sc);
					m_Objs.Set(o.id, created);
				}
			}
		}
	}

	void WriteState()
	{
		DZWState st = new DZWState();
		st.seq = m_Seq;
		st.time = GetGame().GetTickTime();
		st.world = GetGame().GetWorldName();
		st.active = true;
		st.dumpToken = m_DumpToken;
		if (m_Camera)
		{
			vector p = m_Camera.GetPosition();
			vector o = m_Camera.GetOrientation();
			st.cx = p[0];
			st.cy = p[1];
			st.cz = p[2];
			st.cyaw = o[0];
			st.cpitch = o[1];
		}
		st.pending = m_Pending.Count();
		st.count = m_Objs.Count();
		st.hash = 0;   // nothing is edited inside the game, so there is never anything to pull
		st.play = m_Play;
		JsonFileLoader<DZWState>.JsonSaveFile(DIR + "/state.json", st);
	}

	void WriteDump()
	{
		DZWDump d = new DZWDump();
		d.token = m_DumpToken;
		d.world = GetGame().GetWorldName();
		for (int i = 0; i < m_Objs.Count(); i++)
		{
			Object eo = m_Objs.GetElement(i);
			if (!eo)
				continue;
			DZWObj lo = new DZWObj();
			lo.id = m_Objs.GetKey(i);
			lo.type = eo.GetType();
			vector p = eo.GetPosition();
			vector r = eo.GetOrientation();
			lo.x = p[0];
			lo.y = p[1];
			lo.z = p[2];
			lo.yaw = r[0];
			lo.pitch = r[1];
			lo.roll = r[2];
			lo.scale = eo.GetScale();
			d.objects.Insert(lo);
		}
		JsonFileLoader<DZWDump>.JsonSaveFile(DIR + "/objects.json", d);
		Print("[DZStudioWorld] dumped " + d.objects.Count() + " objects");
	}
}

modded class MissionGameplay
{
	override void OnUpdate(float timeslice)
	{
		super.OnUpdate(timeslice);
		if (DZW.Active())
			DZW.Get().Tick(timeslice);
	}
}
