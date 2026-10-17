class CfgPatches
{
	class DZStudioLink
	{
		units[] = {};
		weapons[] = {};
		requiredVersion = 0.1;
		requiredAddons[] = {"DZ_Data", "DZ_Scripts", "Editor_Scripts"};
	};
};

class CfgMods
{
	class DZStudioLink
	{
		dir = "DZStudioLink";
		picture = "";
		action = "";
		hideName = 1;
		hidePicture = 1;
		name = "DZStudioLink";
		credits = "";
		author = "DayZ Studio";
		authorID = "0";
		version = "1.0";
		extra = 0;
		type = "mod";
		dependencies[] = {"World"};

		class defs
		{
			class worldScriptModule
			{
				value = "";
				files[] = {"DZStudioLink/scripts/4_World"};
			};
		};
	};
};
