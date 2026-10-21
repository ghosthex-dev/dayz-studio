"""DayZ Studio - which DayZ maps are on this PC.

Every official map ships as  worlds_<id>_data.pbo  (satellite tiles) and  worlds_<id>_ce.pbo  (Central Economy):
the base game's in  DayZ\\Addons,  a DLC map's in its own folder ( DayZ\\sakhal\\Addons,  DayZ\\nasdara\\addons ).
DayZ Server brings a  mpmissions\\dayzOffline.<id>  mission for each. Looking for those files - instead of keeping
a fixed list - lets Studio offer a new DLC map as soon as Steam has installed it.

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
}

_sizes = {}   # (path, mtime) -> size, so the big CE pbos are only opened once


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
    gw = game_worlds(game)
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
            'game': bool(g), 'dlc': g.get('dlc', ''),
            'mission': sm.get(w, ''),
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
