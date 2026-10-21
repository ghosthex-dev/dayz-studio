/* DayZ Studio - traders and money (📊 Player stats… ▸ 🛒 Traders): price lists that NPCs sell from and buy into, and
   the currencies they pay with. An NPC runs a trader through its "Trader" field; in game the conversation then offers
   "Let's trade." and opens the buy / sell screen (runtime: DSTradeUI, server: DSQuests.ServerTrade).
   S.project.trade = {
     traders:    [{ id, name, currency, items: [{ c, name, buy, sell, n, stock, cat, need, needText }] }],
     currencies: [{ id, name, symbol, kind: 'items' | 'stat', stat, items: [{ c, value }] }]   // besides the built-in dollars
   }  Exported as trade.json (exporters.js tradeJson). */
(function () {
  const DS = (window.DS = window.DS || {});
  const S = DS.store;
  const U = DS.util;
  const el = U.el;
  const R = (DS.Traders = {});
  let cur = 0;   // the trader shown in the editor
  const ch = () => S.changed('quests');
  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 't$1').slice(0, 40);

  R.data = function () {
    const P = S.project;
    if (!P.trade) P.trade = { traders: [], currencies: [] };
    if (!P.trade.traders) P.trade.traders = [];
    if (!P.trade.currencies) P.trade.currencies = [];
    return P.trade;
  };
  R.list = () => R.data().traders;
  /** [id, label] of every currency, the built-in dollars first */
  R.currencyOpts = () => [['dollars', 'Dollars - the $1 … $100 bills of the quest mod']]
    .concat(R.data().currencies.filter((c) => c.id && c.id !== 'dollars').map((c) => [c.id, c.name || c.id]));

  /** NPC nodes that run trader id: [{ quest, node }] */
  R.usedBy = (id) => S.project.quests.flatMap((q) => q.nodes.filter((n) => n.type === 'trg_npc' && n.p && n.p.trader === id).map((n) => ({ quest: q, node: n })));

  // a starting assortment of vanilla goods, priced in dollars (sell = what the trader pays the player)
  const EXAMPLE = [
    { cat: 'Food & drink', c: 'TunaCan', buy: 25, sell: 8 }, { cat: 'Food & drink', c: 'BakedBeansCan', buy: 20, sell: 6 },
    { cat: 'Food & drink', c: 'PeachesCan', buy: 20, sell: 6 }, { cat: 'Food & drink', c: 'WaterBottle', buy: 30, sell: 10 },
    { cat: 'Medical', c: 'BandageDressing', buy: 30, sell: 10 }, { cat: 'Medical', c: 'Rag', buy: 4, sell: 1 },
    { cat: 'Medical', c: 'Morphine', buy: 120, sell: 40 }, { cat: 'Medical', c: 'TetracyclineAntibiotics', buy: 90, sell: 30 },
    { cat: 'Tools', c: 'CanOpener', buy: 40, sell: 12 }, { cat: 'Tools', c: 'Matchbox', buy: 25, sell: 8 },
    { cat: 'Tools', c: 'Hatchet', buy: 120, sell: 35 }, { cat: 'Tools', c: 'Compass', buy: 80, sell: 25 },
    { cat: 'Ammunition', c: 'Ammo_762x39', n: 20, buy: 80, sell: 25 }, { cat: 'Ammunition', c: 'Mag_AKM_30Rnd', buy: 150, sell: 50 },
  ];
  const newItem = (o) => Object.assign({ c: '', name: '', buy: 0, sell: 0, n: 1, stock: '', cat: '', need: null, needText: '' }, o || {});

  /** problems for ✔ Check: [{ level, msg, target }] */
  R.problems = function () {
    const out = [];
    const T = R.data();
    const ids = new Set(T.traders.map((t) => t.id));
    T.traders.forEach((t) => {
      const tgt = { kind: 'stats', tab: 'traders' };
      if (!t.items.length) out.push({ level: 'warn', msg: `Trader “${t.name || t.id}” has nothing to buy or sell.`, target: tgt });
      t.items.forEach((i) => {
        if (!String(i.c || '').trim()) return out.push({ level: 'warn', msg: `Trader “${t.name || t.id}” has an item without a class.`, target: tgt });
        if (+i.sell > 0 && +i.buy > 0 && +i.sell > +i.buy) out.push({ level: 'warn', msg: `Trader “${t.name || t.id}” pays more for ${i.c} (${i.sell}) than it charges (${i.buy}) - players can buy and sell it back for free money.`, target: tgt });
        if (!(+i.sell > 0) && !(+i.buy > 0)) out.push({ level: 'info', msg: `Trader “${t.name || t.id}”: ${i.c} has no buy or sell price, so it never shows.`, target: tgt });
      });
      if (t.currency && t.currency !== 'dollars' && !T.currencies.some((c) => c.id === t.currency)) out.push({ level: 'error', msg: `Trader “${t.name || t.id}” uses a currency that no longer exists.`, target: tgt });
      if (!R.usedBy(t.id).length) out.push({ level: 'info', msg: `No NPC runs trader “${t.name || t.id}” yet - pick it in an NPC's “Trader” field.`, target: tgt });
    });
    T.currencies.forEach((c) => {
      const tgt = { kind: 'stats', tab: 'traders' };
      if (c.kind === 'stat' && !c.stat) out.push({ level: 'error', msg: `Currency “${c.name || c.id}” is a stat but none is picked.`, target: tgt });
      if (c.kind !== 'stat' && !(c.items || []).some((i) => i.c && +i.value > 0)) out.push({ level: 'error', msg: `Currency “${c.name || c.id}” has no money items with a value.`, target: tgt });
    });
    S.project.quests.forEach((q) => q.nodes.forEach((n) => {
      if (n.type === 'trg_npc' && n.p && n.p.trader && !ids.has(n.p.trader))
        out.push({ level: 'warn', msg: `NPC “${n.p.name || n.p.npc}” in “${q.name}” runs a trader that no longer exists.`, target: { kind: 'node', quest: q.id, id: n.id } });
    }));
    return out;
  };

  /* ---------------------------------------------------------------- the tab */
  R.tab = function (redraw) {
    const { txt, num, sel } = DS.Stats.ui;
    const T = R.data();
    const wrap = el('div', {});
    const later = (fn) => () => { fn(); ch(); S.commit(); redraw(); };
    wrap.append(el('div', { class: 'hint-box' }, 'A trader is a price list an NPC sells from and buys into. Give an NPC a trader in its “Trader” field: its conversation then offers “Let’s trade.”, which opens a buy / sell screen in game. Prices are in dollars - the quest mod’s own $1 … $100 bills that players carry (and can lose) - or in a currency you add below. Friendly tiers of the NPC’s faction get their discount on everything it sells.'));

    // ---- which trader
    if (cur >= T.traders.length) cur = Math.max(0, T.traders.length - 1);
    wrap.append(el('div', { class: 'btn-row st-row' },
      T.traders.map((t, i) => el('button', { class: 'btn sm' + (i === cur ? ' primary' : ''), onclick: () => { cur = i; redraw(); } }, '🛒 ' + (t.name || t.id))),
      el('button', { class: 'btn sm', onclick: later(() => {
        let k = T.traders.length + 1, id = 'trader' + k;
        while (T.traders.some((t) => t.id === id)) id = 'trader' + ++k;
        T.traders.push({ id, name: 'Trader ' + k, currency: 'dollars', items: [] });
        cur = T.traders.length - 1;
      }) }, '+ New trader')));

    const t = T.traders[cur];
    if (t) {
      if (!t.items) t.items = [];
      const used = R.usedBy(t.id);
      wrap.append(el('div', { class: 'ins-sec' },
        el('div', { class: 'btn-row st-row' },
          el('span', { class: 'ins-help' }, 'Name'), txt(t.name, (v) => { const auto = !t.id || t.id === slug(t.name); t.name = v; if (auto && !R.usedBy(t.id).length) t.id = slug(v) || t.id; ch(); }, 'Shown as the title of the trade screen'),
          el('span', { class: 'ins-help' }, 'Pays and charges in'), sel(t.currency || 'dollars', R.currencyOpts(), (v) => { t.currency = v; ch(); redraw(); }),
          el('button', { class: 'btn sm danger', title: 'Delete this trader', onclick: later(() => {
            if (used.length && !confirm(`Delete “${t.name || t.id}”? ${used.length} NPC(s) run it and lose their trade reply.`)) return;
            T.traders.splice(cur, 1);
            used.forEach((u) => { u.node.p.trader = ''; });
          }) }, '🗑 Delete')),
        el('div', { class: 'ins-help' }, used.length
          ? 'Run by: ' + used.map((u) => `${u.node.p.name || u.node.p.npc} (“${u.quest.name}”)`).join(', ')
          : 'No NPC runs this trader yet - open an NPC node (Quests view) and pick it in its “Trader” field.')));

      // ---- price list
      const head = el('div', { class: 'tr-row tr-head' }, ['Item class', 'Shown as', 'Player pays', 'Player gets', 'Pieces', 'Stock', 'Category', ''].map((h) => el('span', null, h)));
      const rows = t.items.map((it, i) => {
        const row = el('div', { class: 'tr-row' },
          txt(it.c, (v) => { it.c = v.trim(); ch(); }, 'TunaCan, AKM…', 'dz-classes'),
          txt(it.name, (v) => { it.name = v; ch(); }, '(the game’s name)'),
          num(it.buy, (v) => { it.buy = Math.max(0, Math.round(v)); ch(); }, 1, 80),
          num(it.sell, (v) => { it.sell = Math.max(0, Math.round(v)); ch(); }, 1, 80),
          num(it.n || 1, (v) => { it.n = Math.max(1, Math.round(v)); ch(); }, 1, 60),
          stockInp(it),
          txt(it.cat, (v) => { it.cat = v; ch(); }, 'Food, Ammo…', 'dz-trade-cats'),
          el('span', { class: 'btn-row' },
            el('button', { class: 'btn icon' + (it.need ? ' active' : ''), title: it.need ? 'Remove the requirement' : 'Only sell it to players who meet a condition (a stat, a quest, a faction standing…)', onclick: later(() => {
              // default: the first faction's top tier (e.g. only for Friendly players), else let the author pick
              const F = S.project.factions || {};
              const fac = (F.list || [])[0], tier = (F.tiers || [])[(F.tiers || []).length - 1];
              it.need = it.need ? null : (fac && tier ? { kind: 'reptier', var: fac.id, stat: tier.id } : { kind: '' });
            }) }, '🔒'),
            el('button', { class: 'btn icon', title: 'Move up', disabled: i === 0, onclick: later(() => { t.items.splice(i - 1, 0, t.items.splice(i, 1)[0]); }) }, '↑'),
            el('button', { class: 'btn icon', title: 'Delete', onclick: later(() => t.items.splice(i, 1)) }, '🗑')));
        if (!it.need) return row;
        return el('div', { class: 'tr-need-wrap' }, row, el('div', { class: 'tr-need' },
          el('span', { class: 'ins-label' }, 'Sold only if'), DS.Cond.widget(it.need, { onChange: ch, redraw }),
          txt(it.needText, (v) => { it.needText = v; ch(); }, 'Message, e.g. “Only for friends of the camp.”')));
      });
      const cats = [...new Set(T.traders.flatMap((x) => x.items.map((i) => i.cat)).filter(Boolean))];
      wrap.append(el('div', { class: 'ins-sec' },
        el('div', { class: 'ins-sec-title' }, 'Price list'),
        el('div', { class: 'ins-help' }, '“Player pays” 0 = not for sale, “Player gets” 0 = the trader doesn’t buy it. Pieces = how many per trade (e.g. 20 rounds of ammo). Stock = how many trades it has after each server restart (empty = endless); selling to it adds back. Items in a category are listed under that heading.'),
        el('datalist', { id: 'dz-trade-cats' }, cats.map((c) => el('option', { value: c }))),
        t.items.length ? head : null, rows,
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn sm primary', onclick: later(() => t.items.push(newItem())) }, '+ Item'),
          el('button', { class: 'btn sm', title: 'Food, medical, tools and ammo at sensible dollar prices', onclick: later(() => EXAMPLE.forEach((e) => { if (!t.items.some((i) => i.c === e.c)) t.items.push(newItem(e)); })) }, '+ Example goods'))));
    }

    // ---- currencies
    const own = T.currencies;
    const stats = (S.project.stats || []).map((s) => [s.id, s.name || s.id]);
    wrap.append(el('div', { class: 'ins-sec' },
      el('div', { class: 'ins-sec-title' }, 'Currencies'),
      el('div', { class: 'ins-help' }, 'Dollars are built in: the quest mod adds $1, $5, $10, $20, $50 and $100 bills (DSQ_Dollar1 … DSQ_Dollar100) that stack in the inventory; traders take any mix and give change. Add your own currency for a modded money item (its denominations and what each is worth) or for a balance kept as a player stat.'),
      own.map((c, i) => {
        if (!c.items) c.items = [];
        return el('div', { class: 'ins-sec tr-cur' },
          el('div', { class: 'btn-row st-row' },
            el('span', { class: 'ins-help' }, 'Name'), txt(c.name, (v) => { const auto = !c.id || c.id === slug(c.name); c.name = v; if (auto && !T.traders.some((x) => x.currency === c.id)) c.id = slug(v) || c.id; ch(); }, 'Rubles, Caps…'),
            el('span', { class: 'ins-help' }, 'Symbol'), txt(c.symbol, (v) => { c.symbol = v; ch(); }, '₽, €… (optional)'),
            sel(c.kind || 'items', [['items', 'Money items'], ['stat', 'A player stat (balance)']], (v) => { c.kind = v; ch(); redraw(); }),
            el('button', { class: 'btn icon', title: 'Delete this currency', onclick: later(() => { own.splice(i, 1); T.traders.forEach((x) => { if (x.currency === c.id) x.currency = 'dollars'; }); }) }, '🗑')),
          c.kind === 'stat'
            ? el('div', { class: 'btn-row st-row' }, el('span', { class: 'ins-help' }, 'Stat'), stats.length ? sel(c.stat || '', [['', 'Pick a stat…']].concat(stats), (v) => { c.stat = v; ch(); }) : el('span', { class: 'ins-help' }, 'Make a stat first (📊 Stats tab).'))
            : el('div', {}, c.items.map((m, j) => el('div', { class: 'btn-row st-row' },
              txt(m.c, (v) => { m.c = v.trim(); ch(); }, 'Money item class (e.g. a mod’s banknote)', 'dz-classes'),
              el('span', { class: 'ins-help' }, 'worth'), num(m.value, (v) => { m.value = Math.max(1, Math.round(v)); ch(); }, 1, 80),
              el('button', { class: 'btn icon', title: 'Delete', onclick: later(() => c.items.splice(j, 1)) }, '🗑'))),
            el('button', { class: 'btn sm', onclick: later(() => c.items.push({ c: '', value: 1 })) }, '+ Denomination')));
      }),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn sm', onclick: later(() => {
        let k = own.length + 1, id = 'currency' + k;
        while (own.some((c) => c.id === id)) id = 'currency' + ++k;
        own.push({ id, name: 'Currency ' + k, symbol: '', kind: 'items', stat: '', items: [{ c: '', value: 1 }] });
      }) }, '+ Currency'))));
    return wrap;

    function stockInp(it) {
      const i = el('input', { class: 'inp', type: 'number', min: 0, step: 1, value: it.stock === '' || it.stock == null || +it.stock < 0 ? '' : it.stock, placeholder: '∞', style: { width: '64px' }, title: 'Trades in stock after each restart - empty = endless' });
      i.addEventListener('input', () => { it.stock = i.value === '' ? '' : Math.max(0, Math.round(+i.value)); ch(); });
      i.addEventListener('change', () => S.commit());
      return i;
    }
  };
})();
