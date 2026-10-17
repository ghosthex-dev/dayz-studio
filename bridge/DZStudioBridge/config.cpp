class CfgPatches
{
	class DZStudioBridge
	{
		units[] = {};
		weapons[] = {};
		requiredVersion = 0.1;
		requiredAddons[] = {"DZ_Data", "DZ_Scripts"};
	};
};

class CfgMods
{
	class DZStudioBridge
	{
		dir = "DZStudioBridge";
		picture = "";
		action = "";
		hideName = 1;
		hidePicture = 1;
		name = "DZStudioBridge";
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
				files[] = {"DZStudioBridge/scripts/5_Mission"};
			};
		};
	};
};
