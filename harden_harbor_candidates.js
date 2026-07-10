#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'bimaru-harbor.html');
const DEPTH = path.join(ROOT, 'logical_depth_score.js');
const OUT = path.join(ROOT, 'harbor_hardened_candidates.json');

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
  try { return JSON.parse(execSync(`git -C ${ROOT} show ${commit}:${file}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); }
  catch { return []; }
}
const ctx = loadCtx();
const { analyzePuzzle, classifyByLogicalDepth } = loadDepth();

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function clueStats(cl){
  const vals = Object.values(cl || {});
  const islandVals = vals.filter(v => /^i/.test(v)).map(v => Number(v.slice(1))).sort((a,b)=>a-b);
  return {
    clues: vals.length,
    islands: islandVals.length,
    maxIsland: islandVals.length ? Math.max(...islandVals) : 0,
    ship: vals.filter(v => v === 's' || v === 'e' || v === 'm').length,
    mids: vals.filter(v => v === 'm').length,
    ends: vals.filter(v => v === 'e').length,
    singles: vals.filter(v => v === 's').length,
    water: vals.filter(v => v === 'w').length,
  };
}
function displayDifficulty(p, a, s) {
  if (a.logicalDepth >= 8 || a.pctDepthGe3 >= 7) return 'expert';
  if (a.logicalDepth >= 4 || a.pctDepthGe3 >= 4.5 || ((p.meta?.solverCalls||0) >= 16000 && s.islands >= 2)) return 'hard';
  if (a.logicalDepth >= 2 || a.pctDepthGe2 >= 10) return 'medium';
  return 'easy';
}
function score(p, a, s) {
  let v = 0;
  v += a.logicalDepth * 900 + a.pctDepthGe3 * 80 + a.pctDepthGe2 * 25 + a.avgChainLength * 120;
  v += Math.min(220, (p.meta?.solverCalls || 0) / 180);
  v += s.islands * 140 + (s.maxIsland >= 4 ? 120 : 40);
  v -= s.clues * 20 + s.mids * 90 + s.water * 200;
  return Math.round(v);
}
function orderedRemovals(p) {
  const items = Object.entries(p.cl).map(([k,v]) => ({ i: Number(k), clue: v }));
  const prio = c => {
    if (c.clue === 'w') return 0;
    if (c.clue === 's') return 1;
    if (c.clue === 'e') return 2;
    if (c.clue === 'm') return 3;
    if (/^i1$/.test(c.clue)) return 4;
    if (/^i2$/.test(c.clue)) return 5;
    if (/^i3$/.test(c.clue)) return 6;
    return 7;
  };
  items.sort((a,b)=>prio(a)-prio(b)||a.i-b.i);
  return items;
}

const seeds = hist('8a24b26', 'bimaru-harbor-library.json').filter(p => {
  const s = clueStats(p.cl);
  return s.islands >= 2 && s.clues >= 6 && s.clues <= 11;
}).sort((a,b)=>((b.meta?.logicalDepth||0)-(a.meta?.logicalDepth||0)) || (Object.keys(a.cl||{}).length-Object.keys(b.cl||{}).length)).slice(0, 8);
const results = [];
const seen = new Set();
for (const seed of seeds) {
  let best = null;
  let work = clone(seed);
  const removals = orderedRemovals(work).slice(0, 6);
  for (const rem of removals) {
    const next = clone(work);
    delete next.cl[rem.i];
    const unique = ctx.countSolutionsForPuzzle(next, 2, 18000);
    if (!(unique.exact && unique.solutions === 1)) continue;
    next.meta = Object.assign({}, next.meta || {}, { uniqueChecked: true, uniquenessExact: true, solverCalls: unique.calls });
    const a = analyzePuzzle(clone(next));
    const s = clueStats(next.cl);
    if (s.islands < 2 || s.islands > 3 || s.clues < 5 || s.clues > 11 || s.water > 0) continue;
    const diff = displayDifficulty(next, a, s);
    if (diff === 'easy') continue;
    const sc = score(next, a, s);
    next.meta.logicalDepth = a.logicalDepth;
    next.meta.chainLength = a.avgChainLength;
    next.meta.pctDepthGe2 = a.pctDepthGe2;
    next.meta.pctDepthGe3 = a.pctDepthGe3;
    next.meta.needsBacktracking = a.needsBacktracking;
    next.meta.score = sc;
    next.meta.hardenedFrom = seed.name;
    work = next;
    best = { puzzle: next, difficulty: diff, score: sc, stats: s };
  }
  if (!best) continue;
  const sig = JSON.stringify({ rc: best.puzzle.rc, cc: best.puzzle.cc, cl: Object.entries(best.puzzle.cl).sort((a,b)=>Number(a[0])-Number(b[0])) });
  if (seen.has(sig)) continue;
  seen.add(sig);
  results.push({
    id: results.length,
    name: `Harbor Hardened #${results.length + 1}`,
    difficulty: best.difficulty,
    grid: best.puzzle.grid,
    rc: best.puzzle.rc,
    cc: best.puzzle.cc,
    cl: best.puzzle.cl,
    meta: Object.assign({}, best.puzzle.meta, { hardenedBy: 'remove-clues-pass' })
  });
}
results.sort((a,b)=>{
  const order={expert:0,hard:1,medium:2,easy:3};
  return order[a.difficulty]-order[b.difficulty] || (b.meta?.score||0)-(a.meta?.score||0);
});
fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ saved: results.length, out: OUT, breakdown: results.reduce((m,p)=>(m[p.difficulty]=(m[p.difficulty]||0)+1,m),{}) }, null, 2));
