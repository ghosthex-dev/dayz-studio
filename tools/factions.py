"""
DayZ Studio - factions.json: the schema, strict validation and defaults.

The editor sends the project's faction settings when it builds the quest mod; this module checks them and writes
the exact file the in-game runtime reads ($profile:DZStudioQuests/factions.json, class DSFactionFile in DSQuests.c).
Field names and types here must match the Enforce classes DSFactionFile / DSTier / DSFaction / DSTerritory /
DSKillRule / DSGuard / DSRelation one to one - JsonFileLoader silently skips anything else.

    {
      "version": 1,
      "min": -1000, "max": 1000,                     # the standing scale, shared by every faction
      "tiers": [                                     # contiguous, ordered bands covering min..max
        {"id": "hostile",  "name": "Hostile",  "min": -1000, "max": -500, "color": -1754827,
         "stance": "hostile",  "discount": 0},
        {"id": "neutral",  "name": "Neutral",  "min": -499,  "max": 499,  "color": -5592406,
         "stance": "neutral",  "discount": 0},
        {"id": "friendly", "name": "Friendly", "min": 500,   "max": 1000, "color": -12207306,
         "stance": "friendly", "discount": 20}
      ],
      "factions": [
        {"id": "survivors", "name": "Survivors", "color": -11751600, "start": 0,
         "territories": [{"name": "Green Mountain camp", "x": 3700.0, "z": 5980.0, "radius": 250.0}],
         "kills": [{"victim": "@infected", "where": "territory", "victimTier": "", "amount": 2,   "text": ""},
                   {"victim": "@player",   "where": "territory", "victimTier": "", "amount": -150,
                    "text": "You killed someone in Survivor territory"}],
         "guard": {"warn": 40.0, "attack": 25.0, "damage": 0.35, "interval": 2.0,
                   "warnText": "Stay back!", "refuseText": "We don't talk to your kind."}}
      ],
      "relations": [{"from": "survivors", "to": "bandits", "factor": -0.5}]   # +100 Survivors => -50 Bandits
    }
"""
import json
import re
from dataclasses import asdict, dataclass, field
from typing import List

ID_RE = re.compile(r'^[a-z][a-z0-9_]{0,39}$')
STANCES = ('hostile', 'neutral', 'friendly')
WHERE = ('anywhere', 'territory', 'outside')
VICTIM_RE = re.compile(r'^(@infected|@animal|@player|[A-Za-z_][A-Za-z0-9_]*)$')
INT32 = 2 ** 31


class FactionError(ValueError):
    """all problems found in one pass, so the editor can list them together"""

    def __init__(self, errors):
        super().__init__('; '.join(errors))
        self.errors = errors


@dataclass
class Tier:
    id: str
    name: str
    min: int
    max: int
    color: int = -1
    stance: str = 'neutral'
    discount: int = 0


@dataclass
class Territory:
    name: str
    x: float
    z: float
    radius: float


@dataclass
class KillRule:
    victim: str
    where: str = 'anywhere'
    victimTier: str = ''
    amount: int = 0
    text: str = ''


@dataclass
class Guard:
    warn: float = 0.0
    attack: float = 0.0
    damage: float = 0.35
    interval: float = 2.0
    warnText: str = ''
    refuseText: str = ''


@dataclass
class Faction:
    id: str
    name: str
    color: int = -1
    start: int = 0
    territories: List[Territory] = field(default_factory=list)
    kills: List[KillRule] = field(default_factory=list)
    guard: Guard = field(default_factory=Guard)


@dataclass
class Relation:
    to: str
    factor: float
    # "from" is a Python keyword: kept as from_ here and renamed in to_json()
    from_: str = ''


@dataclass
class FactionFile:
    version: int = 1
    min: int = -1000
    max: int = 1000
    tiers: List[Tier] = field(default_factory=list)
    factions: List[Faction] = field(default_factory=list)
    relations: List[Relation] = field(default_factory=list)

    def to_json(self):
        d = asdict(self)
        d['relations'] = [{'from': r['from_'], 'to': r['to'], 'factor': r['factor']} for r in d['relations']]
        return json.dumps(d, indent=1, ensure_ascii=False)


# ------------------------------------------------------------------ parsing with strict checks
def _num(v, kind, where, errors, lo=None, hi=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        errors.append('%s must be a number' % where)
        return 0 if kind is int else 0.0
    if kind is int and v != int(v):
        errors.append('%s must be a whole number' % where)
    v = kind(v)
    if lo is not None and v < lo:
        errors.append('%s must be at least %s' % (where, lo))
    if hi is not None and v > hi:
        errors.append('%s must be at most %s' % (where, hi))
    return v


def _str(v, where, errors, max_len=200, allow_empty=True):
    if not isinstance(v, str):
        errors.append('%s must be text' % where)
        return ''
    if not allow_empty and not v.strip():
        errors.append('%s is empty' % where)
    if len(v) > max_len:
        errors.append('%s is longer than %d characters' % (where, max_len))
    if '|' in v:
        errors.append('%s may not contain "|" (it separates the fields of the network packet)' % where)
    return v


def _color(v, where, errors):
    c = _num(v, int, where, errors, -INT32, INT32 - 1)
    return c


def parse(obj) -> FactionFile:
    """dict (the editor's export) -> FactionFile, or FactionError listing every problem"""
    errors = []
    if not isinstance(obj, dict):
        raise FactionError(['the faction settings are not an object'])
    ff = FactionFile()
    ff.version = 1
    ff.min = _num(obj.get('min', -1000), int, 'Scale minimum', errors, -100000, 100000)
    ff.max = _num(obj.get('max', 1000), int, 'Scale maximum', errors, -100000, 100000)
    if ff.max <= ff.min:
        errors.append('The scale maximum must be larger than the minimum')

    # tiers: unique ids, ordered, contiguous, covering the whole scale
    seen = set()
    for i, t in enumerate(obj.get('tiers') or []):
        w = 'Tier %d' % (i + 1)
        if not isinstance(t, dict):
            errors.append(w + ' is not an object')
            continue
        tid = _str(t.get('id', ''), w + ' id', errors, 40, False)
        if tid and not ID_RE.match(tid):
            errors.append('%s id "%s" may only use a-z, 0-9 and _ and must start with a letter' % (w, tid))
        if tid in seen:
            errors.append('Two tiers share the id "%s"' % tid)
        seen.add(tid)
        tier = Tier(id=tid, name=_str(t.get('name', ''), w + ' name', errors, 40, False),
                    min=_num(t.get('min'), int, w + ' minimum', errors), max=_num(t.get('max'), int, w + ' maximum', errors),
                    color=_color(t.get('color', -1), w + ' colour', errors),
                    stance=t.get('stance', 'neutral'), discount=_num(t.get('discount', 0), int, w + ' discount', errors, 0, 90))
        if tier.stance not in STANCES:
            errors.append('%s stance must be one of %s' % (w, ', '.join(STANCES)))
        if tier.max < tier.min:
            errors.append('%s ends (%d) before it starts (%d)' % (w, tier.max, tier.min))
        ff.tiers.append(tier)
    if not ff.tiers:
        errors.append('Add at least one tier')
    else:
        ts = sorted(ff.tiers, key=lambda t: t.min)
        if ts[0].min > ff.min:
            errors.append('No tier covers %d to %d' % (ff.min, ts[0].min - 1))
        if ts[-1].max < ff.max:
            errors.append('No tier covers %d to %d' % (ts[-1].max + 1, ff.max))
        for a, b in zip(ts, ts[1:]):
            if b.min <= a.max:
                errors.append('Tiers "%s" and "%s" overlap' % (a.name, b.name))
            elif b.min > a.max + 1:
                errors.append('No tier covers %d to %d (between "%s" and "%s")' % (a.max + 1, b.min - 1, a.name, b.name))
        ff.tiers = ts
    tier_ids = {t.id for t in ff.tiers}

    # factions
    fids = set()
    for i, f in enumerate(obj.get('factions') or []):
        w = 'Faction %d' % (i + 1)
        if not isinstance(f, dict):
            errors.append(w + ' is not an object')
            continue
        fid = _str(f.get('id', ''), w + ' id', errors, 40, False)
        name = _str(f.get('name', ''), w + ' name', errors, 60, False)
        w = 'Faction "%s"' % (name or fid or i + 1)
        if fid and not ID_RE.match(fid):
            errors.append('%s id "%s" may only use a-z, 0-9 and _ and must start with a letter' % (w, fid))
        if fid in fids:
            errors.append('Two factions share the id "%s"' % fid)
        fids.add(fid)
        fac = Faction(id=fid, name=name, color=_color(f.get('color', -1), w + ' colour', errors),
                      start=_num(f.get('start', 0), int, w + ' starting standing', errors, ff.min, ff.max))
        for j, t in enumerate(f.get('territories') or []):
            tw = '%s territory %d' % (w, j + 1)
            if not isinstance(t, dict):
                errors.append(tw + ' is not an object')
                continue
            fac.territories.append(Territory(name=_str(t.get('name', ''), tw + ' name', errors, 60),
                                             x=_num(t.get('x'), float, tw + ' X', errors, 0, 30000),
                                             z=_num(t.get('z'), float, tw + ' Z', errors, 0, 30000),
                                             radius=_num(t.get('radius'), float, tw + ' radius', errors, 1, 10000)))
        for j, k in enumerate(f.get('kills') or []):
            kw = '%s kill rule %d' % (w, j + 1)
            if not isinstance(k, dict):
                errors.append(kw + ' is not an object')
                continue
            rule = KillRule(victim=_str(k.get('victim', ''), kw + ' victim', errors, 80, False),
                            where=k.get('where', 'anywhere'), victimTier=_str(k.get('victimTier', ''), kw + ' victim tier', errors, 40),
                            amount=_num(k.get('amount', 0), int, kw + ' amount', errors, -100000, 100000),
                            text=_str(k.get('text', ''), kw + ' message', errors, 120))
            if rule.victim and not VICTIM_RE.match(rule.victim):
                errors.append('%s victim "%s" is not @infected, @animal, @player or a class name' % (kw, rule.victim))
            if rule.where not in WHERE:
                errors.append('%s "where" must be one of %s' % (kw, ', '.join(WHERE)))
            if rule.where != 'anywhere' and not fac.territories:
                errors.append('%s counts kills %s the territory, but the faction has no territory' % (kw, 'inside' if rule.where == 'territory' else 'outside'))
            if rule.victimTier and rule.victim != '@player':
                errors.append('%s: "victim standing" only works for @player' % kw)
            if rule.victimTier and rule.victimTier not in tier_ids:
                errors.append('%s uses the tier "%s", which does not exist' % (kw, rule.victimTier))
            if rule.amount == 0:
                errors.append('%s changes the standing by 0' % kw)
            fac.kills.append(rule)
        g = f.get('guard') or {}
        if not isinstance(g, dict):
            errors.append(w + ' NPC behaviour is not an object')
            g = {}
        fac.guard = Guard(warn=_num(g.get('warn', 0), float, w + ' warning distance', errors, 0, 500),
                          attack=_num(g.get('attack', 0), float, w + ' shooting distance', errors, 0, 500),
                          damage=_num(g.get('damage', 0.35), float, w + ' damage', errors, 0, 1),
                          interval=_num(g.get('interval', 2), float, w + ' seconds between shots', errors, 1, 60),
                          warnText=_str(g.get('warnText', ''), w + ' warning text', errors, 160),
                          refuseText=_str(g.get('refuseText', ''), w + ' refusal text', errors, 160))
        if fac.guard.attack > fac.guard.warn:
            errors.append('%s shoots from further away (%g m) than it warns (%g m)' % (w, fac.guard.attack, fac.guard.warn))
        ff.factions.append(fac)

    # relations: known factions, no self-relation, one entry per pair
    pairs = set()
    for i, r in enumerate(obj.get('relations') or []):
        w = 'Relation %d' % (i + 1)
        if not isinstance(r, dict):
            errors.append(w + ' is not an object')
            continue
        rel = Relation(from_=r.get('from', ''), to=r.get('to', ''), factor=_num(r.get('factor', 0), float, w + ' factor', errors, -1, 1))
        if rel.from_ not in fids or rel.to not in fids:
            errors.append('%s links a faction that does not exist ("%s" -> "%s")' % (w, rel.from_, rel.to))
        if rel.from_ == rel.to:
            errors.append('%s links "%s" with itself' % (w, rel.from_))
        if (rel.from_, rel.to) in pairs:
            errors.append('%s: "%s" -> "%s" is listed twice' % (w, rel.from_, rel.to))
        pairs.add((rel.from_, rel.to))
        if rel.factor != 0:
            ff.relations.append(rel)
    if errors:
        raise FactionError(errors)
    return ff


def default_file() -> FactionFile:
    """the three-tier scale from the design doc: -1000..-500 Hostile, -499..499 Neutral, 500..1000 Friendly"""
    return FactionFile(tiers=[
        Tier('hostile', 'Hostile', -1000, -500, -1754827, 'hostile', 0),
        Tier('neutral', 'Neutral', -499, 499, -5592406, 'neutral', 0),
        Tier('friendly', 'Friendly', 500, 1000, -12207306, 'friendly', 20),
    ])


def validate_text(text):
    """the editor's JSON text -> (file text for the server, None) or (None, [errors])"""
    try:
        obj = json.loads(text)
    except ValueError as e:
        return None, ['the faction settings are not valid JSON: %s' % e]
    try:
        return parse(obj).to_json(), None
    except FactionError as e:
        return None, e.errors


if __name__ == '__main__':
    # quick self-check: python tools/factions.py
    d = json.loads(default_file().to_json())
    d['factions'] = [{'id': 'survivors', 'name': 'Survivors', 'start': 0, 'kills': [{'victim': '@infected', 'amount': 1}]},
                     {'id': 'bandits', 'name': 'Bandits', 'start': -100}]
    d['relations'] = [{'from': 'survivors', 'to': 'bandits', 'factor': -0.5}]
    out, err = validate_text(json.dumps(d))
    print('valid:', err is None, err or '')
    bad = dict(d, tiers=d['tiers'][:2])
    caught = validate_text(json.dumps(bad))[1]
    print('missing tier caught:', caught)
    if err is not None or not caught:
        raise SystemExit(1)
