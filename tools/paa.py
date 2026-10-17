"""
Minimal reader for DayZ / Arma .paa textures (DXT1/3/5, ARGB4444, ARGB1555, ARGB8888).
Decodes one mip level (the largest one that fits a size budget) to a PIL RGBA image.
"""
import io
import struct

from PIL import Image

import odol_reader

FOURCC = {0xFF01: b'DXT1', 0xFF02: b'DXT3', 0xFF03: b'DXT3', 0xFF04: b'DXT5', 0xFF05: b'DXT5'}


def _mips(data):
    ptype = struct.unpack_from('<H', data, 0)[0]
    pos = 2
    while data[pos:pos + 4] == b'GGAT':
        size = struct.unpack_from('<I', data, pos + 8)[0]
        pos += 12 + size
    pal = struct.unpack_from('<H', data, pos)[0]
    pos += 2 + pal * 3
    out = []
    while pos + 7 <= len(data):
        w, h = struct.unpack_from('<HH', data, pos)
        if w == 0 or h == 0:
            break
        size = data[pos + 4] | (data[pos + 5] << 8) | (data[pos + 6] << 16)
        pos += 7
        out.append((w & 0x7FFF, h & 0x7FFF, bool(w & 0x8000), pos, size))
        pos += size
    return ptype, out


def _dxt_image(fourcc, w, h, raw):
    hdr = bytearray(128)
    hdr[0:4] = b'DDS '
    struct.pack_into('<7I', hdr, 4, 124, 0x1007 | 0x80000, h, w, len(raw), 0, 0)
    struct.pack_into('<I', hdr, 76, 32)         # pixel format size
    struct.pack_into('<I', hdr, 80, 4)          # DDPF_FOURCC
    hdr[84:88] = fourcc
    struct.pack_into('<I', hdr, 108, 0x1000)    # caps: texture
    return Image.open(io.BytesIO(bytes(hdr) + raw)).convert('RGBA')


def decode(data, max_dim=128):
    """-> PIL RGBA image (possibly smaller than the source) or None"""
    try:
        ptype, mips = _mips(data)
    except struct.error:
        return None
    if not mips:
        return None
    pick = None
    for m in mips:
        if max(m[0], m[1]) <= max_dim:
            pick = m
            break
    if pick is None:
        pick = mips[-1]
    w, h, comp, off, size = pick
    raw = data[off:off + size]
    if ptype in FOURCC:
        fc = FOURCC[ptype]
        bw, bh = max(1, (w + 3) // 4), max(1, (h + 3) // 4)
        expect = bw * bh * (8 if fc == b'DXT1' else 16)
        if comp or size < expect:
            r = odol_reader.lzo(raw, 0, limit=expect + 64)
            if not r or len(r[0]) < expect:
                return None
            raw = r[0][:expect]
        return _dxt_image(fc, w, h, raw[:expect])
    if ptype in (0x4444, 0x1555, 0x8888):
        bpp = 4 if ptype == 0x8888 else 2
        if len(raw) < w * h * bpp:
            return None  # LZSS packed variants are not supported
        if ptype == 0x8888:
            return Image.frombuffer('RGBA', (w, h), raw[:w * h * 4], 'raw', 'BGRA', 0, 1)
        import numpy as np
        v = np.frombuffer(raw[:w * h * 2], dtype='<u2').astype(np.uint32)
        if ptype == 0x4444:
            a, r, g, b = (v >> 12) & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15
            arr = np.stack([r * 17, g * 17, b * 17, a * 17], 1)
        else:
            a, r, g, b = (v >> 15) & 1, (v >> 10) & 31, (v >> 5) & 31, v & 31
            arr = np.stack([r * 255 // 31, g * 255 // 31, b * 255 // 31, a * 255], 1)
        return Image.fromarray(arr.reshape(h, w, 4).astype('uint8'), 'RGBA')
    return None
