const fs = require('fs');
const path = '/home/cs/bimaru/bimaru-harbor.html';
const html = fs.readFileSync(path, 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace(/newGame\(\);\s*$/, '');

const bootstrap = `
const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},appendChild(){},classList:{add(){},remove(){}},dataset:{}});
global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){},createElement(){return dummyEl();}};
global.window=globalThis;
`;
eval(bootstrap + js);

// ── Difficulty classification ──────────────────────────────────────────────
function classifyDifficulty(p) {
  const vals = Object.values(p.cl || {});
  const clueCount = vals.length;
  const islandClues = vals.filter(v => /^i/.test(v)).length;
  const bridgeCount = (p.meta && p.meta.harborBridgeCount) || 0;
  const solverCalls = (p.meta && p.meta.solverCalls) || 0;
  const dep = p.meta?.islandDependency || islandDependencyReport(p);
  const shipClues = vals.filter(v => v === 's' || v === 'e' || v === 'm').length;

  let diff = 'easy';
  if (clueCount <= 5 && islandClues >= 3 && solverCalls > 50000 && bridgeCount >= 2) {
    diff = 'expert';
  } else if (clueCount >= 5 && clueCount <= 7 && islandClues >= 2 && solverCalls > 30000 && bridgeCount >= 2) {
    diff = 'hard';
  } else if (clueCount >= 7 && clueCount <= 9 && islandClues >= 1 && solverCalls >= 5000) {
    diff = 'medium';
  }
  if (clueCount <= 5 && islandClues >= 2 && bridgeCount >= 2) {
    diff = 'hard';
    if (islandClues >= 3) diff = 'expert';
  }
  if (solverCalls < 5000 && clueCount >= 9) {
    diff = 'easy';
  }

  const labels = { easy: '⭐ Einfach', medium: '⭐⭐ Mittel', hard: '⭐⭐⭐ Schwer', expert: '⭐⭐⭐⭐ Experte' };

  return { diff, label: labels[diff], clueCount, islandClues, bridgeCount, solverCalls, shipClues, dep_essential: dep.essential };
}

// ── Generate puzzles ──────────────────────────────────────────────────────
const attempts = 25;
const results = [];
const seenSigs = new Set();
const startTime = Date.now();

console.log(`\n=== Harbor Hard Puzzle Generator (${attempts} attempts) ===`);
console.log(`Note: generateBestPuzzle has 90 tries per call, so total ~${attempts * 90} harbor generations.\n`);

for (let i = 0; i < attempts; i++) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (elapsed > 180) {
    console.log(`\nTime limit reached (${elapsed}s), stopping.`);
    break;
  }

  const t0 = Date.now();
  const puzzle = generateBestPuzzle();
  const ms = Date.now() - t0;

  if (!puzzle) {
    if (i % 5 === 0) console.log(`  Attempt ${i + 1}: null (${ms}ms)`);
    continue;
  }

  const sig = JSON.stringify({
    rc: puzzle.rc,
    cc: puzzle.cc,
    cl: Object.entries(puzzle.cl).sort((a, b) => Number(a[0]) - Number(b[0]))
  });
  if (seenSigs.has(sig)) {
    if (i % 5 === 0) console.log(`  Attempt ${i + 1}: duplicate (${ms}ms)`);
    continue;
  }
  seenSigs.add(sig);

  const classif = classifyDifficulty(puzzle);
  if (i % 3 === 0) console.log(`  Attempt ${i + 1}: score=${puzzle.meta?.score ?? '?'} clues=${classif.clueCount} islands=${classif.islandClues} bridges=${classif.bridgeCount} calls=${classif.solverCalls} → ${classif.label} (${ms}ms)`);

  results.push({
    id: results.length,
    grid: puzzle.grid,
    rc: puzzle.rc,
    cc: puzzle.cc,
    cl: puzzle.cl,
    meta: { ...puzzle.meta, sampleIndex: results.length },
    difficulty: classif.diff,
    difficultyLabel: classif.label,
    name: `Harbor #${results.length}`
  });
}

// Sort by difficulty then score
const diffOrder = { expert: 0, hard: 1, medium: 2, easy: 3 };
results.sort((a, b) => {
  if (a.difficulty !== b.difficulty) return diffOrder[a.difficulty] - diffOrder[b.difficulty];
  return (a.meta?.score || 0) - (b.meta?.score || 0);
});

console.log(`\n=== Found ${results.length} unique puzzles ===`);
const counts = {};
for (const r of results) counts[r.difficulty] = (counts[r.difficulty] || 0) + 1;
console.log(`  Difficulty breakdown: ${JSON.stringify(counts)}`);

for (let i = 0; i < results.length; i++) {
  const p = results[i];
  console.log(`  ${i + 1}. ${p.name}: ${p.difficultyLabel} score=${p.meta?.score} clues=${p.difficulty.clueCount} islands=${p.difficulty.islandClues} bridges=${p.difficulty.bridgeCount} calls=${p.difficulty.solverCalls}`);
}

// Write full results
fs.writeFileSync('hard_puzzles_generated.json', JSON.stringify(results, null, 2));
console.log(`\nSaved ${results.length} puzzles → hard_puzzles_generated.json`);
