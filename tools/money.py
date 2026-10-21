"""DayZ Studio - dollar bills for the quest mod: one bill mesh, six textures ($1 $5 $10 $20 $50 $100).

add_to(src, mod, env) writes into the mod source folder that build_export packs:
    money/dollar.p3d                 the bill: a thin box (one stack of bills), texture slot "camo"
    money/dollar_<n>_co.paa          front on the top half, back on the bottom half of a 1024x1024 texture
The config classes (DSQ_Dollar1 ... DSQ_Dollar100) are written by js/runtime.js (R.moneyConfig).

Textures: Studio draws its own simple bills. The user can put their own images in
Documents/DayZStudio/Assets/Currency - dollar_<n>_front.png / _back.png (or one dollar_<n>.png for both sides,
jpg works too) - and those are used instead. They stay on the user's PC (never in the repository).
PNG -> PAA needs DayZ Tools (ImageToPAA); the model is written as MLOD and binarized with DayZ Tools when possible.
"""
import os
import shutil
import struct
import subprocess
import tempfile

DENOMS = [1, 5, 10, 20, 50, 100]
USER_DIR = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZStudio', 'Assets', 'Currency')
# real US bills are 156 x 66 mm; the model is a small bundle, 3 mm thick, so it is visible on the ground
W, D, H = 0.156, 0.066, 0.003
SIDE = (1024, 512)   # each face of a bill in the texture (front: top half, back: bottom half)
# accent colours per denomination, so bills are told apart at a glance
TINT = {1: (86, 112, 84), 5: (112, 86, 122), 10: (176, 112, 58), 20: (70, 128, 82), 50: (176, 82, 112), 100: (54, 116, 140)}
WORDS = {1: 'ONE', 5: 'FIVE', 10: 'TEN', 20: 'TWENTY', 50: 'FIFTY', 100: 'ONE HUNDRED'}
CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


# ------------------------------------------------------------------ textures
def _font(size, bold=True):
    from PIL import ImageFont
    for name in (('segoeuib.ttf', 'arialbd.ttf', 'timesbd.ttf') if bold else ('segoeui.ttf', 'arial.ttf', 'times.ttf')):
        try:
            return ImageFont.truetype(os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', name), size)
        except OSError:
            continue
    return ImageFont.load_default()


def _draw_side(n, back):
    """one side of a Studio bill at 2.35:1, drawn large and scaled down later"""
    from PIL import Image, ImageDraw
    w, h = 2350, 1000
    tint = TINT[n]
    # mid-tone paper and strong ink: real notes are darker than they look, and a near-white bill reads as blank
    paper = tuple(int(c * 0.35 + 150) for c in tint)
    img = Image.new('RGB', (w, h), paper)
    d = ImageDraw.Draw(img)
    ink = tuple(int(c * 0.32) for c in tint)
    light = tuple(int(c * 0.55 + 105) for c in tint)
    # fine background lines (like the engraving on real notes)
    for y in range(0, h, 9):
        d.line([(0, y), (w, y + 40)], fill=light, width=2)
    # frame
    d.rectangle([28, 28, w - 28, h - 28], outline=ink, width=14)
    d.rectangle([62, 62, w - 62, h - 62], outline=tint, width=5)
    for k in range(0, 40, 8):   # rosette pattern in the corners
        for cx, cy in ((150, 150), (w - 150, 150), (150, h - 150), (w - 150, h - 150)):
            d.ellipse([cx - 90 + k, cy - 90 + k, cx + 90 - k, cy + 90 - k], outline=tint, width=3)
    big, mid, small = _font(200), _font(92), _font(56, False)
    num = str(n)
    for cx, cy in ((150, 150), (w - 150, 150), (150, h - 150), (w - 150, h - 150)):
        d.text((cx, cy), num, font=_font(150 if n < 100 else 110), fill=ink, anchor='mm')
    if not back:
        # portrait oval with an emblem, the denomination in words, the issuer
        d.ellipse([w / 2 - 300, h / 2 - 280, w / 2 + 300, h / 2 + 280], fill=light, outline=ink, width=12)
        d.ellipse([w / 2 - 264, h / 2 - 244, w / 2 + 264, h / 2 + 244], outline=tint, width=4)
        d.text((w / 2, h / 2 - 50), '$' + num, font=big if n < 100 else _font(170), fill=ink, anchor='mm')
        d.text((w / 2, h / 2 + 140), 'DAYZ', font=mid, fill=tint, anchor='mm')
        d.text((w / 2, 125), 'CHERNARUS RESERVE NOTE', font=mid, fill=ink, anchor='mm')
        d.text((w / 2, h - 125), WORDS[n] + (' DOLLAR' if n == 1 else ' DOLLARS'), font=mid, fill=ink, anchor='mm')
        d.text((560, h / 2), 'SERIES 2026', font=small, fill=ink, anchor='mm')
        d.text((w - 560, h / 2), 'NOT LEGAL TENDER', font=small, fill=ink, anchor='mm')
    else:
        d.rectangle([w / 2 - 560, h / 2 - 260, w / 2 + 560, h / 2 + 260], fill=light, outline=ink, width=10)
        d.text((w / 2, h / 2), WORDS[n], font=big if n < 100 else mid, fill=ink, anchor='mm')
        d.text((w / 2, 150), 'IN SURVIVAL WE TRUST', font=mid, fill=ink, anchor='mm')
        d.text((w / 2, h - 140), 'GOOD FOR TRADE IN SOUTH ZAGORIA', font=small, fill=ink, anchor='mm')
    return img


def _user_side(n, back):
    """the user's own image for this side, if there is one"""
    for stem in ('dollar_%d_%s' % (n, 'back' if back else 'front'), 'dollar_%d' % n):
        for ext in ('.png', '.jpg', '.jpeg'):
            p = os.path.join(USER_DIR, stem + ext)
            if os.path.isfile(p):
                return p
    return None


def texture_png(n, path):
    """the 1024x1024 texture of one denomination: front on top, back below. Returns 'own' or 'studio'."""
    from PIL import Image
    sides, own = [], False
    for back in (False, True):
        p = _user_side(n, back)
        if p:
            im = Image.open(p).convert('RGB')
            if im.height > im.width:
                im = im.rotate(90, expand=True)   # portrait scan: lay it down
            own = True
        else:
            im = _draw_side(n, back)
        sides.append(im.resize(SIDE, Image.LANCZOS))
    tex = Image.new('RGB', (SIDE[0], SIDE[1] * 2))
    tex.paste(sides[0], (0, 0))
    tex.paste(sides[1], (0, SIDE[1]))
    tex.save(path)
    return 'own' if own else 'studio'


def image_to_paa(env, png, paa):
    tools = env.get('tools')
    exe = os.path.join(tools, 'Bin', 'ImageToPAA', 'ImageToPAA.exe') if tools else None
    if not exe or not os.path.isfile(exe):
        return False
    subprocess.run([exe, png, paa], capture_output=True, timeout=120, creationflags=CREATE_NO_WINDOW)
    return os.path.isfile(paa)


# ------------------------------------------------------------------ the model (MLOD, binarized when possible)
def _lod(points, faces, resolution, selections, mass=None):
    """one MLOD LOD. points: [(x,y,z)], faces: [([i,i,i,(i)], [(u,v)...], texture, material)]"""
    out = bytearray(b'P3DM' + struct.pack('<II', 0x1C, 0x100))
    out += struct.pack('<IIII', len(points), len(faces), len(faces), 0)
    for x, y, z in points:
        out += struct.pack('<fffI', x, y, z, 0)
    normals = []
    for idx, _uv, _t, _m in faces:
        a, b, c = (points[i] for i in idx[:3])
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        nx, ny, nz = u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]
        ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1
        normals.append((nx / ln, ny / ln, nz / ln))
    for n in normals:
        out += struct.pack('<fff', *n)
    for fi, (idx, uvs, tex, mat) in enumerate(faces):
        out += struct.pack('<I', len(idx))
        for k in range(4):
            if k < len(idx):
                out += struct.pack('<IIff', idx[k], fi, uvs[k][0], uvs[k][1])
            else:
                out += struct.pack('<IIff', 0, 0, 0.0, 0.0)
        out += struct.pack('<I', 0)
        out += tex.encode('ascii') + b'\0' + mat.encode('ascii') + b'\0'
    out += b'TAGG'

    def tagg(name, data):
        return b'\x01' + name.encode('ascii') + b'\0' + struct.pack('<I', len(data)) + data
    for name in selections:   # every point and face belongs to the selection
        out += tagg(name, bytes([1]) * len(points) + bytes([1]) * len(faces))
    if mass is not None:
        out += tagg('#Mass#', struct.pack('<%df' % len(points), *([mass / len(points)] * len(points))))
    out += tagg('#EndOfFile#', b'')
    out += struct.pack('<f', resolution)
    return bytes(out)


def bill_mlod(texture, material):
    hw, hd, hh = W / 2, D / 2, H / 2
    # laid out flat (y = thickness), then stood up like DayZ's own flat items (the punched card): wide on x, tall on
    # y, thin on z. The inventory preview looks at that face; on the ground the game lays it down by itself.
    flat = [(-hw, -hh, -hd), (hw, -hh, -hd), (hw, -hh, hd), (-hw, -hh, hd),
            (-hw, hh, -hd), (hw, hh, -hd), (hw, hh, hd), (-hw, hh, hd)]
    pts = [(x, z, y) for x, y, z in flat]
    e = 0.004   # the edges show a sliver of the front's border
    quads = [
        ([4, 5, 6, 7], [(1, 0.5), (0, 0.5), (0, 0), (1, 0)]),          # front of the bill (seen from +z: u runs to -x)
        ([3, 2, 1, 0], [(0, 0.5), (1, 0.5), (1, 1), (0, 1)]),          # back of the bill
        ([0, 1, 5, 4], [(0, e), (1, e), (1, 0), (0, 0)]),
        ([2, 3, 7, 6], [(0, e), (1, e), (1, 0), (0, 0)]),
        ([1, 2, 6, 5], [(0, e), (e, e), (e, 0), (0, 0)]),
        ([3, 0, 4, 7], [(0, e), (e, e), (e, 0), (0, 0)]),
    ]
    # the order the engine wants is the reverse of the quads above (checked in game: the other way round the
    # preview looked through the front and showed the inside of the back, mirrored)
    vis = [(idx[::-1], uv[::-1], texture, material) for idx, uv in quads]
    geo = [(idx[::-1], uv[::-1], '', '') for idx, uv in quads]
    lods = [
        _lod(pts, vis, 1.0, ['camo']),
        _lod(pts, geo, 1e13, ['Component01'], mass=0.05),   # geometry: physics, picking it up
        _lod(pts, geo, 6e15, ['Component01']),              # view geometry
        _lod(pts, geo, 7e15, ['Component01']),              # fire geometry
        _lod([(0, 0, 0.35)], [], 1e15, ['invview']),         # memory: where the inventory preview camera sits
    ]
    return b'MLOD' + struct.pack('<II', 257, len(lods)) + b''.join(lods)


# Binarize keeps "camo" as a section of its own only when model.cfg lists it; without that, hiddenSelectionsTextures
# (one texture per denomination) has nothing to swap and every bill shows the model's own $1 texture
MODEL_CFG = '''class CfgSkeletons
{
	class Default
	{
		isDiscrete = 1;
		skeletonInherit = "";
		skeletonBones[] = {};
	};
};
class CfgModels
{
	class Default
	{
		sectionsInherit = "";
		sections[] = {};
		skeletonName = "";
	};
	class dollar: Default
	{
		sections[] = {"camo"};
	};
};
'''


def binarize(env, mlod_dir, out_dir):
    """MLOD -> ODOL with DayZ Tools' Binarize (what DayZ loads fastest); False when it is not available or fails"""
    tools = env.get('tools')
    exe = os.path.join(tools, 'Bin', 'Binarize', 'binarize.exe') if tools else None
    if not exe or not os.path.isfile(exe):
        return False
    os.makedirs(out_dir, exist_ok=True)
    r = subprocess.run([exe, '-norecurse', mlod_dir, out_dir], capture_output=True, text=True, timeout=180,
                       creationflags=CREATE_NO_WINDOW, cwd=mlod_dir)
    return os.path.isfile(os.path.join(out_dir, 'dollar.p3d')), (r.stdout + r.stderr)[-2000:]


# ------------------------------------------------------------------ into the mod
# the generator as it was when the studio server loaded it (not the file on disk, which may be newer)
import hashlib
_CODE = hashlib.md5(open(__file__, 'rb').read()).hexdigest()


def _signature(mod, env):
    """what the generated files depend on: the mod name (texture paths), the user's images, this generator"""
    parts = [mod, str(bool(env.get('tools'))), _CODE]
    if os.path.isdir(USER_DIR):
        for fn in sorted(os.listdir(USER_DIR)):
            p = os.path.join(USER_DIR, fn)
            parts.append('%s:%d:%d' % (fn, os.path.getsize(p), int(os.path.getmtime(p))))
    return '|'.join(parts)


def add_to(src, mod, env, cache=None):
    """write the bills into the mod source folder; returns a short report for the build result.
    cache: a folder that keeps the last result, so a rebuild with nothing changed takes no time"""
    out = os.path.join(src, 'money')
    os.makedirs(out, exist_ok=True)
    sig = _signature(mod, env)
    if cache and os.path.isfile(os.path.join(cache, 'sig.txt')) and open(os.path.join(cache, 'sig.txt'), encoding='utf-8').read() == sig:
        import json
        for fn in os.listdir(cache):
            if fn.endswith(('.paa', '.p3d')):
                shutil.copy2(os.path.join(cache, fn), os.path.join(out, fn))
        return json.load(open(os.path.join(cache, 'report.json'), encoding='utf-8'))
    report = {'textures': 0, 'own': [], 'model': '', 'notes': []}
    tmp = tempfile.mkdtemp(prefix='dzs_money_')
    try:
        for n in DENOMS:
            png = os.path.join(tmp, 'dollar_%d_co.png' % n)
            if texture_png(n, png) == 'own':
                report['own'].append(n)
            if image_to_paa(env, png, os.path.join(out, 'dollar_%d_co.paa' % n)):
                report['textures'] += 1
        if report['textures'] < len(DENOMS):
            report['notes'].append('bill textures need DayZ Tools (ImageToPAA) - install DayZ Tools from Steam')
        mlod = bill_mlod('%s\\money\\dollar_1_co.paa' % mod, '')   # no material: vanilla paper's lit them almost white
        mdir = os.path.join(tmp, 'mlod')
        os.makedirs(mdir)
        with open(os.path.join(mdir, 'dollar.p3d'), 'wb') as f:
            f.write(mlod)
        with open(os.path.join(mdir, 'model.cfg'), 'w', encoding='ascii') as f:
            f.write(MODEL_CFG)
        ok = binarize(env, mdir, os.path.join(tmp, 'odol'))
        if ok and ok[0]:
            shutil.copy2(os.path.join(tmp, 'odol', 'dollar.p3d'), os.path.join(out, 'dollar.p3d'))
            report['model'] = 'binarized'
        else:
            shutil.copy2(os.path.join(mdir, 'dollar.p3d'), os.path.join(out, 'dollar.p3d'))
            report['model'] = 'mlod'
            if ok:
                report['notes'].append('Binarize: ' + ok[1][-300:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if cache and report['textures'] == len(DENOMS):
        import json
        shutil.rmtree(cache, ignore_errors=True)
        shutil.copytree(out, cache)
        json.dump(report, open(os.path.join(cache, 'report.json'), 'w', encoding='utf-8'))
        open(os.path.join(cache, 'sig.txt'), 'w', encoding='utf-8').write(sig)
    return report


if __name__ == '__main__':   # python tools/money.py <out dir>: just the textures as PNG, to look at them
    import sys
    d = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(d, exist_ok=True)
    for n in DENOMS:
        print(n, texture_png(n, os.path.join(d, 'dollar_%d_co.png' % n)))
