const fs = require('fs');
const path = require('path');
const hw = path.join(__dirname, 'bimaru-harbor.html');
const html = fs.readFileSync(hw, 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace(/newGame\(\);\s*$/, '');
const bootstrap = `
const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},appendChild(){},classList:{add(){},remove(){}},dataset:{}});
global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){},createElement(){return dummyEl();}};
global.window=globalThis;
`;
eval(bootstrap + js);

function summarizePuzzle(p){
  const vals = Object.values(p.cl || {});
  const dep = p.meta?.islandDependency || islandDependencyReport(p);
  return {
    clues: vals.length,
    islandClues: vals.filter(v=>/^i/.test(v)).length,
    shipClues: vals.filter(v=>v==='s'||v==='e'||v==='m').length,
    singles: vals.filter(v=>v==='s').length,
    ends: vals.filter(v=>v==='e').length,
    mids: vals.filter(v=>v==='m').length,
    islandVals: vals.filter(v=>/^i/.test(v)).map(v=>Number(v.slice(1))).sort((a,b)=>a-b),
    noIslandSolutions: dep.solutions,
    noIslandExact: dep.exact,
    essential: dep.essential,
    score: p.meta?.score ?? null,
    solverCalls: p.meta?.solverCalls ?? null,
    bridge: p.meta?.harborBridgeCount ?? null,
    zeroLines: p.meta?.zeroLines ?? null,
  };
}

function quickGenerate(tries=10, mLoops=1){
  let best = null;
  let bestScore = Infinity;
  for(let t=0; t<tries; t++){
    let harbor = genHarborSolution();
    if(!harbor) continue;
    let base = createInitialPuzzle(harbor);
    base.meta.zeroLines = zeroLinesScore({r:base.rc, c:base.cc});
    let baseCheck = countSolutionsForPuzzle(base, 2, 50000);
    if(!(baseCheck.exact && baseCheck.solutions===1)) continue;
    base.meta.uniqueChecked = true;
    base.meta.uniquenessExact = true;
    base.meta.solverCalls = baseCheck.calls;
    base.meta.score = cheapScorePuzzle(base);
    for(let m=0; m<mLoops; m++){
      let candidate = minimizePuzzle(base) || base;
      candidate = stripTrivialWaterClues(candidate);
      let finalCheck = countSolutionsForPuzzle(candidate, 2, 50000);
      if(!(finalCheck.exact && finalCheck.solutions===1)) continue;
      candidate.meta.uniqueChecked = true;
      candidate.meta.uniquenessExact = true;
      candidate.meta.solverCalls = finalCheck.calls;
      candidate.meta.zeroLines = zeroLinesScore({r:candidate.rc,c:candidate.cc});
      candidate = strengthenIslandDependency(candidate) || candidate;
      let dep = candidate.meta?.islandDependency || islandDependencyReport(candidate);
      if(!dep.essential || !dep.exact || dep.solutions < 2) continue;
      candidate.meta.islandDependency = dep;
      candidate.meta.clueCount = Object.keys(candidate.cl).length;
      candidate.meta.score = finalScorePuzzle(candidate, dep);
      const shipClues = Object.values(candidate.cl).filter(v=>v==='s'||v==='e'||v==='m').length;
      const islandVals = Object.values(candidate.cl).filter(v=>/^i/.test(v)).map(v=>Number(v.slice(1)));
      if(shipClues > 3) continue;
      if(candidate.meta.clueCount > 6) continue;
      if(!islandVals.some(v=>v>=3)) continue;
      if(candidate.meta.score < bestScore){
        best = candidate;
        bestScore = candidate.meta.score;
      }
      if(candidate.meta.clueCount <= 5 && countIslandClues(candidate.cl) >= 2 && shipClues <= 3) return best;
    }
  }
  return best;
}

const started = Date.now();
const p = quickGenerate(Number(process.argv[2]||10), Number(process.argv[3]||1));
const ms = Date.now() - started;
if(!p){ console.log(JSON.stringify({ok:false, ms, reason:'null'})); process.exit(0); }
console.log(JSON.stringify({ok:true, ms, summary:summarizePuzzle(p), puzzle:p}));
