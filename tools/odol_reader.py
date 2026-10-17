"""
Minimal reader for DayZ binarized models (.p3d, ODOL v54): extracts the render geometry of every LOD that
carries faces + vertex positions.  Arrays >= 1024 bytes are LZO1X compressed; face lists are stored plain as
  [u32 faceCount][u32 size][u16 pad] then per face: [u8 n (3|4)][n * u16 vertex index]
and the vertex table is  [u32 N][N * float3]  (N == highest face index + 1).
"""
import re
import struct

import numpy as np


def lzo(src, start, limit=1 << 22):
    """LZO1X decompress src[start:] until the EOF marker. Returns (bytes, end_offset) or None."""
    out = bytearray()
    ip = start
    try:
        t = src[ip]
        state = 'loop'
        if t > 17:
            ip += 1
            t -= 17
            if t < 4:
                state = 'match_next'
            else:
                out += src[ip:ip + t]
                ip += t
                state = 'first'
        while True:
            if len(out) > limit:
                return None
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
                if mpos < 0:
                    return None
                for i in range(3):
                    out.append(out[mpos + i])
                state = 'done'
            elif state == 'match':
                if t >= 64:
                    mpos = len(out) - 1 - ((t >> 2) & 7) - (src[ip] << 3); ip += 1
                    ln = (t >> 5) - 1 + 2
                elif t >= 32:
                    t &= 31
                    if t == 0:
                        while src[ip] == 0:
                            t += 255; ip += 1
                        t += 31 + src[ip]; ip += 1
                    ln = t + 2
                    dd = (src[ip] >> 2) + (src[ip + 1] << 6); ip += 2
                    mpos = len(out) - 1 - dd
                elif t >= 16:
                    mpos = len(out) - ((t & 8) << 11)
                    t &= 7
                    if t == 0:
                        while src[ip] == 0:
                            t += 255; ip += 1
                        t += 7 + src[ip]; ip += 1
                    dd = (src[ip] >> 2) + (src[ip + 1] << 6); ip += 2
                    mpos -= dd
                    if mpos == len(out):
                        return bytes(out), ip
                    mpos -= 0x4000
                    ln = t + 2
                else:
                    mpos = len(out) - 1 - (t >> 2) - (src[ip] << 2); ip += 1
                    ln = 2
                if mpos < 0:
                    return None
                if mpos + ln <= len(out):
                    out += out[mpos:mpos + ln]
                else:
                    for i in range(ln):
                        out.append(out[mpos + i])
                state = 'done'
            else:
                if state == 'done':
                    t = src[ip - 2] & 3
                if t == 0:
                    state = 'loop'
                else:
                    out += src[ip:ip + t]; ip += t
                    t = src[ip]; ip += 1
                    state = 'match'
    except (IndexError, ValueError):
        return None


def faces_at(b, p):
    """validate a face list at p -> (end_offset, max_index) or None"""
    if p + 10 > len(b):
        return None
    cnt, size = struct.unpack_from('<II', b, p)
    if not (1 <= cnt <= 60000) or not (cnt <= size <= cnt * 12):
        return None
    pos = p + 10
    mx = 0
    for _ in range(cnt):
        if pos >= len(b):
            return None
        n = b[pos]
        if n < 3 or n > 4:
            return None
        pos += 1
        if pos + 2 * n > len(b):
            return None
        idx = struct.unpack_from('<%dH' % n, b, pos)
        pos += 2 * n
        m = max(idx)
        if m > mx:
            mx = m
    return pos, mx


def read_faces(b, p):
    cnt, size = struct.unpack_from('<II', b, p)
    pos = p + 10
    out = []
    for _ in range(cnt):
        n = b[pos]
        pos += 1
        out.append(struct.unpack_from('<%dH' % n, b, pos))
        pos += 2 * n
    return out, pos


def _candidates(b):
    """offsets that look like face-list headers (numpy prefilter, all four byte alignments)"""
    n = len(b)
    arr = np.frombuffer(b, dtype=np.uint8)
    out = set()
    for al in range(4):
        m = (n - al) // 4 * 4
        if m < 16:
            continue
        u = np.frombuffer(b[al:al + m], dtype='<u4')
        cnt = u[:-1]
        size = u[1:]
        ok = (cnt >= 2) & (cnt <= 60000) & (size >= cnt) & (size <= cnt * 12)
        for i in np.nonzero(ok)[0]:
            p = al + int(i) * 4
            if p + 11 < n and arr[p + 8] == 0 and arr[p + 9] == 0 and arr[p + 10] in (3, 4):
                out.add(p)
    return sorted(out)


_TEX = re.compile(rb'[A-Za-z0-9_\\.\-]+\.paa')


def parse(b):
    """-> list of dict(offset, faces, verts (Nx3 float32 | None), tex[], maxidx) in file order"""
    lists = []
    last_end = 0
    for p in _candidates(b):
        if p < last_end:
            continue
        r = faces_at(b, p)
        if r and r[1] >= 2:
            lists.append((p, r[0], r[1]))
            last_end = r[0]
    n = len(b)
    res = []
    prev_end = 0
    for (p, end, mx) in lists:
        lo = max(prev_end, p - 6000)
        tex = []
        for m in _TEX.finditer(b[lo:p]):
            t = m.group(0).decode('latin1').lower()
            if t not in tex:
                tex.append(t)
        verts = None
        N = mx + 1
        if N * 12 < 1024:
            tgt = struct.pack('<I', N)
            stop = min(n, end + N * 40 + 8000)
            q = b.find(tgt, end, stop)
            while q != -1 and verts is None:
                if q + 4 + 12 * N <= n:
                    a = np.frombuffer(b[q + 4:q + 4 + 12 * N], dtype='<f4')
                    if np.isfinite(a).all() and abs(a).max() < 300 and abs(a).max() > 0.05:
                        verts = a.reshape(-1, 3).copy()
                q = b.find(tgt, q + 1, stop)
        else:
            hi = min(n, end + 700000)
            seg = b[end:hi]
            cands = []
            for al in range(4):
                m = (len(seg) - al) // 4 * 4
                if m < 4:
                    continue
                u = np.frombuffer(seg[al:al + m], dtype='<u4')
                for i in np.nonzero((u >= N) & (u <= N + 4000))[0]:
                    v = int(u[i])
                    if v * 12 >= 1024:
                        cands.append((v - N, end + al + int(i) * 4, v))
            cands.sort()  # exact vertex count first, then nearest to the face list
            for _, q, v in cands:
                r = lzo(b, q + 4, limit=v * 24)
                if r and len(r[0]) >= v * 12 - 8:
                    a = np.frombuffer(r[0][:v * 12], dtype='<f4')
                    if np.isfinite(a).all() and abs(a).max() < 300:
                        verts = a.reshape(-1, 3).copy()
                        break
        faces, _ = read_faces(b, p)
        res.append({'offset': p, 'faces': faces, 'verts': verts, 'tex': tex, 'maxidx': mx})
        prev_end = end
    return res


# ---------------------------------------------------------------- textures / UVs
_STR = re.compile(rb'(?:[A-Za-z0-9_\\.\-]+\.paa|#\([^\x00]{3,120})', re.I)
_RVMAT = re.compile(rb'[A-Za-z0-9_\\.\-]+\.rvmat', re.I)
_COLOR = re.compile(r'color\(\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*,\s*([a-z]+)\)', re.I)


def _cstr(b, p):
    e = b.index(b'\0', p)
    return b[p:e].decode('latin1'), e + 1


def read_tables(b, prev_end, face_off):
    """texture table + material list that precede a LOD's face list.
    -> (textures[], materials[(rvmat, [stage strings])])"""
    lo = max(prev_end, face_off - 12000)
    seg = b[lo:face_off]
    m = _STR.search(seg)
    if not m:
        return [], []
    s0 = lo + m.start()
    k = None
    nempty = 0
    for j in range(0, 10):
        q = s0 - 4 - j
        if q < lo:
            break
        if any(b[q + 4:s0]):
            break
        cnt = struct.unpack_from('<I', b, q)[0]
        if j < cnt < 400:
            k = cnt
            nempty = j
            break
    if k is None:
        return [], []
    pos = s0 - nempty
    tex = []
    try:
        for _ in range(k):
            s, pos = _cstr(b, pos)
            tex.append(s.lower())
    except ValueError:
        return [], []
    mats = []
    # materials: rvmat name followed by its stage texture strings, until the next rvmat
    rv = [(lo + r.start(), r.group(0).decode('latin1').lower()) for r in _RVMAT.finditer(seg) if lo + r.start() >= pos]
    for i, (rp, name) in enumerate(rv):
        nxt = rv[i + 1][0] if i + 1 < len(rv) else face_off
        stages = [x.group(0).decode('latin1').lower() for x in _STR.finditer(b[rp + len(name):nxt])]
        mats.append((name, stages))
    return tex, mats


def read_sections(b, face_end, faces):
    """-> ([(lowFace, highFace, textureIndex, materialIndex)], offset_of_last_record) or None
    Section bounds are byte offsets into the in-memory polygon list (2 + 2*n bytes per polygon)."""
    cum = [0]
    for f in faces:
        cum.append(cum[-1] + 2 + 2 * len(f))
    at = {v: i for i, v in enumerate(cum)}
    total = cum[-1]
    pos = face_end + 4
    out = []
    want = 0
    n = len(b)
    for _ in range(600):
        if pos + 30 > n:
            return None
        lo, hi = struct.unpack_from('<II', b, pos)
        if lo != want or hi <= lo or hi > total or lo not in at or hi not in at:
            return None
        tex = struct.unpack_from('<h', b, pos + 20)[0]
        mat = struct.unpack_from('<i', b, pos + 26)[0]
        out.append((at[lo], at[hi], tex, mat))
        if hi == total:
            return out, pos
        want = hi
        tgt = struct.pack('<I', hi)
        q = b.find(tgt, pos + 30, pos + 600)
        found = None
        while q != -1:
            if q + 8 <= n:
                nl, nu = struct.unpack_from('<II', b, q)
                if nl == hi and nu > nl and nu <= total and nu in at:
                    found = q
                    break
            q = b.find(tgt, q + 1, pos + 600)
        if found is None:
            return None
        pos = found
    return None


def read_uv(b, start, nverts, limit=60000):
    """first UV set -> (nverts x 2 float32) or None"""
    n = len(b)
    best = None
    q = start
    tgt = struct.pack('<I', nverts)
    end = min(n - 30, start + limit)
    while True:
        q = b.find(tgt, q + 1, end + 20)
        if q == -1:
            break
        s = q - 16
        if s < start:
            continue
        f = struct.unpack_from('<4f', b, s)
        if not all(abs(x) < 256 and x == x for x in f) or not (f[0] <= f[2] and f[1] <= f[3]):
            continue
        dp = q + 5
        if nverts * 4 < 1024:
            raw = b[dp:dp + nverts * 4]
        else:
            r = lzo(b, dp, limit=nverts * 8)
            raw = r[0] if r else b''
        if len(raw) < nverts * 4:
            continue
        a = np.frombuffer(raw[:nverts * 4], dtype='<i2').reshape(-1, 2).astype(np.float32)
        ext = float(a.min()) <= -32760 and float(a.max()) >= 32760
        if best is None or ext:
            sc = np.array([f[2] - f[0], f[3] - f[1]], dtype=np.float32)
            uv = np.array([f[0], f[1]], dtype=np.float32) + (a + 32767.0) / 65534.0 * sc
            best = uv
            if ext:
                break
    return best


def color_of(s):
    """'#(argb,8,8,3)color(r,g,b,a,dt)' -> '#rrggbb' or None"""
    m = _COLOR.search(s)
    if not m:
        return None
    r, g, bl = (max(0.0, min(1.0, float(m.group(i)))) for i in (1, 2, 3))
    if m.group(5).lower() not in ('co', 'dt', 'dtsmdi', 'ca', 'cadt'):
        return None
    return '#%02x%02x%02x' % (int(r * 255), int(g * 255), int(bl * 255))
