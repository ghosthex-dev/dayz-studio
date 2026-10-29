"""DayZ Studio - which DayZ maps are on this PC.

Every official map ships as  worlds_<id>_data.pbo  (satellite tiles) and  worlds_<id>_ce.pbo  (Central Economy):
the base game's in  DayZ\\Addons,  a DLC map's in its own folder ( DayZ\\sakhal\\Addons,  DayZ\\nasdara\\addons ).
DayZ Server brings a  mpmissions\\dayzOffline.<id>  mission for each. Looking for those files - instead of keeping
a fixed list - lets Studio offer a new DLC map as soon as Steam has installed it.

A mod map (Deer Isle, Namalsk, ...) comes as a Steam Workshop item (steamapps\\workshop\\content\\221100\\<id>, next to
DayZ) or an @folder in DayZ's folder, and names its pbos as its author likes: it is the mod with a  <id>.wrp  world
in one of its pbos, the satellite tiles in whichever pbo has the most  S_x_y_lco.paa,  the Central Economy in the
one with mapgroupproto.xml.

A map's size (the side of the square world, in metres) is read from its areaflags.map header: the server
mission's copy, else the one inside the CE pbo, else the copy extract_maps.py already saved.

    python worlds.py        # prints what this PC has
"""
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# id -> (name shown in Studio, CfgWorlds class). Missions are named <anything>.<class>, case does not matter, so
# a map that is not listed here works with its id. The order is the order of the Map list.
KNOWN = {
    'chernarusplus': ('Chernarus+', 'ChernarusPlus'),
    'enoch': ('Livonia', 'Enoch'),
    'sakhal': ('Sakhal', 'Sakhal'),
    'nasdara': ('Nasdara', 'Nasdara'),
    'deerisle': ('Deer Isle', 'DeerIsle'),
    'namalsk': ('Namalsk', 'Namalsk'),
}

_sizes = {}   # (path, mtime) -> size, so the big CE pbos are only opened once
_pbos = {}    # (path, mtime, size) -> what a mod's pbo holds (map mods are found by reading pbo headers)


def world_name(w):
    return KNOWN[w][0] if w in KNOWN else w[:1].upper() + w[1:]


def world_class(w):
    return KNOWN[w][1] if w in KNOWN else w


def addon_folders(game):
    """DayZ\\Addons plus every DLC folder's Addons"""
    out = []
    if not game or not os.path.isdir(game):
        return out
    if os.path.isdir(os.path.join(game, 'Addons')):
        out.append((os.path.join(game, 'Addons'), ''))
    for d in sorted(os.listdir(game)):
        a = os.path.join(game, d, 'Addons')   # Windows paths ignore case, so this also finds 'addons'
        if d.lower() != 'addons' and os.path.isdir(a):
            out.append((a, d))
    return out


def game_worlds(game):
    """{id: {'pbo', 'ce', 'dlc'}} for every worlds_<id>_data.pbo in the game"""
    found = {}
    for folder, dlc in addon_folders(game):
        for fn in sorted(os.listdir(folder)):
            m = re.match(r'worlds_(\w+?)_data\.pbo$', fn, re.I)
            if not m:
                continue
            ce = os.path.join(folder, 'worlds_%s_ce.pbo' % m.group(1))
            found.setdefault(m.group(1).lower(), {'pbo': os.path.join(folder, fn), 'ce': ce if os.path.isfile(ce) else '', 'dlc': dlc})
    return found


def mod_name(folder):
    """a mod's name from its meta.cpp / mod.cpp, else its folder name"""
    for fn in ('meta.cpp', 'mod.cpp'):
        try:
            with open(os.path.join(folder, fn), encoding='utf-8', errors='replace') as f:
                m = re.search(r'^\s*name\s*=\s*"([^"]+)"', f.read(4000), re.M)
            if m:
                return m.group(1)
        except OSError:
            pass
    return os.path.basename(folder).lstrip('@')


def mod_folders(game):
    """[(mod folder, its Addons folder)]: the Steam Workshop items in DayZ's Steam library, then the @mods in DayZ's folder"""
    out = []
    if not game or not os.path.isdir(game):
        return out
    ws = os.path.normpath(os.path.join(game, '..', '..', 'workshop', 'content', '221100'))
    for base, only_at in ((ws, False), (game, True)):
        if not os.path.isdir(base):
            continue
        for d in sorted(os.listdir(base)):
            a = os.path.join(base, d, 'Addons')
            if (not only_at or d.startswith('@')) and os.path.isdir(a):
                out.append((os.path.join(base, d), a))
    return out


# ---- rapified config.bin, just enough for CfgPatches: which addons a pbo brings and which it needs
def _cint(b, p):
    v = s = 0
    while True:
        c = b[p]
        p += 1
        v |= (c & 0x7f) << s
        s += 7
        if not c & 0x80:
            return v, p


def _cstr(b, p):
    e = b.index(b'\0', p)
    return b[p:e].decode('latin1'), e + 1


def _rap_array(b, p):
    n, p = _cint(b, p)
    out = []
    for _ in range(n):
        t = b[p]
        p += 1
        if t in (0, 4):
            v, p = _cstr(b, p)
        elif t in (1, 2):
            v, p = struct.unpack_from('<i' if t == 2 else '<f', b, p)[0], p + 4
        elif t == 3:
            v, p = _rap_array(b, p)
        else:
            raise ValueError('array element type %d' % t)
        out.append(v)
    return out, p


def _rap_class(b, p):
    """{name: (kind, class body offset / value / list)} of the class body at p"""
    _, p = _cstr(b, p)   # the parent class
    n, p = _cint(b, p)
    out = {}
    for _ in range(n):
        t = b[p]
        p += 1
        if t == 0:
            name, p = _cstr(b, p)
            out[name.lower()] = ('class', struct.unpack_from('<I', b, p)[0], name)
            p += 4
        elif t == 1:
            sub = b[p]
            name, p = _cstr(b, p + 1)
            if sub in (0, 4):
                v, p = _cstr(b, p)
            else:
                v, p = None, p + (8 if sub == 6 else 4)
            out[name.lower()] = ('value', v, name)
        elif t in (2, 5):
            name, p = _cstr(b, p + (4 if t == 5 else 0))
            v, p = _rap_array(b, p)
            out[name.lower()] = ('array', v, name)
        elif t in (3, 4):
            name, p = _cstr(b, p)
            out[name.lower()] = ('extern', None, name)
        else:
            raise ValueError('entry type %d' % t)
    return out


def cfg_patches(cfg):
    """{CfgPatches class: [its requiredAddons]} of a rapified config.bin ({} for anything else)"""
    if cfg[:4] != b'\0raP':
        return {}
    cp = _rap_class(cfg, 16).get('cfgpatches')
    if not cp or cp[0] != 'class':
        return {}
    out = {}
    for kind, off, name in _rap_class(cfg, cp[1]).values():
        if kind == 'class':
            req = _rap_class(cfg, off).get('requiredaddons')
            out[name] = [r for r in req[1] if isinstance(r, str)] if req and req[0] == 'array' else []
    return out


def _pbo_summary(path):
    """{'wrp': [world ids], 'tiles': satellite tile count, 'ce': how much of a map's Central Economy it holds (0-4:
    mapgroupproto, mapgrouppos, areaflags, types - add-ons bring a mapgroupproto of their own),
    'patches': {CfgPatches class: [requiredAddons]}} - read once per pbo version"""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (path, st.st_mtime, st.st_size)
    if key not in _pbos:
        from extract_maps import pbo_entries
        s = {'wrp': [], 'tiles': 0, 'ce': 0, 'patches': {}}
        try:
            for n, off, size in pbo_entries(path):
                low = n.lower().replace('\\', '/')
                if low.split('/')[-1] == 'config.bin':
                    with open(path, 'rb') as f:
                        f.seek(off)
                        try:
                            s['patches'].update(cfg_patches(f.read(size)))
                        except (ValueError, IndexError, struct.error):
                            pass   # a config we can't read: its addons stay unknown
                elif low.endswith('.wrp'):
                    s['wrp'].append(low.split('/')[-1][:-4])
                elif low.endswith('_lco.paa') and re.search(r'(^|/)s_\d+_\d+_lco\.paa$', low):
                    s['tiles'] += 1
                elif low.split('/')[-1] in ('mapgroupproto.xml', 'mapgrouppos.xml', 'areaflags.map', 'types.xml'):
                    s['ce'] += 1
        except Exception:
            pass   # not a pbo we can read: no map in it
        _pbos[key] = s
    return _pbos[key]


def mod_worlds(game):
    """{id: {'pbo', 'ce', 'mod', 'modName'}} for every map mod (a mod with a .wrp world); 'pbo' / 'ce' are '' when
    the mod has no satellite tiles / Central Economy. The first mod with a map wins (Workshop before @folders)."""
    found = {}
    for folder, addons in mod_folders(game):
        pbos = []
        for fn in sorted(os.listdir(addons)):
            if fn.lower().endswith('.pbo'):
                s = _pbo_summary(os.path.join(addons, fn))
                if s:
                    pbos.append((os.path.join(addons, fn), s))
        wrps = [w for p, s in pbos for w in s['wrp']]
        if not wrps:
            continue
        tiles = max(pbos, key=lambda t: t[1]['tiles'])
        ce = max(pbos, key=lambda t: t[1]['ce'])
        for w in wrps:
            found.setdefault(w, {'pbo': tiles[0] if tiles[1]['tiles'] else '', 'ce': ce[0] if ce[1]['ce'] >= 2 else '', 'dlc': '',
                                 'mod': folder, 'modName': mod_name(folder)})
    return found


def mod_addons(folder):
    """(the addons a mod brings, the addons its pbos need) from their CfgPatches"""
    have, need = set(), set()
    addons = os.path.join(folder, 'Addons')
    if os.path.isdir(addons):
        for fn in os.listdir(addons):
            if fn.lower().endswith('.pbo'):
                s = _pbo_summary(os.path.join(addons, fn))
                for k, req in (s['patches'] if s else {}).items():
                    have.add(k.lower())
                    need.update(r.lower() for r in req)
    return have, need


def mod_dependencies(game, folder):
    """(the other installed mods a mod needs, dependencies first; addons it needs that no installed mod brings).
    DayZ's own addons (DZ_...) need no mod. Found through CfgPatches requiredAddons, e.g. Deer Isle -> CF."""
    index = [(f, mod_addons(f)[0]) for f, a in mod_folders(game)]
    order, missing, seen = [], set(), set()

    def visit(f):
        key = os.path.normcase(os.path.abspath(f))
        if key in seen:
            return
        seen.add(key)
        have, need = mod_addons(f)
        for addon in sorted(need - have):
            if addon.startswith('dz_'):
                continue
            dep = next((g for g, prov in index if addon in prov), None)
            if dep:
                visit(dep)
            else:
                missing.add(addon)
        order.append(f)

    visit(folder)
    return order[:-1], sorted(missing)


def mod_key(folder):
    """how a project names a mod: its Workshop id (the folder name in workshop\\content\\221100), or '@name' for a
    mod in DayZ's folder - the same on every PC subscribed to it"""
    return os.path.basename(os.path.normpath(folder))


def installed_mods(game):
    """every mod Studio can load: [{'id', 'name', 'path', 'workshop', 'maps': [world ids], 'needs': [ids of the
    mods it requires], 'missing': [required addons no installed mod brings]}], Workshop items first"""
    out = []
    worlds = mod_worlds(game)
    for folder, addons in mod_folders(game):
        deps, missing = mod_dependencies(game, folder)
        key = mod_key(folder)
        out.append({'id': key, 'name': mod_name(folder), 'path': folder, 'workshop': not key.startswith('@'),
                    'maps': sorted(w for w, g in worlds.items() if os.path.normcase(g['mod']) == os.path.normcase(folder)),
                    'needs': [mod_key(d) for d in deps], 'missing': missing})
    return out


def find_mod(game, key):
    """the folder of an installed mod by its id ('1559212036' / '@MyMod'), or None"""
    key = str(key or '')
    return next((f for f, a in mod_folders(game) if mod_key(f).lower() == key.lower()), None)


def all_worlds(game):
    """the game's own maps and the map mods ({id: {'pbo', 'ce', 'dlc'[, 'mod', 'modName']}}); the game's win"""
    out = mod_worlds(game)
    out.update(game_worlds(game))
    return out


def server_missions(server):
    """{id: mission folder name} for the stock dayzOffline.<id> missions of DayZ Server"""
    out = {}
    root = os.path.join(server, 'mpmissions') if server else ''
    if root and os.path.isdir(root):
        for d in sorted(os.listdir(root)):
            m = re.match(r'dayzOffline\.(\w+)$', d, re.I)
            if m and os.path.isfile(os.path.join(root, d, 'init.c')):
                out.setdefault(m.group(1).lower(), d)
    return out


MISSION_STAMP = '.dzstudio_mission'   # in a server mission Studio built from a mod map's files: where they came from


def mission_source_sig(ce):
    """which version of a mod map's Central Economy pbo a mission was built from"""
    try:
        return '%s|%d|%d' % (os.path.normcase(ce), os.path.getsize(ce), int(os.path.getmtime(ce)))
    except OSError:
        return ''


def mission_stamp(server, mission):
    """the stamp of a server mission Studio installed, '' for one it did not"""
    try:
        with open(os.path.join(server, 'mpmissions', mission, MISSION_STAMP), encoding='utf-8') as f:
            return f.readline().strip()
    except (OSError, TypeError):
        return ''


def _cached(path, read):
    try:
        key = (path, os.path.getmtime(path))
    except OSError:
        return None
    if key not in _sizes:
        try:
            _sizes[key] = read(path)
        except Exception:
            _sizes[key] = None
    return _sizes[key]


def _size_from_header(head):
    nx, nz, mw, mh = struct.unpack_from('<4I', head, 0)
    return mw if mw == mh and 1024 <= mw <= 81920 else None


def size_from_areaflags(path):
    def read(p):
        with open(p, 'rb') as f:
            return _size_from_header(f.read(16))
    return _cached(path, read)


def size_from_ce(ce):
    def read(p):
        from extract_maps import pbo_entries
        for n, off, size in pbo_entries(p):
            if n.lower().replace('\\', '/').split('/')[-1] == 'areaflags.map' and size >= 16:
                with open(p, 'rb') as f:
                    f.seek(off)
                    return _size_from_header(f.read(16))
        return None
    return _cached(ce, read)


def size_from_extracted(maps, w):
    def read(p):
        with open(p, encoding='ascii', errors='replace') as f:
            m = re.search(r'"size":(\d+)', f.read(400))
        return int(m.group(1)) if m else None
    return _cached(os.path.join(maps, w, 'areaflags.js'), read)


def discover(game, server, maps, data):
    """every map the game, DayZ Server or Studio's own extracted data knows about, the known ones first"""
    gw = all_worlds(game)
    sm = server_missions(server)
    ids = set(gw) | set(sm)
    if maps and os.path.isdir(maps):
        ids |= {d for d in os.listdir(maps) if os.path.isfile(os.path.join(maps, d, 'overview.jpg'))}
    order = [w for w in KNOWN if w in ids] + sorted(ids - set(KNOWN))
    out = []
    for w in order:
        g = gw.get(w, {})
        size = None
        if w in sm:
            size = size_from_areaflags(os.path.join(server, 'mpmissions', sm[w], 'areaflags.map'))
        if not size and g.get('ce'):
            size = size_from_ce(g['ce'])
        if not size and maps:
            size = size_from_extracted(maps, w)
        out.append({
            'id': w, 'name': world_name(w), 'size': size, 'cls': world_class(w),
            'game': bool(g), 'dlc': g.get('dlc', ''), 'mod': g.get('modName', ''),
            'mission': sm.get(w, ''),
            # a mod map brings its own mission files (in its Central Economy pbo): Studio can install them on DayZ Server
            'missionFromMod': bool(g.get('mod') and g.get('ce')),
            'missionOutdated': bool(g.get('mod') and g.get('ce') and w in sm and mission_stamp(server, sm[w])
                                    and mission_stamp(server, sm[w]) != mission_source_sig(g['ce'])),
            'imagery': bool(maps) and os.path.isfile(os.path.join(maps, w, 'overview.jpg')),
            'loot': bool(maps) and os.path.isfile(os.path.join(maps, w, 'loot.js')),
            'terrain': bool(data) and os.path.isfile(os.path.join(data, w, 'heights.bin')),
        })
    return out


def server_mission(server, w):
    """the dayzOffline.<id> mission folder name for a map, or '' when DayZ Server has none"""
    return server_missions(server).get(w, '')


if __name__ == '__main__':
    from paths import MAPS, DATA
    import studio_server as S
    env = S.find_env()
    print(json.dumps(discover(env['game'], S.find_server(), MAPS, DATA), indent=1))
