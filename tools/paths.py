"""Where DayZ Studio's files live.

APP  = the program itself (index.html, js, tools, bridge) - read-only once installed.
HOME = everything Studio writes: data extracted from the user's own DayZ install (terrain, map imagery, models,
       scene), the game / server profiles and mod builds.
From a download or a git clone both are the same folder. The installed desktop app sets DZSTUDIO_HOME
(%LOCALAPPDATA%\\DayZStudio), so installing an update never touches the user's data.
"""
import os

APP = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
HOME = os.path.abspath(os.environ.get('DZSTUDIO_HOME') or APP)
DATA = os.path.join(HOME, 'data')         # captured heights / bounds / models / scene per world, builds
MAPS = os.path.join(HOME, 'maps')         # terrain imagery, loot and areaflags per world (extract_maps.py)
GAME_DATA = os.path.join(HOME, '_game')   # profile, missions, built bridge mod, local server
