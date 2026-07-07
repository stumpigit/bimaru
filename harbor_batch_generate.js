const fs = require('fs');
const path = require('path');
const vm = require('vm');

const hw = path.join(__dirname, 'bimaru-harbor.html');
const depthPath = path.join(__dirname, 'logical_depth_score.js');
const html = fs.readFileSync(hw, 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace(/newGame\(\);\s*$/, '');

const bootstrap = `
const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},appendChild(){},classList:{add(){},remove(){}},dataset:{},style:{}});
global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){},createElement(){return dummyEl();}};
global.window=globalThis;
`;
eval(bootstrap + js);

let depthCode = fs.readFileSync(depthPath, 'utf8');
depthCode = depthCode.replace(/main\(\);\s*$/, 'module.exports = { analyzePuzzle, classifyByLogicalDepth };');
const depthSandbox = { console, require, module: { exports: {} }, exports: {}, __dirname, __filename: depthPath };
vm.createContext(depthSandbox);
vm.runInContext(depthCode, depthSandbox, { filename: depthPath });
const { analyzePuzzle, classifyByLogicalDepth } = depthSandbox.module.exports;

const labels = { easy: '⭐ Einfach', medium: '⭐⭐ Mittel', hard: '⭐⭐⭐ Schwer', expert: '⭐⭐⭐⭐ Experte' };

function summarizePuzzle(p, analysis){
  const vals = Object.values(p.cl || {});
  const dep = p.meta?.islandDependency || islandDependencyReport(p);
  return {
    clues: vals.length,
    islandClues: vals.filter(v=>/^i/.test(v)).length,
    shipClues: vals.filter(v=>v==='s'||v==='e'||v==='m').length,
    singles: vals.filter(v=>v==='s').length,
    ends: vals.filter(v=>v==='e').length,
    mids: vals.filter(v=>v==='m').length,
    water: vals.filter(v=>v==='w').length,
    islandVals: vals.filter(v=>/^i/.test(v)).map(v=>Number(v.slice(1))).sort((a,b)=>a-b),
    noIslandSolutions: dep.solutions,
    noIslandExact: dep.exact,
    essential: dep.essential,
    score: p.meta?.score ?? null,
    solverCalls: p.meta?.solverCalls ?? null,
    bridge: p.meta?.harborBridgeCount ?? null,
    zeroLines: p.meta?.zeroLines ?? null,
    logicalDepth: analysis?.logicalDepth ?? 0,
    pctDepthGe2: analysis?.pctDepthGe2 ?? 0,
    pctDepthGe3: analysis?.pctDepthGe3 ?? 0,
    avgChainLength: analysis?.avgChainLength ?? 0,
    needsBacktracking: analysis?.needsBacktracking ?? false,
  };
}

function strengthScore(summary){
  let score = 0;
  score += summary.logicalDepth * 1000;
  score += summary.pctDepthGe3 * 80;
  score += summary.pctDepthGe2 * 30;
  score += summary.avgChainLength * 150;
  score += Math.min(250, (summary.solverCalls || 0) / 150);
  score -= summary.clues * 25;
  score -= summary.shipClues * 18;
  score -= summary.singles * 70;
  score -= summary.water * 120;
  if (summary.islandVals.some(v => v >= 3)) score += 80;
  if (summary.needsBacktracking) score += 100;
  return Math.round(score);
}

function makeUniquePuzzle(harbor){
  let base = createInitialPuzzle(harbor);
  let islandVals = Object.values(base.cl).filter(v=>/^i/.test(v)).map(v=>Number(v.slice(1)));
  if(islandVals.length < 2 || !islandVals.some(v=>v>=3)) return null;

  let flat = base.grid;
  let islandCells = Object.keys(base.cl)
    .filter(k => /^i/.test(base.cl[k]))
    .map(k => ({ r: Math.floor(Number(k)/N), c: Number(k)%N }));

  let candidates = [];
  for(let i=0;i<N*N;i++){
    if(flat[i]!==SH) continue;
    if(base.cl[i] !== undefined) continue;
    let r=Math.floor(i/N), c=i%N;
    let t=clueTypeForCell(flat, r, c);
    let nearIsland=0;
    for(let isl of islandCells) if(Math.abs(isl.r-r)+Math.abs(isl.c-c)===1) nearIsland++;
    let centrality=8-(Math.abs(r-4)+Math.abs(c-4));
    let weight=(t==='m'?50:t==='e'?32:10) + nearIsland*24 + centrality;
    candidates.push({ i, t, weight, nearIsland, centrality });
  }

  candidates.sort((a,b)=>b.weight-a.weight || a.i-b.i);
  let variants = [
    candidates.filter(c=>c.t!=='s').concat(candidates.filter(c=>c.t==='s')),
    candidates.filter(c=>c.t==='e').concat(candidates.filter(c=>c.t==='m')).concat(candidates.filter(c=>c.t==='s')),
    candidates.filter(c=>c.t==='m' && c.nearIsland>0).concat(candidates.filter(c=>c.t==='e' && c.nearIsland>0)).concat(candidates.filter(c=>c.t==='m' && c.nearIsland===0)).concat(candidates.filter(c=>c.t==='e' && c.nearIsland===0)).concat(candidates.filter(c=>c.t==='s'))
  ];

  let best = null;
  let bestScore = -Infinity;
  let fallback = null;
  let fallbackScore = -Infinity;

  for(let ordered of variants){
    for(let targetClues=7; targetClues<=14; targetClues++){
      let puz = clonePuzzle(base);
      for(let cand of ordered){
        if(Object.keys(puz.cl).length >= targetClues) break;
        puz.cl[cand.i] = cand.t;
      }
      let check = countSolutionsForPuzzle(puz, 2, 30000);
      if(!(check.exact && check.solutions === 1)) continue;

      puz.meta.uniqueChecked = true;
      puz.meta.uniquenessExact = true;
      puz.meta.solverCalls = check.calls;
      puz.meta.clueCount = Object.keys(puz.cl).length;

      let dep = islandDependencyReport(puz);
      let analysis = analyzePuzzle(puz);
      let summary = summarizePuzzle(puz, analysis);
      let score = strengthScore(summary);

      puz.meta.islandDependency = dep;
      puz.meta.score = score;
      puz.meta.logicalDepth = analysis.logicalDepth;
      puz.meta.chainLength = analysis.avgChainLength;
      puz.meta.pctDepthGe2 = analysis.pctDepthGe2;
      puz.meta.pctDepthGe3 = analysis.pctDepthGe3;
      puz.meta.needsBacktracking = analysis.needsBacktracking;

      if(score > fallbackScore){
        fallback = puz;
        fallbackScore = score;
      }

      if(summary.islandClues < 2) continue;
      if(summary.water > 0) continue;
      if(summary.shipClues < 5 || summary.shipClues > 10) continue;
      if(summary.clues < 7 || summary.clues > 14) continue;
      if(summary.singles > 2) continue;
      if(!summary.islandVals.some(v => v >= 3)) continue;
      if(!dep.essential || !dep.exact) continue;

      if(score > bestScore || (score === bestScore && summary.clues < Object.keys(best?.cl || {}).length)){
        best = puz;
        bestScore = score;
      }
    }
  }

  return best || fallback;
}

function quickGenerate(tries=3){
  let best = null;
  let bestScore = -Infinity;
  for(let t=0; t<tries; t++){
    let harbor = genHarborSolution();
    if(!harbor) continue;
    let candidate = makeUniquePuzzle(harbor);
    if(!candidate) continue;
    let dep = candidate.meta?.islandDependency || islandDependencyReport(candidate);
    if(!dep.essential || !dep.exact) continue;
    candidate.meta.islandDependency = dep;
    candidate.meta.clueCount = Object.keys(candidate.cl).length;

    const analysis = analyzePuzzle(candidate);
    const summary = summarizePuzzle(candidate, analysis);

    if(summary.islandClues < 2) continue;
    if(summary.water > 0) continue;
    if(summary.shipClues < 5 || summary.shipClues > 10) continue;
    if(summary.clues < 7 || summary.clues > 14) continue;
    if(summary.singles > 2) continue;
    if(!summary.islandVals.some(v => v >= 3)) continue;
    if(!(analysis.logicalDepth >= 4 || analysis.pctDepthGe3 >= 6 || (analysis.logicalDepth >= 3 && analysis.pctDepthGe2 >= 18 && summary.shipClues <= 10))) continue;

    const score = strengthScore(summary);
    candidate.meta.score = score;
    candidate.meta.logicalDepth = analysis.logicalDepth;
    candidate.meta.chainLength = analysis.avgChainLength;
    candidate.meta.pctDepthGe2 = analysis.pctDepthGe2;
    candidate.meta.pctDepthGe3 = analysis.pctDepthGe3;
    candidate.meta.needsBacktracking = analysis.needsBacktracking;

    if(score > bestScore){
      best = { puzzle: candidate, analysis, summary, score };
      bestScore = score;
    }
  }
  return best;
}

const target = Number(process.argv[2] || 12);
const outPath = path.resolve(process.argv[3] || path.join(__dirname, 'hard_puzzles_generated.json'));
const results = [];
const seenSigs = new Set();
const startTime = Date.now();

console.log('=== Harbor Hard Puzzle Generator (batch mode) ===');
console.log('Target: ' + target + ' puzzles');
console.log('Output: ' + outPath + '\n');

for(let i = 0; i < 200 && results.length < target; i++){
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if(elapsed > 1800){
    console.log('\nTime limit reached (' + elapsed + 's), stopping.');
    break;
  }

  const t0 = Date.now();
  const result = quickGenerate(3);
  const ms = Date.now() - t0;

  if(!result){
    console.log('  Attempt ' + (i+1) + ': null (' + ms + 'ms)');
    continue;
  }

  const { puzzle, analysis, summary, score } = result;
  const sig = JSON.stringify({
    rc: puzzle.rc,
    cc: puzzle.cc,
    cl: Object.entries(puzzle.cl).sort((a,b)=>Number(a[0])-Number(b[0]))
  });
  if(seenSigs.has(sig)){
    console.log('  Attempt ' + (i+1) + ': duplicate (' + ms + 'ms)');
    continue;
  }
  seenSigs.add(sig);

  const diff = classifyByLogicalDepth(analysis);
  const diffOrder = { expert: 0, hard: 1, medium: 2, easy: 3 };

  console.log(
    '  Attempt ' + (i+1) + ': clues=' + summary.clues +
    ' islands=' + summary.islandClues +
    ' ship=' + summary.shipClues +
    ' depth=' + summary.logicalDepth +
    ' p>=2=' + summary.pctDepthGe2 +
    ' calls=' + summary.solverCalls +
    ' → ' + diff +
    ' score=' + score +
    ' (' + ms + 'ms)'
  );

  results.push({
    id: results.length,
    grid: puzzle.grid,
    rc: puzzle.rc,
    cc: puzzle.cc,
    cl: puzzle.cl,
    meta: Object.assign({}, puzzle.meta, { sampleIndex: results.length }),
    difficulty: diff,
    difficultyOrder: diffOrder[diff],
    name: 'Harbor #' + (results.length + 1)
  });

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
}

results.sort((a,b) => (a.difficultyOrder || 4) - (b.difficultyOrder || 4) || ((b.meta?.score || 0) - (a.meta?.score || 0)));
results.forEach((r,i) => r.id = i);
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

console.log('\n=== Found ' + results.length + ' unique puzzles ===');
const counts = {};
for(const r of results) counts[r.difficulty] = (counts[r.difficulty] || 0) + 1;
console.log('  Difficulty: ' + JSON.stringify(counts));

for(let i = 0; i < results.length; i++){
  const p = results[i];
  console.log(
    '  ' + (i+1) + '. ' + p.name + ': ' + labels[p.difficulty] +
    ' depth=' + (p.meta?.logicalDepth ?? '?') +
    ' clues=' + Object.keys(p.cl).length +
    ' ship=' + Object.values(p.cl).filter(v=>v==='s'||v==='e'||v==='m').length +
    ' score=' + (p.meta?.score ?? '?')
  );
}

console.log('\nSaved ' + results.length + ' puzzles to ' + outPath);
