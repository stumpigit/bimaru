const fs = require('fs');

// 1. Read the HTML file
const html = fs.readFileSync('bimaru-harbor.html', 'utf8');

// 2. Extract ARCHIPELAGO_LIBRARY — everything after "ARCHIPELAGO_LIBRARY=["
const libMatch = html.match(/ARCHIPELAGO_LIBRARY=\[(.+)/s);
if (!libMatch) {
  console.error('Could not find ARCHIPELAGO_LIBRARY');
  process.exit(1);
}

const arrContent = libMatch[1];

// Find the outermost closing bracket for the array
let depth = 0;
let endIdx = -1;
for (let i = 0; i < arrContent.length; i++) {
  if (arrContent[i] === '[') depth++;
  else if (arrContent[i] === ']') {
    depth--;
    if (depth === -1) { endIdx = i; break; }
  }
}

if (endIdx === -1) {
  console.error('Could not find end of ARCHIPELAGO_LIBRARY array');
  process.exit(1);
}

const jsonStr = '[' + arrContent.substring(0, endIdx) + ']';

// 3. Parse all puzzle objects
let puzzles;
try {
  puzzles = JSON.parse(jsonStr);
} catch (e) {
  console.error('JSON parse error:', e.message);
  process.exit(1);
}

// 4. Helper: count islands in clue object (values starting with 'i')
function countIslands(cl) {
  if (!cl) return 0;
  return Object.values(cl).filter(v => typeof v === 'string' && v.startsWith('i')).length;
}

// 5. Classify difficulty
function classify(p) {
  const cc = p.meta.clueCount || Object.keys(p.cl || {}).length;
  const islands = countIslands(p.cl);
  const sc = p.meta.solverCalls || 0;
  const bc = p.meta.harborBridgeCount || 0;

  if (cc >= 9 && islands <= 1 && sc < 5000) {
    return '⭐ Easy';
  }
  if (cc >= 7 && cc <= 9 && islands >= 1 && islands <= 2 && sc >= 5000 && sc <= 30000) {
    return '⭐⭐ Medium';
  }
  if (cc >= 5 && cc <= 7 && islands >= 2 && sc > 30000 && bc >= 2) {
    return '⭐⭐⭐ Hard';
  }
  if (cc <= 5 && islands >= 3 && sc > 50000) {
    return '⭐⭐⭐⭐ Expert';
  }
  return '🔵 Unclassified';
}

// 6. Print header
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  ARCHIPELAGO LIBRARY — Puzzle Analysis');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`  Total puzzles: ${puzzles.length}`);
console.log('');

// 7. Table header
console.log('  ┌───────────────────────────────────────────────────────────────┐');
console.log('  │  PUZZLE  │  CLUES  │ ISL.  │ SOLVER   │ SCORE  │ HARBOR  │  META  │');
console.log('  ├───────────────────────────────────────────────────────────────┤');

// 8. Print each puzzle row
const rows = puzzles.map((p, idx) => {
  const cl = p.cl || {};
  const meta = p.meta || {};
  const clueCount = meta.clueCount || Object.keys(cl).length;
  const islands = countIslands(cl);
  const solverCalls = meta.solverCalls || 0;
  const score = meta.score || 0;
  const zeroLines = meta.zeroLines || 0;
  const hasHarbor = !!meta.harbor;
  const sampleIndex = meta.sampleIndex != null ? meta.sampleIndex : '—';
  const curated = meta.curated || '—';
  const bridgeCount = meta.harborBridgeCount != null ? meta.harborBridgeCount : '—';
  const diff = classify(p);
  const sig = Object.entries(cl)
    .sort(([a], [b]) => +a - +b)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');

  return {
    idx: idx + 1,
    clueCount, islands, solverCalls, score, zeroLines,
    hasHarbor, sampleIndex, curated, bridgeCount, diff, sig,
    metaKeys: Object.keys(meta).join(', '),
  };
});

rows.forEach(r => {
  const num = `#${String(r.idx).padStart(2)}`;
  const cc = String(r.clueCount).padStart(6);
  const isl = String(r.islands).padStart(5);
  const sc = String(r.solverCalls).padStart(9);
  const s = String(r.score).padStart(7);
  const hb = r.hasHarbor ? 'Y' : 'N';
  const si = String(r.sampleIndex).padEnd(5);
  const cu = String(r.curated).padEnd(22);
  const bc = String(r.bridgeCount).padEnd(5);
  const diff = r.diff.padEnd(13);
  const zl = String(r.zeroLines).padStart(6);

  console.log(`  │ ${num} │ ${cc} │ ${isl} │ ${sc} │ ${s} │ ${hb} │ ${si} │ ${cu} │ ${bc} │ ${diff} │`);
  console.log(`  │ ${zl} │ ${r.metaKeys}`);
  console.log(`  │   Clue map: ${r.sig}`);
  console.log(`  └───────────────────────────────────────────────────────────────┘`);
});

// 9. Summary
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════');

const counts = {};
rows.forEach(r => { counts[r.diff] = (counts[r.diff] || 0) + 1; });
for (const [diff, count] of Object.entries(counts)) {
  console.log(`  ${diff.padEnd(20)} ${count}`);
}

const harborCount = rows.filter(r => r.hasHarbor).length;
console.log(`  Harbor puzzles                   ${harborCount}`);

const maxSolver = Math.max(...rows.map(r => r.solverCalls));
const minSolver = Math.min(...rows.map(r => r.solverCalls));
const avgSolver = Math.round(rows.reduce((s, r) => s + r.solverCalls, 0) / rows.length);
console.log(`  Solver calls: min=${minSolver.toLocaleString()}, max=${maxSolver.toLocaleString()}, avg=${avgSolver.toLocaleString()}`);

const maxClues = Math.max(...rows.map(r => r.clueCount));
const minClues = Math.min(...rows.map(r => r.clueCount));
console.log(`  Clue count:   min=${minClues}, max=${maxClues}`);

const maxIslands = Math.max(...rows.map(r => r.islands));
const minIslands = Math.min(...rows.map(r => r.islands));
console.log(`  Island count: min=${minIslands}, max=${maxIslands}`);

const maxScore = Math.max(...rows.map(r => r.score));
const minScore = Math.min(...rows.map(r => r.score));
console.log(`  Score:      min=${minScore}, max=${maxScore}`);

console.log('');

// 10. Full detail per puzzle
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  FULL META DETAIL (every puzzle)');
console.log('═══════════════════════════════════════════════════════════════════');

rows.forEach(r => {
  const p = puzzles[r.idx - 1];
  const meta = p.meta || {};
  const cl = p.cl || {};
  const islandClues = Object.entries(cl)
    .filter(([k, v]) => v.startsWith('i'))
    .map(([k, v]) => `${k}=${v}`);
  const shipClues = Object.entries(cl)
    .filter(([k, v]) => !v.startsWith('i'))
    .map(([k, v]) => `${k}=${v}`);

  console.log(`\n  Puzzle ${r.idx}:`);
  console.log(`    clueCount   : ${r.clueCount}`);
  console.log(`    islands     : ${r.islands} (${islandClues.join(', ') || 'none'})`);
  console.log(`    shipClues   : ${shipClues.length} (${shipClues.join(', ') || 'none'})`);
  console.log(`    solverCalls : ${r.solverCalls}`);
  console.log(`    noIslandCalls: ${meta.noIslandCalls || 'N/A'}`);
  console.log(`    zeroLines   : ${r.zeroLines}`);
  console.log(`    score       : ${r.score}`);
  console.log(`    bridgeCount : ${r.bridgeCount} (harborBridgeCount in meta)`);
  console.log(`    harbor      : ${r.hasHarbor}`);
  console.log(`    sampleIndex : ${r.sampleIndex}`);
  console.log(`    curated     : ${r.curated}`);
  console.log(`    meta keys   : [${r.metaKeys}]`);
  console.log(`    difficulty  : ${r.diff}`);

  // Check which classification criteria it meets
  console.log(`    ── Difficulty criteria ──`);
  console.log(`       Easy   (cc≥9, isl≤1, sc<5000): cc=${r.clueCount}≥9=${r.clueCount>=9}, isl=${r.islands}≤1=${r.islands<=1}, sc=${r.solverCalls}<5000=${r.solverCalls<5000}`);
  console.log(`       Medium (7≤cc≤9, 1≤isl≤2, 5k≤sc≤30k): 7≤${r.clueCount}≤9=${r.clueCount>=7&&r.clueCount<=9}, 1≤${r.islands}≤2=${r.islands>=1&&r.islands<=2}, 5000≤${r.solverCalls}≤30000=${r.solverCalls>=5000&&r.solverCalls<=30000}`);
  console.log(`       Hard   (5≤cc≤7, isl≥2, sc>30k, bc≥2): 5≤${r.clueCount}≤7=${r.clueCount>=5&&r.clueCount<=7}, isl=${r.islands}≥2=${r.islands>=2}, sc=${r.solverCalls}>30000=${r.solverCalls>30000}, bc=${r.bridgeCount}≥2=${(typeof r.bridgeCount==='number'&&r.bridgeCount>=2)}`);
  console.log(`       Expert (cc≤5, isl≥3, sc>50k): cc=${r.clueCount}≤5=${r.clueCount<=5}, isl=${r.islands}≥3=${r.islands>=3}, sc=${r.solverCalls}>50000=${r.solverCalls>50000}`);
});

console.log('');
