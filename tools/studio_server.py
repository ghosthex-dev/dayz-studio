#!/usr/bin/env python3
"""
DayZ Studio local server  -  serves the editor and lets it talk to your DayZ install.

    python tools/studio_server.py            # then open http://localhost:8765

What it adds over opening index.html directly:
  * detects DayZ / DayZ Tools / the workshop mods (CF, Dabs Framework, DayZ-Editor)
  * builds + launches the DZStudio bridge mod so the game itself exports terrain heights
    and model bounding boxes for the 3D view
  * writes your project as a DayZ-Editor .dze build and starts the game with the Editor mod
Everything is plain standard library; nothing leaves your machine.
"""
import hashlib, json, mimetypes, os, re, shutil, struct, subprocess, sys, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..'))
GAME_DATA = os.path.join(APP, '_game')           # profile, missions, built bridge mod
PROFILE = os.path.join(GAME_DATA, 'profile')
MISSIONS = os.path.join(GAME_DATA, 'missions')
MOD_DIR = os.path.join(GAME_DATA, '@DZStudioBridge')
DATA = os.path.join(APP, 'data')                 # captured heights / bounds per world
BRIDGE_SRC = os.path.join(APP, 'bridge', 'DZStudioBridge')
LINK_SRC = os.path.join(APP, 'bridge', 'DZStudioLink')
LINK_DIR_MOD = os.path.join(GAME_DATA, '@DZStudioLink')
DOCS_DAYZ = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZ')
LOCAL_DAYZ = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'DayZ')
WORKSHOP_IDS = {'CF': '1559212036', 'DabsFramework': '2545327648', 'DayZEditor': '2250764298'}

state = {'proc': None, 'mode': None, 'world': None, 'started': 0.0, 'log': []}


def log(msg):
    state['log'].append('%s  %s' % (time.strftime('%H:%M:%S'), msg))
    state['log'] = state['log'][-60:]
    print(msg, flush=True)


# ------------------------------------------------------------------ environment
def steam_roots():
    roots = []
    for base in (r'C:\Program Files (x86)\Steam', r'C:\Program Files\Steam', r'D:\Steam', r'D:\SteamLibrary', r'E:\SteamLibrary', r'F:\SteamLibrary'):
        if os.path.isdir(os.path.join(base, 'steamapps')):
            roots.append(base)
    # libraryfolders.vdf may list more libraries
    for r in list(roots):
        vdf = os.path.join(r, 'steamapps', 'libraryfolders.vdf')
        if os.path.isfile(vdf):
            try:
                for m in re.finditer(r'"path"\s+"([^"]+)"', open(vdf, encoding='utf-8', errors='replace').read()):
                    p = m.group(1).replace('\\\\', '\\')
                    if os.path.isdir(os.path.join(p, 'steamapps')) and p not in roots:
                        roots.append(p)
            except OSError:
                pass
    return roots


def find_env():
    env = {'game': None, 'tools': None, 'mods': {}, 'addonBuilder': None, 'cfgConvert': None}
    for r in steam_roots():
        g = os.path.join(r, 'steamapps', 'common', 'DayZ')
        if not env['game'] and os.path.isfile(os.path.join(g, 'DayZ_x64.exe')):
            env['game'] = g
        t = os.path.join(r, 'steamapps', 'common', 'DayZ Tools')
        if not env['tools'] and os.path.isdir(t):
            env['tools'] = t
        for name, wid in WORKSHOP_IDS.items():
            m = os.path.join(r, 'steamapps', 'workshop', 'content', '221100', wid)
            if os.path.isdir(m) and name not in env['mods']:
                env['mods'][name] = m
    if env['tools']:
        cc = os.path.join(env['tools'], 'Bin', 'CfgConvert', 'CfgConvert.exe')
        if os.path.isfile(cc):
            env['cfgConvert'] = cc
    return env


# ------------------------------------------------------------------ PBO packer
def pack_pbo(src_dir, prefix, out_path):
    """Minimal uncompressed PBO writer (header entry with prefix, files, SHA1 trailer)."""
    files = []
    for root, _, names in os.walk(src_dir):
        for n in names:
            full = os.path.join(root, n)
            rel = os.path.relpath(full, src_dir).replace('/', '\\')
            files.append((rel, full))
    files.sort(key=lambda t: t[0].lower())
    out = bytearray()
    # product entry
    out += b'\0' + struct.pack('<5I', 0x56657273, 0, 0, 0, 0)
    out += b'prefix\0' + prefix.encode() + b'\0' + b'\0'
    datas = []
    for rel, full in files:
        d = open(full, 'rb').read()
        datas.append(d)
        out += rel.encode() + b'\0' + struct.pack('<5I', 0, len(d), 0, 0, len(d))
    out += b'\0' + struct.pack('<5I', 0, 0, 0, 0, 0)
    for d in datas:
        out += d
    out += b'\0' + hashlib.sha1(bytes(out)).digest()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(out)


def build_mod(env, src, mod_dir, pbo_name, prefix):
    """Pack a mod source folder into <mod_dir>/addons/<pbo_name>.pbo (config.cpp binarized when possible)"""
    stage = os.path.join(GAME_DATA, '_stage_' + pbo_name)
    shutil.rmtree(stage, ignore_errors=True)
    shutil.copytree(src, stage)
    cfg_cpp = os.path.join(stage, 'config.cpp')
    binarized = False
    if env.get('cfgConvert'):
        try:
            r = subprocess.run([env['cfgConvert'], '-bin', '-dst', os.path.join(stage, 'config.bin'), cfg_cpp], capture_output=True, text=True, timeout=60)
            if os.path.isfile(os.path.join(stage, 'config.bin')):
                os.remove(cfg_cpp)
                binarized = True
            else:
                log('CfgConvert failed: ' + (r.stdout + r.stderr)[:200])
        except Exception as e:
            log('CfgConvert error: %s' % e)
    pbo = os.path.join(mod_dir, 'addons', pbo_name + '.pbo')
    pack_pbo(stage, prefix, pbo)
    shutil.rmtree(stage, ignore_errors=True)
    with open(os.path.join(mod_dir, 'mod.cpp'), 'w') as f:
        f.write('name = "%s";\n' % prefix)
    log('%s built (%s config)' % (prefix, 'binarized' if binarized else 'text'))
    return pbo


def build_bridge(env):
    return build_mod(env, BRIDGE_SRC, MOD_DIR, 'dzstudiobridge', 'DZStudioBridge')


def build_link(env):
    return build_mod(env, LINK_SRC, LINK_DIR_MOD, 'dzstudiolink', 'DZStudioLink')


# ------------------------------------------------------------------ launching
def game_alive():
    p = state['proc']
    return bool(p and p.poll() is None)


def world_suffix(world):
    return {'chernarusplus': 'chernarusplus', 'enoch': 'enoch', 'sakhal': 'sakhal'}.get(world, world)


def start_capture(body):
    env = find_env()
    if not env['game']:
        return {'ok': False, 'error': 'DayZ_x64.exe not found. Is DayZ installed through Steam?'}
    if game_alive():
        return {'ok': False, 'error': 'The game is already running (started by DayZ Studio). Close it first.'}
    world = body.get('world', 'chernarusplus')
    size = float(body.get('size', 15360))
    n = int(body.get('n', 1024))
    classes = [c for c in body.get('classes', []) if re.fullmatch(r'[A-Za-z0-9_\-]+', c or '')]
    build_bridge(env)
    ddir = os.path.join(PROFILE, 'DZStudio')
    shutil.rmtree(ddir, ignore_errors=True)
    os.makedirs(ddir, exist_ok=True)
    with open(os.path.join(ddir, 'request.cfg'), 'w') as f:
        f.write('size=%s\nn=%d\n' % (size, n))
        if body.get('list'):
            f.write('list=1\n')
        if body.get('scan'):
            f.write('scan=1\nscanX0=%s\nscanZ0=%s\nscanX1=%s\nscanZ1=%s\nscanCell=%s\n' % tuple(float(body.get(k, d)) for k, d in (('x0', 0), ('z0', 0), ('x1', 0), ('z1', 0), ('cell', 100))))
        if body.get('probe'):
            f.write('probe=%s\nprobeN=%d\n' % (re.sub(r'[^A-Za-z0-9_]', '', body['probe']), int(body.get('probeN', 3000))))
    with open(os.path.join(ddir, 'classes.txt'), 'w') as f:
        f.write('\n'.join(classes) + '\n')
    mission = os.path.join(MISSIONS, 'DZStudioCapture.' + world_suffix(world))
    shutil.rmtree(mission, ignore_errors=True)
    os.makedirs(mission, exist_ok=True)
    with open(os.path.join(mission, 'init.c'), 'w') as f:
        f.write('void main()\n{\n}\n\nMission CreateCustomMission(string path)\n{\n\treturn DZStudioCreateMission();\n}\n')
    args = [os.path.join(env['game'], 'DayZ_x64.exe'), '-mod=' + MOD_DIR, '-mission=' + mission, '-profiles=' + PROFILE,
            '-window', '-nosplash', '-skipIntro', '-noBenchmark', '-nopause']
    log('launch: ' + ' '.join(args))
    state['proc'] = subprocess.Popen(args, cwd=env['game'])
    state.update(mode='capture', world=world, started=time.time())
    return {'ok': True, 'pid': state['proc'].pid}


def reap_capture():
    """the bridge finishes by writing capture.done; the engine ignores RequestExit from a custom mission,
    so close the game ourselves once the data is on disk"""
    p = state['proc']
    if state['mode'] == 'capture' and p and p.poll() is None:
        if os.path.isfile(os.path.join(PROFILE, 'DZStudio', 'capture.done')):
            time.sleep(1.5)
            try:
                p.terminate()
                log('capture finished - game closed')
            except Exception:
                pass


def capture_status():
    reap_capture()
    ddir = os.path.join(PROFILE, 'DZStudio')
    st = {
        'running': game_alive(), 'mode': state['mode'], 'world': state['world'],
        'elapsed': int(time.time() - state['started']) if state['started'] else 0,
        'heightsDone': os.path.isfile(os.path.join(ddir, 'heights.done')),
        'boundsDone': os.path.isfile(os.path.join(ddir, 'bounds.done')),
        'listDone': os.path.isfile(os.path.join(ddir, 'classes_all.done')),
        'scanDone': os.path.isfile(os.path.join(ddir, 'scan.done')),
        'captureDone': os.path.isfile(os.path.join(ddir, 'capture.done')),
        'heightsBytes': os.path.getsize(os.path.join(ddir, 'heights.bin')) if os.path.isfile(os.path.join(ddir, 'heights.bin')) else 0,
        'log': state['log'][-8:],
    }
    p = state['proc']
    st['exitCode'] = p.poll() if p else None
    return st


def finalize_capture(world):
    ddir = os.path.join(PROFILE, 'DZStudio')
    out = os.path.join(DATA, world)
    os.makedirs(out, exist_ok=True)
    got = []
    for fn in ('heights.bin', 'bounds.csv', 'classes_all.csv', 'scan.csv'):
        s = os.path.join(ddir, fn)
        if os.path.isfile(s):
            shutil.copy2(s, os.path.join(out, fn))
            got.append(fn)
    return got


EDITOR_MAPS = {'chernarusplus': 'ChernarusPlus', 'enoch': 'Enoch', 'sakhal': 'Sakhal'}


def ensure_editor_mission(map_name):
    # Editor missions live in Documents/DayZ/Editor/Missions/Editor.<Map> (init.c + MapGroupProto.xml)
    root = os.path.join(DOCS_DAYZ, 'Editor', 'Missions')
    os.makedirs(root, exist_ok=True)
    folder = os.path.join(root, 'Editor.' + map_name)
    os.makedirs(folder, exist_ok=True)
    init = os.path.join(folder, 'init.c')
    if not os.path.isfile(init):
        with open(init, 'w') as f:
            f.write('void main()\n{\n}\n\nMission CreateCustomMission(string path)\n{\n    return new MissionGameplay();\n}\n')
    proto = os.path.join(folder, 'MapGroupProto.xml')
    if not os.path.isfile(proto):
        sib = [os.path.join(root, d, 'MapGroupProto.xml') for d in os.listdir(root) if os.path.isfile(os.path.join(root, d, 'MapGroupProto.xml'))]
        if sib:
            shutil.copy2(sib[0], proto)
        else:
            with open(proto, 'w') as f:
                f.write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<prototype>\n</prototype>\n')
    return folder


def link_dirs():
    return [os.path.join(LOCAL_DAYZ, 'DZStudio', 'link'), os.path.join(DOCS_DAYZ, 'DZStudio', 'link')]


WORLD_SRC = os.path.join(BRIDGE_SRC, '..', 'DZStudioWorld')
WORLD_MOD = os.path.join(GAME_DATA, '@DZStudioWorld')


def build_world(env):
    return build_mod(env, os.path.abspath(WORLD_SRC), WORLD_MOD, 'dzstudioworld', 'DZStudioWorld')


def ensure_world_mission(map_name):
    """offline mission that simply runs the stock MissionGameplay (our mod takes over once it loads)"""
    folder = os.path.join(MISSIONS, 'DZStudioWorld.' + map_name)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'init.c'), 'w') as f:
        f.write('void main()\n{\n}\n\nMission CreateCustomMission(string path)\n{\n    return new MissionGameplay();\n}\n')
    proto = os.path.join(folder, 'MapGroupProto.xml')
    if not os.path.isfile(proto):
        root = os.path.join(DOCS_DAYZ, 'Editor', 'Missions')
        sib = []
        if os.path.isdir(root):
            sib = [os.path.join(root, d, 'MapGroupProto.xml') for d in os.listdir(root) if os.path.isfile(os.path.join(root, d, 'MapGroupProto.xml'))]
        if sib:
            shutil.copy2(sib[0], proto)
        else:
            with open(proto, 'w') as f:
                f.write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<prototype>\n</prototype>\n')
    return folder


def launch_editor(body):
    env = find_env()
    if not env['game']:
        return {'ok': False, 'error': 'DayZ_x64.exe not found.'}
    engine = body.get('engine', 'world')
    if engine == 'dabs':
        missing = [n for n in ('CF', 'DabsFramework', 'DayZEditor') if n not in env['mods']]
        if missing:
            return {'ok': False, 'error': 'Missing Steam Workshop mod(s): ' + ', '.join(missing) + '. Subscribe to them on the Steam Workshop first.'}
    if game_alive():
        return {'ok': False, 'error': 'The game is already running (started by DayZ Studio). Close it first.'}
    if engine == 'dabs':
        build_link(env)
    else:
        build_world(env)
    for d in link_dirs():
        os.makedirs(d, exist_ok=True)
        for fn in ('state.json', 'objects.json', 'cmd.json', 'world.flag'):
            for base in (d, os.path.dirname(d)):
                try:
                    os.remove(os.path.join(base, fn))
                except OSError:
                    pass
    map_name = EDITOR_MAPS.get(body.get('world', 'chernarusplus'))
    if engine == 'dabs':
        mod_list = [env['mods'][n] for n in ('CF', 'DabsFramework', 'DayZEditor')] + [LINK_DIR_MOD]
        mission = ensure_editor_mission(map_name) if map_name else None
    else:
        mod_list = [WORLD_MOD]
        mission = ensure_world_mission(map_name) if map_name else None
        for d in link_dirs():  # the standalone mod only acts when this flag exists
            with open(os.path.join(os.path.dirname(d), 'world.flag'), 'w') as f:
                f.write('1')
    if body.get('exportName'):
        nm = re.sub(r'[^A-Za-z0-9_]', '', str(body['exportName']))
        em = os.path.join(BUILD_DIR, '@' + nm)
        if os.path.isdir(em):
            mod_list.append(em)
            qj = os.path.join(BUILD_DIR, 'profile', 'DZStudioQuests', 'quests.json')
            os.makedirs(os.path.join(PLAY_DIR, 'players'), exist_ok=True)
            if os.path.isfile(qj):
                shutil.copy2(qj, os.path.join(PLAY_DIR, 'quests.json'))
            for fn in os.listdir(os.path.join(PLAY_DIR, 'players')):
                try:
                    os.remove(os.path.join(PLAY_DIR, 'players', fn))
                except OSError:
                    pass
            for fn in ('progress.json', 'reload.flag', 'reset.flag', 'simkill.flag'):
                try:
                    os.remove(os.path.join(PLAY_DIR, fn))
                except OSError:
                    pass
            with open(os.path.join(PLAY_DIR, 'playtest.flag'), 'w') as f:
                f.write('1')
    elif body.get('playtest') and os.path.isdir(QT_MOD):
        mod_list.append(QT_MOD)
    args = [os.path.join(env['game'], 'DayZ_x64.exe'), '-mod=' + ';'.join(mod_list), '-nosplash', '-skipIntro', '-noBenchmark', '-window', '-nopause']
    if mission:
        args.append('-mission=' + mission)
    log('launch %s: %s' % (engine, ' '.join(args)))
    state['proc'] = subprocess.Popen(args, cwd=env['game'])
    state.update(mode='editor', world=body.get('world'), started=time.time(), engine=engine)
    return {'ok': True, 'pid': state['proc'].pid, 'map': map_name, 'engine': engine}


# ---- local dedicated server (multiplayer test of an exported mod) ------------
SRV_ROOT = os.path.join(GAME_DATA, 'server')
SRV_PROFILE = os.path.join(SRV_ROOT, 'profile')
SRV_PORT = 2302
SRV_WORLDS = {'chernarusplus': 'dayzOffline.chernarusplus', 'enoch': 'dayzOffline.enoch', 'sakhal': 'dayzOffline.sakhal'}


def find_server():
    for r in steam_roots():
        s = os.path.join(r, 'steamapps', 'common', 'DayZServer')
        if os.path.isfile(os.path.join(s, 'DayZServer_x64.exe')):
            return s
    return None


def server_pids():
    """DayZServer_x64 processes (the server keeps running when Studio restarts, so look by name)"""
    try:
        r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq DayZServer_x64.exe', '/FO', 'CSV', '/NH'],
                           capture_output=True, text=True, timeout=10)
        return [int(m) for m in re.findall(r'"DayZServer_x64\.exe","(\d+)"', r.stdout)]
    except Exception:
        return []


def server_alive():
    p = state.get('srv')
    return bool(p and p.poll() is None) or bool(server_pids())


def detached(args, cwd):
    """start a process in its own console that outlives this server (and the job object it may run in)"""
    flags = getattr(subprocess, 'CREATE_NEW_CONSOLE', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
    try:
        return subprocess.Popen(args, cwd=cwd, creationflags=flags | 0x01000000)  # CREATE_BREAKAWAY_FROM_JOB
    except OSError:
        return subprocess.Popen(args, cwd=cwd, creationflags=flags)


def newest_server_rpt():
    best = None
    if os.path.isdir(SRV_PROFILE):
        for fn in os.listdir(SRV_PROFILE):
            if fn.lower().endswith('.rpt'):
                p = os.path.join(SRV_PROFILE, fn)
                if not best or os.path.getmtime(p) > os.path.getmtime(best):
                    best = p
    return best


def local_server_start(body):
    """run DayZServer_x64 on this PC with an exported quest mod (unsigned mods allowed, BattlEye off)"""
    srv = find_server()
    if not srv:
        return {'ok': False, 'error': 'DayZ Server is not installed. In Steam: Library > Tools > DayZ Server > Install.'}
    if server_alive():
        return {'ok': False, 'error': 'The local server is already running.'}
    nm = re.sub(r'[^A-Za-z0-9_]', '', str(body.get('exportName', '')))
    em = os.path.join(BUILD_DIR, '@' + nm)
    if not nm or not os.path.isdir(em):
        return {'ok': False, 'error': 'Build the mod first (Export > Build installable mod).'}
    world = body.get('world', 'chernarusplus')
    template = SRV_WORLDS.get(world, 'dayzOffline.chernarusplus')
    os.makedirs(SRV_PROFILE, exist_ok=True)
    for fn in os.listdir(SRV_PROFILE):  # old logs
        if fn.lower().endswith(('.rpt', '.log', '.adm', '.mdmp')):
            try:
                os.remove(os.path.join(SRV_PROFILE, fn))
            except OSError:
                pass
    qdir = os.path.join(SRV_PROFILE, 'DZStudioQuests')
    os.makedirs(os.path.join(qdir, 'players'), exist_ok=True)
    qj = os.path.join(BUILD_DIR, 'profile', 'DZStudioQuests', 'quests.json')
    if os.path.isfile(qj):
        shutil.copy2(qj, os.path.join(qdir, 'quests.json'))
    if body.get('resetProgress'):
        for fn in os.listdir(os.path.join(qdir, 'players')):
            try:
                os.remove(os.path.join(qdir, 'players', fn))
            except OSError:
                pass
    for fn in ('progress.json', 'reload.flag', 'reset.flag', 'simkill.flag', 'talk.flag', 'choose.flag'):
        try:
            os.remove(os.path.join(qdir, fn))
        except OSError:
            pass
    flag = os.path.join(qdir, 'playtest.flag')   # enables the test helpers (progress.json, simulated kills)
    if body.get('debug', True):
        with open(flag, 'w') as f:
            f.write('1')
    elif os.path.isfile(flag):
        os.remove(flag)
    cfg = os.path.join(SRV_ROOT, 'serverDZ.cfg')
    with open(os.path.join(SRV_ROOT, 'mod.txt'), 'w') as f:
        f.write(nm)
    # "check signatures like a real server": install the mod's .bikey in the server's keys folder, verifySignatures = 2
    verify = 0
    if body.get('verify'):
        keys = [k for k in os.listdir(os.path.join(em, 'keys'))] if os.path.isdir(os.path.join(em, 'keys')) else []
        if not keys:
            return {'ok': False, 'error': 'This build of the mod is not signed (no keys folder). Install DayZ Tools and build it again.'}
        os.makedirs(os.path.join(srv, 'keys'), exist_ok=True)
        for k in keys:
            shutil.copy2(os.path.join(em, 'keys', k), os.path.join(srv, 'keys', k))
        verify = 2
    with open(cfg, 'w') as f:
        f.write('hostname = "DayZ Studio test server";\npassword = "";\npasswordAdmin = "";\n'
                'description = "Local test of %s";\nenableWhitelist = 0;\nmaxPlayers = 4;\n'
                'verifySignatures = %d;\nforceSameBuild = 1;\nBattlEye = 0;\ndisableVoN = 1;\n'
                'thirdPersonView = 1;\ndisableCrosshair = 0;\ndisablePersonalLight = 1;\nlightingConfig = 0;\n'
                'serverTime = "2015/6/15/11/00";\nserverTimeAcceleration = 1;\nserverTimePersistent = 0;\n'
                'guaranteedUpdates = 1;\nloginQueueConcurrentPlayers = 5;\nloginQueueMaxPlayers = 20;\n'
                'instanceId = 77;\nstorageAutoFix = 1;\n\nclass Missions\n{\n    class DayZ\n    {\n'
                '        template = "%s";\n    };\n};\n' % (nm, verify, template))
    args = [os.path.join(srv, 'DayZServer_x64.exe'), '-config=' + cfg, '-port=%d' % SRV_PORT,
            '-profiles=' + SRV_PROFILE, '-mod=' + em, '-dologs', '-adminlog', '-netlog', '-freezecheck']
    log('local server: ' + ' '.join(args))
    state['srv'] = detached(args, srv)
    state['srvMod'] = nm
    state['srvStarted'] = time.time()
    return {'ok': True, 'pid': state['srv'].pid, 'mod': nm, 'port': SRV_PORT}


def local_server_status():
    if not state.get('srvMod') and os.path.isfile(os.path.join(SRV_ROOT, 'mod.txt')):
        state['srvMod'] = open(os.path.join(SRV_ROOT, 'mod.txt')).read().strip()
    out = {'ok': True, 'running': server_alive(), 'mod': state.get('srvMod'), 'ready': False, 'loaded': None,
           'errors': [], 'players': [], 'port': SRV_PORT, 'installed': bool(find_server())}
    if not out['running']:
        return out   # logs / progress on disk are from the last run
    rpt = newest_server_rpt()
    if rpt:
        try:
            txt = open(rpt, encoding='utf-8', errors='replace').read()
        except OSError:
            txt = ''
        m = re.findall(r'\[DZStudio\] (?:Re)?[Ll]oaded (\d+) quest', txt)
        if m:
            out['loaded'] = int(m[-1])
        out['ready'] = ('Mission read' in txt) or bool(m)
        errs = [ln.strip() for ln in txt.splitlines() if 'SCRIPT' in ln and ('(E)' in ln or 'ERROR' in ln)]
        out['errors'] = errs[-8:]
        joined = re.findall(r'Player "([^"]+)" \(steamID=\d+[^)]*\) is connected', txt)
        left = re.findall(r'Player (\S+) \(\d+\) kicked from server: \d+ \(([^)]*)\)', txt)
        out['players'] = sorted(set(joined))
        out['kicks'] = ['%s: %s' % k for k in left][-5:]
    pj = os.path.join(SRV_PROFILE, 'DZStudioQuests', 'progress.json')
    if os.path.isfile(pj):
        try:
            out['progress'] = json.load(open(pj, encoding='utf-8'))
        except (OSError, ValueError):
            pass
    return out


def local_server_stop():
    p = state.get('srv')
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(10)
        except Exception:
            p.kill()
    for pid in server_pids():
        subprocess.run(['taskkill', '/PID', str(pid), '/F'], capture_output=True)
    state['srv'] = None
    return {'ok': True}


def local_server_join(body):
    """start the game and connect it to the local server with the same mod"""
    env = find_env()
    if not env['game']:
        return {'ok': False, 'error': 'DayZ_x64.exe not found.'}
    if game_alive():
        return {'ok': False, 'error': 'The game is already running (started by DayZ Studio). Close it first.'}
    nm = state.get('srvMod') or (open(os.path.join(SRV_ROOT, 'mod.txt')).read().strip() if os.path.isfile(os.path.join(SRV_ROOT, 'mod.txt')) else '') or re.sub(r'[^A-Za-z0-9_]', '', str(body.get('exportName', '')))
    em = os.path.join(BUILD_DIR, '@' + nm)
    if not os.path.isdir(em):
        return {'ok': False, 'error': 'Build the mod first.'}
    name = re.sub(r'[^A-Za-z0-9_ ]', '', str(body.get('name', 'StudioTester'))) or 'StudioTester'
    # servers run BattlEye, so the client must too (DayZ_BE.exe starts it, like the official launcher)
    exe = 'DayZ_BE.exe' if os.path.isfile(os.path.join(env['game'], 'DayZ_BE.exe')) else 'DayZ_x64.exe'
    args = [os.path.join(env['game'], exe), '-connect=127.0.0.1', '-port=%d' % SRV_PORT, '-mod=' + em,
            '-name=' + name, '-nosplash', '-skipIntro', '-noBenchmark', '-window', '-nopause']
    log('join local server: ' + ' '.join(args))
    state['proc'] = subprocess.Popen(args, cwd=env['game'])
    state.update(mode='client', started=time.time(), engine='client')
    return {'ok': True, 'pid': state['proc'].pid}


def local_server_flag(body):
    """test helpers on the server: talk (teleport to the first NPC + open its conversation), simkill, reset, reload"""
    qdir = os.path.join(SRV_PROFILE, 'DZStudioQuests')
    os.makedirs(qdir, exist_ok=True)
    what = body.get('flag')
    if what not in ('talk', 'simkill', 'reset', 'reload', 'give', 'setvar'):
        return {'ok': False, 'error': 'unknown flag'}
    lines = [re.sub(r'[^A-Za-z0-9_@ .\-]', '', str(x)) for x in body.get('lines', [])]
    with open(os.path.join(qdir, what + '.flag'), 'w') as f:
        f.write('\n'.join(lines) if what in ('simkill', 'give', 'setvar') else str(int(body.get('index', 0) or 0)) if what == 'talk' else '1')
    return {'ok': True}


# ---- live link files -----------------------------------------------------------
def link_state():
    best = None
    for d in link_dirs():
        f = os.path.join(d, 'state.json')
        if os.path.isfile(f):
            m = os.path.getmtime(f)
            if best is None or m > best[0]:
                best = (m, f)
    out = {'alive': game_alive(), 'mode': state['mode'], 'fresh': False, 'state': None}
    if best:
        try:
            with open(best[1], 'r', encoding='utf-8') as fh:
                out['state'] = json.loads(fh.read() or 'null')
            out['age'] = round(time.time() - best[0], 2)
            out['fresh'] = out['age'] < 3.0 and out['alive']
        except (OSError, ValueError):
            pass
    return out


_link_lock = threading.Lock()


def link_send(body):
    with _link_lock:  # requests arrive on parallel threads; never interleave writes
        return _link_send(body)


def _link_send(body):
    cmds = body.get('cmds', [])
    d = link_dirs()[0]
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, 'cmd.json')
    batch = {'seq': int(body.get('seq', 0)), 'cmds': cmds}
    if os.path.isfile(path):  # keep commands the game has not consumed yet
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                old = json.loads(fh.read())
            batch['cmds'] = old.get('cmds', []) + cmds
        except (OSError, ValueError):
            pass
    tmp = '%s.%d.tmp' % (path, threading.get_ident())
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(batch, fh, indent=1)  # short lines: Enforce's FGets reads line by line
    os.replace(tmp, path)
    return {'ok': True, 'queued': len(batch['cmds'])}


def link_objects(token):
    for d in link_dirs():
        f = os.path.join(d, 'objects.json')
        if os.path.isfile(f):
            try:
                with open(f, 'r', encoding='utf-8') as fh:
                    data = json.loads(fh.read())
                if token is None or data.get('token') == token:
                    return {'ok': True, 'data': data}
            except (OSError, ValueError):
                pass
    return {'ok': False}


def build_models(body):
    world = re.sub(r'[^A-Za-z0-9_]', '', body.get('world', 'chernarusplus'))
    script = os.path.join(HERE, 'extract_models.py')
    try:
        r = subprocess.run([sys.executable, script, world], capture_output=True, text=True, timeout=900, cwd=APP)
        tail = (r.stdout + r.stderr).strip().splitlines()[-4:]
        return {'ok': r.returncode == 0, 'log': tail}
    except Exception as e:
        return {'ok': False, 'log': [str(e)]}


BUILD_DIR = os.path.join(DATA, '_build')
PROJECTS_DIR = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZStudio', 'Projects')
BACKUPS_DIR = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZStudio', 'Backups')


KEYS_DIR = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZStudio', 'Keys')
PREFABS_DIR = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZStudio', 'Prefabs')


def prefab_list():
    """the user's prefab stamps (shared by every project)"""
    out = []
    if os.path.isdir(PREFABS_DIR):
        for fn in sorted(os.listdir(PREFABS_DIR)):
            if fn.endswith('.json'):
                try:
                    with open(os.path.join(PREFABS_DIR, fn), encoding='utf-8') as f:
                        j = json.load(f)
                    if isinstance(j.get('parts'), list):
                        out.append({'id': fn[:-5], 'name': str(j.get('name') or fn[:-5]), 'parts': j['parts'], 'desc': str(j.get('desc') or '')})
                except (OSError, ValueError):
                    continue
    return {'ok': True, 'prefabs': out, 'dir': PREFABS_DIR}


def prefab_save(body):
    pid = re.sub(r'[^A-Za-z0-9_\-]', '', str(body.get('id') or ''))
    parts = body.get('parts')
    if not pid or not isinstance(parts, list) or not parts:
        return {'ok': False, 'error': 'nothing to save'}
    os.makedirs(PREFABS_DIR, exist_ok=True)
    with open(os.path.join(PREFABS_DIR, pid + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'name': str(body.get('name') or pid)[:80], 'desc': str(body.get('desc') or '')[:200], 'parts': parts}, f, indent=1)
    return {'ok': True, 'id': pid}


def prefab_delete(body):
    pid = re.sub(r'[^A-Za-z0-9_\-]', '', str(body.get('id') or ''))
    path = os.path.join(PREFABS_DIR, pid + '.json')
    if pid and os.path.isfile(path):
        os.remove(path)
    return {'ok': True}


def sign_pbo(env, pbo, mod_dir, key_name):
    """sign the PBO with DayZ Tools (DSCreateKey once per key name, DSSignFile per build) and put the .bikey into
    <mod>/keys so servers can keep verifySignatures = 2. The private key stays in Documents/DayZStudio/Keys."""
    if not env.get('tools'):
        return {'signed': False, 'why': 'DayZ Tools not found'}
    ds = os.path.join(env['tools'], 'Bin', 'DsUtils')
    create, signer = os.path.join(ds, 'DSCreateKey.exe'), os.path.join(ds, 'DSSignFile.exe')
    if not (os.path.isfile(create) and os.path.isfile(signer)):
        return {'signed': False, 'why': 'DsUtils not found in DayZ Tools'}
    os.makedirs(KEYS_DIR, exist_ok=True)
    priv = os.path.join(KEYS_DIR, key_name + '.biprivatekey')
    pub = os.path.join(KEYS_DIR, key_name + '.bikey')
    try:
        if not os.path.isfile(priv):
            subprocess.run([create, key_name], cwd=KEYS_DIR, capture_output=True, timeout=60)
        if not (os.path.isfile(priv) and os.path.isfile(pub)):
            return {'signed': False, 'why': 'DSCreateKey did not create the key'}
        for fn in os.listdir(os.path.dirname(pbo)):   # old signatures of this PBO
            if fn.lower().endswith('.bisign'):
                os.remove(os.path.join(os.path.dirname(pbo), fn))
        r = subprocess.run([signer, priv, pbo], capture_output=True, text=True, timeout=120)
        sig = pbo + '.' + key_name + '.bisign'
        if not os.path.isfile(sig):
            return {'signed': False, 'why': 'DSSignFile failed: ' + (r.stdout + r.stderr)[:200]}
        os.makedirs(os.path.join(mod_dir, 'keys'), exist_ok=True)
        shutil.copy2(pub, os.path.join(mod_dir, 'keys', key_name + '.bikey'))
        return {'signed': True, 'key': key_name, 'bikey': os.path.join(mod_dir, 'keys', key_name + '.bikey')}
    except Exception as e:
        return {'signed': False, 'why': str(e)}


def build_export(body):
    """pack the quest framework the browser exported into a ready-to-install mod (PBO) + profile files, zipped"""
    import zipfile
    env = find_env()
    nm = re.sub(r'[^A-Za-z0-9_]', '', str(body.get('name', 'DZStudioQuests'))) or 'DZStudioQuests'
    for key in ('config', 'core', 'custom', 'hook', 'quests'):
        if key not in body:
            return {'ok': False, 'error': 'missing ' + key}
    src = os.path.join(GAME_DATA, '_src_export_' + nm)
    shutil.rmtree(src, ignore_errors=True)
    os.makedirs(os.path.join(src, 'scripts', '4_World'), exist_ok=True)
    os.makedirs(os.path.join(src, 'scripts', '5_Mission'), exist_ok=True)

    def w(rel, text):
        with open(os.path.join(src, rel), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    w('config.cpp', body['config'])
    w(os.path.join('scripts', '4_World', 'DSQuests.c'), body['core'])
    w(os.path.join('scripts', '4_World', 'DSCustom.c'), body['custom'])
    w(os.path.join('scripts', '5_Mission', 'DSMission.c'), body['hook'])
    n_snd = 0
    for s_ in body.get('sounds', []):
        sid = re.sub(r'[^A-Za-z0-9]', '', str(s_.get('id', '')))
        ext = 'wav' if s_.get('ext') == 'wav' else 'ogg'
        f_ = os.path.join(DATA, '_audio', '%s.%s' % (sid, ext))
        if sid and os.path.isfile(f_):
            os.makedirs(os.path.join(src, 'sounds'), exist_ok=True)
            shutil.copy2(f_, os.path.join(src, 'sounds', '%s.%s' % (sid, ext)))
            n_snd += 1
    mod_dir = os.path.join(BUILD_DIR, '@' + nm)
    shutil.rmtree(mod_dir, ignore_errors=True)
    pbo = build_mod(env, src, mod_dir, nm.lower(), nm)
    sig = sign_pbo(env, pbo, mod_dir, nm) if body.get('sign', True) else {'signed': False, 'why': 'signing turned off'}
    if sig.get('signed'):
        step4 = ('4. The mod is signed. Copy  @%s/keys/%s.bikey  into your server\'s  keys  folder and keep\n'
                 '   verifySignatures = 2  in serverDZ.cfg. (Rebuilding the mod keeps the same key.)\n' % (nm, nm))
    else:
        step4 = ('4. The mod is not signed (%s). Either set  verifySignatures = 0  in serverDZ.cfg, or sign the PBO with\n'
                 '   DayZ Tools (DSSignFile) and put the .bikey in the server keys folder.\n' % sig.get('why', ''))
    prof = os.path.join(BUILD_DIR, 'profile', 'DZStudioQuests')
    os.makedirs(prof, exist_ok=True)
    with open(os.path.join(prof, 'quests.json'), 'w', encoding='utf-8') as f:
        f.write(body['quests'])
    install = (
        'DayZ Studio - quest mod "%s"\n\n'
        '1. Copy the folder  @%s  into your DayZ server folder (next to DayZServer_x64.exe).\n'
        '2. Start the server with  -mod=@%s  (add it to your other mods separated by ;).\n'
        '   The conversation, tracker and journal screens run on the players\' PCs, so players need this mod too:\n'
        '   publish it on the Steam Workshop or hand them the @%s folder.\n'
        '3. Copy the folder  profile/DZStudioQuests  into your server PROFILE folder (the one given with -profiles=).\n'
        '   quests.json in it is your quest data; per-player progress is written next to it (players/ folder).\n' % (nm, nm, nm, nm)
        + step4 +
        '5. Restart the server. The script log shows "[DZStudio] Loaded N quest(s)."\n')
    zpath = os.path.join(BUILD_DIR, nm + '_ready.zip')
    os.makedirs(BUILD_DIR, exist_ok=True)
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _d, files in os.walk(mod_dir):
            for fn in files:
                full = os.path.join(root, fn)
                z.write(full, os.path.join('@' + nm, os.path.relpath(full, mod_dir)))
        z.write(os.path.join(prof, 'quests.json'), 'profile/DZStudioQuests/quests.json')
        z.writestr('INSTALL.txt', install)
    return {'ok': True, 'zip': 'data/_build/%s_ready.zip' % nm, 'name': nm, 'pboBytes': os.path.getsize(pbo),
            'binarized': bool(env.get('cfgConvert')), 'sounds': n_snd, 'folder': mod_dir,
            'signed': bool(sig.get('signed')), 'signNote': sig.get('why', ''), 'keysDir': KEYS_DIR}


def proj_paths(pid):
    pid = re.sub(r'[^A-Za-z0-9_\-]', '', str(pid or ''))
    return pid, os.path.join(PROJECTS_DIR, pid + '.dzstudio.json')


def proj_save(body):
    pid, path = proj_paths(body.get('id'))
    if not pid:
        return {'ok': False, 'error': 'no project id'}
    data = body.get('data', '')
    if not data or len(data) < 20:
        return {'ok': False, 'error': 'empty project'}
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(data)
    os.replace(tmp, path)
    # rolling backups: at most one per 5 minutes (unless forced), the newest 25 are kept
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    mine = sorted(n for n in os.listdir(BACKUPS_DIR) if n.startswith(pid + '_'))
    last = os.path.getmtime(os.path.join(BACKUPS_DIR, mine[-1])) if mine else 0
    backed = False
    if body.get('force') or time.time() - last > 300:
        stamp = time.strftime('%Y%m%d_%H%M%S')
        shutil.copy2(path, os.path.join(BACKUPS_DIR, '%s_%s.json' % (pid, stamp)))
        backed = True
        mine = sorted(n for n in os.listdir(BACKUPS_DIR) if n.startswith(pid + '_'))
        for old in mine[:-25]:
            try:
                os.remove(os.path.join(BACKUPS_DIR, old))
            except OSError:
                pass
    with open(os.path.join(PROJECTS_DIR, '_last.json'), 'w') as f:
        json.dump({'id': pid, 'name': body.get('name', ''), 'saved': time.time()}, f)
    return {'ok': True, 'path': path, 'backup': backed}


def proj_list():
    out = []
    if os.path.isdir(PROJECTS_DIR):
        for fn in os.listdir(PROJECTS_DIR):
            if not fn.endswith('.dzstudio.json'):
                continue
            p = os.path.join(PROJECTS_DIR, fn)
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    j = json.load(f)
                out.append({'id': fn[:-len('.dzstudio.json')], 'name': (j.get('meta') or {}).get('name', ''),
                            'objects': len(j.get('objects', [])), 'quests': len(j.get('quests', [])),
                            'saved': os.path.getmtime(p), 'world': (j.get('meta') or {}).get('world', '')})
            except (OSError, ValueError):
                continue
    out.sort(key=lambda x: -x['saved'])
    backups = []
    if os.path.isdir(BACKUPS_DIR):
        for fn in sorted(os.listdir(BACKUPS_DIR), reverse=True)[:200]:
            if fn.endswith('.json'):
                p = os.path.join(BACKUPS_DIR, fn)
                backups.append({'file': fn, 'saved': os.path.getmtime(p), 'bytes': os.path.getsize(p)})
    last = None
    try:
        with open(os.path.join(PROJECTS_DIR, '_last.json'), 'r') as f:
            last = json.load(f)
    except (OSError, ValueError):
        pass
    return {'ok': True, 'projects': out, 'backups': backups, 'last': last, 'dir': PROJECTS_DIR}


def proj_load(q):
    pid = (q.get('id') or [''])[0]
    bk = (q.get('backup') or [''])[0]
    if bk:
        fn = os.path.basename(bk)
        path = os.path.join(BACKUPS_DIR, fn)
    else:
        _pid, path = proj_paths(pid)
    if not os.path.isfile(path):
        return {'ok': False, 'error': 'not found'}
    with open(path, 'r', encoding='utf-8') as f:
        return {'ok': True, 'data': f.read()}


def audio_upload(body):
    """voice lines for NPC conversations: stored as data/_audio/<sha1-10>.<ogg|wav>"""
    import base64
    name = str(body.get('name', 'voice.ogg'))
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if ext not in ('ogg', 'wav'):
        return {'ok': False, 'error': 'Only .ogg and .wav files can be used.'}
    try:
        raw = base64.b64decode(body.get('data', ''))
    except Exception:
        return {'ok': False, 'error': 'Could not read the file data.'}
    if not raw or len(raw) > 12 * 1024 * 1024:
        return {'ok': False, 'error': 'File is empty or larger than 12 MB.'}
    fid = hashlib.sha1(raw).hexdigest()[:10]
    d = os.path.join(DATA, '_audio')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, '%s.%s' % (fid, ext)), 'wb') as f:
        f.write(raw)
    return {'ok': True, 'id': fid, 'ext': ext, 'size': len(raw)}


def scene_build(body):
    world = re.sub(r'[^A-Za-z0-9_]', '', body.get('world', 'chernarusplus'))
    script = os.path.join(HERE, 'build_scene.py')
    try:
        r = subprocess.run([sys.executable, script, world], capture_output=True, text=True, timeout=1800, cwd=APP)
        tail = (r.stdout + r.stderr).strip().splitlines()[-4:]
        return {'ok': r.returncode == 0, 'log': tail}
    except Exception as e:
        return {'ok': False, 'log': [str(e)]}


def models_add(body):
    """append single classes (their meshes + textures) to the 3D pack"""
    world = re.sub(r'[^A-Za-z0-9_]', '', body.get('world', 'chernarusplus'))
    classes = [c for c in body.get('classes', []) if re.fullmatch(r'[A-Za-z0-9_\-]+', c or '')][:300]
    if not classes:
        return {'ok': False, 'log': ['no classes']}
    script = os.path.join(HERE, 'extract_models.py')
    try:
        r = subprocess.run([sys.executable, script, world, '--add', ','.join(classes)], capture_output=True, text=True, timeout=900, cwd=APP)
        tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
        return {'ok': r.returncode == 0, 'log': tail}
    except Exception as e:
        return {'ok': False, 'log': [str(e)]}


QT_SRC = os.path.join(GAME_DATA, '_src_questtest')
QT_MOD = os.path.join(GAME_DATA, '@DZStudioQuestTest')
PLAY_DIR = os.path.join(LOCAL_DAYZ, 'DZStudioQuests')


def playtest_prepare(body):
    """Build the play-test mod (generated quest runtime + Editor hook) and stage quests.json."""
    env = find_env()
    for key in ('config', 'core', 'custom', 'hook', 'quests'):
        if key not in body:
            return {'ok': False, 'error': 'missing ' + key}
    shutil.rmtree(QT_SRC, ignore_errors=True)
    os.makedirs(os.path.join(QT_SRC, 'scripts', '4_World'), exist_ok=True)
    os.makedirs(os.path.join(QT_SRC, 'scripts', '5_Mission'), exist_ok=True)
    with open(os.path.join(QT_SRC, 'config.cpp'), 'w', encoding='utf-8') as f:
        f.write(body['config'])
    with open(os.path.join(QT_SRC, 'scripts', '4_World', 'DSQuests.c'), 'w', encoding='utf-8') as f:
        f.write(body['core'])
    with open(os.path.join(QT_SRC, 'scripts', '4_World', 'DSCustom.c'), 'w', encoding='utf-8') as f:
        f.write(body['custom'])
    with open(os.path.join(QT_SRC, 'scripts', '5_Mission', 'DSMissionHook.c'), 'w', encoding='utf-8') as f:
        f.write(body['hook'])
    snd_dir = os.path.join(QT_SRC, 'sounds')
    for s in body.get('sounds', []):
        sid = re.sub(r'[^A-Za-z0-9]', '', str(s.get('id', '')))
        ext = 'wav' if s.get('ext') == 'wav' else 'ogg'
        src = os.path.join(DATA, '_audio', '%s.%s' % (sid, ext))
        if sid and os.path.isfile(src):
            os.makedirs(snd_dir, exist_ok=True)
            shutil.copy2(src, os.path.join(snd_dir, '%s.%s' % (sid, ext)))
    build_mod(env, QT_SRC, QT_MOD, 'dzstudioquesttest', 'DZStudioQuestTest')
    os.makedirs(os.path.join(PLAY_DIR, 'players'), exist_ok=True)
    for fn in ('progress.json', 'reload.flag', 'reset.flag', 'simkill.flag'):
        try:
            os.remove(os.path.join(PLAY_DIR, fn))
        except OSError:
            pass
    pdir = os.path.join(PLAY_DIR, 'players')
    for fn in os.listdir(pdir):
        try:
            os.remove(os.path.join(pdir, fn))
        except OSError:
            pass
    with open(os.path.join(PLAY_DIR, 'quests.json'), 'w', encoding='utf-8') as f:
        f.write(body['quests'])
    with open(os.path.join(PLAY_DIR, 'playtest.flag'), 'w') as f:
        f.write('1')
    return {'ok': True}


def playtest_flag(body):
    os.makedirs(PLAY_DIR, exist_ok=True)
    act = body.get('action')
    if act == 'reload':
        with open(os.path.join(PLAY_DIR, 'quests.json'), 'w', encoding='utf-8') as f:
            f.write(body.get('quests', '{"quests":[]}'))
        open(os.path.join(PLAY_DIR, 'reload.flag'), 'w').write('1')
    elif act == 'reset':
        open(os.path.join(PLAY_DIR, 'reset.flag'), 'w').write('1')
    elif act == 'simkill':
        cls = re.sub(r'[^A-Za-z0-9_@]', '', body.get('cls', '@infected')) or '@infected'
        n = max(1, min(50, int(body.get('count', 1))))
        open(os.path.join(PLAY_DIR, 'simkill.flag'), 'a').write((cls + '\n') * n)
    else:
        return {'ok': False, 'error': 'unknown action'}
    return {'ok': True}


def playtest_progress():
    out = {'ok': True, 'progress': None, 'errors': [], 'loaded': False, 'alive': game_alive()}
    f = os.path.join(PLAY_DIR, 'progress.json')
    if os.path.isfile(f):
        try:
            with open(f, 'r', encoding='utf-8') as fh:
                out['progress'] = json.loads(fh.read())
            out['age'] = round(time.time() - os.path.getmtime(f), 1)
        except (OSError, ValueError):
            pass
    logs = []
    if os.path.isdir(LOCAL_DAYZ):
        logs = [os.path.join(LOCAL_DAYZ, n) for n in os.listdir(LOCAL_DAYZ) if n.startswith('script_') and n.endswith('.log')]
    if logs:
        lp = max(logs, key=os.path.getmtime)
        try:
            with open(lp, 'r', encoding='utf-8', errors='replace') as fh:
                lines = fh.read().splitlines()
            for i, l in enumerate(lines):
                if '[DZStudio] Loaded' in l or '[DZStudio] Reloaded' in l:
                    out['loaded'] = True
                if ('(E)' in l or 'ompile error' in l or "Can't compile" in l) and 'Sound' not in l:
                    out['errors'].append(l.strip()[:240])
            out['errors'] = out['errors'][:12]
            out['log'] = os.path.basename(lp)
        except OSError:
            pass
    return out


def write_handoff(body):
    name = re.sub(r'[^A-Za-z0-9_.\-]', '_', body.get('name', 'project.json'))
    # the Editor's file dialog opens in  Documents\DayZ\Editor  by default, so put it there
    d = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZ', 'Editor')
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        d = os.path.join(GAME_DATA, 'handoff')
        os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body.get('text', ''))
    return {'ok': True, 'path': path}


def newest_rpt():
    cands = []
    for d in (PROFILE, os.path.join(os.environ.get('LOCALAPPDATA', ''), 'DayZ')):
        if os.path.isdir(d):
            cands += [os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith('.rpt')]
    return max(cands, key=os.path.getmtime) if cands else None


# ------------------------------------------------------------------ HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP, **kw)

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/api/env':
            env = find_env()
            have = {}
            if os.path.isdir(DATA):
                for w in os.listdir(DATA):
                    have[w] = {fn: os.path.isfile(os.path.join(DATA, w, fn)) for fn in ('heights.bin', 'bounds.csv')}
            return self._json({'ok': True, 'game': env['game'], 'tools': env['tools'], 'mods': env['mods'], 'cfgConvert': bool(env['cfgConvert']),
                               'running': game_alive(), 'data': have, 'profile': PROFILE})
        if u.path == '/api/capture/status':
            return self._json(capture_status())
        if u.path == '/api/link/state':
            return self._json(link_state())
        if u.path == '/api/server/status':
            return self._json(local_server_status())
        if u.path == '/api/prefabs':
            return self._json(prefab_list())
        if u.path == '/api/project/list':
            return self._json(proj_list())
        if u.path == '/api/project/load':
            return self._json(proj_load(parse_qs(u.query)))
        if u.path == '/api/playtest/progress':
            return self._json(playtest_progress())
        if u.path == '/api/link/objects':
            q = parse_qs(u.query)
            tok = int(q['token'][0]) if 'token' in q else None
            return self._json(link_objects(tok))
        if u.path == '/api/servercfg':
            return self._json(ST.servercfg_get(parse_qs(u.query)))
        if u.path == '/api/types/source':
            return self._json(ST.types_source(parse_qs(u.query)))
        if u.path == '/api/pbo/sources':
            return self._json(ST.pbo_sources())
        if u.path == '/api/fs/list':
            return self._json(ST.fs_list(parse_qs(u.query)))
        if u.path == '/api/pbo/info':
            return self._json(ST.pbo_info(parse_qs(u.query)))
        if u.path == '/api/logs/tail':
            return self._json(ST.logs_tail(parse_qs(u.query)))
        if u.path == '/api/nodes':
            return self._json(ST.nodes_list())
        if u.path == '/api/mods':
            return self._json(ST.mods_list())
        if u.path == '/api/rpt':
            p = newest_rpt()
            txt = ''
            if p:
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    lines = f.read().splitlines()
                txt = '\n'.join(l for l in lines if 'DZStudio' in l or 'SCRIPT' in l or 'rror' in l)[-6000:]
            return self._json({'file': p, 'text': txt})
        return super().do_GET()

    def end_headers(self):
        # fresh files while developing / re-capturing
        if not any(bytes(h).lower().startswith(b'cache-control') for h in getattr(self, '_headers_buffer', [])):
            self.send_header('Cache-Control', 'no-cache')  # always revalidate: scripts change while developing
        super().end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(n) or b'{}')
        if u.path == '/api/capture/start':
            return self._json(start_capture(body))
        if u.path == '/api/capture/finalize':
            return self._json({'ok': True, 'files': finalize_capture(body.get('world', 'chernarusplus'))})
        if u.path == '/api/models/build':
            return self._json(build_models(body))
        if u.path == '/api/link/cmd':
            return self._json(link_send(body))
        if u.path == '/api/mod/build':
            return self._json(build_export(body))
        if u.path == '/api/prefabs/save':
            return self._json(prefab_save(body))
        if u.path == '/api/prefabs/delete':
            return self._json(prefab_delete(body))
        if u.path == '/api/project/save':
            return self._json(proj_save(body))
        if u.path == '/api/audio/upload':
            return self._json(audio_upload(body))
        if u.path == '/api/scene/build':
            return self._json(scene_build(body))
        if u.path == '/api/models/add':
            return self._json(models_add(body))
        if u.path == '/api/playtest/prepare':
            return self._json(playtest_prepare(body))
        if u.path == '/api/playtest/flag':
            return self._json(playtest_flag(body))
        if u.path == '/api/server/start':
            return self._json(local_server_start(body))
        if u.path == '/api/server/stop':
            return self._json(local_server_stop())
        if u.path == '/api/server/join':
            return self._json(local_server_join(body))
        if u.path == '/api/server/flag':
            return self._json(local_server_flag(body))
        if u.path == '/api/editor/launch':
            return self._json(launch_editor(body))
        if u.path == '/api/handoff':
            return self._json(write_handoff(body))
        if u.path == '/api/servercfg/save':
            return self._json(ST.servercfg_save(body))
        if u.path == '/api/types/apply':
            return self._json(ST.types_apply(body))
        if u.path == '/api/pbo/unpack':
            return self._json(ST.pbo_unpack(body))
        if u.path == '/api/pbo/pack':
            return self._json(ST.pbo_pack(body))
        if u.path == '/api/pbo/models':
            return self._json(ST.pbo_models(body))
        if u.path == '/api/nodes/save':
            return self._json(ST.nodes_save(body))
        if u.path == '/api/nodes/delete':
            return self._json(ST.nodes_delete(body))
        if u.path == '/api/mods/clear':
            return self._json(ST.mods_clear())
        if u.path == '/api/fs/open':
            return self._json(open_folder(body))
        if u.path == '/api/capture/stop':
            if game_alive():
                state['proc'].terminate()
            return self._json({'ok': True})
        return self._json({'ok': False, 'error': 'unknown endpoint'}, 404)


def open_folder(body):
    """show a folder Studio wrote (unpacked / packed files) in Explorer"""
    d = str(body.get('path', ''))
    if not os.path.isdir(d):
        d = os.path.dirname(d)
    if not os.path.isdir(d):
        return {'ok': False, 'error': 'Folder not found'}
    os.startfile(d)
    return {'ok': True}


import server_tools as ST   # noqa: E402  (needs the helpers above)
ST.setup(dict(find_env=find_env, find_server=find_server, pack_pbo=pack_pbo, sign_pbo=sign_pbo, steam_roots=steam_roots,
              DATA=DATA, SRV_WORLDS=SRV_WORLDS, SRV_PROFILE=SRV_PROFILE, PROFILE=PROFILE, LOCAL_DAYZ=LOCAL_DAYZ,
              server_alive=server_alive))


def main():
    import socket
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    os.makedirs(GAME_DATA, exist_ok=True)

    class V6(ThreadingHTTPServer):
        address_family = socket.AF_INET6

    servers = [ThreadingHTTPServer(('127.0.0.1', port), Handler)]
    try:
        servers.append(V6(('::1', port), Handler))  # "localhost" may resolve to ::1 first
    except OSError:
        pass
    for extra in servers[1:]:
        threading.Thread(target=extra.serve_forever, daemon=True).start()
    print('DayZ Studio server on http://localhost:%d  (Ctrl+C to stop)' % port, flush=True)
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
