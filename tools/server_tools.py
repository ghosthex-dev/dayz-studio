"""
DayZ Studio - server utilities used by studio_server.py:

  * serverDZ.cfg   - read / write (the editor does the key-by-key editing, unknown lines are kept)
  * types.xml      - global loot multipliers (rules by category / usage / tier / name), always applied to a
                     pristine copy so applying twice never compounds
  * PBO tools      - list, inspect, unpack (LZSS-compressed entries, config.bin -> config.cpp with DayZ Tools'
                     CfgConvert or the built-in reader), pack (+ binarize + sign), and register a mod's PBOs so
                     its classes and models show up in the asset list and the 3D view
Plain standard library.
"""
import fnmatch, json, math, os, re, shutil, struct, subprocess, time

H = {}   # helpers handed over by studio_server.setup(): find_env, find_server, pack_pbo, sign_pbo, steam_roots, DATA, ...

DOCS = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZStudio')
UNPACKED = os.path.join(DOCS, 'Unpacked')
PACKED = os.path.join(DOCS, 'Packed')


def setup(helpers):
    H.update(helpers)


def stamp():
    return time.strftime('%Y%m%d-%H%M%S')


# ================================================================== serverDZ.cfg
def server_root():
    return H['find_server']()


def servercfg_get(q):
    path = (q.get('path') or [''])[0]
    root = server_root()
    if not path and root:
        path = os.path.join(root, 'serverDZ.cfg')
    if not path:
        return {'ok': False, 'error': 'DayZ Server is not installed (Steam: Library > Tools > DayZ Server). Enter the path to a serverDZ.cfg instead.'}
    if not path.lower().endswith('.cfg'):
        return {'ok': False, 'error': 'Pick a .cfg file.'}
    text = ''
    if os.path.isfile(path):
        text = open(path, encoding='utf-8', errors='replace').read()
    mdir = os.path.join(os.path.dirname(path), 'mpmissions')
    missions = sorted(d for d in os.listdir(mdir) if os.path.isdir(os.path.join(mdir, d))) if os.path.isdir(mdir) else []
    return {'ok': True, 'path': path, 'exists': os.path.isfile(path), 'text': text, 'missions': missions, 'serverRoot': root or ''}


def servercfg_save(body):
    path = str(body.get('path', ''))
    text = str(body.get('text', ''))
    if not path.lower().endswith('.cfg'):
        return {'ok': False, 'error': 'Pick a .cfg file.'}
    if not os.path.isdir(os.path.dirname(path) or '.'):
        return {'ok': False, 'error': 'The folder does not exist: ' + os.path.dirname(path)}
    backup = ''
    if os.path.isfile(path):
        backup = path + '.bak-' + stamp()
        shutil.copy2(path, backup)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    return {'ok': True, 'path': path, 'backup': backup}


# ================================================================== types.xml multipliers
TYPE_RE = re.compile(r'<type\s+name="([^"]+)"\s*>(.*?)</type>', re.S)
NUM_RE = {k: re.compile(r'(<%s>\s*)(-?\d+)(\s*</%s>)' % (k, k)) for k in ('nominal', 'min')}


def types_path_for(world):
    root = server_root()
    m = H['SRV_WORLDS'].get(world)
    if not root or not m:
        return ''
    return os.path.join(root, 'mpmissions', m, 'db', 'types.xml')


def types_source(q):
    world = (q.get('world') or ['chernarusplus'])[0]
    path = (q.get('path') or [''])[0] or types_path_for(world)
    orig = path + '.studio-original'
    return {'ok': True, 'path': path, 'exists': bool(path) and os.path.isfile(path), 'hasOriginal': bool(path) and os.path.isfile(orig)}


def rule_matches(r, name, cat, usages, tiers):
    if r.get('cat') and r['cat'] != cat:
        return False
    if r.get('usage') and r['usage'] not in usages:
        return False
    if r.get('tier') and r['tier'] not in tiers:
        return False
    pat = str(r.get('name') or '').strip().lower()
    if pat:
        if not any(c in pat for c in '*?['):
            pat = '*' + pat + '*'
        if not fnmatch.fnmatch(name.lower(), pat):
            return False
    return True


def apply_rules(xml, rules):
    """-> (new xml, changes [[name, cat, nominal, newNominal, min, newMin]], totals {cat: [before, after]})"""
    rules = [r for r in rules if r.get('on', True) and abs(float(r.get('mult', 1)) - 1) > 1e-6]
    changes, totals = [], {}

    def one(m):
        name, inner = m.group(1), m.group(2)
        cm = re.search(r'<category\s+name="([^"]*)"', inner)
        cat = cm.group(1) if cm else ''
        usages = re.findall(r'<usage\s+name="([^"]*)"', inner)
        tiers = re.findall(r'<value\s+name="([^"]*)"', inner)
        nm, mm = NUM_RE['nominal'].search(inner), NUM_RE['min'].search(inner)
        if not nm:
            return m.group(0)
        nom = int(nm.group(2))
        mn = int(mm.group(2)) if mm else 0
        t = totals.setdefault(cat or '(none)', [0, 0])
        t[0] += nom
        f, min_too = 1.0, False
        for r in rules:
            if rule_matches(r, name, cat, usages, tiers):
                f *= max(0.0, float(r.get('mult', 1)))
                min_too = min_too or r.get('minToo', True)
        if nom <= 0 or f == 1.0:
            t[1] += nom
            return m.group(0)
        nn = int(math.floor(nom * f + 0.5))
        if f > 0 and nn < 1:
            nn = 1
        nmin = mn
        if min_too:
            nmin = int(math.floor(mn * f + 0.5))
        nmin = min(nmin, nn)
        t[1] += nn
        if nn == nom and nmin == mn:
            return m.group(0)
        changes.append([name, cat, nom, nn, mn, nmin])
        out = NUM_RE['nominal'].sub(lambda x: x.group(1) + str(nn) + x.group(3), inner, 1)
        if mm:
            out = NUM_RE['min'].sub(lambda x: x.group(1) + str(nmin) + x.group(3), out, 1)
        return m.group(0).replace(inner, out, 1)

    return TYPE_RE.sub(one, xml), changes, totals


def types_apply(body):
    path = str(body.get('path', ''))
    if not path.lower().endswith('.xml') or not os.path.isfile(path):
        return {'ok': False, 'error': 'types.xml not found: ' + path}
    orig = path + '.studio-original'
    action = body.get('action', 'preview')
    if action == 'restore':
        if not os.path.isfile(orig):
            return {'ok': False, 'error': 'No original copy - Studio never changed this file.'}
        shutil.copy2(orig, path)
        os.remove(orig)
        return {'ok': True, 'restored': True}
    src = orig if os.path.isfile(orig) else path   # rules always start from the untouched file
    xml = open(src, encoding='utf-8', errors='replace').read()
    new, changes, totals = apply_rules(xml, body.get('rules') or [])
    res = {'ok': True, 'path': path, 'from': src, 'types': len(TYPE_RE.findall(xml)), 'changes': changes[:4000],
           'changed': len(changes), 'totals': totals}
    if action == 'write':
        if not os.path.isfile(orig):
            shutil.copy2(path, orig)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(new)
        res['written'] = True
        res['original'] = orig
    elif action == 'download':
        res['xml'] = new
    return res


# ================================================================== PBO reading
CPRS = 0x43707273   # 'Cprs': LZSS-compressed entry
VERS = 0x56657273   # 'Vers': header with properties (prefix)


def pbo_read_index(path):
    """-> (props {prefix,...}, [(name, offset, stored_size, original_size, compressed)])"""
    with open(path, 'rb') as f:
        data = f.read(16 * 1024 * 1024)
    pos, props, ents = 0, {}, []

    def cstr():
        nonlocal pos
        e = data.index(b'\0', pos)
        s = data[pos:e].decode('utf-8', errors='replace')
        pos = e + 1
        return s

    while True:
        name = cstr()
        mime, orig, _res, _ts, size = struct.unpack_from('<5I', data, pos)
        pos += 20
        if name == '' and mime == VERS:
            while True:
                k = cstr()
                if k == '':
                    break
                props[k.lower()] = cstr()
            continue
        if name == '':
            break
        ents.append((name, size, orig, mime == CPRS))
    off, out = pos, []
    for name, size, orig, comp in ents:
        out.append((name, off, size, orig if comp else size, comp))
        off += size
    return props, out


def lzss(src, out_len):
    out = bytearray()
    i, n = 0, len(src)
    while len(out) < out_len and i < n:
        flags = src[i]
        i += 1
        for bit in range(8):
            if len(out) >= out_len or i >= n:
                break
            if flags & (1 << bit):
                out.append(src[i])
                i += 1
            else:
                if i + 1 >= n:
                    break
                b1, b2 = src[i], src[i + 1]
                i += 2
                rpos = len(out) - (b1 | ((b2 & 0xF0) << 4))
                for k in range(((b2 & 0x0F) + 3)):
                    if len(out) >= out_len:
                        break
                    p = rpos + k
                    out.append(out[p] if 0 <= p < len(out) else 0x20)
    return bytes(out)


def pbo_entry_bytes(path, ent):
    name, off, size, orig, comp = ent
    with open(path, 'rb') as f:
        f.seek(off)
        raw = f.read(size)
    return lzss(raw, orig) if comp else raw


def safe_rel(name):
    """entry name -> a relative path that stays inside the target folder"""
    parts = [p for p in re.split(r'[\\/]+', name) if p not in ('', '.', '..')]
    parts = [re.sub(r'[<>:"|?*\x00-\x1f]', '_', p) for p in parts]
    return os.path.join(*parts) if parts else ''


# ================================================================== config.bin (rapified) + config.cpp readers
def read_rap(b):
    if b[:4] != b'\0raP':
        raise ValueError('not a rapified config')

    def cint(p):
        v, sh = 0, 0
        while True:
            c = b[p]
            p += 1
            v |= (c & 0x7F) << sh
            if not c & 0x80:
                return v, p
            sh += 7

    def asciiz(p):
        e = b.index(b'\0', p)
        return b[p:e].decode('utf-8', errors='replace'), e + 1

    def array(p):
        n, p = cint(p)
        out = []
        for _ in range(n):
            t = b[p]
            p += 1
            if t in (0, 4):
                s, p = asciiz(p)
                out.append(s)
            elif t == 1:
                out.append(struct.unpack_from('<f', b, p)[0])
                p += 4
            elif t == 2:
                out.append(struct.unpack_from('<i', b, p)[0])
                p += 4
            elif t == 3:
                a, p = array(p)
                out.append(a)
            elif t == 6:
                out.append(struct.unpack_from('<q', b, p)[0])
                p += 8
            else:
                raise ValueError('bad array element %d' % t)
        return out, p

    def body(p, depth=0):
        parent, p = asciiz(p)
        n, p = cint(p)
        d = {'__parent': parent}
        for _ in range(n):
            t = b[p]
            p += 1
            if t == 0:
                name, p = asciiz(p)
                off = struct.unpack_from('<I', b, p)[0]
                p += 4
                d[name] = body(off, depth + 1) if depth < 64 else {}
            elif t == 1:
                sub = b[p]
                p += 1
                name, p = asciiz(p)
                if sub in (0, 4):
                    d[name], p = asciiz(p)
                elif sub == 1:
                    d[name] = struct.unpack_from('<f', b, p)[0]
                    p += 4
                elif sub == 2:
                    d[name] = struct.unpack_from('<i', b, p)[0]
                    p += 4
                elif sub == 6:
                    d[name] = struct.unpack_from('<q', b, p)[0]
                    p += 8
                else:
                    raise ValueError('bad value type %d' % sub)
            elif t == 2:
                name, p = asciiz(p)
                d[name], p = array(p)
            elif t == 5:
                p += 4
                name, p = asciiz(p)
                d[name], p = array(p)
            elif t in (3, 4):
                name, p = asciiz(p)
                d.setdefault(name, {'__parent': '', '__extern': True})
            else:
                raise ValueError('bad entry type %d' % t)
        return d

    return body(16)


TOK_RE = re.compile(r'"(?:[^"]|"")*"|[A-Za-z0-9_.\-+\\/]+|\[\]|[{}:;=,]')


def read_cpp(text):
    """config.cpp -> the same dict shape as read_rap (good enough for class names, parents, scope and model)"""
    text = re.sub(r'//[^\n]*|/\*.*?\*/', '', text, flags=re.S)
    text = '\n'.join(l for l in text.split('\n') if not l.strip().startswith('#'))
    toks = TOK_RE.findall(text)
    i = 0

    def val(t):
        if t.startswith('"'):
            return t[1:-1].replace('""', '"')
        try:
            return float(t) if '.' in t else int(t)
        except ValueError:
            return t

    def block():
        nonlocal i
        d = {}
        while i < len(toks) and toks[i] != '}':
            t = toks[i]
            if t == 'class':
                name = toks[i + 1]
                i += 2
                parent = ''
                if i < len(toks) and toks[i] == ':':
                    parent = toks[i + 1]
                    i += 2
                if i < len(toks) and toks[i] == '{':
                    i += 1
                    sub = block()
                    sub['__parent'] = parent
                    d[name] = sub
                    i += 1   # }
                else:
                    d.setdefault(name, {'__parent': parent, '__extern': True})
            elif t == 'delete':
                i += 2
            elif t == ';':
                i += 1
            elif i + 1 < len(toks) and toks[i + 1] in ('=', '[]'):
                name = t
                if toks[i + 1] == '[]':
                    i += 3   # name [] =
                    arr, depth, cur = [], 0, []
                    while i < len(toks):
                        x = toks[i]
                        i += 1
                        if x == '{':
                            depth += 1
                        elif x == '}':
                            depth -= 1
                            if depth == 0:
                                break
                        elif x != ',':
                            arr.append(val(x))
                    d[name] = arr
                else:
                    i += 2
                    v = []
                    while i < len(toks) and toks[i] != ';':
                        v.append(toks[i])
                        i += 1
                    d[name] = val(v[0]) if len(v) == 1 else ' '.join(v)
            else:
                i += 1
        return d

    root = block()
    root['__parent'] = ''
    return root


def debin_cfgconvert(cfg_bin, cfg_cpp):
    env = H['find_env']()
    cc = env.get('cfgConvert')
    if not cc:
        return False
    try:
        subprocess.run([cc, '-txt', '-dst', cfg_cpp, cfg_bin], capture_output=True, timeout=120)
    except Exception:
        return False
    return os.path.isfile(cfg_cpp)


def cpp_from_rap(d, indent=0):
    """fallback text dump when CfgConvert is not installed"""
    pad = '\t' * indent
    out = []

    def lit(v):
        if isinstance(v, str):
            return '"%s"' % v.replace('"', '""')
        if isinstance(v, list):
            return '{' + ', '.join(lit(x) for x in v) + '}'
        if isinstance(v, float):
            return ('%.6g' % v)
        return str(v)

    for k, v in d.items():
        if k.startswith('__'):
            continue
        if isinstance(v, dict):
            if v.get('__extern'):
                out.append('%sclass %s;' % (pad, k))
                continue
            head = '%sclass %s%s' % (pad, k, (': ' + v['__parent']) if v.get('__parent') else '')
            out.append(head)
            out.append(pad + '{')
            out.extend(cpp_from_rap(v, indent + 1))
            out.append(pad + '};')
        elif isinstance(v, list):
            out.append('%s%s[] = %s;' % (pad, k, lit(v)))
        else:
            out.append('%s%s = %s;' % (pad, k, lit(v)))
    return out


# ================================================================== PBO endpoints
def pbo_sources():
    env = H['find_env']()
    out = []
    g = env.get('game')
    if g:
        out.append({'label': 'DayZ game files', 'path': os.path.join(g, 'Addons'), 'vanilla': True})
        for d in sorted(os.listdir(g)):
            a = os.path.join(g, d, 'Addons')
            if d.lower() != 'addons' and os.path.isdir(a):
                out.append({'label': 'DayZ · ' + d, 'path': a, 'vanilla': True})
        wsl = os.path.join(g, '!Workshop')
        if os.path.isdir(wsl):
            out.append({'label': 'Launcher mods (!Workshop)', 'path': wsl})
    for r in H['steam_roots']():
        ws = os.path.join(r, 'steamapps', 'workshop', 'content', '221100')
        if os.path.isdir(ws):
            out.append({'label': 'Steam Workshop mods', 'path': ws})
    srv = server_root()
    if srv:
        out.append({'label': 'DayZ Server', 'path': srv})
    os.makedirs(UNPACKED, exist_ok=True)
    out.append({'label': 'My unpacked files', 'path': UNPACKED})
    out.append({'label': 'My packed PBOs', 'path': PACKED})
    return {'ok': True, 'sources': out}


def mod_name(d):
    for fn in ('meta.cpp', 'mod.cpp'):
        p = os.path.join(d, fn)
        if os.path.isfile(p):
            m = re.search(r'name\s*=\s*"([^"]*)"', open(p, encoding='utf-8', errors='replace').read())
            if m:
                return m.group(1)
    return ''


def fs_list(q):
    d = (q.get('dir') or [''])[0]
    if not d or not os.path.isdir(d):
        return {'ok': False, 'error': 'Folder not found: ' + d}
    dirs, pbos, files = [], [], 0
    try:
        names = sorted(os.listdir(d), key=str.lower)
    except OSError as e:
        return {'ok': False, 'error': str(e)}
    for n in names:
        p = os.path.join(d, n)
        if os.path.isdir(p):
            dirs.append({'name': n, 'label': mod_name(p)})
        elif n.lower().endswith('.pbo'):
            pbos.append({'name': n, 'size': os.path.getsize(p)})
        else:
            files += 1
    parent = os.path.dirname(d.rstrip('\\/'))
    return {'ok': True, 'dir': d, 'parent': parent if parent != d else '', 'dirs': dirs[:2000], 'pbos': pbos, 'files': files,
            'hasConfig': os.path.isfile(os.path.join(d, 'config.cpp')) or os.path.isfile(os.path.join(d, 'config.bin')),
            'prefix': prefix_of_folder(d)}


def pbo_info(q):
    path = (q.get('path') or [''])[0]
    if not path.lower().endswith('.pbo') or not os.path.isfile(path):
        return {'ok': False, 'error': 'PBO not found: ' + path}
    try:
        props, ents = pbo_read_index(path)
    except Exception as e:
        return {'ok': False, 'error': 'Could not read this PBO (damaged or protected): %s' % e}
    exts = {}
    for e in ents:
        x = os.path.splitext(e[0])[1].lower() or '(none)'
        exts[x] = exts.get(x, 0) + 1
    return {'ok': True, 'path': path, 'props': props, 'count': len(ents), 'exts': exts,
            'files': [[e[0], e[3], e[4]] for e in ents[:3000]], 'size': os.path.getsize(path)}


def pbo_unpack(body):
    path = str(body.get('path', ''))
    if not path.lower().endswith('.pbo') or not os.path.isfile(path):
        return {'ok': False, 'error': 'PBO not found: ' + path}
    base = os.path.splitext(os.path.basename(path))[0]
    dest = str(body.get('dest') or os.path.join(UNPACKED, base))
    try:
        props, ents = pbo_read_index(path)
    except Exception as e:
        return {'ok': False, 'error': 'Could not read this PBO (damaged or protected): %s' % e}
    os.makedirs(dest, exist_ok=True)
    written, skipped, configs = 0, [], []
    for ent in ents:
        rel = safe_rel(ent[0])
        if not rel:
            continue
        out = os.path.join(dest, rel)
        if not os.path.abspath(out).startswith(os.path.abspath(dest)):
            skipped.append(ent[0])
            continue
        try:
            data = pbo_entry_bytes(path, ent)
        except Exception:
            skipped.append(ent[0])
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'wb') as f:
            f.write(data)
        written += 1
        if os.path.basename(out).lower() == 'config.bin':
            cpp = os.path.join(os.path.dirname(out), 'config.cpp')
            how = ''
            if not os.path.isfile(cpp):
                if debin_cfgconvert(out, cpp):
                    how = 'CfgConvert'
                else:
                    try:
                        open(cpp, 'w', encoding='utf-8').write('\n'.join(cpp_from_rap(read_rap(data))) + '\n')
                        how = 'built-in reader'
                    except Exception:
                        how = ''
            if how:
                configs.append({'file': os.path.relpath(cpp, dest), 'how': how})
    if props.get('prefix'):
        with open(os.path.join(dest, '$PBOPREFIX$'), 'w') as f:
            f.write(props['prefix'])
    return {'ok': True, 'dest': dest, 'written': written, 'skipped': skipped[:50], 'configs': configs, 'prefix': props.get('prefix', '')}


def prefix_of_folder(d):
    for fn in ('$PBOPREFIX$', '$PBOPREFIX$.txt'):
        p = os.path.join(d, fn)
        if os.path.isfile(p):
            t = open(p, encoding='utf-8', errors='replace').read().strip()
            m = re.search(r'prefix\s*=\s*(.+)', t)
            return (m.group(1) if m else t.splitlines()[0] if t else '').strip()
    return ''


def pbo_pack(body):
    src = str(body.get('src', ''))
    if not os.path.isdir(src):
        return {'ok': False, 'error': 'Folder not found: ' + src}
    name = re.sub(r'[^A-Za-z0-9_\-]', '', str(body.get('name') or os.path.basename(src.rstrip('\\/')))) or 'addon'
    prefix = str(body.get('prefix') or prefix_of_folder(src) or name).strip().strip('\\')
    mod_dir = str(body.get('modDir') or os.path.join(PACKED, '@' + name))
    out = os.path.join(mod_dir, 'addons', name + '.pbo')
    stage = os.path.join(PACKED, '_stage_' + name)
    shutil.rmtree(stage, ignore_errors=True)
    shutil.copytree(src, stage, ignore=shutil.ignore_patterns('$PBOPREFIX$', '$PBOPREFIX$.txt', '*.bak', '.git', 'Thumbs.db'))
    note, binarized = '', False
    cpp = os.path.join(stage, 'config.cpp')
    if os.path.isfile(cpp) and os.path.isfile(os.path.join(stage, 'config.bin')):
        os.remove(os.path.join(stage, 'config.bin'))   # unpacked folders hold both: the (edited) config.cpp wins
    if body.get('binarize', True) and os.path.isfile(cpp):
        env = H['find_env']()
        if env.get('cfgConvert'):
            r = subprocess.run([env['cfgConvert'], '-bin', '-dst', os.path.join(stage, 'config.bin'), cpp], capture_output=True, text=True, timeout=120)
            if os.path.isfile(os.path.join(stage, 'config.bin')):
                os.remove(cpp)
                binarized = True
            else:
                shutil.rmtree(stage, ignore_errors=True)
                return {'ok': False, 'error': 'config.cpp has an error (CfgConvert): ' + (r.stdout + r.stderr).strip()[:400]}
        else:
            note = 'config.cpp packed as text (DayZ Tools not found)'
    H['pack_pbo'](stage, prefix, out)
    shutil.rmtree(stage, ignore_errors=True)
    res = {'ok': True, 'pbo': out, 'modDir': mod_dir, 'prefix': prefix, 'size': os.path.getsize(out), 'binarized': binarized, 'note': note}
    key = re.sub(r'[^A-Za-z0-9_]', '', str(body.get('key') or ''))
    if key:
        res['sign'] = H['sign_pbo'](H['find_env'](), out, mod_dir, key)
    return res


# ================================================================== mod classes + models for the 3D view
MODS_DIR_NAME = 'mods'


def mods_dir():
    d = os.path.join(H['DATA'], MODS_DIR_NAME)
    os.makedirs(d, exist_ok=True)
    return d


def mod_pbos_in(path):
    if os.path.isfile(path) and path.lower().endswith('.pbo'):
        return [path]
    out = []
    for root, dirs, names in os.walk(path):
        if root[len(path):].count(os.sep) > 3:
            dirs[:] = []
            continue
        out += [os.path.join(root, n) for n in names if n.lower().endswith('.pbo')]
    return out


def collect_classes(cfg):
    """CfgVehicles of one config -> {class: [parent, scope or None, model or None]}"""
    cv = cfg.get('CfgVehicles')
    out = {}
    if not isinstance(cv, dict):
        return out
    for name, c in cv.items():
        if name.startswith('__') or not isinstance(c, dict) or c.get('__extern'):
            continue
        sc = c.get('scope')
        md = c.get('model')
        out[name] = [c.get('__parent', ''), int(sc) if isinstance(sc, (int, float)) else None, md if isinstance(md, str) and md else None]
    return out


def pbo_models(body):
    """register a mod (folder or PBOs): its CfgVehicles classes go into data/mods/classes_mods.csv (asset list) and
    its PBOs into data/mods/pbos.json (3D models are then built on demand like vanilla ones)"""
    path = str(body.get('path', ''))
    if not os.path.exists(path):
        return {'ok': False, 'error': 'Not found: ' + path}
    pbos = mod_pbos_in(path)
    if not pbos:
        return {'ok': False, 'error': 'No PBOs in ' + path}
    found, errors = {}, []
    for p in pbos:
        try:
            _props, ents = pbo_read_index(p)
        except Exception as e:
            errors.append('%s: %s' % (os.path.basename(p), e))
            continue
        for ent in ents:
            low = ent[0].lower().replace('/', '\\')
            if low.split('\\')[-1] not in ('config.bin', 'config.cpp'):
                continue
            try:
                data = pbo_entry_bytes(p, ent)
                cfg = read_rap(data) if data[:4] == b'\0raP' else read_cpp(data.decode('utf-8', errors='replace'))
                found.update(collect_classes(cfg))
            except Exception as e:
                errors.append('%s/%s: %s' % (os.path.basename(p), ent[0], e))
    # resolve scope / model inherited from other classes of the same mod
    def resolve(c, k, seen=0):
        v = found[c][k]
        if v is None and seen < 30 and found[c][0] in found:
            return resolve(found[c][0], k, seen + 1)
        return v
    rows = {}
    for c in found:
        sc, md = resolve(c, 1), resolve(c, 2)
        if md:
            rows[c] = '%s,%s,%d,%s' % (c, found[c][0], 2 if sc is None else sc, md.replace(',', ''))
    d = mods_dir()
    csv = os.path.join(d, 'classes_mods.csv')
    old = {}
    if os.path.isfile(csv):
        for ln in open(csv, encoding='utf-8', errors='replace'):
            if ln.strip():
                old[ln.split(',')[0]] = ln.rstrip('\n')
    old.update(rows)
    with open(csv, 'w', encoding='utf-8') as f:
        f.write('\n'.join(old[k] for k in sorted(old)) + '\n')
    pj = os.path.join(d, 'pbos.json')
    reg = json.load(open(pj)) if os.path.isfile(pj) else []
    for p in pbos:
        if p not in reg:
            reg.append(p)
    json.dump(reg, open(pj, 'w'), indent=1)
    return {'ok': True, 'classes': len(rows), 'pbos': len(pbos), 'errors': errors[:20], 'sample': sorted(rows)[:12]}


def mods_list():
    d = mods_dir()
    pj = os.path.join(d, 'pbos.json')
    reg = json.load(open(pj)) if os.path.isfile(pj) else []
    csv = os.path.join(d, 'classes_mods.csv')
    n = sum(1 for ln in open(csv, encoding='utf-8', errors='replace') if ln.strip()) if os.path.isfile(csv) else 0
    return {'ok': True, 'pbos': reg, 'classes': n}


def mods_clear():
    d = mods_dir()
    for fn in ('pbos.json', 'classes_mods.csv'):
        p = os.path.join(d, fn)
        if os.path.isfile(p):
            os.remove(p)
    return {'ok': True}


# ================================================================== script logs (live console)
def newest(dirs, pattern):
    best = None
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if fnmatch.fnmatch(fn.lower(), pattern):
                p = os.path.join(d, fn)
                if not best or os.path.getmtime(p) > os.path.getmtime(best):
                    best = p
    return best


def logs_tail(q):
    """the newest log of a source and what was added since `offset` (the console polls this)"""
    src = (q.get('src') or ['server'])[0]
    have = (q.get('file') or [''])[0]
    try:
        offset = int((q.get('offset') or ['0'])[0])
    except ValueError:
        offset = 0
    if src == 'server':
        path = newest([H['SRV_PROFILE']], 'script_*.log')
    elif src == 'server-rpt':
        path = newest([H['SRV_PROFILE']], '*.rpt')
    else:
        path = newest([H['PROFILE'], H['LOCAL_DAYZ']], 'script_*.log')
    alive = H['server_alive']()
    if not path:
        return {'ok': True, 'file': '', 'text': '', 'offset': 0, 'reset': True, 'serverRunning': alive}
    size = os.path.getsize(path)
    reset = path != have or offset > size
    if reset:
        offset = max(0, size - 96 * 1024)   # start with the last part of a long log
    end = min(size, offset + 256 * 1024)
    with open(path, 'rb') as f:
        f.seek(offset)
        data = f.read(end - offset)
    # never cut a line in half: keep a partial last line for the next poll
    if end < size or not data.endswith(b'\n'):
        cut = data.rfind(b'\n')
        if cut >= 0:
            data = data[:cut + 1]
            end = offset + cut + 1
    return {'ok': True, 'file': path, 'name': os.path.basename(path), 'text': data.decode('utf-8', errors='replace'),
            'offset': end, 'size': size, 'reset': reset, 'serverRunning': alive}


# ================================================================== custom node library (Documents/DayZStudio/Nodes)
NODES_DIR = os.path.join(DOCS, 'Nodes')


def nodes_list():
    out = []
    if os.path.isdir(NODES_DIR):
        for fn in sorted(os.listdir(NODES_DIR)):
            if fn.endswith('.json'):
                try:
                    j = json.load(open(os.path.join(NODES_DIR, fn), encoding='utf-8'))
                    if isinstance(j, dict) and j.get('id') and isinstance(j.get('code'), str):
                        out.append(j)
                except (OSError, ValueError):
                    continue
    return {'ok': True, 'nodes': out, 'dir': NODES_DIR}


def nodes_save(body):
    d = body.get('node') or {}
    nid = re.sub(r'[^A-Za-z0-9_]', '', str(d.get('id') or ''))
    if not nid or not isinstance(d.get('code'), str):
        return {'ok': False, 'error': 'nothing to save'}
    os.makedirs(NODES_DIR, exist_ok=True)
    d['id'] = nid
    json.dump(d, open(os.path.join(NODES_DIR, nid + '.json'), 'w', encoding='utf-8'), indent=1)
    return {'ok': True, 'id': nid, 'path': os.path.join(NODES_DIR, nid + '.json')}


def nodes_delete(body):
    nid = re.sub(r'[^A-Za-z0-9_]', '', str(body.get('id') or ''))
    p = os.path.join(NODES_DIR, nid + '.json')
    if nid and os.path.isfile(p):
        os.remove(p)
    return {'ok': True}


# ---- workspace profiles (js/workspace.js): the user's own layouts + shortcuts + toolbar + interface size, one file
#      each in Documents/DayZStudio/Workspaces - they survive updates and can be backed up or shared
PROFILES_DIR = os.path.join(DOCS, 'Workspaces')


def _profile_file(name):
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(name or '')).strip(' .')[:80]
    return os.path.join(PROFILES_DIR, stem + '.dzworkspace.json') if stem else None


def profiles_list():
    out = []
    if os.path.isdir(PROFILES_DIR):
        for fn in sorted(os.listdir(PROFILES_DIR)):
            if fn.endswith('.json'):
                try:
                    j = json.load(open(os.path.join(PROFILES_DIR, fn), encoding='utf-8'))
                    if isinstance(j, dict) and j.get('name') and isinstance(j.get('layout'), dict):
                        out.append(j)
                except (OSError, ValueError):
                    continue
    return {'ok': True, 'profiles': out, 'dir': PROFILES_DIR}


def profiles_save(body):
    p = body.get('profile') or {}
    f = _profile_file(p.get('name'))
    if not f or not isinstance(p.get('layout'), dict):
        return {'ok': False, 'error': 'nothing to save'}
    os.makedirs(PROFILES_DIR, exist_ok=True)
    p['saved'] = time.time()
    tmp = f + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(p, fh, indent=1)
    os.replace(tmp, f)
    return {'ok': True, 'path': f}


def profiles_delete(body):
    f = _profile_file(body.get('name'))
    if f and os.path.isfile(f):
        os.remove(f)
    return {'ok': True}


# every endpoint answers {'ok': False, 'error': ...} instead of dropping the connection (permissions, locked files...)
def _safe(fn):
    def run(*a, **k):
        try:
            return fn(*a, **k)
        except PermissionError as e:
            return {'ok': False, 'error': 'Windows refused access (%s). Close programs using the file, or run Studio as administrator.' % e}
        except Exception as e:
            return {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
    run.__name__ = fn.__name__
    return run


for _n in ('servercfg_get', 'servercfg_save', 'types_source', 'types_apply', 'pbo_sources', 'fs_list', 'pbo_info',
           'pbo_unpack', 'pbo_pack', 'pbo_models', 'mods_list', 'mods_clear', 'logs_tail', 'nodes_list', 'nodes_save',
           'nodes_delete', 'profiles_list', 'profiles_save', 'profiles_delete'):
    globals()[_n] = _safe(globals()[_n])
