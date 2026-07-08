#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'bimaru-harbor.html');
const SAMPLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'harbor_samples.json'), 'utf8'));

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
const sampleArg = Number(process.argv[2] || 1);
const islandArg = Number(process.argv[3] || 0);
const budgetArg = Number(process.argv[4] || 30000);
const sample = SAMPLES[sampleArg - 1];
if(!sample){
  console.error(JSON.stringify({ ok:false, error:'sample not found', sampleArg, sampleCount:SAMPLES.length }, null, 2));
  process.exit(1);
}

function buildBase(sample, island){
  return {
    grid: sample.flat.slice(),
    rc: sample.rows.slice(),
    cc: sample.cols.slice(),
    cl: { [ctx.idx(island[0], island[1])]: 'i' + island[2] },
    meta: {}
  };
}

function orderCells(assign, puz){
  const order=[];
  for(let i=0;i<assign.length;i++) if(assign[i]===null) order.push(i);
  order.sort((a,b)=>{
    const ar=Math.floor(a/ctx.N), ac=a%ctx.N, br=Math.floor(b/ctx.N), bc=b%ctx.N;
    return (puz.rc[br]+puz.cc[bc]) - (puz.rc[ar]+puz.cc[ac]);
  });
  return order;
}

function enumerateSolutions(puz, limit=2, maxCalls=budgetArg){
  const seed = new Array(ctx.N*ctx.N).fill(null);
  for(const key of Object.keys(puz.cl)){
    const i = +key, t = puz.cl[key];
    seed[i] = (t === 'w' || ctx.isIslandClueType(t)) ? ctx.WA : ctx.SH;
  }
  const root = seed.slice();
  if(!ctx.propagateForcedAssignments(root, puz.rc, puz.cc, puz.cl).ok) return { solutions: [], calls: 0 };
  const order = orderCells(root, puz);
  const sols=[];
  let calls=0;
  let aborted=false;
  function dfs(pos, assign){
    calls++;
    if(calls>maxCalls){ aborted=true; return; }
    if(sols.length>=limit) return;
    while(pos<order.length && assign[order[pos]]!==null) pos++;
    if(pos===order.length){
      if(ctx.partialValid(assign,puz.rc,puz.cc,puz.cl) && ctx.clueSatisfied(assign,puz.cl) && ctx.finalFleetOk(assign,puz.cl)) sols.push(assign.slice());
      return;
    }
    const i=order[pos], r=Math.floor(i/ctx.N), c=i%ctx.N;
    const w=assign.slice(); w[i]=ctx.WA;
    if(ctx.propagateForcedAssignments(w,puz.rc,puz.cc,puz.cl).ok && ctx.lineShapePossible(w)) dfs(pos+1,w);
    const s=assign.slice(); s[i]=ctx.SH;
    if(ctx.localAdjacencyOk(s,r,c,puz.cl) && ctx.propagateForcedAssignments(s,puz.rc,puz.cc,puz.cl).ok && ctx.lineShapePossible(s)) dfs(pos+1,s);
  }
  dfs(0, root);
  return { solutions: sols, calls, aborted };
}

function diffIndices(a, b){
  const out=[];
  for(let i=0;i<a.length;i++) if(a[i] !== b[i]) out.push(i);
  return out;
}

function separatorClueForCell(sample, i){
  const r = Math.floor(i / ctx.N), c = i % ctx.N;
  if(sample.flat[i] === ctx.SH) return ctx.clueTypeForCell(sample.flat, r, c);
  return 'w';
}

function summarizeCandidate(sample, island, islandIndex, separatorIndex, unique){
  const puz = buildBase(sample, island);
  const clue = separatorClueForCell(sample, separatorIndex);
  puz.cl[separatorIndex] = clue;
  puz.meta = {
    style: 'one-island-minimal',
    uniqueChecked: unique.solutions === 1,
    uniquenessExact: !!unique.exact,
    solverCalls: unique.calls,
    clueCount: Object.keys(puz.cl).length,
    harborIslands: [island],
    sampleIndex: sampleArg,
    islandIndex,
    separator: { i: separatorIndex, r: Math.floor(separatorIndex / ctx.N), c: separatorIndex % ctx.N, clue }
  };
  return {
    sample: sampleArg,
    islandIndex,
    island,
    clueCount: 2,
    islandCount: 1,
    separatorCount: 1,
    separator: puz.meta.separator,
    unique: { exact: !!unique.exact, solutions: unique.solutions, calls: unique.calls },
    puzzle: puz
  };
}

function generateForIsland(sample, island, islandIndex){
  const base = buildBase(sample, island);
  const baseCheck = ctx.countSolutionsForPuzzle(base, 2, budgetArg);
  if(!(baseCheck.exact && baseCheck.solutions === 2)) return [];
  const baseEnum = enumerateSolutions(base, 2, budgetArg);
  if(baseEnum.aborted || baseEnum.solutions.length !== 2) return [];
  const diffs = diffIndices(baseEnum.solutions[0], baseEnum.solutions[1]);
  const candidates=[];
  for(const i of diffs){
    const puz = buildBase(sample, island);
    puz.cl[i] = separatorClueForCell(sample, i);
    const res = ctx.countSolutionsForPuzzle(puz, 2, budgetArg);
    if(res.exact && res.solutions === 1){
      candidates.push(summarizeCandidate(sample, island, islandIndex, i, res));
    }
  }
  candidates.sort((a,b)=>b.unique.calls-a.unique.calls || String(a.separator.clue).localeCompare(String(b.separator.clue)) || a.separator.i-b.separator.i);
  return candidates;
}

const allCandidates=[];
const islandEntries = islandArg ? [[sample.islands[islandArg - 1], islandArg]].filter(([isl]) => !!isl) : sample.islands.map((isl, i) => [isl, i+1]);
for(const [island, index] of islandEntries){
  allCandidates.push(...generateForIsland(sample, island, index));
}
allCandidates.sort((a,b)=>b.unique.calls-a.unique.calls || a.islandIndex-b.islandIndex || a.separator.i-b.separator.i);

console.log(JSON.stringify({
  ok: allCandidates.length > 0,
  sample: sampleArg,
  style: 'one-island-minimal',
  candidateCount: allCandidates.length,
  candidates: allCandidates
}, null, 2));
