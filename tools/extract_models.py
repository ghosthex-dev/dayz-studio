#!/usr/bin/env python3
"""
DayZ Studio - model extractor.

Reads the binarized .p3d models of every class listed in data/<world>/bounds.csv (captured from the game)
straight out of your DayZ install and writes a compact mesh pack for the 3D view:

    data/<world>/models.json     class -> model index, bounding boxes, colours, LOD table, texture groups
    data/<world>/models.bin      quantised vertices + triangle indices + UVs
    data/<world>/textures.json   per texture: [offset, length, hasAlpha, avgColour]
    data/<world>/textures.bin    downscaled diffuse textures (JPEG / PNG), read straight from the game PBOs

    python tools/extract_models.py [world] [--tex 128] [--no-tex]        (default world: chernarusplus)
    python tools/extract_models.py [world] --add Class1,Class2            add models of single classes to the existing pack

Wall/roof colours are still guessed from the texture names and used for faces without a texture.
"""
import io
import json
import os
import re
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import odol_reader  # noqa: E402
import paa  # noqa: E402

APP = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
GAME_CANDIDATES = [
    r'C:\Program Files (x86)\Steam\steamapps\common\DayZ',
    r'C:\Program Files\Steam\steamapps\common\DayZ',
    r'D:\SteamLibrary\steamapps\common\DayZ',
    r'E:\SteamLibrary\steamapps\common\DayZ',
]


# ---------------------------------------------------------------- PBO index
def read_pbo(path):
    """-> (prefix, [(name, data_offset, size)])"""
    with open(path, 'rb') as f:
        data = f.read(8 * 1024 * 1024)  # headers are small
    pos = 0
    prefix = ''
    entries = []

    def cstr():
        nonlocal pos
        e = data.index(b'\0', pos)
        s = data[pos:e].decode('latin1')
        pos = e + 1
        return s

    while True:
        name = cstr()
        mime, orig, res, ts, size = struct.unpack_from('<5I', data, pos)
        pos += 20
        if name == '' and mime == 0x56657273:
            while True:
                k = cstr()
                if k == '':
                    break
                v = cstr()
                if k.lower() == 'prefix':
                    prefix = v
            continue
        if name == '':
            break
        entries.append((name, size))
    off = pos
    out = []
    for name, size in entries:
        out.append((name, off, size))
        off += size
    return prefix, out


def index_files(game, exts=('.p3d', '.paa')):
    """lower-case virtual path -> (pbo, offset, size) for every file with one of the extensions"""
    idx = {}
    roots = [os.path.join(game, 'Addons')]
    for d in os.listdir(game):
        a = os.path.join(game, d, 'Addons')
        if os.path.isdir(a):
            roots.append(a)
    paths = [os.path.join(r, fn) for r in roots for fn in os.listdir(r) if fn.lower().endswith('.pbo')]
    # mod PBOs registered in Studio (PBO tools > Use in Studio): data/mods/pbos.json
    reg = os.path.join(APP, 'data', 'mods', 'pbos.json')
    if os.path.isfile(reg):
        try:
            paths += [p for p in json.load(open(reg)) if os.path.isfile(p)]
        except ValueError:
            pass
    for p in paths:
        try:
            prefix, ents = read_pbo(p)
        except Exception:
            continue
        pre = prefix.replace('/', '\\').strip('\\').lower()
        for name, off, size in ents:
            if name.lower().endswith(exts):
                full = (pre + '\\' + name.replace('/', '\\')).lower().strip('\\')
                idx[full] = (p, off, size)
    return idx


def index_models(game):
    return {k: v for k, v in index_files(game, ('.p3d',)).items()}


def read_entry(ent):
    with open(ent[0], 'rb') as f:
        f.seek(ent[1])
        return f.read(ent[2])


# ---------------------------------------------------------------- colours
KEYS = [
    (('glass', 'window'), '#8fb4cf'),
    (('roof_', 'roof\\', '_roof', 'tile', 'ethernit', 'shingle', 'tar'), '#8a5a48'),
    (('tin', 'metal', 'corrug', 'sheet', 'steel', 'iron', 'rust'), '#8d9298'),
    (('brick',), '#a9634f'),
    (('wood', 'plank', 'board', 'timber', 'log', 'fence'), '#8f7048'),
    (('concrete', 'cement', 'plaster', 'stucco', 'wall', 'panel', 'block'), '#b3b0a6'),
    (('paint', 'color', 'yellow', 'green'), '#a6aa8f'),
]


def pick_color(names, skip=()):
    for n in names:
        low = n.lower()
        if any(s in low for s in skip):
            continue
        for keys, col in KEYS:
            if any(k in low for k in keys):
                return col
    return None


def lod_colors(tex):
    roof = pick_color([t for t in tex if 'roof' in t.lower()] or [], ())
    wall = pick_color([t for t in tex if 'roof' not in t.lower() and 'glass' not in t.lower() and 'window' not in t.lower()
                       and 'floor' not in t.lower() and 'ceil' not in t.lower()], ())
    return (wall or '#a8a49a'), (roof or '#7d5a4c')


# ---------------------------------------------------------------- texture selection
AUX = ('_nohq', '_smdi', '_as.', '_mc.', '_ads.', '_mask', '_normal', '_dtsmdi', '_sm.', '_no.', '_ca2', 'env_', '_lco',
       '_detail', '_nopx', '_am.', '_mca', '_sdm')
DIFFUSE = ('_co.paa', '_ca.paa', '_dt.paa', '_d.paa', '_diff.paa', '_c.paa', '_col.paa')


def is_aux(s):
    return any(k in s for k in AUX)


def diffuse_of(strs):
    """best diffuse texture / colour among a material's stage strings -> ('t', path) | ('c', '#rrggbb') | None"""
    paas = [s for s in strs if s.endswith('.paa') and not is_aux(s)]
    for s in paas:
        if s.endswith(DIFFUSE):
            return ('t', s)
    if paas:
        return ('t', paas[0])
    for s in strs:
        if s.startswith('#('):
            c = odol_reader.color_of(s)
            if c:
                return ('c', c)
    return None


def face_groups(nfaces, tex, mats, sections):
    """-> (keys list, per-face index into keys; -1 = no information)"""
    keys = []
    kidx = {}
    per = np.full(nfaces, -1, dtype=np.int32)
    for lo, hi, ti, mi in sections:
        res = None
        if 0 <= ti < len(tex):
            t = tex[ti]
            if t.endswith('.paa') and not is_aux(t):
                res = ('t', t)
            elif t.startswith('#('):
                c = odol_reader.color_of(t)
                if c:
                    res = ('c', c)
        if res is None and 0 <= mi < len(mats):
            res = diffuse_of(mats[mi][1])
        if res is None:
            continue
        if res not in kidx:
            kidx[res] = len(keys)
            keys.append(res)
        per[lo:hi] = kidx[res]
    return keys, per


# ---------------------------------------------------------------- mesh build
def build_mesh(lod, uv=None, face_grp=None, step=0.002):
    """-> (positions, triangles uint16, uv or None, group ranges [(key, start, count)]) or None"""
    v = lod['verts']
    tris = []
    grp = []
    for fi, f in enumerate(lod['faces']):
        if max(f) >= len(v):
            continue
        g = int(face_grp[fi]) if face_grp is not None else -1
        tris.append((f[0], f[1], f[2]))
        grp.append(g)
        if len(f) == 4:
            tris.append((f[0], f[2], f[3]))
            grp.append(g)
    if not tris:
        return None
    t = np.array(tris, dtype=np.int64)
    g = np.array(grp, dtype=np.int64)
    order = np.argsort(g, kind='stable')
    t, g = t[order], g[order]
    used = np.unique(t)
    remap = -np.ones(len(v), dtype=np.int64)
    remap[used] = np.arange(len(used))
    pos = v[used]
    cols = [np.round(pos / step)]
    if uv is not None:
        uvu = uv[used]
        cols.append(np.round(uvu * 1024))
    key = np.concatenate(cols, axis=1).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = np.asarray(inv).reshape(-1)
    pos2 = pos[first]
    uv2 = uvu[first] if uv is not None else None
    t2 = inv[remap[t]]
    keep = (t2[:, 0] != t2[:, 1]) & (t2[:, 1] != t2[:, 2]) & (t2[:, 0] != t2[:, 2])
    t2, g = t2[keep], g[keep]
    if len(pos2) >= 65535 or len(t2) == 0:
        return None
    ranges = []
    s = 0
    for k in range(1, len(g) + 1):
        if k == len(g) or g[k] != g[s]:
            ranges.append((int(g[s]), s, k - s))
            s = k
    return pos2.astype(np.float32), t2.astype(np.uint16), (uv2.astype(np.float32) if uv2 is not None else None), ranges


def tiny_lod(parsed, max_faces=160):
    """the most detailed LOD that is still very cheap (distant scenery); falls back to the lightest one"""
    vis = []
    for l in parsed:
        if l['verts'] is None or len(l['verts']) < 4 or not l['tex']:
            continue
        if all('roadway' in t or 'env_land' in t or 'surfaces\\data' in t for t in l['tex']):
            continue
        vis.append(l)
    if not vis:
        return None
    vis.sort(key=lambda l: len(l['faces']))
    small = [l for l in vis if len(l['faces']) <= max_faces]
    return small[-1] if small else vis[0]


def choose_lods(parsed):
    vis = []
    for l in parsed:
        if l['verts'] is None or len(l['verts']) < 4:
            continue
        tex = l['tex']
        if not tex:
            continue  # geometry / fire / view / shadow lods carry no textures
        if all('roadway' in t or 'env_land' in t or 'surfaces\\data' in t for t in tex):
            continue
        vis.append(l)
    if not vis:
        # some small props carry no texture names in front of their faces: fall back to the first LOD in the file
        any_v = [l for l in parsed if l['verts'] is not None and len(l['verts']) >= 4]
        if not any_v:
            return None, None
        vis = [any_v[0]]
    vis.sort(key=lambda l: len(l['faces']))
    under = [l for l in vis if len(l['faces']) <= 9000]  # keep the pack and the GPU reasonable
    hi = under[-1] if under else vis[0]
    lo = None
    for l in vis:
        if len(l['faces']) <= 700:
            lo = l
    if lo is None:
        lo = vis[0]
    return hi, lo


def lod_surface(data, parsed, l):
    """UVs + texture groups of one parsed LOD -> (uv | None, keys, per-face group index | None)"""
    i = parsed.index(l)
    prev = 0
    if i > 0:
        _, prev = odol_reader.read_faces(data, parsed[i - 1]['offset'])
    faces, end = odol_reader.read_faces(data, l['offset'])
    sec = odol_reader.read_sections(data, end, faces)
    if not sec:
        return None, [], None
    tex, mats = odol_reader.read_tables(data, prev, l['offset'])
    uv = odol_reader.read_uv(data, sec[1], len(l['verts']))
    keys, per = face_groups(len(faces), tex, mats, sec[0])
    return uv, keys, per


# ---------------------------------------------------------------- textures
def pack_textures(want, paa_idx, size, table, meta, blob):
    """decode + append the textures in `want` that are not packed yet.
    table: path -> index (updated), meta: [[offset, length, hasAlpha, avgColour, path], ...] (appended), blob: bytearray (appended)"""
    from PIL import Image
    ok = bad = 0
    for path in sorted(want):
        if path in table:
            continue
        ent = paa_idx.get(path)
        if not ent:
            bad += 1
            continue
        try:
            im = paa.decode(read_entry(ent), size)
        except Exception:
            im = None
        if im is None:
            bad += 1
            continue
        a = im.getchannel('A')
        has_a = a.getextrema()[0] < 250
        avg = im.convert('RGB').resize((1, 1), Image.BILINEAR).getpixel((0, 0))
        buf = io.BytesIO()
        if has_a:
            im.save(buf, 'PNG', optimize=True)
        else:
            im.convert('RGB').save(buf, 'JPEG', quality=82)
        data = buf.getvalue()
        table[path] = len(meta)
        meta.append([len(blob), len(data), 1 if has_a else 0, '#%02x%02x%02x' % avg, path])
        blob += data
        ok += 1
    print('textures: %d new, %d unavailable, %.1f MB total' % (ok, bad, len(blob) / 1e6))


def extract_model(data, want_tex, only_lo=False):
    """-> (entry dict, blob bytes, wanted texture paths) or None"""
    parsed = odol_reader.parse(data)
    hi, lo = choose_lods(parsed)
    if hi is None:
        return None
    picks = [hi] if lo is hi or lo is None else [lo, hi]
    if only_lo:
        tl = tiny_lod(parsed)
        picks = [tl if tl is not None else (lo if lo is not None else hi)]
    meshes = []
    for l in picks:
        try:
            uv, keys, per = lod_surface(data, parsed, l) if want_tex else (None, [], None)
        except Exception:
            uv, keys, per = None, [], None
        m = build_mesh(l, uv, per)
        if m is None and uv is not None:
            m = build_mesh(l, None, None)
            keys = []
        if m and len(m[1]) > 0:
            meshes.append((l, m, keys))
    if not meshes:
        return None
    allv = np.concatenate([m[0] for _, m, _ in meshes])
    mn, mx = allv.min(0), allv.max(0)
    span = np.maximum(mx - mn, 1e-3)
    lods = []
    blob = bytearray()
    wanted = set()
    for l, (pos, tri, uv, ranges), keys in meshes:
        q = np.round((pos - mn) / span * 65535).astype(np.uint16)
        ent_l = {'o': len(blob), 'nv': int(len(pos)), 'nt': int(len(tri))}
        blob += q.tobytes()
        blob += tri.tobytes()
        if uv is not None:
            umn, umx = uv.min(0), uv.max(0)
            us = np.maximum(umx - umn, 1e-6)
            blob += np.round((uv - umn) / us * 65535).astype(np.uint16).tobytes()
            ent_l['uv'] = [round(float(umn[0]), 5), round(float(umn[1]), 5), round(float(umx[0]), 5), round(float(umx[1]), 5)]
            grp = []
            for k, s, n in ranges:
                key = keys[k] if 0 <= k < len(keys) else None
                if key and key[0] == 't':
                    wanted.add(key[1])
                grp.append([key, s, n])
            ent_l['g'] = grp
        lods.append(ent_l)
    wall, roof = lod_colors(hi['tex'])
    entry = {'min': [round(float(x), 4) for x in mn], 'max': [round(float(x), 4) for x in mx], 'lods': lods, 'wall': wall, 'roof': roof}
    return entry, bytes(blob), wanted


def read_class_models(path, only=None):
    """classes_all.csv / bounds.csv -> {class: lower-case model path}"""
    out = {}
    for ln in open(path, encoding='utf-8', errors='replace'):
        p = ln.rstrip('\n').split(',')
        if len(p) < 4:
            continue
        name, model = p[0], ','.join(p[3:]) if path.endswith(('classes_all.csv', 'classes_mods.csv')) else p[7] if len(p) >= 8 else ''
        if only is not None and name not in only:
            continue
        if not model or model.lower().endswith('.bmp'):
            continue
        mp = model.replace('/', '\\').strip('\\').lower()
        if not mp.endswith('.p3d'):
            mp += '.p3d'  # config model paths may omit the extension
        out[name] = mp
    return out


def main():
    argv = sys.argv[1:]
    tex_size = 128
    add = None
    pos_args = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--tex':
            tex_size = int(argv[i + 1]); i += 2; continue
        if a == '--add':
            add = [c for c in argv[i + 1].split(',') if c]; i += 2; continue
        if not a.startswith('--'):
            pos_args.append(a)
        i += 1
    world = pos_args[0] if pos_args else 'chernarusplus'
    want_tex = '--no-tex' not in argv
    game = next((g for g in GAME_CANDIDATES if os.path.isdir(os.path.join(g, 'Addons'))), None)
    if not game:
        print('DayZ install not found')
        return 1
    out_dir = os.path.join(APP, 'data', world)
    bounds = os.path.join(out_dir, 'bounds.csv')
    allc = os.path.join(out_dir, 'classes_all.csv')
    if add is not None:
        src = allc if os.path.isfile(allc) else bounds
        if not os.path.isfile(src):
            print('no class list for', world)
            return 1
        cls_model = read_class_models(src, set(add))
        mods_csv = os.path.join(APP, 'data', 'mods', 'classes_mods.csv')
        if os.path.isfile(mods_csv):
            for k, v in read_class_models(mods_csv, set(add) - set(cls_model)).items():
                cls_model[k] = v
    else:
        if not os.path.isfile(bounds):
            print('Run the terrain capture first (data/%s/bounds.csv missing)' % world)
            return 1
        cls_model = read_class_models(bounds)
    print('classes with a model path:', len(cls_model))
    print('indexing game PBOs ...', flush=True)
    fidx = index_files(game, ('.p3d', '.paa'))
    idx = {k: v for k, v in fidx.items() if k.endswith('.p3d')}
    print('models indexed:', len(idx), ' textures indexed:', len(fidx) - len(idx))

    models, blobs, classes, by_path = [], bytearray(), {}, {}
    tmeta, tblob, ttable = [], bytearray(), {}
    if add is not None and os.path.isfile(os.path.join(out_dir, 'models.json')):
        j = json.load(open(os.path.join(out_dir, 'models.json')))
        models, classes = j['models'], j['classes']
        blobs = bytearray(open(os.path.join(out_dir, 'models.bin'), 'rb').read())
        by_path = {m['path']: k for k, m in enumerate(models)}
        tj = os.path.join(out_dir, 'textures.json')
        if os.path.isfile(tj):
            tmeta = json.load(open(tj))
            tblob = bytearray(open(os.path.join(out_dir, 'textures.bin'), 'rb').read())
            ttable = {m[4]: k for k, m in enumerate(tmeta) if len(m) > 4}
    first_new = len(models)
    missing = failed = 0
    wanted = set()
    for cls, path in sorted(cls_model.items()):
        if cls in classes:
            continue
        if path in by_path:
            classes[cls] = by_path[path]
            continue
        ent = idx.get(path)
        if not ent:
            missing += 1
            continue
        data = read_entry(ent)
        if data[:4] != b'ODOL':
            failed += 1
            continue
        try:
            r = extract_model(data, want_tex)
        except Exception as e:  # keep going on odd models
            print('  ! %s: %s' % (cls, e))
            failed += 1
            continue
        if r is None:
            failed += 1
            continue
        entry, blob, wt = r
        for l in entry['lods']:
            l['o'] += len(blobs)
        blobs += blob
        wanted |= wt
        entry['path'] = path
        models.append(entry)
        by_path[path] = len(models) - 1
        classes[cls] = len(models) - 1

    if want_tex:
        print('decoding %d textures ...' % len(wanted), flush=True)
        pack_textures(wanted, fidx, tex_size, ttable, tmeta, tblob)
        # replace path keys by texture indices (or nothing when the texture could not be read)
        for m in models[first_new:]:
            for l in m['lods']:
                for g in l.get('g', []):
                    key = g[0]
                    if key and key[0] == 't':
                        ti = ttable.get(key[1])
                        g[0] = [ti] if ti is not None else None
                    elif key and key[0] == 'c':
                        g[0] = key[1]
        with open(os.path.join(out_dir, 'textures.bin'), 'wb') as f:
            f.write(tblob)
        with open(os.path.join(out_dir, 'textures.json'), 'w') as f:
            json.dump(tmeta, f, separators=(',', ':'))
    with open(os.path.join(out_dir, 'models.bin'), 'wb') as f:
        f.write(blobs)
    with open(os.path.join(out_dir, 'models.json'), 'w') as f:
        json.dump({'classes': classes, 'models': models, 'textured': bool(want_tex and tmeta)}, f, separators=(',', ':'))
    print('models:', len(models), ' classes:', len(classes), ' missing p3d:', missing, ' no geometry:', failed,
          ' pack: %.1f MB' % (len(blobs) / 1e6))
    return 0


if __name__ == '__main__':
    sys.exit(main())
