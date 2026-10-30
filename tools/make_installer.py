"""Build the Windows installer:  python tools/make_installer.py [version]  ->  dist/installer/DayZStudio-Setup-<version>.exe

1. stages DayZ Studio's own files (the same set as make_dist.py - never anything extracted from DayZ)
2. puts a private Python next to them: the official embeddable package + Pillow and numpy wheels, so users need
   no Python, pip or PATH setup
3. runs electron-builder (desktop/package.json "build") which wraps it all in a per-user NSIS setup.exe, plus the
   latest.yml + .blockmap the in-app updater reads from the GitHub release
version defaults to desktop/package.json's.

Needs Node.js (npm) and Python 3 with pip on the build machine; downloads are cached in dist/_cache.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')
STAGE = os.path.join(DIST, 'stage')
CACHE = os.path.join(DIST, '_cache')
PY_VER = '3.12.10'
PY_URL = 'https://www.python.org/ftp/python/%s/python-%s-embed-amd64.zip' % (PY_VER, PY_VER)
WHEELS = ['pillow==11.1.0', 'numpy==2.2.6']
STUDIO = ['index.html', 'README.md', 'css', 'js', 'tools', 'bridge']
SKIP_DIRS = {'node_modules', '__pycache__', '.git', 'dist'}
SKIP_FILES = {'sample_dabs_v8.dze', 'make_dist.py', 'make_installer.py'}


def step(msg):
    print('==> ' + msg, flush=True)


def plain_license(md):
    """the Markdown EULA as readable plain text: headings in capitals, no ** markers, bullets as dashes"""
    out = []
    for line in md.splitlines():
        line = line.rstrip()
        h = re.match(r'^(#+)\s*(.*)$', line)
        if h:
            line = h.group(2).upper() if len(h.group(1)) == 1 else h.group(2)
        line = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', line)
        line = re.sub(r'(\*\*|__)(.+?)\1', r'\2', line)
        line = re.sub(r'^(\s*)[*+] ', r'\1  - ', line)
        out.append(line.replace('`', ''))
    return '\n'.join(out).strip() + '\n'


def stage_studio():
    out = os.path.join(STAGE, 'studio')
    for item in STUDIO:
        src = os.path.join(ROOT, item)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(out, item))
            continue
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fn in files:
                if fn in SKIP_FILES or fn.endswith('.pyc'):
                    continue
                full = os.path.join(root, fn)
                dst = os.path.join(out, os.path.relpath(full, ROOT))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(full, dst)
    # the installer shows the EULA (and needs it accepted) before installing: NSIS shows plain text, LICENSE is Markdown
    with open(os.path.join(ROOT, 'LICENSE'), encoding='utf-8') as f:
        md = f.read()
    with open(os.path.join(out, 'LICENSE.txt'), 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(plain_license(md))
    n = sum(len(f) for _r, _d, f in os.walk(out))
    print('    %d files' % n)


def stage_python():
    out = os.path.join(STAGE, 'python')
    os.makedirs(CACHE, exist_ok=True)
    zpath = os.path.join(CACHE, os.path.basename(PY_URL))
    if not os.path.isfile(zpath):
        print('    downloading ' + PY_URL)
        urllib.request.urlretrieve(PY_URL, zpath + '.part')
        os.replace(zpath + '.part', zpath)
    print('    %s  sha256 %s' % (os.path.basename(zpath), hashlib.sha256(open(zpath, 'rb').read()).hexdigest()))
    with zipfile.ZipFile(zpath) as z:
        z.extractall(out)
    # the ._pth file fixes sys.path of the embeddable Python: add site-packages for the wheels below
    pth = [f for f in os.listdir(out) if f.endswith('._pth')][0]
    with open(os.path.join(out, pth), 'w') as f:
        f.write('python%s.zip\n.\nLib\\site-packages\nimport site\n' % ''.join(PY_VER.split('.')[:2]))
    site = os.path.join(out, 'Lib', 'site-packages')
    os.makedirs(site, exist_ok=True)
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--target', site,
                    '--platform', 'win_amd64', '--python-version', '.'.join(PY_VER.split('.')[:2]), '--implementation', 'cp',
                    '--only-binary=:all:', '--cache-dir', os.path.join(CACHE, 'pip')] + WHEELS, check=True)
    # prove it works: the studio's imports, with the staged Python itself
    py = os.path.join(out, 'python.exe')
    r = subprocess.run([py, '-c', 'import PIL, numpy, ctypes, http.server, multiprocessing, xml.etree.ElementTree; '
                        'print("Python", __import__("sys").version.split()[0], "Pillow", PIL.__version__, "numpy", numpy.__version__)'],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit('staged Python is broken:\n' + r.stderr)
    print('    ' + r.stdout.strip())


def build(version=None):
    desk = os.path.join(ROOT, 'desktop')
    npm = shutil.which('npm') or shutil.which('npm.cmd')
    if not npm:
        sys.exit('npm (Node.js) is needed to build the installer')
    if not os.path.isdir(os.path.join(desk, 'node_modules', 'electron-builder')):
        subprocess.run([npm, 'ci', '--no-audit', '--no-fund'], cwd=desk, check=True)
    extra = ['--', '-c.extraMetadata.version=' + version] if version else []   # e.g. a test build of a newer version
    subprocess.run([npm, 'run', 'dist'] + extra, cwd=desk, check=True)
    ver = version or json.load(open(os.path.join(desk, 'package.json')))['version']
    exe = os.path.join(DIST, 'installer', 'DayZStudio-Setup-%s.exe' % ver)
    # the updater needs the .exe, its .blockmap and latest.yml (also for alpha / beta versions: on GitHub those
    # are told apart by the release's pre-release flag)
    for f in (exe, exe + '.blockmap', os.path.join(DIST, 'installer', 'latest.yml')):
        if not os.path.isfile(f):
            sys.exit('electron-builder finished but %s is missing' % f)
    print('\n%s  (%.1f MB)' % (exe, os.path.getsize(exe) / 1048576))
    return exe


def stage_addon(src):
    """an add-on pack (a folder with addon.json) into studio/addons/<id>, and the
    Python packages it lists ("pip") into the private Python"""
    with open(os.path.join(src, 'addon.json'), encoding='utf-8') as f:
        m = json.load(f)
    aid = re.sub(r'[^A-Za-z0-9_-]', '', str(m.get('id') or os.path.basename(os.path.normpath(src))))
    out = os.path.join(STAGE, 'studio', 'addons', aid)
    shutil.copytree(src, out, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.git*', 'tests', '*.md'))
    print('    %s %s -> addons/%s' % (m.get('name', aid), m.get('version', ''), aid))
    pkgs = [str(p) for p in m.get('pip') or []]
    if pkgs:
        site = os.path.join(STAGE, 'python', 'Lib', 'site-packages')
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--target', site,
                        '--platform', 'win_amd64', '--python-version', '.'.join(PY_VER.split('.')[:2]), '--implementation', 'cp',
                        '--only-binary=:all:', '--cache-dir', os.path.join(CACHE, 'pip')] + pkgs, check=True)
        print('    + ' + ', '.join(pkgs))


def main(version=None, addons=()):
    shutil.rmtree(STAGE, ignore_errors=True)
    shutil.rmtree(os.path.join(DIST, 'installer'), ignore_errors=True)
    os.makedirs(os.path.join(STAGE, 'studio'))
    step('staging DayZ Studio')
    stage_studio()
    step('staging Python %s + %s' % (PY_VER, ', '.join(WHEELS)))
    stage_python()
    for a in addons:
        step('staging the add-on ' + a)
        stage_addon(a)
    step('building the installer (electron-builder)')
    return build(version)


if __name__ == '__main__':
    # python tools/make_installer.py [version] [--addon <folder>]...   (a build with add-on packs)
    args = sys.argv[1:]
    adds = []
    while '--addon' in args:
        i = args.index('--addon')
        adds.append(args[i + 1])
        del args[i:i + 2]
    main(args[0] if args else None, adds)
