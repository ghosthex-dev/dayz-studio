// ============================================================================
// DayZ Studio <-> DayZ Editor (Dabs) live link.
// Studio writes  $profile:DZStudio/link/cmd.json   (consumed + deleted here)
// This mod writes $profile:DZStudio/link/state.json (~2 Hz) and objects.json (on "dump")
// Object ids are Editor uuids; Studio-created objects use the prefix "dzs_".
// ============================================================================

class DZSLinkObj
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

class DZSLinkShape
{
	string kind;   // cyl | sphere | line | text
	string text;
	float x;
	float y;
	float z;
	float r;       // radius (cyl/sphere) or font size (text)
	float h;       // cylinder height
	float dy;      // metres above the ground (added to y, or to the surface height when y == 0)
	int flag;      // DebugTextFlags value for text
	float x2;
	float y2;
	float z2;
	int color;
}

class DZSLabel
{
	ref TextWidget m_W;
	vector m_Pos;
}

class DZSLinkCmd
{
	string op;
	float x;
	float y;
	float z;
	float yaw;
	float pitch;
	float roll;
	ref array<string> ids;
	ref array<ref DZSLinkObj> objects;
	ref array<ref DZSLinkShape> shapes;

	void DZSLinkCmd()
	{
		ids = new array<string>;
		objects = new array<ref DZSLinkObj>;
		shapes = new array<ref DZSLinkShape>;
	}
}

class DZSProbe
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

class DZSLinkBatch
{
	int seq;
	ref array<ref DZSLinkCmd> cmds;

	void DZSLinkBatch()
	{
		cmds = new array<ref DZSLinkCmd>;
	}
}

class DZSLinkState
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
	ref array<string> selected;

	void DZSLinkState()
	{
		selected = new array<string>;
	}
}

class DZSLinkDump
{
	int token;
	string world;
	ref array<ref DZSLinkObj> objects;

	void DZSLinkDump()
	{
		objects = new array<ref DZSLinkObj>;
	}
}

class DZSLink
{
	static const string DIR = "$profile:DZStudio/link";
	static ref DZSLink s_Instance;

	float m_Acc;
	float m_StateT;
	int m_Seq;
	int m_DumpToken;
	bool m_Ready;
	ref array<ref DZSLinkObj> m_Pending;
	ref array<string> m_KeepSel;
	bool m_Batching;
	bool m_DumpWanted;
	ref array<Shape> m_PvShapes;
	ref array<ref DZSLabel> m_Labels;

	void DZSLink()
	{
		m_Pending = new array<ref DZSLinkObj>;
		m_KeepSel = new array<string>;
		m_PvShapes = new array<Shape>;
		m_Labels = new array<ref DZSLabel>;
	}

	static DZSLink Get()
	{
		if (!s_Instance)
			s_Instance = new DZSLink();
		return s_Instance;
	}

	void Init()
	{
		MakeDirectory("$profile:DZStudio");
		MakeDirectory(DIR);
		m_Ready = true;
		Print("[DZStudioLink] ready, dir=" + DIR);
	}

	void Tick(Editor ed, float dt)
	{
		if (!ed)
			return;
		if (!m_Ready)
			Init();

		UpdateLabels();

		m_Acc += dt;
		if (m_Acc < 0.2)
			return;
		float step = m_Acc;
		m_Acc = 0;
		m_StateT += step;

		ProcessPending(ed);

		string cmdPath = DIR + "/cmd.json";
		if (FileExist(cmdPath))
			HandleCmdFile(ed, cmdPath);

		if (m_DumpWanted && m_Pending.Count() == 0)
		{
			m_DumpWanted = false;
			WriteDump(ed);
		}

		if (m_StateT >= 0.5)
		{
			m_StateT = 0;
			WriteState(ed);
		}
	}

	void HandleCmdFile(Editor ed, string path)
	{
		// read as text and parse with error output: a half-written file must never throw inside the Editor
		string text = "";
		FileHandle fh = OpenFile(path, FileMode.READ);
		if (!fh)
			return;
		string line;
		while (FGets(fh, line) > 0)
			text = text + line;
		CloseFile(fh);
		DeleteFile(path);

		DZSLinkBatch batch = new DZSLinkBatch();
		string err;
		JsonSerializer js = new JsonSerializer();
		if (!js.ReadFromString(batch, text, err))
		{
			Print("[DZStudioLink] ignored unreadable cmd.json: " + err);
			return;
		}
		m_Seq = batch.seq;

		for (int i = 0; i < batch.cmds.Count(); i++)
		{
			DZSLinkCmd c = batch.cmds.Get(i);
			if (c.op == "sync")
			{
				for (int j = 0; j < c.objects.Count(); j++)
					m_Pending.Insert(c.objects.Get(j));
			}
			else if (c.op == "delete")
			{
				for (int k = 0; k < c.ids.Count(); k++)
					ed.DeleteObjectByUuid(c.ids.Get(k), false);
			}
			else if (c.op == "clear")
			{
				ClearStudioObjects(ed);
			}
			else if (c.op == "select")
			{
				ed.ClearSelection();
				for (int s = 0; s < c.ids.Count(); s++)
				{
					EditorObject eo = ed.GetEditorObjectByUuid(c.ids.Get(s));
					if (eo)
						ed.SelectObject(eo);
				}
			}
			else if (c.op == "camera")
			{
				EditorCamera cam = ed.GetCamera();
				if (cam)
				{
					cam.SetPosition(Vector(c.x, c.y, c.z));
					cam.SetOrientation(Vector(c.yaw, c.pitch, 0));
				}
			}
			else if (c.op == "savetest")
			{
				// writes a sample .dze with the real Dabs serializer (used to verify Studio's importer)
				EditorSaveData sd = new EditorSaveData();
				sd.MapName = "ChernarusPlus";
				sd.CameraPosition = Vector(1, 2, 3);
				sd.AuthorId = "76561190000000000";
				sd.CreditIds.Insert("76561190000000000");
				EditorObjectData d1 = EditorObjectData.Create("Land_Shed_M1", Vector(1216.5, 300.25, 12058.75), Vector(30, 5, -7), 1.5, EFE_DEFAULT);
				sd.EditorObjects.Insert(d1);
				EditorObjectData d2 = EditorObjectData.Create("Apple", Vector(1220, 0, 12060), Vector(0, 0, 0), 1, EFE_DEFAULT);
				sd.EditorObjects.Insert(d2);
				EditorDeletedObjectData del = new EditorDeletedObjectData();
				del.Type = "Land_House_1W01";
				del.Position = Vector(1100, 280, 12000);
				del.ModelName = "dz\\structures\\house_1w01.p3d";
				sd.EditorHiddenObjects.Insert(del);
				FileSerializer fs = new FileSerializer();
				if (fs.Open(DIR + "/sample.dze", FileMode.WRITE))
				{
					sd.Write(fs, EditorSaveData.Version);
					fs.Close();
				}
			}
			else if (c.op == "probe")
			{
				// orientation convention test: yaw/pitch/roll -> where do model forward/up/right point in the world?
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
						DZSProbe pb = new DZSProbe();
						pb.fx = pf[0]; pb.fy = pf[1]; pb.fz = pf[2];
						pb.ux = pu[0]; pb.uy = pu[1]; pb.uz = pu[2];
						pb.rx = pr[0]; pb.ry = pr[1]; pb.rz = pr[2];
						JsonFileLoader<DZSProbe>.JsonSaveFile(DIR + "/probe_" + Math.Round(c.yaw) + "_" + Math.Round(c.pitch) + "_" + Math.Round(c.roll) + ".json", pb);
						GetGame().ObjectDelete(po);
					}
				}
			}
			else if (c.op == "tp")
			{
				PlayerBase tp = PlayerBase.Cast(GetGame().GetPlayer());
				if (tp)
				{
					float ty = GetGame().SurfaceY(c.x, c.z) + 0.1;
					tp.SetPosition(Vector(c.x, ty, c.z));
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
				PlayerBase gp = PlayerBase.Cast(GetGame().GetPlayer());
				if (gp && c.ids.Count() > 0)
				{
					int ga = Math.Round(c.y);
					if (ga < 1)
						ga = 1;
					for (int gi = 0; gi < ga && gi < 30; gi++)
					{
						EntityAI ge = gp.GetInventory().CreateInInventory(c.ids.Get(0));
						if (!ge)
							GetGame().CreateObject(c.ids.Get(0), gp.GetPosition());
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
				m_DumpWanted = true;   // written once the pending queue is empty (see Tick)
			}
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
			DZSLabel lb = m_Labels.Get(k);
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
			DZSLabel lb = m_Labels.Get(i);
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
	void ApplyPreview(array<ref DZSLinkShape> list)
	{
		ClearPreview();
		ShapeFlags fl = ShapeFlags.TRANSP | ShapeFlags.NOOUTLINE | ShapeFlags.NOZWRITE | ShapeFlags.DOUBLESIDE;
		ShapeFlags flLine = ShapeFlags.TRANSP | ShapeFlags.NOZBUFFER;
		for (int i = 0; i < list.Count(); i++)
		{
			DZSLinkShape d = list.Get(i);
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
						DZSLabel lab = new DZSLabel();
						lab.m_W = tw;
						lab.m_Pos = pos;
						m_Labels.Insert(lab);
					}
				}
			}
		}
	}

	void ClearStudioObjects(Editor ed)
	{
		array<string> doomed = new array<string>;
		EditorObjectMap placed = ed.GetPlacedObjects();
		foreach (int id, EditorObject eo : placed)
		{
			if (eo && eo.Uuid.IndexOf("dzs_") == 0)
				doomed.Insert(eo.Uuid);
		}
		for (int i = 0; i < doomed.Count(); i++)
			ed.DeleteObjectByUuid(doomed.Get(i), false);
	}

	// create / update in small chunks so a big project does not stall a frame
	void ProcessPending(Editor ed)
	{
		if (m_Pending.Count() == 0)
		{
			if (m_Batching)
			{
				m_Batching = false;
				ed.ClearSelection();
				for (int r = 0; r < m_KeepSel.Count(); r++)
				{
					EditorObject keep = ed.GetEditorObjectByUuid(m_KeepSel.Get(r));
					if (keep)
						ed.SelectObject(keep);
				}
				m_KeepSel.Clear();
			}
			return;
		}

		if (!m_Batching)
		{
			m_Batching = true;
			m_KeepSel.Clear();
			EditorObjectMap sel = ed.GetSelectedObjects();
			foreach (int sid, EditorObject so : sel)
			{
				if (so)
					m_KeepSel.Insert(so.Uuid);
			}
		}

		int budget = 40;
		while (budget > 0 && m_Pending.Count() > 0)
		{
			DZSLinkObj o = m_Pending.Get(0);
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

			EditorObject existing = ed.GetEditorObjectByUuid(o.id);
			if (existing)
			{
				existing.SetPosition(pos);
				existing.SetOrientation(ori);
				existing.SetScale(sc);
			}
			else
			{
				EditorObjectData data = EditorObjectData.Create(o.type, pos, ori, sc, EFE_DEFAULT);
				ed.CreateObjectByUuid(o.id, data, false);
			}
		}
	}

	void FillObj(DZSLinkObj lo, EditorObject eo)
	{
		lo.id = eo.Uuid;
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
	}

	void WriteState(Editor ed)
	{
		DZSLinkState st = new DZSLinkState();
		st.seq = m_Seq;
		st.time = GetGame().GetTickTime();
		st.world = GetGame().GetWorldName();
		st.active = ed.IsActive();
		st.dumpToken = m_DumpToken;
		EditorCamera cam = ed.GetCamera();
		if (cam)
		{
			vector p = cam.GetPosition();
			vector o = cam.GetOrientation();
			st.cx = p[0];
			st.cy = p[1];
			st.cz = p[2];
			st.cyaw = o[0];
			st.cpitch = o[1];
		}
		st.pending = m_Pending.Count();
		EditorObjectMap placed = ed.GetPlacedObjects();
		if (placed)
		{
			st.count = placed.Count();
			float h = 0;
			foreach (int hid, EditorObject ho : placed)
			{
				if (!ho)
					continue;
				vector hp = ho.GetPosition();
				vector hr = ho.GetOrientation();
				h += hp[0] * 1.31 + hp[1] * 0.37 + hp[2] * 1.77 + hr[0] * 0.13 + ho.GetScale();
			}
			st.hash = h;
		}
		EditorObjectMap sel = ed.GetSelectedObjects();
		if (sel)
		{
			foreach (int id, EditorObject eo : sel)
			{
				if (eo)
					st.selected.Insert(eo.Uuid);
			}
		}
		JsonFileLoader<DZSLinkState>.JsonSaveFile(DIR + "/state.json", st);
	}

	void WriteDump(Editor ed)
	{
		DZSLinkDump d = new DZSLinkDump();
		d.token = m_DumpToken;
		d.world = GetGame().GetWorldName();
		EditorObjectMap placed = ed.GetPlacedObjects();
		foreach (int id, EditorObject eo : placed)
		{
			if (!eo)
				continue;
			DZSLinkObj lo = new DZSLinkObj();
			FillObj(lo, eo);
			d.objects.Insert(lo);
		}
		JsonFileLoader<DZSLinkDump>.JsonSaveFile(DIR + "/objects.json", d);
		Print("[DZStudioLink] dumped " + d.objects.Count() + " objects");
	}
}

modded class Editor
{
	protected static bool s_DZSDialogSkipped;

	override void Update(float timeslice)
	{
		super.Update(timeslice);
		DZSLink.Get().Tick(this, timeslice);
	}

	// Studio embeds the Editor in a window: skip the automatic start-up changelog pop-up once.
	// (Opening it from the Editor's own menu still works.)
	override void ShowDonationDialog()
	{
		if (!s_DZSDialogSkipped)
		{
			s_DZSDialogSkipped = true;
			return;
		}
		super.ShowDonationDialog();
	}
}
