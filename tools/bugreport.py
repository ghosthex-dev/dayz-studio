"""DayZ Studio - bug reports (File > Report a bug).

The report, Studio's own log, recent errors from the editor page, the newest DayZ game / DayZ Server logs and some
system info go into one zip in Documents/DayZStudio/BugReports. The reporter drags it into the GitHub issue the app
opens - Studio uploads nothing itself. The Windows user name is replaced in every file (paths like C:/Users/<name>/...).
"""
import getpass
import glob
import json
import os
import platform
import re
import subprocess
import sys
import time
import zipfile

H = {}   # helpers from studio_server (setup)
TAIL_LINES = 800          # of each game / server log
OUT_DIR = os.path.join(os.path.expanduser('~'), 'Documents', 'DayZStudio', 'BugReports')


def setup(helpers):
    H.update(helpers)


def redact(text):
    """the Windows user name out of paths and lines"""
    text = str(text or '')
    home = os.path.expanduser('~')
    for v in {home, home.replace('\\', '/'), home.replace('\\', '\\\\')}:
        text = re.sub(re.escape(v), '%USERPROFILE%', text, flags=re.I)
    try:
        user = getpass.getuser()
    except Exception:
        user = ''
    if len(user) >= 3:
        text = re.sub(r'(?i)(?<![A-Za-z0-9])' + re.escape(user) + r'(?![A-Za-z0-9])', '<user>', text)
    return text


def tail(path, lines=TAIL_LINES):
    """the last lines of a (possibly huge) log file"""
    try:
        size = os.path.getsize(path)
        with open(path, 'rb') as f:
            f.seek(max(0, size - 768 * 1024))
            data = f.read().decode('utf-8', 'replace')
    except OSError:
        return ''
    rows = data.splitlines()
    cut = len(rows) > lines
    rows = rows[-lines:]
    return ('[... earlier lines cut ...]\n' if cut else '') + '\n'.join(rows) + '\n'


def newest(patterns, max_age_h=None):
    best = None
    for pat in patterns:
        for p in glob.glob(pat):
            try:
                t = os.path.getmtime(p)
            except OSError:
                continue
            if max_age_h and time.time() - t > max_age_h * 3600:
                continue
            if not best or t > best[0]:
                best = (t, p)
    return best[1] if best else None


ERR_RE = re.compile(r"\(E\)|\berror\b|\bexception\b|traceback|can't compile|\bfailed\b|NULL pointer", re.I)
# everyday noise of vanilla DayZ (Central Economy, missing sound shaders, terrain placement) - not worth the excerpt
NOISE_RE = re.compile(r"\[CE\]|Sound set '|SoundShader|slopelandcontact|Xmas|ANIMATION \(E\): Can't load", re.I)


def error_lines(text, keep=12):
    """lines that look like errors (for the short excerpt in the issue)"""
    rows = [r.strip() for r in str(text or '').splitlines() if ERR_RE.search(r) and not NOISE_RE.search(r)]
    return rows[-keep:]


def system_info(body):
    env = H['find_env']()
    srv = H['find_server']()
    rows = [
        'DayZ Studio: %s (%s)' % (body.get('version') or '?', 'desktop app' if body.get('desktop') else 'browser'),
        'OS: %s' % platform.platform(),
        'Python: %s' % sys.version.split()[0],
        'Browser / shell: %s' % (body.get('ua') or '?'),
        'Screen: %s' % (body.get('screen') or '?'),
        'DayZ: %s' % ('found' if env.get('game') else 'NOT found'),
        'DayZ Tools: %s (CfgConvert %s)' % ('found' if env.get('tools') else 'NOT found', 'yes' if env.get('cfgConvert') else 'no'),
        'DayZ Server: %s' % ('found' if srv else 'not installed'),
        'Workshop mods (CF / Dabs / Editor): %s' % (', '.join(sorted(env.get('mods', {}).keys())) or 'none'),
        'Studio data folder: %s' % H['HOME'],
        'Maps with imagery: %s' % (', '.join(sorted(d for d in os.listdir(H['MAPS']) if os.path.isfile(os.path.join(H['MAPS'], d, 'overview.jpg')))) if os.path.isdir(H['MAPS']) else 'none'),
        'Project: %s' % (body.get('summary') or '?'),
    ]
    return '\n'.join(rows) + '\n'


def collect(body):
    """-> { ok, path, file, os, excerpt }"""
    rep = body.get('report') or {}
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = time.strftime('%Y-%m-%d_%H-%M-%S')
    name = 'dzstudio-bug-%s.zip' % stamp
    path = os.path.join(OUT_DIR, name)
    files = {}
    files['report.md'] = '# %s\n\n## What happened\n%s\n\n## Steps\n%s\n\n## Expected\n%s\n' % (
        rep.get('title', ''), rep.get('what', ''), rep.get('steps', ''), rep.get('expected', ''))
    files['system.txt'] = system_info(body)
    # Studio itself: its server log (rotated file) and the editor page's own errors
    log_file = H['LOG_FILE']
    studio = ''
    for p in (log_file + '.1', log_file):
        if os.path.isfile(p):
            studio += tail(p, 3000)
    files['studio-server.log'] = studio or '(no log file yet)\n'
    files['studio-page-errors.log'] = '\n'.join(body.get('console') or []) + '\n' if body.get('console') else '(no errors recorded on the page)\n'
    # DayZ: the game Studio started (viewport, capture) and the local DayZ Server, newest of each kind
    local = H['LOCAL_DAYZ']
    picks = [
        ('dayz-client.rpt', [os.path.join(local, 'DayZ_x64*.RPT'), os.path.join(H['PROFILE'], 'DayZ_x64*.RPT')]),
        ('dayz-client-script.log', [os.path.join(local, 'script*.log'), os.path.join(H['PROFILE'], 'script*.log')]),
        ('dayz-client-crash.log', [os.path.join(local, 'crash*.log'), os.path.join(H['PROFILE'], 'crash*.log')]),
        ('dayz-server.rpt', [os.path.join(H['SRV_PROFILE'], '*.RPT')]),
        ('dayz-server-script.log', [os.path.join(H['SRV_PROFILE'], 'script*.log')]),
    ]
    found = []
    for out, pats in picks:
        p = newest(pats, max_age_h=72)
        if p:
            files[out] = '(%s, %s)\n' % (os.path.basename(p), time.strftime('%Y-%m-%d %H:%M', time.localtime(os.path.getmtime(p)))) + tail(p)
            found.append(out)
    if body.get('project'):
        files['project.dzstudio.json'] = body['project'] if isinstance(body['project'], str) else json.dumps(body['project'])
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for fn, text in files.items():
            z.writestr(fn, redact(text) if fn != 'project.dzstudio.json' else text)
    # a short excerpt for the issue itself: error-looking lines from Studio, the page and the game logs
    # Studio's own errors first, then a few from each game log
    ex = []
    for fn, keep in [('studio-server.log', 6), ('studio-page-errors.log', 6)] + [(f, 3) for f in found]:
        for row in error_lines(files.get(fn, ''), keep):
            ex.append('[%s] %s' % (fn.split('.')[0], redact(row)[:240]))
    return {'ok': True, 'path': path, 'file': name, 'os': platform.platform(), 'excerpt': ex[:20], 'logs': found}


def reveal(body):
    """show the zip in Explorer, selected (only files in the bug report folder)"""
    p = os.path.abspath(str(body.get('path') or ''))
    if not p.lower().startswith(os.path.abspath(OUT_DIR).lower()) or not os.path.isfile(p):
        return {'ok': False, 'error': 'not a bug report'}
    subprocess.Popen(['explorer', '/select,', p])
    return {'ok': True}
