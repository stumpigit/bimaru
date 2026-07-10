#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'bimaru-harbor.html');
const DEPTH = path.join(ROOT, 'logical_depth_score.js');
const LIB = path.join(ROOT, 'bimaru-harbor-library.json');
const FOUND = path.join(ROOT, 'harbor_background_hard_expert_found.json');
const STATE = path.join(ROOT, 'harbor_background_hard_expert_state.json');
const TARGET = Number(process.argv[2] || 6);
const MAX_COMBOS = Number(process.argv[3] || 120);
const MAX_SECONDS = Number(process.argv[4] || 150);

function loadCtx() {
  const html = fs.readFileSync(HTML, 'utf8');
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  let js = match[1];
  js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
  js = js.replace(/newGame\(\);\s*$/, '');
  const sandbox = { console, Math, JSON, Date, setTimeout, clearTimeout };
  const dummyEl = () => ({ textContent:'', className:'', innerHTML:'', addEventListener(){}, appendChild(){}, classList:{add(){},remove(){}}, dataset:{}, style:{} });
  sandbox.document = { getElementById(){return dummyEl();}, querySelector(){return dummyEl();}, querySelectorAll(){return [];}, addEventListener(){}, createElement(){return dummyEl();} };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: HTML });
  return sandbox;
}
function loadDepth() {
  let code = fs.readFileSync(DEPTH, 'utf8').replace(/main\(\);\s*$/, 'module.exports={analyzePuzzle,classifyByLogicalDepth};');
  const sandbox = { console, require, module: { exports: {} }, exports: {}, __dirname: ROOT, __filename: DEPTH };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: DEPTH });
  return sandbox.module.exports;
}
function hist(commit, file) {
  try {
    return JSON.parse(execSync(`git -C ${ROOT} show ${commit}:${file}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  } catch {
    return [];
  }
}
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function clone(x){ return JSON.parse(JSON.stringify(x)); }
function clueStats(cl) {
  const vals = Object.values(cl || {});
  const islandVals = vals.filter(v => /^i/.test(v)).map(v => Number(v.slice(1))).sort((a,b)=>a-b);
  return {
    clues: vals.length,
    islands: islandVals.length,
    maxIsland: islandVals.length ? Math.max(...islandVals) : 0,
    ship: vals.filter(v => v === 's' || v === 'e' || v === 'm').length,
    water: vals.filter(v => v === 'w').length,
  };
}
function shapeKey(p) { return `${p.rc.join(',')}|${p.cc.join(',')}`; }
function displayDifficulty(p, a, s) {
  if (a.logicalDepth >= 8) return 'expert';
  if (a.logicalDepth >= 5) return 'hard';
  if (a.logicalDepth >= 2 || a.pctDepthGe2 >= 10) return 'medium';
  return 'easy';
}
function score(p, a, s) {
  let v = 0;
  v += a.logicalDepth * 900 + a.pctDepthGe3 * 80 + a.pctDepthGe2 * 25 + a.avgChainLength * 120;
  v += Math.min(220, (p.meta?.solverCalls || 0) / 180);
  v += s.islands * 140 + (s.maxIsland >= 4 ? 120 : 40);
  v -= s.clues * 20 + s.water * 180;
  return Math.round(v);
}
function orderedRemovals(p) {
  const items = Object.entries(p.cl || {}).map(([k, v]) => ({ i: Number(k), clue: v }));
  const prio = clue => {
    if (clue === 'w') return 0;
    if (clue === 's') return 1;
    if (clue === 'e') return 2;
    if (clue === 'm') return 3;
    if (clue === 'i1') return 4;
    if (clue === 'i2') return 5;
    if (clue === 'i3') return 6;
    return 7;
  };
  items.sort((a,b)=>prio(a.clue)-prio(b.clue)||a.i-b.i);
  return items;
}
function combinations(n, k) {
  const out = [];
  const cur = [];
  function rec(start, left) {
    if (left === 0) { out.push(cur.slice()); return; }
    for (let i = start; i <= n - left; i++) {
      cur.push(i);
      rec(i + 1, left - 1);
      cur.pop();
    }
  }
  rec(0, k);
  return out;
}

const ctx = loadCtx();
const { analyzePuzzle } = loadDepth();
const currentLibrary = loadJson(LIB, []);
const found = loadJson(FOUND, []);
const state = loadJson(STATE, { seedIndex: 0, comboSize: 1, comboOffset: 0, pass: 0, announcedDone: false });
const existingShapeKeys = new Set(currentLibrary.map(shapeKey));
for (const p of found) existingShapeKeys.add(shapeKey(p));

const seedPool = hist('8a24b26', 'bimaru-harbor-library.json')
  .filter(p => {
    const s = clueStats(p.cl);
    return s.islands >= 2 && s.islands <= 3 && s.clues >= 6 && s.clues <= 11;
  })
  .sort((a,b)=>((b.meta?.logicalDepth||0)-(a.meta?.logicalDepth||0)) || (Object.keys(a.cl||{}).length - Object.keys(b.cl||{}).length));

const start = Date.now();
let tested = 0;
let added = [];
if (found.length >= TARGET) {
  if (!state.announcedDone) {
    state.announcedDone = true;
    saveJson(STATE, state);
    process.stdout.write(`Hard/Expert background target already reached: ${found.length}/${TARGET}.\n`);
  }
  process.exit(0);
}

while (tested < MAX_COMBOS && ((Date.now() - start) / 1000) < MAX_SECONDS) {
  if (!seedPool.length) break;
  if (state.seedIndex >= seedPool.length) {
    state.seedIndex = 0;
    state.comboSize += 1;
    state.comboOffset = 0;
    if (state.comboSize > 3) {
      state.comboSize = 1;
      state.pass += 1;
    }
  }
  const seed = clone(seedPool[state.seedIndex]);
  const removables = orderedRemovals(seed).slice(0, Math.min(8 + state.pass, 10));
  if (removables.length < state.comboSize) {
    state.seedIndex += 1;
    state.comboOffset = 0;
    continue;
  }
  const combos = combinations(removables.length, state.comboSize);
  if (state.comboOffset >= combos.length) {
    state.seedIndex += 1;
    state.comboOffset = 0;
    continue;
  }
  const combo = combos[state.comboOffset];
  state.comboOffset += 1;
  tested += 1;

  const next = clone(seed);
  for (const idx of combo) delete next.cl[removables[idx].i];
  const unique = ctx.countSolutionsForPuzzle(next, 2, 22000);
  if (!(unique.exact && unique.solutions === 1)) continue;
  next.meta = Object.assign({}, next.meta || {}, { uniqueChecked: true, uniquenessExact: true, solverCalls: unique.calls });
  const analysis = analyzePuzzle(clone(next));
  const stats = clueStats(next.cl);
  const diff = displayDifficulty(next, analysis, stats);
  if (!(diff === 'hard' || diff === 'expert')) continue;
  if (diff === 'expert' && analysis.logicalDepth < 8) continue;
  if (diff === 'hard' && analysis.logicalDepth < 5) continue;
  const key = shapeKey(next);
  if (existingShapeKeys.has(key)) continue;
  next.difficulty = diff;
  next.name = `Harbor Background ${found.length + added.length + 1}`;
  next.meta.logicalDepth = analysis.logicalDepth;
  next.meta.chainLength = analysis.avgChainLength;
  next.meta.pctDepthGe2 = analysis.pctDepthGe2;
  next.meta.pctDepthGe3 = analysis.pctDepthGe3;
  next.meta.needsBacktracking = analysis.needsBacktracking;
  next.meta.score = score(next, analysis, stats);
  next.meta.backgroundHardSearch = true;
  next.meta.backgroundSource = seed.name || 'historical-seed';
  next.meta.backgroundRemovals = combo.map(i => removables[i]);
  added.push(next);
  existingShapeKeys.add(key);
  if ((found.length + added.length) >= TARGET) break;
}

saveJson(STATE, state);
if (!added.length) process.exit(0);
const merged = found.concat(added);
saveJson(FOUND, merged);
execSync(`node ${path.join(ROOT, 'select_strong_harbor_library.js')}`, { stdio: 'ignore' });
execSync(`cp ${path.join(ROOT, 'selected_strong_harbor_library.json')} ${path.join(ROOT, 'bimaru-harbor-library.json')}`, { stdio: 'ignore' });
execSync(`node ${path.join(ROOT, 'embed_library.js')}`, { stdio: 'ignore' });
const lines = added.map(p => `+ ${p.difficulty.toUpperCase()} ${p.name}: ${p.rc.join(',')} | ${p.cc.join(',')} | score=${p.meta.score} | src=${p.meta.backgroundSource}`);
process.stdout.write(`Background Harbor search: ${added.length} neue Hard/Expert-Rätsel eingebaut (${merged.length}/${TARGET}).\n${lines.join('\n')}\n`);
if (merged.length >= TARGET) {
  state.announcedDone = true;
  saveJson(STATE, state);
  process.stdout.write(`Ziel erreicht: ${merged.length}/${TARGET} zusätzliche Hard/Expert-Rätsel gefunden.\n`);
}
