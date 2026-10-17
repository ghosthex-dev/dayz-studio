"""Build a shareable DayZ Studio package:  python tools/make_dist.py  ->  dist/DayZStudio_<date>.zip

Only DayZ Studio's own files go in. Everything extracted from DayZ (terrain, maps, models, textures, scene) is left out:
it belongs to Bohemia Interactive, and every user rebuilds it from their own game install on first run.
"""
import os
import sys
import time
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
INCLUDE = ['index.html', 'README.md', 'LICENSE', 'run_desktop.bat', 'run_studio.bat', 'css', 'js', 'tools', 'bridge', 'desktop']
SKIP_DIRS = {'node_modules', '__pycache__', '.git', 'dist'}
SKIP_FILES = {'_eval.js', '_eval.out'}

FIRST_RUN = """DayZ Studio - first run
=======================

You need (all free):
  * DayZ (Steam)                      - the editor reads terrain, models and objects from your own install
  * DayZ Tools (Steam > Library > Tools) - binarizes and SIGNS the mods you build
  * Python 3.10 or newer (python.org, tick "Add to PATH")
      then once in a terminal:   pip install pillow numpy
  * Optional: Node.js (nodejs.org) for the desktop app. Without it use run_studio.bat (opens in your browser).
  * Optional: DayZ Server (Steam > Library > Tools) to test your mods in multiplayer.

Start:
  run_desktop.bat   desktop app (installs its shell with npm on the first start)
  run_studio.bat    same editor in your web browser

First time per map (the package contains no game data):
  1. Game tab > "Capture terrain from the game" - starts DayZ once and records heights, buildings and classes.
  2. Game tab > capture the scene (trees, rocks, walls) and build the 3D models.
  3. Terrain imagery for the 2D map:   python tools/extract_maps.py
  Everything is written to the data/ and maps/ folders next to this file.

Your projects are saved to Documents/DayZStudio/Projects (backups in .../Backups).
Your mod signing keys are in Documents/DayZStudio/Keys - back them up; future versions of your mods need the same key.
"""


def main():
    stamp = time.strftime('%Y%m%d')
    out_dir = os.path.join(ROOT, 'dist')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, 'DayZStudio_%s.zip' % stamp)
    n = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for item in INCLUDE:
            src = os.path.join(ROOT, item)
            if os.path.isfile(src):
                z.write(src, os.path.join('DayZStudio', item))
                n += 1
                continue
            for root, dirs, files in os.walk(src):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for fn in files:
                    if fn in SKIP_FILES or fn.endswith('.pyc'):
                        continue
                    full = os.path.join(root, fn)
                    z.write(full, os.path.join('DayZStudio', os.path.relpath(full, ROOT)))
                    n += 1
        z.writestr('DayZStudio/FIRST_RUN.txt', FIRST_RUN)
        z.writestr('DayZStudio/data/README.txt', 'Filled on first run from your own DayZ install (see FIRST_RUN.txt).\n')
        z.writestr('DayZStudio/maps/README.txt', 'Filled by tools/extract_maps.py from your own DayZ install.\n')
    print('%s  (%d files, %.1f MB)' % (out, n + 3, os.path.getsize(out) / 1048576))
    return out


if __name__ == '__main__':
    sys.exit(0 if main() else 1)
