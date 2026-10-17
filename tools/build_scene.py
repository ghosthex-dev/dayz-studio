#!/usr/bin/env python3
"""
DayZ Studio - world scene builder.

Turns the in-game object scan (data/<world>/scan.csv: every map object with model path, position, orientation, scale)
into a compact streaming scene for the 3D tab:

    data/<world>/scene.json          shapes: model bounds, low-detail mesh, texture groups, cell grid info
    data/<world>/scene.bin           the low-detail meshes (positions + triangles + UVs)
    data/<world>/scene_objects.bin   all object instances, sorted by cell (header + cell index + records)
    data/<world>/textures.json/.bin  shared texture pack (new textures are appended)

    python tools/build_scene.py [world] [--tex 64] [--cell 250] [--min-faces 1]

Records (13 bytes): shape u16, x u16 (0.25 m), z u16 (0.25 m), y u16 (0.01 m + 100 m), yaw u16 (360/65536 deg),
pitch i8 (deg), roll i8 (deg), scale u8 (/50).
"""
import json
import os
import struct
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_models as EM  # noqa: E402

APP = EM.APP


def main():
    argv = sys.argv[1:]
    tex_size = 64
    cell = 250
    pos = []
    i = 0
    while i < len(argv):
        if argv[i] == '--tex':
            tex_size = int(argv[i + 1]); i += 2; continue
        if argv[i] == '--cell':
            cell = int(argv[i + 1]); i += 2; continue
        if not argv[i].startswith('--'):
            pos.append(argv[i])
        i += 1
    world = pos[0] if pos else 'chernarusplus'
    d = os.path.join(APP, 'data', world)
    scan = os.path.join(d, 'scan.csv')
    if not os.path.isfile(scan):
        print('no scan.csv - capture the world objects first')
        return 1
    t0 = time.time()
    shapes = {}
    names = []
    rows = []
    with open(scan, encoding='utf-8', errors='replace') as f:
        for ln in f:
            p = ln.rstrip('\n').split(',')
            if len(p) < 8:
                continue
            sp = p[0].replace('/', '\\').strip('\\').lower()
            si = shapes.get(sp)
            if si is None:
                si = shapes[sp] = len(names)
                names.append(sp)
            try:
                rows.append((si, float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5]), float(p[6]), float(p[7])))
            except ValueError:
                continue
    print('objects: %d   distinct shapes: %d   (%.1fs)' % (len(rows), len(names), time.time() - t0), flush=True)
    if not rows:
        return 1
    arr = np.array(rows, dtype=np.float64)

    # ---- models (lowest-detail visible LOD of every shape)
    game = next(g for g in EM.GAME_CANDIDATES if os.path.isdir(os.path.join(g, 'Addons')))
    print('indexing game PBOs ...', flush=True)
    fidx = EM.index_files(game, ('.p3d', '.paa'))
    models = []
    blob = bytearray()
    wanted = set()
    shape_model = {}      # shape index -> model index
    ok = miss = fail = 0
    for si, sp in enumerate(names):
        ent = fidx.get(sp)
        if not ent:
            miss += 1
            continue
        try:
            data = EM.read_entry(ent)
            r = EM.extract_model(data, True, only_lo=True)
        except Exception:
            r = None
        if r is None:
            fail += 1
            continue
        entry, mblob, wt = r
        for l in entry['lods']:
            l['o'] += len(blob)
        blob += mblob
        wanted |= wt
        entry['path'] = sp
        shape_model[si] = len(models)
        models.append(entry)
        ok += 1
        if ok % 200 == 0:
            print('  %d models ...' % ok, flush=True)
    print('models: %d ok, %d missing p3d, %d unreadable' % (ok, miss, fail), flush=True)

    # ---- textures (shared pack, appended)
    tmeta, tblob, ttable = [], bytearray(), {}
    tj = os.path.join(d, 'textures.json')
    if os.path.isfile(tj):
        tmeta = json.load(open(tj))
        tblob = bytearray(open(os.path.join(d, 'textures.bin'), 'rb').read())
        ttable = {m[4]: k for k, m in enumerate(tmeta) if len(m) > 4}
    print('textures wanted: %d' % len(wanted), flush=True)
    EM.pack_textures(wanted, fidx, tex_size, ttable, tmeta, tblob)
    for m in models:
        for l in m['lods']:
            for g in l.get('g', []):
                key = g[0]
                if key and key[0] == 't':
                    ti = ttable.get(key[1])
                    g[0] = [ti] if ti is not None else None
                elif key and key[0] == 'c':
                    g[0] = key[1]
    with open(os.path.join(d, 'textures.bin'), 'wb') as f:
        f.write(tblob)
    with open(os.path.join(d, 'textures.json'), 'w') as f:
        json.dump(tmeta, f, separators=(',', ':'))

    # ---- object records, sorted by cell
    keep = np.array([int(r[0]) in shape_model for r in rows])
    arr = arr[keep]
    smap = np.array([shape_model.get(i, 0) for i in range(len(names))], dtype=np.int64)
    sidx = smap[arr[:, 0].astype(np.int64)]
    size = 15360
    try:
        j = json.load(open(os.path.join(d, 'models.json')))
        _ = j
    except Exception:
        pass
    ncell = int(np.ceil(size / cell))
    cx = np.clip((arr[:, 1] // cell).astype(np.int64), 0, ncell - 1)
    cz = np.clip((arr[:, 3] // cell).astype(np.int64), 0, ncell - 1)
    cid = cz * ncell + cx
    order = np.argsort(cid, kind='stable')
    arr, sidx, cid = arr[order], sidx[order], cid[order]
    n = len(arr)
    rec = np.zeros(n, dtype=[('s', '<u2'), ('x', '<u2'), ('z', '<u2'), ('y', '<u2'), ('yaw', '<u2'), ('p', 'i1'), ('r', 'i1'), ('sc', 'u1')])
    rec['s'] = sidx
    rec['x'] = np.clip(np.round(arr[:, 1] * 4), 0, 65535)
    rec['z'] = np.clip(np.round(arr[:, 3] * 4), 0, 65535)
    rec['y'] = np.clip(np.round((arr[:, 2] + 100) * 100), 0, 65535)
    rec['yaw'] = np.round((arr[:, 4] % 360) / 360 * 65536).astype(np.int64) % 65536
    rec['p'] = np.clip(np.round(arr[:, 5]), -127, 127)
    rec['r'] = np.clip(np.round(arr[:, 6]), -127, 127)
    rec['sc'] = np.clip(np.round(arr[:, 7] * 50), 1, 255)
    counts = np.bincount(cid, minlength=ncell * ncell).astype(np.uint32)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]]).astype(np.uint32)
    with open(os.path.join(d, 'scene_objects.bin'), 'wb') as f:
        f.write(struct.pack('<4sIII', b'DZSO', ncell, cell, n))
        f.write(starts.tobytes())
        f.write(counts.tobytes())
        f.write(rec.tobytes())
    with open(os.path.join(d, 'scene.bin'), 'wb') as f:
        f.write(blob)
    with open(os.path.join(d, 'scene.json'), 'w') as f:
        json.dump({'cell': cell, 'ncell': ncell, 'count': n, 'models': models}, f, separators=(',', ':'))
    print('scene: %d objects, %d models, scene.bin %.1f MB, objects %.1f MB   (%.0fs)' % (
        n, len(models), len(blob) / 1e6, (n * 13 + ncell * ncell * 8) / 1e6, time.time() - t0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
