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

function classifyDifficulty(s){
  if(s.clues <= 5 && s.islandClues >= 3 && s.solverCalls > 50000) return 'expert';
  if(s.clues <= 5 && s.islandClues >= 2 && (s.bridge ?? 0) >= 2) return 'expert';
  if(s.clues <= 6 && s.islandClues >= 2 && s.solverCalls > 30000 && (s.bridge ?? 0) >= 2) return 'hard';
  if(s.clues >= 6 && s.clues <= 7 && s.islandClues >= 2 && (s.bridge ?? 0) >= 2) return 'hard';
  if(s.clues >= 7 && s.clues <= 9 && s.islandClues >= 1) return 'medium';
  if(s.islandClues === 0 && s.clues >= 9) return 'easy';
  if(s.islandClues >= 1) return 'medium';
  return 'easy';
}

const labels = { easy: '⭐ Einfach', medium: '⭐⭐ Mittel', hard: '⭐⭐⭐ Schwer', expert: '⭐⭐⭐⭐ Experte' };

// Add clues until puzzle is unique, then minimize
function makeUniquePuzzle(harbor){
  let puz = createInitialPuzzle(harbor);
  puz.meta.zeroLines = zeroLinesScore({r:puz.rc, c:puz.cc});
  
  // Add ship clues until unique
  let flat = puz.grid;
  let shipCells = [];
  for(let i=0;i<N*N;i++){ if(flat[i]===SH) shipCells.push(i); }
  let waterCells = [];
  for(let i=0;i<N*N;i++){ if(flat[i]===WA) waterCells.push(i); }
  
  let allClueCandidates = shipCells.map(i=>({
    i, t: clueTypeForCell(flat, Math.floor(i/N), i%N)
  })).filter(c => !isIslandClueType(puz.cl[c.i] || puz.cl[c.i]===undefined));
  
  // Shuffle and add clues one at a time until unique
  shuffle(allClueCandidates);
  for(let c of allClueCandidates){
    puz.cl[c.i] = c.t;
    let check = countSolutionsForPuzzle(puz, 2, 30000);
    if(check.exact && check.solutions === 1){
      puz.meta.uniqueChecked = true;
      puz.meta.uniquenessExact = true;
      puz.meta.solverCalls = check.calls;
      return puz;
    }
  }
  return null; // couldn't make unique
}

function quickGenerate(tries=10, mLoops=1){
  let best = null;
  let bestScore = Infinity;
  for(let t=0; t<tries; t++){
    let harbor = genHarborSolution();
    if(!harbor) continue;
    let base = makeUniquePuzzle(harbor);
    if(!base) continue;
    base.meta.score = cheapScorePuzzle(base);
    if(base.meta.score < bestScore){
      best = base;
      bestScore = base.meta.score;
    }
    for(let m=0; m<mLoops; m++){
      let candidate = minimizePuzzle(base) || base;
      candidate = stripTrivialWaterClues(candidate);
      let finalCheck = countSolutionsForPuzzle(candidate, 2, 30000);
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

const target = Number(process.argv[2] || 30);
const outPath = path.join(__dirname, 'hard_puzzles_generated.json');
const results = [];
const seenSigs = new Set();
const startTime = Date.now();

console.log('=== Harbor Hard Puzzle Generator (batch mode) ===');
console.log('Target: ' + target + ' puzzles\n');

for(let i = 0; i < 200 && results.length < target; i++){
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if(elapsed > 1200){
    console.log('\nTime limit reached (' + elapsed + 's), stopping.');
    break;
  }
  
  const t0 = Date.now();
  const puzzle = quickGenerate(5, 0);
  const ms = Date.now() - t0;
  
  if(!puzzle){
    if(i % 10 === 0) console.log('  Attempt ' + (i+1) + ': null (' + ms + 'ms)');
    continue;
  }
  
  const sig = JSON.stringify({
    rc: puzzle.rc,
    cc: puzzle.cc,
    cl: Object.entries(puzzle.cl).sort((a,b)=>Number(a[0])-Number(b[0]))
  });
  if(seenSigs.has(sig)){
    continue;
  }
  seenSigs.add(sig);
  
  const summary = summarizePuzzle(puzzle);
  const classif = classifyDifficulty(summary);
  const diffOrder = { expert: 0, hard: 1, medium: 2, easy: 3 };
  summary.difficulty = classif;
  summary.difficultyOrder = diffOrder[classif];
  
  if(i % 5 === 0 || results.length < 5){
    console.log('  Attempt ' + (i+1) + ': clues=' + summary.clues + ' islands=' + summary.islandClues + ' bridges=' + summary.bridge + ' calls=' + summary.solverCalls + ' → ' + classif + ' (' + ms + 'ms)');
  }
  
  results.push({
    id: results.length,
    grid: puzzle.grid,
    rc: puzzle.rc,
    cc: puzzle.cc,
    cl: puzzle.cl,
    meta: Object.assign({}, puzzle.meta, { sampleIndex: results.length }),
    difficulty: classif,
    difficultyOrder: diffOrder[classif],
    name: 'Harbor #' + (results.length + 1)
  });
  
  if(results.length >= target) break;
}

results.sort((a,b) => (a.difficultyOrder || 4) - (b.difficultyOrder || 4));
results.forEach((r,i) => r.id = i);

console.log('\n=== Found ' + results.length + ' unique puzzles ===');
const counts = {};
for(const r of results) counts[r.difficulty] = (counts[r.difficulty] || 0) + 1;
console.log('  Difficulty: ' + JSON.stringify(counts));

for(let i = 0; i < results.length; i++){
  const p = results[i];
  console.log('  ' + (i+1) + '. ' + p.name + ': ' + p.difficulty + ' score=' + p.meta?.score + ' clues=' + p.meta?.clueCount + ' islands=' + Object.values(p.cl).filter(v=>/^i/.test(v)).length);
}

fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log('\nSaved ' + results.length + ' puzzles to ' + outPath);
