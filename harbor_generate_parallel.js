const fs = require('fs');
const { spawn } = require('child_process');

const target = 25; // target unique puzzles
const numWorkers = 3;
const found = [];
const seenSigs = new Set();
const startTime = Date.now();

function addPuzzle(result) {
  if (!result || !result.ok || !result.puzzle) return false;
  const p = result.puzzle;
  const sig = JSON.stringify({
    rc: p.rc,
    cc: p.cc,
    cl: Object.entries(p.cl).sort((a, b) => Number(a[0]) - Number(b[0]))
  });
  if (seenSigs.has(sig)) return false;
  seenSigs.add(sig);

  const vals = Object.values(p.cl || {});
  const clueCount = vals.length;
  const islandClues = vals.filter(v => /^i/.test(v)).length;
  const bridgeCount = (p.meta && p.meta.harborBridgeCount) || 0;
  const solverCalls = (p.meta && p.meta.solverCalls) || 0;
  const shipClues = vals.filter(v => v === 's' || v === 'e' || v === 'm').length;
  const dep = result.summary || {};

  let diff = 'easy';
  if (clueCount <= 5 && islandClues >= 3 && solverCalls > 50000 && bridgeCount >= 2) diff = 'expert';
  else if (clueCount >= 5 && clueCount <= 7 && islandClues >= 2 && solverCalls > 30000 && bridgeCount >= 2) diff = 'hard';
  else if (clueCount >= 7 && clueCount <= 9 && islandClues >= 1 && solverCalls >= 5000) diff = 'medium';
  if (clueCount <= 5 && islandClues >= 2 && bridgeCount >= 2) {
    diff = 'hard';
    if (islandClues >= 3) diff = 'expert';
  }
  if (solverCalls < 5000 && clueCount >= 9) diff = 'easy';

  const labels = { easy: '⭐ Einfach', medium: '⭐⭐ Mittel', hard: '⭐⭐⭐ Schwer', expert: '⭐⭐⭐⭐ Experte' };

  const entry = {
    id: found.length,
    grid: p.grid,
    rc: p.rc,
    cc: p.cc,
    cl: p.cl,
    meta: { ...p.meta, sampleIndex: found.length },
    difficulty: diff,
    difficultyLabel: labels[diff],
    name: `Harbor #${found.length}`
  };

  found.push(entry);
  return true;
}

function spawnWorker(id) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['harbor_generate_one_hard.js'], {
      cwd: '/home/cs/bimaru',
      timeout: 60000,
    });
    let stdout = '';
    proc.stdout.on('data', (d) => stdout += d);
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      try {
        const lines = stdout.trim().split('\n');
        const last = lines[lines.length - 1];
        const result = JSON.parse(last);
        const added = addPuzzle(result);
        if (added) {
          const s = result.summary;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          console.log(`  [W${id}] #${found.length}: ${s.clues} clues, ${s.islandClues} island, ${s.bridge} bridge, ${s.solverCalls} calls → ${found[found.length-1].difficultyLabel} [${elapsed}s]`);
        }
      } catch(e) {
        // ignore parse errors
      }
      resolve();
    });
    proc.on('error', () => resolve());
  });
}

async function runWorkers() {
  console.log(`\n=== Parallel Harbor Hard Puzzle Generator ===`);
  console.log(`Target: ${target} unique puzzles, ${numWorkers} workers\n`);

  while (found.length < target) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > 180) {
      console.log(`\nTime limit reached (${elapsed}s), stopping.`);
      break;
    }

    const workers = [];
    for (let i = 0; i < numWorkers; i++) {
      workers.push(spawnWorker(i));
    }
    await Promise.all(workers);

    const uniqueCount = found.filter((p, idx) => found.indexOf(p) === idx).length;
    console.log(`  Progress: ${found.length} found (${uniqueCount} unique), need ${target}`);
  }

  // Classify difficulty
  const diffOrder = { expert: 0, hard: 1, medium: 2, easy: 3 };
  found.sort((a, b) => {
    if (a.difficulty !== b.difficulty) return diffOrder[a.difficulty] - diffOrder[b.difficulty];
    return (a.meta?.score || 0) - (b.meta?.score || 0);
  });

  console.log(`\n=== Results: ${found.length} unique puzzles ===`);
  const counts = {};
  for (const p of found) counts[p.difficulty] = (counts[p.difficulty] || 0) + 1;
  console.log(`  Difficulty breakdown: ${JSON.stringify(counts)}`);

  for (let i = 0; i < found.length; i++) {
    const p = found[i];
    console.log(`  ${i + 1}. ${p.name}: ${p.difficultyLabel} score=${p.meta?.score ?? '?'} clues=${Object.keys(p.cl).length} islands=${Object.values(p.cl).filter(v=>/^i/.test(v)).length} bridges=${p.meta?.harborBridgeCount ?? '?'} calls=${p.meta?.solverCalls ?? '?'}`);
  }

  fs.writeFileSync('hard_puzzles_generated.json', JSON.stringify(found, null, 2));
  console.log(`\nSaved → hard_puzzles_generated.json`);
}

runWorkers().catch(console.error);
