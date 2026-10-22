#!/usr/bin/env node
/*
 * DayZ Studio - checks the Enforce Script the editor generates, without DayZ.
 *
 *   node tools/check_scripts.js            # the showcase project (every system) + every template
 *   node tools/check_scripts.js my.json    # also a saved project file (Documents/DayZStudio/Projects/*.dzstudio.json)
 *
 * Loads the editor's own modules in Node (tiny browser stubs), builds the quest mod exactly like "Build installable
 * mod" does and runs the whole-file checker (DS.Code.checkFile) over every generated script: control characters,
 * brackets / quotes / comments, reserved words used as names, the same local declared twice in one function.
 * Exits with 1 when anything is wrong (GitHub runs this on every push: .github/workflows/check.yml).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..');
const MODULES = ['util', 'data', 'state', 'validate', 'code', 'customnodes', 'conditions', 'runtime', 'exporters', 'traders', 'npcs', 'showcase'];

function loadStudio() {
  const noop = () => {};
  const el = () => ({ append: noop, appendChild: noop, setAttribute: noop, addEventListener: noop, style: {}, classList: { add: noop, remove: noop, toggle: noop }, remove: noop, click: noop });
  const store = {};
  const ctx = {
    console, setTimeout: (f) => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }), text: () => Promise.resolve('') }),
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    location: { search: '?nodisk', origin: 'http://localhost' },
    navigator: { sendBeacon: () => true },
    document: { createElement: el, createTextNode: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: el(), addEventListener: noop },
    Blob: function () {}, URL: { createObjectURL: () => '' },
  };
  ctx.window = ctx;
  ctx.window.addEventListener = noop;
  vm.createContext(ctx);
  MODULES.forEach((m) => {
    const f = path.join(APP, 'js', m + '.js');
    if (!fs.existsSync(f)) return;
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  });
  const DS = ctx.window.DS;
  DS.MapView = { center: () => ({ x: 7500, z: 7500 }), fit: noop };
  return DS;
}

function checkPayload(DS, label) {
  const p = DS.exporters.modPayload();
  const R = DS.RUNTIME;
  const files = {
    'DSQuests.c (Studio runtime)': p.core,
    'DSCustom.c (your scripts + generated data)': p.custom,
    'DSMission.c (mission hook)': p.hook,
    'DSPlaytest.c (editor play-test hook)': R.hookEditor || '',
    'config.cpp': p.config,
  };
  let errors = 0;
  Object.entries(files).forEach(([name, text]) => {
    const issues = DS.Code.checkFile(text).filter((i) => i.level === 'error');
    issues.slice(0, 20).forEach((i) => console.log(`  ✖ [${label}] ${name}: ${i.msg}`));
    errors += issues.length;
  });
  // the JSON files the server reads must parse
  try { JSON.parse(p.quests); } catch (e) { console.log(`  ✖ [${label}] quests.json does not parse: ${e.message}`); errors++; }
  if (p.factions) { try { JSON.parse(p.factions); } catch (e) { console.log(`  ✖ [${label}] factions.json does not parse: ${e.message}`); errors++; } }
  if (p.trade) { try { const t = JSON.parse(p.trade); if (!t.traders.length) throw new Error('no traders'); } catch (e) { console.log(`  ✖ [${label}] trade.json is broken: ${e.message}`); errors++; } }
  return errors;
}

function main() {
  const DS = loadStudio();
  const S = DS.store;
  let errors = 0;
  const runs = [];
  if (DS.Showcase) runs.push(['showcase', () => S.setProject(DS.Showcase.project({ x: 7500, z: 7500 }), true)]);
  runs.push(['empty project', () => S.setProject(S.blank(), true)]);
  process.argv.slice(2).forEach((f) => runs.push([path.basename(f), () => S.setProject(JSON.parse(fs.readFileSync(f, 'utf8')), true)]));
  runs.forEach(([label, load]) => {
    load();
    const n = checkPayload(DS, label);
    // the editor's own project check (validate.js) on top
    const probs = DS.validateAll ? DS.validateAll().filter((x) => x.level === 'error') : [];
    if (label === 'showcase') probs.forEach((x) => console.log(`  ✖ [${label}] project check: ${x.msg}`));
    const total = n + (label === 'showcase' ? probs.length : 0);
    console.log(`${total ? '✖' : '✔'} ${label}: ${total ? total + ' problem(s)' : 'generated scripts look fine'}`);
    errors += total;
  });
  process.exit(errors ? 1 : 0);
}

main();
