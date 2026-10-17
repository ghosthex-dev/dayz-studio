class CfgPatches
{
	class DZStudioWorld
	{
		units[] = {};
		weapons[] = {};
		requiredVersion = 0.1;
		requiredAddons[] = {"DZ_Data", "DZ_Scripts"};
	};
};

class CfgMods
{
	class DZStudioWorld
	{
		dir = "DZStudioWorld";
		picture = "";
		action = "";
		hideName = 1;
		hidePicture = 1;
		name = "DZStudioWorld";
		credits = "";
		author = "DayZ Studio";
		authorID = "0";
		version = "1.0";
		extra = 0;
		type = "mod";
		dependencies[] = {"Mission"};

		class defs
		{
			class missionScriptModule
			{
				value = "";
				files[] = {"DZStudioWorld/scripts/5_Mission"};
			};
		};
	};
};
