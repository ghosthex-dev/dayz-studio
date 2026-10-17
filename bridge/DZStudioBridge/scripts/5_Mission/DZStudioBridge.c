// ============================================================================
// DayZ Studio bridge - runs inside the game and exports data the web editor
// cannot read from game files:
//   heights.bin   terrain height grid sampled with SurfaceY
//   bounds.csv    model bounding boxes (ClippingInfo) for a list of class names
//   paths.txt     where $profile: and $saves: really point to
// Driven by  $profile:DZStudio/request.cfg  (written by tools/studio_server.py)
// ============================================================================

class DZSCapture
{
	static const string DIR = "$profile:DZStudio";

	int m_Phase;          // 0 init, 1 heights, 2 bounds, 3 finish
	float m_Size;         // world size in metres
	int m_N;              // samples per axis
	float m_Step;
	int m_Row;
	int m_Col;
	ref FileSerializer m_Out;
	ref array<string> m_Classes;
	int m_ClassIdx;
	FileHandle m_Bounds;
	float m_Wait;
	string m_Probe;
	int m_ProbeN;
	bool m_List;          // enumerate every CfgVehicles class into classes_all.csv
	bool m_Scan;          // scan all map objects (trees, rocks, props, buildings) into scan.csv
	float m_ScanX0;
	float m_ScanZ0;
	float m_ScanX1;
	float m_ScanZ1;
	float m_ScanCell;
	int m_ScanIx;
	int m_ScanIz;
	int m_ScanNx;
	int m_ScanNz;
	int m_ScanCount;
	FileHandle m_ScanFh;
	int m_ListIdx;
	int m_ListN;
	FileHandle m_ListFh;

	void DZSCapture()
	{
		m_Classes = new array<string>;
		m_Size = 15360;
		m_N = 1024;
	}

	void ReadRequest()
	{
		FileHandle fh = OpenFile(DIR + "/request.cfg", FileMode.READ);
		if (!fh)
		{
			Print("[DZStudio] no request.cfg - using defaults");
			return;
		}
		string line;
		while (FGets(fh, line) > 0)
		{
			TStringArray parts = new TStringArray;
			line.Split("=", parts);
			if (parts.Count() < 2)
				continue;
			string key = parts.Get(0);
			string val = parts.Get(1);
			val.Trim();
			if (key == "size")
				m_Size = val.ToFloat();
			else if (key == "n")
				m_N = val.ToInt();
			else if (key == "list")
				m_List = val.ToInt() > 0;
			else if (key == "scan")
				m_Scan = val.ToInt() > 0;
			else if (key == "scanX0")
				m_ScanX0 = val.ToFloat();
			else if (key == "scanZ0")
				m_ScanZ0 = val.ToFloat();
			else if (key == "scanX1")
				m_ScanX1 = val.ToFloat();
			else if (key == "scanZ1")
				m_ScanZ1 = val.ToFloat();
			else if (key == "scanCell")
				m_ScanCell = val.ToFloat();
			else if (key == "probe")
				m_Probe = val;
			else if (key == "probeN")
				m_ProbeN = val.ToInt();
		}
		CloseFile(fh);

		fh = OpenFile(DIR + "/classes.txt", FileMode.READ);
		if (fh)
		{
			while (FGets(fh, line) > 0)
			{
				line.Trim();
				if (line != "")
					m_Classes.Insert(line);
			}
			CloseFile(fh);
		}
	}

	void WriteMarker(string path, string text)
	{
		FileHandle fh = OpenFile(path, FileMode.WRITE);
		if (fh)
		{
			FPrintln(fh, text);
			CloseFile(fh);
		}
	}

	// dump the vertices of every LOD of one model (reverse-engineering oracle for the p3d format)
	void RunProbe()
	{
		Object o = GetGame().CreateObject(m_Probe, "0 0 0", true);
		if (!o)
		{
			WriteMarker(DIR + "/probe.txt", "no object " + m_Probe);
			return;
		}
		FileHandle fh = OpenFile(DIR + "/probe.txt", FileMode.WRITE);
		array<LOD> lods = new array<LOD>;
		o.GetLODS(lods);
		FPrintln(fh, "lods " + lods.Count());
		for (int i = 0; i < lods.Count(); i++)
		{
			LOD lod = lods.Get(i);
			FPrintln(fh, "LOD " + i + " name=" + o.GetLODName(lod) + " selections=" + lod.GetSelectionCount());
			array<Selection> sels = new array<Selection>;
			lod.GetSelections(sels);
			for (int s = 0; s < sels.Count() && s < 40; s++)
				FPrintln(fh, "  SEL " + sels.Get(s).GetName() + " verts=" + sels.Get(s).GetVertexCount());
			for (int v = 0; v < m_ProbeN; v++)
			{
				vector p = lod.GetVertexPosition(v);
				FPrintln(fh, "V " + i + " " + v + " " + p[0] + " " + p[1] + " " + p[2]);
			}
		}
		CloseFile(fh);
		GetGame().ObjectDelete(o);
	}

	void Tick(float dt)
	{
		if (m_Phase == 0)
		{
			m_Wait += dt;
			if (m_Wait < 2.0)
				return;  // let the world settle

			MakeDirectory(DIR);
			WriteMarker("$profile:DZStudio/paths.txt", "profile ok");
			MakeDirectory("$saves:DZStudio");
			WriteMarker("$saves:DZStudio/paths.txt", "saves ok");
			ReadRequest();
			if (m_Scan)
			{
				if (m_ScanCell < 20)
					m_ScanCell = 100;
				if (m_ScanX1 <= m_ScanX0)
					m_ScanX1 = m_Size;
				if (m_ScanZ1 <= m_ScanZ0)
					m_ScanZ1 = m_Size;
				m_ScanNx = Math.Ceil((m_ScanX1 - m_ScanX0) / m_ScanCell);
				m_ScanNz = Math.Ceil((m_ScanZ1 - m_ScanZ0) / m_ScanCell);
				m_ScanFh = OpenFile(DIR + "/scan.csv", FileMode.WRITE);
				Print("[DZStudio] object scan start cells=" + (m_ScanNx * m_ScanNz));
				m_Phase = 6;
				return;
			}
			if (m_List)
			{
				m_ListN = GetGame().ConfigGetChildrenCount("CfgVehicles");
				m_ListFh = OpenFile(DIR + "/classes_all.csv", FileMode.WRITE);
				Print("[DZStudio] class list start, classes=" + m_ListN);
				m_Phase = 5;
				return;
			}
			if (m_Probe != "")
			{
				RunProbe();
				m_Phase = 3;
				return;
			}
			if (m_N < 16)
				m_N = 16;
			m_Step = m_Size / (m_N - 1);
			Print("[DZStudio] capture start size=" + m_Size + " n=" + m_N + " classes=" + m_Classes.Count());

			m_Out = new FileSerializer();
			if (!m_Out.Open(DIR + "/heights.bin", FileMode.WRITE))
			{
				Print("[DZStudio] cannot open heights.bin");
				m_Phase = 3;
				return;
			}
			m_Out.Write(m_N);
			m_Out.Write(m_Step);
			m_Out.Write(m_Size);
			m_Phase = 1;
			return;
		}

		if (m_Phase == 1)
		{
			int budget = 120000;
			while (budget > 0 && m_Row < m_N)
			{
				float z = m_Row * m_Step;
				while (budget > 0 && m_Col < m_N)
				{
					float x = m_Col * m_Step;
					m_Out.Write(GetGame().SurfaceY(x, z));
					m_Col++;
					budget--;
				}
				if (m_Col >= m_N)
				{
					m_Col = 0;
					m_Row++;
				}
			}
			if (m_Row >= m_N)
			{
				m_Out.Close();
				Print("[DZStudio] heights done");
				WriteMarker(DIR + "/heights.done", "" + m_N);
				m_Phase = 2;
			}
			return;
		}

		if (m_Phase == 2)
		{
			if (m_Classes.Count() == 0)
			{
				m_Phase = 3;
				return;
			}
			if (!m_Bounds)
			{
				m_Bounds = OpenFile(DIR + "/bounds.csv", FileMode.WRITE);
				if (!m_Bounds)
				{
					m_Phase = 3;
					return;
				}
			}
			int per = 15;
			while (per > 0 && m_ClassIdx < m_Classes.Count())
			{
				string cls = m_Classes.Get(m_ClassIdx);
				m_ClassIdx++;
				per--;
				Object o = GetGame().CreateObject(cls, "0 0 0", true);
				if (!o)
					continue;
				vector mm[2];
				o.ClippingInfo(mm);
				string modelPath = "";
				GetGame().ConfigGetText("CfgVehicles " + cls + " model", modelPath);
				FPrintln(m_Bounds, cls + "," + mm[0][0] + "," + mm[0][1] + "," + mm[0][2] + "," + mm[1][0] + "," + mm[1][1] + "," + mm[1][2] + "," + modelPath);
				GetGame().ObjectDelete(o);
			}
			if (m_ClassIdx >= m_Classes.Count())
			{
				CloseFile(m_Bounds);
				WriteMarker(DIR + "/bounds.done", "" + m_Classes.Count());
				m_Phase = 3;
			}
			return;
		}

		if (m_Phase == 6)
		{
			int cellsPerTick = 12;
			while (cellsPerTick > 0 && m_ScanIz < m_ScanNz)
			{
				cellsPerTick--;
				float cx0 = m_ScanX0 + m_ScanIx * m_ScanCell;
				float cz0 = m_ScanZ0 + m_ScanIz * m_ScanCell;
				vector centre = Vector(cx0 + m_ScanCell * 0.5, 0, cz0 + m_ScanCell * 0.5);
				centre[1] = GetGame().SurfaceY(centre[0], centre[2]);
				array<Object> found = new array<Object>;
				array<CargoBase> cargos = new array<CargoBase>;
				GetGame().GetObjectsAtPosition3D(centre, m_ScanCell * 0.72, found, cargos);
				for (int fi = 0; fi < found.Count(); fi++)
				{
					Object so = found.Get(fi);
					if (!so || so.IsEntityAI())
						continue;
					vector sp = so.GetPosition();
					if (sp[0] < cx0 || sp[0] >= cx0 + m_ScanCell || sp[2] < cz0 || sp[2] >= cz0 + m_ScanCell)
						continue;
					string shape = so.GetShapeName();
					if (shape == "")
						continue;
					vector sr = so.GetOrientation();
					FPrintln(m_ScanFh, shape + "," + sp[0] + "," + sp[1] + "," + sp[2] + "," + sr[0] + "," + sr[1] + "," + sr[2] + "," + so.GetScale());
					m_ScanCount++;
				}
				m_ScanIx++;
				if (m_ScanIx >= m_ScanNx)
				{
					m_ScanIx = 0;
					m_ScanIz++;
				}
			}
			if (m_ScanIz >= m_ScanNz)
			{
				CloseFile(m_ScanFh);
				WriteMarker(DIR + "/scan.done", "" + m_ScanCount);
				Print("[DZStudio] object scan done: " + m_ScanCount);
				m_Phase = 3;
			}
			return;
		}

		if (m_Phase == 5)
		{
			int lb = 1500;
			while (lb > 0 && m_ListIdx < m_ListN)
			{
				string lname;
				GetGame().ConfigGetChildName("CfgVehicles", m_ListIdx, lname);
				m_ListIdx++;
				lb--;
				string lpath = "CfgVehicles " + lname;
				int lscope = GetGame().ConfigGetInt(lpath + " scope");
				string lparent;
				GetGame().ConfigGetBaseName(lpath, lparent);
				string lmodel;
				GetGame().ConfigGetText(lpath + " model", lmodel);
				FPrintln(m_ListFh, lname + "," + lparent + "," + lscope + "," + lmodel);
			}
			if (m_ListIdx >= m_ListN)
			{
				CloseFile(m_ListFh);
				WriteMarker(DIR + "/classes_all.done", "" + m_ListN);
				m_Phase = 3;
			}
			return;
		}

		if (m_Phase == 3)
		{
			WriteMarker(DIR + "/capture.done", "ok");
			Print("[DZStudio] capture finished - exiting");
			m_Phase = 4;
			GetGame().RequestExit(IDC_MAIN_QUIT);
		}
	}
}

class DZSMission: MissionBase
{
	ref DZSCapture m_Cap;

	override void OnInit()
	{
		super.OnInit();
		Print("[DZStudio] bridge mission started");
		m_Cap = new DZSCapture();
	}

	override void OnUpdate(float timeslice)
	{
		super.OnUpdate(timeslice);
		if (m_Cap)
			m_Cap.Tick(timeslice);
	}
}

// Engine entry point used when started with  -mission=<folder with init.c>.
// The init.c in that folder calls this through CreateCustomMission.
Mission DZStudioCreateMission()
{
	return new DZSMission();
}
