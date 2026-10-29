#!/usr/bin/env python3
"""
DayZ Studio - terrain extractor.

Reads the satellite tiles that ship inside your own DayZ install and writes them into
../maps/<world>/ so the editor can show the real map.

    python extract_maps.py                      # auto-detect the Steam install
    python extract_maps.py "D:/Games/DayZ"      # explicit DayZ folder
    python extract_maps.py --world nasdara      # just one map (DLC maps are found in their own DayZ/<dlc> folder)
    python extract_maps.py --pbo path/to/worlds_xyz_data.pbo --name xyz   # a mod / DLC map
    python extract_maps.py --pbo .../data.pbo --ce .../ce.pbo --name deerisle   # a mod map's tiles + its loot and zones

Needs:  pip install pillow
Output per world:  maps/<world>/overview.jpg  (4096px)  and  maps/<world>/t/XXX_YYY.jpg (512px tiles)
The images are derived from game files you own - for your personal use, do not redistribute them.
"""
import io, os, re, struct, sys
from multiprocessing import Pool
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from paths import MAPS as OUT  # noqa: E402  (maps/ next to the program, or the user's folder once installed)


# ---- PBO directory ---------------------------------------------------------
def pbo_entries(path):
    f = open(path, 'rb')

    def cstr():
        b = bytearray()
        while True:
            c = f.read(1)
            if c == b'\0' or not c:
                return b.decode('latin1')
            b += c

    out = []
    while True:
        name = cstr()
        meta = struct.unpack('<5I', f.read(20))
        if name == '' and meta[0] == 0x56657273:  # 'Vers' header
            while cstr() != '':
                cstr()
            continue
        if name == '':
            break
        out.append((name, meta[4]))
    data_start = f.tell()
    f.close()
    res, off = [], data_start
    for n, size in out:
        res.append((n, off, size))
        off += size
    return res


# ---- LZO1X + PAA -----------------------------------------------------------
def lzo1x_decompress(src, expected):
    out = bytearray()
    ip = 0
    t = src[0]
    state = 'loop'
    if t > 17:
        ip = 1
        t -= 17
        if t < 4:
            state = 'match_next'
        else:
            out += src[ip:ip + t]; ip += t
            state = 'first'
    while True:
        if state == 'loop':
            t = src[ip]; ip += 1
            if t >= 16:
                state = 'match'; continue
            if t == 0:
                while src[ip] == 0:
                    t += 255; ip += 1
                t += 15 + src[ip]; ip += 1
            t += 3
            out += src[ip:ip + t]; ip += t
            state = 'first'
        elif state == 'first':
            t = src[ip]; ip += 1
            if t >= 16:
                state = 'match'; continue
            mpos = len(out) - 0x801 - (t >> 2) - (src[ip] << 2); ip += 1
            for i in range(3):
                out.append(out[mpos + i])
            state = 'done'
        elif state == 'match':
            if t >= 64:
                mpos = len(out) - 1 - ((t >> 2) & 7) - (src[ip] << 3); ip += 1
                L = (t >> 5) - 1 + 2
            elif t >= 32:
                t &= 31
                if t == 0:
                    while src[ip] == 0:
                        t += 255; ip += 1
                    t += 31 + src[ip]; ip += 1
                L = t + 2
                d = (src[ip] >> 2) + (src[ip + 1] << 6); ip += 2
                mpos = len(out) - 1 - d
            elif t >= 16:
                mpos = len(out) - ((t & 8) << 11)
                t &= 7
                if t == 0:
                    while src[ip] == 0:
                        t += 255; ip += 1
                    t += 7 + src[ip]; ip += 1
                d = (src[ip] >> 2) + (src[ip + 1] << 6); ip += 2
                mpos -= d
                if mpos == len(out):
                    break
                mpos -= 0x4000
                L = t + 2
            else:
                mpos = len(out) - 1 - (t >> 2) - (src[ip] << 2); ip += 1
                L = 2
            if mpos < 0:
                raise ValueError('bad LZO offset')
            if mpos + L <= len(out):
                out += out[mpos:mpos + L]
            else:
                for i in range(L):
                    out.append(out[mpos + i])
            state = 'done'
        else:  # 'done' / 'match_next'
            if state == 'done':
                t = src[ip - 2] & 3
            if t == 0:
                state = 'loop'
            else:
                out += src[ip:ip + t]; ip += t
                t = src[ip]; ip += 1
                state = 'match'
        if len(out) >= expected and state == 'loop':
            break
    return bytes(out[:expected])


def read_paa_mip0(data):
    marker = struct.unpack_from('<H', data, 0)[0]
    pos = 2
    while data[pos:pos + 4] == b'GGAT':
        ln = struct.unpack_from('<I', data, pos + 8)[0]
        pos += 12 + ln
    pal = struct.unpack_from('<H', data, pos)[0]
    pos += 2 + pal * 3
    w, h = struct.unpack_from('<HH', data, pos)
    size = data[pos + 4] | (data[pos + 5] << 8) | (data[pos + 6] << 16)
    pos += 7
    comp = bool(w & 0x8000)
    w &= 0x7fff
    raw = data[pos:pos + size]
    fmt = {0xFF01: 'DXT1', 0xFF03: 'DXT3', 0xFF05: 'DXT5'}.get(marker)
    if fmt is None:
        raise ValueError('unsupported PAA format %04x' % marker)
    bpb = 8 if fmt == 'DXT1' else 16
    expected = max(1, w // 4) * max(1, h // 4) * bpb
    if comp:
        raw = lzo1x_decompress(raw, expected)
    return fmt, w, h, raw


def to_image(fmt, w, h, raw):
    hdr = bytearray(128)
    hdr[0:4] = b'DDS '
    struct.pack_into('<7I', hdr, 4, 124, 0x1007, h, w, len(raw), 0, 0)
    struct.pack_into('<II4s', hdr, 76, 32, 4, fmt.encode())
    struct.pack_into('<I', hdr, 108, 0x1000)
    return Image.open(io.BytesIO(bytes(hdr) + raw)).convert('RGB')


def work(a):
    pbo, off, size, name, outdir, tpx = a
    with open(pbo, 'rb') as f:
        f.seek(off)
        data = f.read(size)
    fmt, w, h, raw = read_paa_mip0(data)
    im = to_image(fmt, w, h, raw)
    m = re.search(r'S_(\d+)_(\d+)_', name, re.I)
    xi, yi = int(m.group(1)), int(m.group(2))
    if im.width != tpx:
        im = im.resize((tpx, tpx), Image.LANCZOS)
    im.save(os.path.join(outdir, 't', '%03d_%03d.jpg' % (xi, yi)), quality=82)
    return xi, yi


def extract(pbo, world, overview_px=4096, tile_px=512):
    outdir = os.path.join(OUT, world)
    os.makedirs(os.path.join(outdir, 't'), exist_ok=True)
    jobs = [(pbo, off, size, n, outdir, tile_px) for n, off, size in pbo_entries(pbo)
            if n.lower().startswith('layers') and re.search(r'S_\d+_\d+_lco\.paa$', n, re.I)]
    if not jobs:
        print('  no satellite tiles in', os.path.basename(pbo))
        return False
    print('  %s: %d tiles ...' % (world, len(jobs)), flush=True)
    with Pool() as p:
        res = p.map(work, jobs, chunksize=8)
    nx = max(r[0] for r in res) + 1
    ny = max(r[1] for r in res) + 1
    cell = overview_px // max(nx, ny)
    mosaic = Image.new('RGB', (cell * nx, cell * ny))
    for xi, yi in res:
        t = Image.open(os.path.join(outdir, 't', '%03d_%03d.jpg' % (xi, yi))).resize((cell, cell), Image.LANCZOS)
        mosaic.paste(t, (xi * cell, yi * cell))
    mosaic.save(os.path.join(outdir, 'overview.jpg'), quality=85)
    print('  done ->', outdir, '(grid %dx%d)' % (nx, ny))
    return True


# ---- Central Economy loot data -> maps/<world>/loot.js -----------------------
def read_pbo_file(pbo, entries, wanted):
    wanted = wanted.lower()
    for n, off, size in entries:
        if n.lower().replace('\\', '/').split('/')[-1] == wanted:
            with open(pbo, 'rb') as f:
                f.seek(off)
                return f.read(size)
    return None


def extract_loot(ce_pbo, world):
    """Parse mapgroupproto/mapgrouppos/types/limits from worlds_<w>_ce.pbo into one script file
    that the editor can load even from file:// (window.DS_LOOT[world] = {...})."""
    import json
    import xml.etree.ElementTree as ET
    ents = pbo_entries(ce_pbo)
    proto_b = read_pbo_file(ce_pbo, ents, 'mapgroupproto.xml')
    pos_b = read_pbo_file(ce_pbo, ents, 'mapgrouppos.xml')
    if not proto_b or not pos_b:
        print('  %s: no mapgroupproto/mapgrouppos in %s' % (world, os.path.basename(ce_pbo)))
        return False
    proto = ET.fromstring(proto_b)
    pos = ET.fromstring(pos_b)

    raw = proto_b.decode('utf-8', 'replace')
    m = re.search(r'<defaults>.*?</defaults>', raw, re.S)
    header = m.group(0) if m else ''

    def num(v):
        return None if v is None else float(v)

    protos = []
    for g in proto.iter('group'):
        p = {'n': g.get('name'), 'lm': int(g.get('lootmax')) if g.get('lootmax') else None, 'u': [], 'v': [], 'c': [], 'x': []}
        for ch in g:
            if ch.tag == 'usage':
                p['u'].append(ch.get('name'))
            elif ch.tag == 'value':
                p['v'].append(ch.get('name'))
            elif ch.tag == 'container':
                c = {'n': ch.get('name'), 'lm': int(ch.get('lootmax')) if ch.get('lootmax') else None, 'cat': [], 'tag': [], 'p': []}
                for k in ch:
                    if k.tag == 'category':
                        c['cat'].append(k.get('name'))
                    elif k.tag == 'tag':
                        c['tag'].append(k.get('name'))
                    elif k.tag == 'point':
                        x, y, z = [float(t) for t in k.get('pos').split()]
                        c['p'].append([x, y, z, num(k.get('range')), num(k.get('height')), int(k.get('flags')) if k.get('flags') else None])
                p['c'].append(c)
            else:
                p['x'].append(re.sub(r'\s*\n\s*', ' ', ET.tostring(ch, encoding='unicode').strip()))
        protos.append(p)

    names, index, inst = [], {}, []
    for g in pos.iter('group'):
        n = g.get('name')
        if n not in index:
            index[n] = len(names)
            names.append(n)
        x, y, z = [float(t) for t in g.get('pos').split()]
        r, pt, yw = [float(t) for t in g.get('rpy').split()]
        inst.append([index[n], round(x, 4), round(y, 4), round(z, 4), round(r, 4), round(pt, 4), round(yw, 4), round(float(g.get('a', 0)), 4)])

    types = []
    tb = read_pbo_file(ce_pbo, ents, 'types.xml')
    if tb:
        for t in ET.fromstring(tb).iter('type'):
            nom = t.find('nominal')
            cat = t.find('category')
            types.append([t.get('name'), int(nom.text) if nom is not None and nom.text else 0, cat.get('name') if cat is not None else '',
                          [u.get('name') for u in t.findall('usage')], [v.get('name') for v in t.findall('value')]])
    limits = {'categories': [], 'tags': [], 'usages': [], 'values': []}
    lb = read_pbo_file(ce_pbo, ents, 'cfglimitsdefinition.xml')
    if lb:
        L = ET.fromstring(lb)
        limits['categories'] = [e.get('name') for e in L.iter('category')]
        limits['tags'] = [e.get('name') for e in L.iter('tag')]
        limits['usages'] = [e.get('name') for e in L.iter('usage')]
        limits['values'] = [e.get('name') for e in L.iter('value')]

    data = {'world': world, 'header': header, 'protos': protos, 'names': names, 'inst': inst, 'types': types, 'limits': limits}
    outdir = os.path.join(OUT, world)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, 'loot.js'), 'w', encoding='utf-8') as f:
        f.write('window.DS_LOOT = window.DS_LOOT || {};\nwindow.DS_LOOT[%s] = ' % json.dumps(world))
        json.dump(data, f, separators=(',', ':'))
        f.write(';\n')
    print('  %s loot: %d groups, %d instances, %d points, %d item types' % (
        world, len(protos), len(inst), sum(len(c['p']) for p in protos for c in p['c']), len(types)))
    return True


def extract_areaflags(ce_pbo, world):
    """areaflags.map = 24-byte header [cells_x, cells_z, map_w, map_h, usage bits, 0], then the usage-flag grid
    (32 bits per cell on the official maps, 16 on some mod maps such as Deer Isle), then a value (tier) grid of
    16, 8 or 4 bits per cell. Row 0 is the SOUTH edge. Stored gzip+base64 in maps/<world>/areaflags.js so the
    editor can load it without a server."""
    import base64, gzip, json
    ents = pbo_entries(ce_pbo)
    raw = read_pbo_file(ce_pbo, ents, 'areaflags.map')
    if not raw:
        print('  %s: no areaflags.map' % world)
        return False
    nx, nz, mw, mh, ubits, _ = struct.unpack_from('<6I', raw, 0)
    ubits = ubits if ubits in (16, 32) else 32
    body = raw[24:]
    cells = nx * nz
    rest = len(body) - cells * ubits // 8
    vbits = 16 if rest == cells * 2 else 8 if rest == cells else 4 if rest * 2 == cells else None
    if nx != nz or vbits is None:
        print('  %s: unexpected areaflags layout (%d x %d, %d-bit usage, %d bytes) - skipped' % (world, nx, nz, ubits, len(raw)))
        return False
    gz = gzip.compress(body, 6)
    outdir = os.path.join(OUT, world)
    os.makedirs(outdir, exist_ok=True)
    meta = {'n': nx, 'size': mw, 'ubits': ubits, 'vbits': vbits, 'gz': base64.b64encode(gz).decode('ascii')}
    with open(os.path.join(outdir, 'areaflags.js'), 'w', encoding='ascii') as f:
        f.write('window.DS_AREAFLAGS = window.DS_AREAFLAGS || {};\nwindow.DS_AREAFLAGS[%s] = ' % json.dumps(world))
        json.dump(meta, f, separators=(',', ':'))
        f.write(';\n')
    print('  %s areaflags: %dx%d cells, %d-bit usage, %d-bit tiers, %d KB' % (world, nx, nz, ubits, vbits, len(gz) // 1024))
    return True


def find_install(arg):
    cands = [arg] if arg else [
        r'C:\Program Files (x86)\Steam\steamapps\common\DayZ',
        r'C:\Program Files\Steam\steamapps\common\DayZ',
        r'D:\SteamLibrary\steamapps\common\DayZ',
        r'E:\SteamLibrary\steamapps\common\DayZ',
    ]
    for c in cands:
        if c and os.path.isdir(os.path.join(c, 'Addons')):
            return c
    return None


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--pbo' in args or '--ce' in args:   # a map's own pbos (a mod map names them as it likes)
        pbo = args[args.index('--pbo') + 1] if '--pbo' in args else ''
        ce = args[args.index('--ce') + 1] if '--ce' in args else ''
        name = args[args.index('--name') + 1] if '--name' in args else re.sub(r'^worlds_|_data\.pbo$', '', os.path.basename(pbo or ce))
        ok = extract(pbo, name) if pbo else False
        if not pbo:
            print('  %s: the map has no satellite tiles to extract' % name)
        if ce:
            extract_loot(ce, name)
            extract_areaflags(ce, name)
        print('Extracted %s. Reload DayZ Studio.' % name if ok else 'No imagery extracted for %s.' % name)
        sys.exit(0 if ok else 1)
    only = None
    if '--world' in args:  # just one map, e.g. a new DLC map:  --world nasdara
        i = args.index('--world')
        only = args[i + 1].lower() if i + 1 < len(args) else None
        del args[i:i + 2]
    positional = [a for a in args if not a.startswith('--')]
    root = find_install(positional[0] if positional else None)
    if not root:
        print('Could not find the DayZ folder. Pass it as an argument, e.g.  python extract_maps.py "D:/Games/DayZ"')
        sys.exit(1)
    print('DayZ install:', root)
    found = 0
    loot_only = '--loot-only' in args
    search = [os.path.join(root, 'Addons')]
    for d in sorted(os.listdir(root)):  # DLC folders such as 'sakhal' and 'nasdara'
        a = os.path.join(root, d, 'Addons')
        if d.lower() != 'addons' and os.path.isdir(a):
            search.append(a)
    for folder in search:
        for fn in sorted(os.listdir(folder)):
            m = re.match(r'worlds_(.+)_data\.pbo$', fn, re.I)
            if m:
                w = m.group(1).lower()
                if only and w != only:
                    continue
                if not loot_only:
                    found += 1 if extract(os.path.join(folder, fn), w) else 0
                ce = os.path.join(folder, 'worlds_%s_ce.pbo' % m.group(1))
                if os.path.exists(ce):
                    extract_loot(ce, w)
                    extract_areaflags(ce, w)
    print('Extracted %d world(s). Reload DayZ Studio.' % found)
