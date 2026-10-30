"""DayZ Studio - add-ons: extra feature packs in addons/<id>/ (next to Studio's files, and in Studio's data folder).

addon.json = {
  "id": "example", "name": "Example pack", "version": "1.0.0", "edition": "",
  "js": ["js/x.js"], "css": ["css/x.css"],      # loaded by the editor before it starts (js/addons.js)
  "server": "server.py",                        # optional: setup(helpers) -> {"POST name": fn(body), "GET name": fn(query)}
  "pip": ["package==1.0"],                       # Python packages the installer bundles for it (tools/make_installer.py)
  "updates": {"mode": "manual", "note": "...", "url": "..."}   # the desktop app does not update this build by itself
}
A route "POST tool/run" is served at /api/addons/<id>/tool/run, so add-ons never replace Studio's own routes.
Their files are served at /addons/<id>/<path>. A broken add-on is listed with its error and Studio carries on.
"""
import importlib.util
import json
import os
import re
import sys
import traceback

H = {}          # helpers from studio_server (setup)
ADDONS = []     # [{id, name, version, edition, dir, js, css, routes, error}]


def setup(helpers):
    H.update(helpers)
    scan()


def folders():
    out = []
    for base in (os.path.join(H['APP'], 'addons'), os.path.join(H['HOME'], 'addons')):
        b = os.path.normcase(os.path.abspath(base))
        if os.path.isdir(base) and b not in [os.path.normcase(os.path.abspath(x)) for x in out]:
            out.append(base)
    return out


def scan():
    ADDONS.clear()
    for base in folders():
        for name in sorted(os.listdir(base)):
            d = os.path.join(base, name)
            mf = os.path.join(d, 'addon.json')
            if not os.path.isfile(mf):
                continue
            a = {'dir': d, 'routes': {}, 'error': ''}
            try:
                with open(mf, encoding='utf-8') as f:
                    m = json.load(f)
            except (OSError, ValueError) as e:
                H['log']('add-on %s: unreadable addon.json (%s)' % (name, e))
                continue
            a['id'] = re.sub(r'[^A-Za-z0-9_-]', '', str(m.get('id') or name)) or name
            if any(x['id'] == a['id'] for x in ADDONS):
                continue   # the first one found wins (Studio's own folder before the data folder)
            a.update(name=str(m.get('name') or a['id']), version=str(m.get('version') or ''), edition=str(m.get('edition') or ''),
                     js=[str(x) for x in m.get('js') or []], css=[str(x) for x in m.get('css') or []], manifest=m)
            if m.get('server'):
                try:
                    a['routes'] = load_server(a, os.path.join(d, str(m['server'])))
                except Exception as e:
                    a['error'] = '%s: %s' % (type(e).__name__, e)
                    H['log']('add-on %s failed to start: %s\n%s' % (a['id'], e, traceback.format_exc()))
            ADDONS.append(a)
            H['log']('add-on %s %s loaded (%d route(s))%s' % (a['id'], a['version'], len(a['routes']), ' - ' + a['error'] if a['error'] else ''))


def load_server(a, path):
    """import the add-on's server module (its folder on sys.path, for its own modules) and register its routes"""
    if a['dir'] not in sys.path:
        sys.path.insert(0, a['dir'])
    spec = importlib.util.spec_from_file_location('dzs_addon_' + a['id'].replace('-', '_'), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    data = os.path.join(H['HOME'], 'addons-data', a['id'])   # its own settings and downloads (kept across updates)
    routes = mod.setup(dict(H, ADDON_DIR=a['dir'], ADDON_DATA=data, ADDON_ID=a['id'])) or {}
    out = {}
    for key, fn in routes.items():
        method, _, name = str(key).partition(' ')
        out['%s /api/addons/%s/%s' % (method.upper(), a['id'], name.strip('/'))] = fn
    return out


def listing():
    return [{'id': a['id'], 'name': a['name'], 'version': a['version'], 'edition': a['edition'], 'error': a['error'],
             'js': ['/addons/%s/%s' % (a['id'], x) for x in a['js']], 'css': ['/addons/%s/%s' % (a['id'], x) for x in a['css']]}
            for a in ADDONS]


def route(method, path):
    for a in ADDONS:
        fn = a['routes'].get('%s %s' % (method, path))
        if fn:
            return fn
    return None


def file_path(urlpath):
    """/addons/<id>/<file> -> the file on disk (inside its add-on folder), or None"""
    m = re.match(r'^/addons/([A-Za-z0-9_-]+)/(.+)$', urlpath)
    if not m:
        return None
    a = next((x for x in ADDONS if x['id'] == m.group(1)), None)
    if not a:
        return None
    from urllib.parse import unquote
    p = os.path.normpath(os.path.join(a['dir'], unquote(m.group(2))))
    return p if os.path.normcase(p).startswith(os.path.normcase(os.path.abspath(a['dir'])) + os.sep) else None
