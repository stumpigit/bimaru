#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'bimaru-harbor.html');
const TARGET = path.join(ROOT, 'one_island_family_library.json');

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

const ctx = loadCtx();
const lib = JSON.parse(fs.readFileSync(TARGET, 'utf8'));

function solveOne(puz, maxCalls=60000) {
  const N = ctx.N;
  const seed = new Array(N * N).fill(null);
  for (const key of Object.keys(puz.cl)) {
    const i = +key, t = puz.cl[key];
    seed[i] = (t === 'w' || ctx.isIslandClueType(t)) ? ctx.WA : ctx.SH;
  }
  const root = seed.slice();
  if (!ctx.propagateForcedAssignments(root, puz.rc, puz.cc, puz.cl).ok) return { ok: false, reason: 'inconsistent-root' };
  const order = [];
  for (let i = 0; i < root.length; i++) if (root[i] === null) order.push(i);
  order.sort((a, b) => {
    const ar = Math.floor(a / N), ac = a % N, br = Math.floor(b / N), bc = b % N;
    return (puz.rc[br] + puz.cc[bc]) - (puz.rc[ar] + puz.cc[ac]);
  });
  let calls = 0;
  let solution = null;
  let solutionCount = 0;
  function dfs(pos, assign) {
    calls++;
    if (calls > maxCalls || solutionCount >= 2) return;
    while (pos < order.length && assign[order[pos]] !== null) pos++;
    if (pos === order.length) {
      if (ctx.partialValid(assign, puz.rc, puz.cc, puz.cl) && ctx.clueSatisfied(assign, puz.cl) && ctx.finalFleetOk(assign, puz.cl)) {
        solutionCount++;
        if (!solution) solution = assign.slice();
      }
      return;
    }
    const i = order[pos], r = Math.floor(i / N), c = i % N;
    const w = assign.slice();
    w[i] = ctx.WA;
    if (ctx.propagateForcedAssignments(w, puz.rc, puz.cc, puz.cl).ok && ctx.lineShapePossible(w)) dfs(pos + 1, w);
    const s = assign.slice();
    s[i] = ctx.SH;
    if (ctx.localAdjacencyOk(s, r, c, puz.cl) && ctx.propagateForcedAssignments(s, puz.rc, puz.cc, puz.cl).ok && ctx.lineShapePossible(s)) dfs(pos + 1, s);
  }
  dfs(0, root);
  if (solutionCount !== 1 || !solution) return { ok: false, reason: `solutions=${solutionCount}`, calls };
  return { ok: true, calls, solution: solution.map(v => v === ctx.SH ? 1 : 0) };
}

const report = [];
for (const p of lib) {
  const solved = solveOne(p, 80000);
  if (!solved.ok) {
    report.push({ name: p.name, ok: false, reason: solved.reason, calls: solved.calls || 0 });
    continue;
  }
  p.grid = solved.solution;
  report.push({ name: p.name, ok: true, calls: solved.calls, clueCount: Object.keys(p.cl).length });
}
fs.writeFileSync(TARGET, JSON.stringify(lib, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
