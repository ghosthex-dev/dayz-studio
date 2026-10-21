"""DayZ Studio - publish a built quest mod to the Steam Workshop.

Uses the Steamworks library that ships with DayZ (steam_api64.dll, flat ISteamUGC API) through the Steam client the
user is already logged into - the same route DayZ Tools' Publisher takes, without its window.

Two halves:
  * the studio server imports this module: workshop_status() / workshop_publish(body) / workshop_progress()
    stage a clean content folder (addons + keys + mod.cpp - never the private key) and run the helper below;
  * the helper runs as its own process ("python workshop.py <job.json>") because SteamAPI_Init ties a process to
    DayZ in Steam ("playing DayZ") until it exits. It prints one JSON object per line: progress, then done / error.
"""
import base64, ctypes, json, os, re, shutil, subprocess, sys, threading, time

DAYZ_APPID = 221100
VISIBILITY = {'public': 0, 'friends': 1, 'private': 2, 'unlisted': 3}
# DayZ Workshop tags: "Mod" is the type the launcher lists; the rest are the "Mod Type" filters on the Workshop
TAGS = ['Mechanics', 'Economy', 'Environment', 'Equipment', 'Character', 'Vehicle', 'Sound', 'Props', 'Animation', 'Terrain']
TITLE_MAX, DESC_MAX, NOTE_MAX, PREVIEW_MAX = 128, 8000, 8000, 1024 * 1024
RESULTS = {2: 'Steam reported a generic failure', 3: 'no connection to Steam', 8: 'Steam rejected a value (title, tags or '
           'description)', 9: 'the content folder or preview image was not found', 10: 'Steam is busy - try again in a minute',
           15: 'access denied - is this Workshop item owned by the Steam account that is logged in?', 16: 'Steam timed out',
           17: 'this Steam account is banned from the Workshop', 21: 'not logged in to Steam', 25: 'the Workshop rejected the '
           'size of the item (preview over 1 MB?)', 33: 'Steam is busy - try again in a minute', 36: 'a file in the mod is '
           'locked (DayZ or the local server using it?)'}


# ------------------------------------------------------------------ the helper process
class CreateItemResult(ctypes.Structure):          # k_iSteamUGCCallbacks + 3
    _fields_ = [('result', ctypes.c_int32), ('id', ctypes.c_uint64), ('legal', ctypes.c_bool)]


class SubmitItemUpdateResult(ctypes.Structure):    # k_iSteamUGCCallbacks + 4
    _fields_ = [('result', ctypes.c_int32), ('legal', ctypes.c_bool), ('id', ctypes.c_uint64)]


class StringArray(ctypes.Structure):               # SteamParamStringArray_t
    _fields_ = [('strings', ctypes.POINTER(ctypes.c_char_p)), ('count', ctypes.c_int32)]


def say(**kv):
    print(json.dumps(kv), flush=True)


def helper(job_path):
    with open(job_path, encoding='utf-8') as f:
        job = json.load(f)
    # Steam reads the app id from steam_appid.txt in the working folder (or SteamAppId) - DayZ, like the Publisher
    work = os.path.dirname(os.path.abspath(job_path))
    with open(os.path.join(work, 'steam_appid.txt'), 'w') as f:
        f.write(str(DAYZ_APPID))
    os.chdir(work)
    os.environ['SteamAppId'] = os.environ['SteamGameId'] = str(DAYZ_APPID)
    try:
        api = ctypes.CDLL(job['dll'])
    except OSError as e:
        return say(stage='error', error='Could not load DayZ\'s Steam library: %s' % e)
    u64, vp, cp, b = ctypes.c_uint64, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_bool

    def fn(name, res, *args):
        f_ = getattr(api, name)
        f_.restype, f_.argtypes = res, list(args)
        return f_
    init = fn('SteamAPI_Init', b)
    shutdown = fn('SteamAPI_Shutdown', None)
    run_callbacks = fn('SteamAPI_RunCallbacks', None)
    ugc = fn('SteamAPI_SteamUGC_v017', vp)
    utils = fn('SteamAPI_SteamUtils_v010', vp)
    create = fn('SteamAPI_ISteamUGC_CreateItem', u64, vp, ctypes.c_uint32, ctypes.c_int)
    start = fn('SteamAPI_ISteamUGC_StartItemUpdate', u64, vp, ctypes.c_uint32, u64)
    set_title = fn('SteamAPI_ISteamUGC_SetItemTitle', b, vp, u64, cp)
    set_desc = fn('SteamAPI_ISteamUGC_SetItemDescription', b, vp, u64, cp)
    set_vis = fn('SteamAPI_ISteamUGC_SetItemVisibility', b, vp, u64, ctypes.c_int)
    set_tags = fn('SteamAPI_ISteamUGC_SetItemTags', b, vp, u64, ctypes.POINTER(StringArray))
    set_content = fn('SteamAPI_ISteamUGC_SetItemContent', b, vp, u64, cp)
    set_preview = fn('SteamAPI_ISteamUGC_SetItemPreview', b, vp, u64, cp)
    submit = fn('SteamAPI_ISteamUGC_SubmitItemUpdate', u64, vp, u64, cp)
    progress = fn('SteamAPI_ISteamUGC_GetItemUpdateProgress', ctypes.c_int, vp, u64, ctypes.POINTER(u64), ctypes.POINTER(u64))
    completed = fn('SteamAPI_ISteamUtils_IsAPICallCompleted', b, vp, u64, ctypes.POINTER(b))
    call_result = fn('SteamAPI_ISteamUtils_GetAPICallResult', b, vp, u64, vp, ctypes.c_int, ctypes.c_int, ctypes.POINTER(b))

    if not init():
        return say(stage='error', error='Steam is not running or not logged in (or this account does not own DayZ). '
                                        'Start Steam, log in and try again.')
    try:
        U, T = ugc(), utils()
        if not U or not T:
            return say(stage='error', error='Steam did not provide the Workshop interface')
        if job.get('dryRun'):
            return say(stage='done', id=0, dryRun=True)

        def wait(call, struct, cb_id, on_tick=None):
            failed = b(False)
            while not completed(T, call, ctypes.byref(failed)):
                run_callbacks()
                if on_tick:
                    on_tick()
                time.sleep(0.25)
            r = struct()
            if not call_result(T, call, ctypes.byref(r), ctypes.sizeof(r), cb_id, ctypes.byref(failed)) or failed.value:
                raise RuntimeError('Steam did not answer the request')
            return r

        item = int(job.get('id') or 0)
        legal = False
        if not item:
            say(stage='creating')
            r = wait(create(U, DAYZ_APPID, 0), CreateItemResult, 3403)      # 0 = k_EWorkshopFileTypeCommunity
            if r.result != 1:
                return say(stage='error', error='Could not create the Workshop item: ' + RESULTS.get(r.result, 'Steam error %d' % r.result))
            item, legal = int(r.id), bool(r.legal)
            say(stage='created', id=str(item), legal=legal)
        h = start(U, DAYZ_APPID, item)
        enc = lambda s: str(s).encode('utf-8')
        ok = set_title(U, h, enc(job['title'])) and set_desc(U, h, enc(job['description'])) \
            and set_vis(U, h, VISIBILITY.get(job.get('visibility'), 2)) and set_content(U, h, enc(job['content']))
        tags = [enc(t) for t in job.get('tags', [])]
        arr = (ctypes.c_char_p * len(tags))(*tags)
        ok = ok and set_tags(U, h, ctypes.byref(StringArray(arr, len(tags))))
        if job.get('preview'):
            ok = ok and set_preview(U, h, enc(job['preview']))
        if not ok:
            return say(stage='error', id=str(item), error='Steam refused the item settings (title, tags, folder or preview)')
        last = [None]

        def tick():
            done_, total = u64(0), u64(0)
            st = progress(U, h, ctypes.byref(done_), ctypes.byref(total))
            cur = (st, done_.value, total.value)
            if cur != last[0]:
                last[0] = cur
                say(stage=['', 'preparing', 'preparing', 'uploading', 'preview', 'committing'][st] if 0 <= st <= 5 else 'uploading',
                    done=done_.value, total=total.value, id=str(item))
        say(stage='preparing', id=str(item))
        r = wait(submit(U, h, enc(job.get('changeNote') or '')), SubmitItemUpdateResult, 3404, tick)
        if r.result != 1:
            return say(stage='error', id=str(item), error='Upload failed: ' + RESULTS.get(r.result, 'Steam error %d' % r.result))
        say(stage='done', id=str(item), legal=legal or bool(r.legal))
    except Exception as e:
        say(stage='error', error=str(e))
    finally:
        shutdown()


# ------------------------------------------------------------------ studio server side
_cfg = {}
job = {'running': False, 'stage': 'idle', 'log': []}
_lock = threading.Lock()


def setup(cfg):
    """find_env, BUILD_DIR, steam_running from the studio server"""
    _cfg.update(cfg)


def _dll():
    g = _cfg['find_env']().get('game')
    p = os.path.join(g, 'steam_api64.dll') if g else None
    return p if p and os.path.isfile(p) else None


def steam_running():
    try:
        out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq steam.exe', '/NH'], capture_output=True, text=True,
                             timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout
        return 'steam.exe' in out.lower()
    except Exception:
        return True   # can't tell - let Steam itself answer


def workshop_status():
    return {'ok': True, 'steam': steam_running(), 'dll': bool(_dll()), 'tags': TAGS, 'job': workshop_progress()['job']}


def workshop_progress():
    with _lock:
        return {'ok': True, 'job': {k: v for k, v in job.items() if k != 'log'} | {'log': job['log'][-20:]}}


def _stage_content(name):
    """copy the built @name into a clean Workshop folder: addons (PBOs + signatures), keys (.bikey), mod.cpp"""
    src = os.path.join(_cfg['BUILD_DIR'], '@' + name)
    if not os.path.isdir(os.path.join(src, 'addons')):
        return None, 'The mod has not been built yet'
    dst = os.path.join(_cfg['BUILD_DIR'], '_workshop', '@' + name)
    shutil.rmtree(dst, ignore_errors=True)
    os.makedirs(dst)
    for sub, keep in (('addons', ('.pbo', '.bisign')), ('keys', ('.bikey',))):
        d = os.path.join(src, sub)
        if os.path.isdir(d):
            os.makedirs(os.path.join(dst, sub))
            for fn in os.listdir(d):
                if fn.lower().endswith(keep):
                    shutil.copy2(os.path.join(d, fn), os.path.join(dst, sub, fn))
    if os.path.isfile(os.path.join(src, 'mod.cpp')):
        shutil.copy2(os.path.join(src, 'mod.cpp'), os.path.join(dst, 'mod.cpp'))
    if not any(f.lower().endswith('.pbo') for f in os.listdir(os.path.join(dst, 'addons'))):
        return None, 'The built mod has no PBO'
    return dst, None


def _preview(data_url, name):
    m = re.match(r'data:image/(png|jpe?g);base64,(.+)$', data_url or '', re.S)
    if not m:
        return None, None
    raw = base64.b64decode(m.group(2))
    if len(raw) > PREVIEW_MAX:
        return None, 'The preview image is over 1 MB - pick a smaller one'
    p = os.path.join(_cfg['BUILD_DIR'], '_workshop', '%s_preview.%s' % (name, 'png' if m.group(1) == 'png' else 'jpg'))
    with open(p, 'wb') as f:
        f.write(raw)
    return p, None


def workshop_publish(body):
    with _lock:
        if job['running']:
            return {'ok': False, 'error': 'A Workshop upload is already running'}
    name = re.sub(r'[^A-Za-z0-9_]', '', str(body.get('name', '')))
    title = str(body.get('title', '')).strip()
    desc = str(body.get('description', ''))
    note = str(body.get('changeNote', ''))
    item = re.sub(r'\D', '', str(body.get('id') or ''))
    if not name or not title:
        return {'ok': False, 'error': 'The item needs a title'}
    if len(title) > TITLE_MAX or len(desc) > DESC_MAX or len(note) > NOTE_MAX:
        return {'ok': False, 'error': 'Title (max %d), description or change notes (max %d characters) too long' % (TITLE_MAX, DESC_MAX)}
    if body.get('visibility', 'private') not in VISIBILITY:
        return {'ok': False, 'error': 'unknown visibility'}
    dll = _dll()
    if not dll:
        return {'ok': False, 'error': 'DayZ was not found - it is needed for its Steam library (steam_api64.dll)'}
    content, err = _stage_content(name)
    if err:
        return {'ok': False, 'error': err}
    preview, err = _preview(body.get('preview'), name)
    if err:
        return {'ok': False, 'error': err}
    tags = ['Mod'] + [t for t in body.get('tags', []) if t in TAGS]
    work = os.path.join(_cfg['BUILD_DIR'], '_workshop', '_job')
    os.makedirs(work, exist_ok=True)
    jp = os.path.join(work, 'job.json')
    with open(jp, 'w', encoding='utf-8') as f:
        json.dump({'dll': dll, 'id': item, 'title': title, 'description': desc, 'changeNote': note, 'tags': tags,
                   'visibility': body.get('visibility', 'private'), 'content': content, 'preview': preview,
                   'dryRun': bool(body.get('dryRun'))}, f)
    with _lock:
        job.clear()
        job.update(running=True, stage='starting', id=item or None, done=0, total=0, error=None, legal=False, log=[],
                   started=time.time())
    proc = subprocess.Popen([sys.executable, '-I', os.path.abspath(__file__), jp], stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    def pump():
        for line in proc.stdout:
            line = line.strip()
            try:
                m = json.loads(line)
            except ValueError:
                with _lock:
                    job['log'].append(line)
                continue
            with _lock:
                job['stage'] = m.get('stage', job['stage'])
                for k in ('id', 'done', 'total', 'error', 'dryRun'):
                    if m.get(k) is not None:
                        job[k] = m[k]
                job['legal'] = job['legal'] or bool(m.get('legal'))
        proc.wait()
        with _lock:
            if job['stage'] not in ('done', 'error'):
                job.update(stage='error', error='The Steam helper stopped unexpectedly: ' + ' '.join(job['log'][-3:]))
            job['running'] = False
    threading.Thread(target=pump, daemon=True).start()
    return {'ok': True}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: workshop.py <job.json>')
    helper(sys.argv[1])
