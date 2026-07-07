#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, 'bimaru-harbor.html');
const DEPTH_PATH = path.join(ROOT, 'logical_depth_score.js');

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function loadHarborContext() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('Could not extract <script> from bimaru-harbor.html');
  let js = match[1];
  js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
  js = js.replace(/newGame\(\);\s*$/, '');

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance: { now: () => Date.now() },
    Blob: function Blob(parts) { this.parts = parts; },
    URL: { createObjectURL() { return 'blob:dummy'; }, revokeObjectURL() {} },
    Worker: function Worker() { throw new Error('Worker not available in generator sandbox'); },
    Math,
    JSON,
    Date,
  };
  const dummyEl = () => ({
    textContent: '',
    className: '',
    innerHTML: '',
    addEventListener() {},
    appendChild() {},
    removeChild() {},
    classList: { add() {}, remove() {} },
    dataset: {},
    style: {},
  });
  sandbox.document = {
    getElementById() { return dummyEl(); },
    querySelector() { return dummyEl(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return dummyEl(); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: HTML_PATH });
  return sandbox;
}

function loadDepthTools() {
  let code = fs.readFileSync(DEPTH_PATH, 'utf8');
  code = code.replace(/main\(\);\s*$/, 'module.exports = { analyzePuzzle, classifyByLogicalDepth };');
  const sandbox = {
    console,
    require,
    module: { exports: {} },
    exports: {},
    __dirname: ROOT,
    __filename: DEPTH_PATH,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: DEPTH_PATH });
  return sandbox.module.exports;
}

const ctx = loadHarborContext();
const { analyzePuzzle, classifyByLogicalDepth } = loadDepthTools();

function countShipClues(cl) {
  return Object.values(cl || {}).filter(v => v === 's' || v === 'e' || v === 'm').length;
}

function countSingles(cl) {
  return Object.values(cl || {}).filter(v => v === 's').length;
}

function countWaterClues(cl) {
  return Object.values(cl || {}).filter(v => v === 'w').length;
}

function countIslandCluesLocal(cl) {
  return Object.values(cl || {}).filter(v => typeof v === 'string' && /^i\d+$/.test(v)).length;
}

function islandValues(cl) {
  return Object.values(cl || {})
    .filter(v => typeof v === 'string' && /^i\d+$/.test(v))
    .map(v => Number(v.slice(1)));
}

function puzzleSignature(p) {
  const clueEntries = Object.entries(p.cl || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  return JSON.stringify({ rc: p.rc, cc: p.cc, cl: clueEntries });
}

function summarizePuzzle(p, analysis, dep) {
  const vals = Object.values(p.cl || {});
  const islandVals = vals.filter(v => /^i\d+$/.test(v)).map(v => Number(v.slice(1)));
  const shipClues = vals.filter(v => v === 's' || v === 'e' || v === 'm').length;
  const waterClues = vals.filter(v => v === 'w').length;
  const singles = vals.filter(v => v === 's').length;
  const mids = vals.filter(v => v === 'm').length;
  const ends = vals.filter(v => v === 'e').length;
  const clueCount = vals.length;
  const bridge = p.meta?.harborBridgeCount ?? 0;
  const highIslands = islandVals.filter(v => v >= 3).length;
  return {
    clueCount,
    islandClues: islandVals.length,
    islandVals,
    islandValueSum: islandVals.reduce((a, b) => a + b, 0),
    shipClues,
    waterClues,
    singles,
    mids,
    ends,
    bridge,
    zeroLines: p.meta?.zeroLines ?? 0,
    solverCalls: p.meta?.solverCalls ?? 0,
    logicalDepth: analysis.logicalDepth,
    avgChainLength: analysis.avgChainLength,
    pctDepthGe2: analysis.pctDepthGe2,
    pctDepthGe3: analysis.pctDepthGe3,
    directRounds: analysis.directRounds,
    needsBacktracking: !!analysis.needsBacktracking,
    solved: !!analysis.solved,
    islandEssential: !!dep?.essential,
    islandSolutions: dep?.solutions ?? 0,
    islandExact: dep?.exact !== false,
    highIslands,
    difficulty: classifyByLogicalDepth(analysis),
  };
}

function isStrong(summary) {
  if (!summary.solved) return false;
  if (!summary.islandEssential || !summary.islandExact) return false;
  if (summary.waterClues > 0) return false;
  if (summary.singles > 1) return false;
  if (summary.islandClues < 2) return false;
  if (summary.highIslands < 1) return false;
  if (summary.logicalDepth >= 4) return true;
  if (summary.pctDepthGe3 >= 6) return true;
  if (summary.pctDepthGe2 >= 18 && summary.shipClues <= 7) return true;
  return false;
}

function hardnessScore(summary) {
  let score = 0;
  score += summary.logicalDepth * 1200;
  score += summary.pctDepthGe3 * 90;
  score += summary.pctDepthGe2 * 35;
  score += summary.avgChainLength * 180;
  score += Math.min(300, summary.solverCalls / 120);
  score += summary.bridge * 45;
  score += summary.highIslands * 80;
  score += summary.islandValueSum * 18;
  if (summary.needsBacktracking) score += 180;

  score -= summary.clueCount * 38;
  score -= summary.shipClues * 34;
  score -= summary.waterClues * 140;
  score -= summary.singles * 90;
  score -= Math.max(0, summary.shipClues - 6) * 90;
  score -= Math.max(0, summary.clueCount - 9) * 70;
  score -= summary.zeroLines * 22;

  if (summary.difficulty === 'expert') score += 420;
  else if (summary.difficulty === 'hard') score += 180;

  return Math.round(score);
}

function annotateUnique(p) {
  const check = ctx.countSolutionsForPuzzle(clone(p), 2, 180000);
  if (!(check.exact && check.solutions === 1)) return null;
  const out = clone(p);
  out.meta = Object.assign({}, out.meta || {}, {
    uniqueChecked: true,
    uniquenessExact: true,
    solverCalls: check.calls,
    clueCount: Object.keys(out.cl || {}).length,
    zeroLines: ctx.zeroLinesScore({ r: out.rc, c: out.cc }),
  });
  return out;
}

function analyzeCandidate(p, sourceTag) {
  const exact = annotateUnique(p);
  if (!exact) return null;
  const dep = ctx.islandDependencyReport(clone(exact));
  if (!(dep?.essential && dep?.exact && dep?.solutions >= 2)) return null;
  exact.meta = Object.assign({}, exact.meta || {}, { islandDependency: dep });
  const analysis = analyzePuzzle(clone(exact));
  const summary = summarizePuzzle(exact, analysis, dep);
  if (!isStrong(summary)) return null;
  exact.meta = Object.assign({}, exact.meta || {}, {
    logicalDepth: analysis.logicalDepth,
    chainLength: analysis.avgChainLength,
    pctDepthGe2: analysis.pctDepthGe2,
    pctDepthGe3: analysis.pctDepthGe3,
    needsBacktracking: analysis.needsBacktracking,
    directRounds: analysis.directRounds,
  });
  const score = hardnessScore(summary);
  exact.meta.score = score;
  return { puzzle: exact, summary, score, sourceTag };
}

function shipCandidatesFromSolution(harbor) {
  const flat = harbor.grid;
  const islands = harbor.islands || [];
  const islandSet = new Set(islands.map(x => `${x.r},${x.c}`));
  const candidates = [];

  for (let i = 0; i < flat.length; i++) {
    if (flat[i] !== ctx.SH) continue;
    const r = Math.floor(i / ctx.N);
    const c = i % ctx.N;
    const t = ctx.clueTypeForCell(flat, r, c);
    let nearIsland = 0;
    for (const isl of islands) {
      const d = Math.abs(isl.r - r) + Math.abs(isl.c - c);
      if (d === 1) nearIsland++;
    }
    const rowNeed = harbor.meta?.rowCounts ? harbor.meta.rowCounts[r] : harbor.rc?.[r] ?? 0;
    const colNeed = harbor.meta?.colCounts ? harbor.meta.colCounts[c] : harbor.cc?.[c] ?? 0;
    const centrality = 8 - (Math.abs(r - 4) + Math.abs(c - 4));
    candidates.push({
      i, r, c, t, nearIsland, rowNeed, colNeed, centrality,
      weight: (t === 'm' ? 40 : t === 'e' ? 26 : 8) + nearIsland * 20 + centrality + rowNeed + colNeed,
      islandAdj: islandSet.has(`${r-1},${c}`) || islandSet.has(`${r+1},${c}`) || islandSet.has(`${r},${c-1}`) || islandSet.has(`${r},${c+1}`),
    });
  }

  return candidates;
}

function orderedCandidates(candidates, mode) {
  const arr = candidates.slice();
  if (mode === 'depth-first') {
    arr.sort((a, b) => (b.weight - a.weight) || (b.centrality - a.centrality) || (Math.random() < 0.5 ? -1 : 1));
  } else if (mode === 'minimal') {
    arr.sort((a, b) => {
      const ap = (a.t === 'm' ? 0 : a.t === 'e' ? 1 : 3) + (a.nearIsland ? -2 : 0);
      const bp = (b.t === 'm' ? 0 : b.t === 'e' ? 1 : 3) + (b.nearIsland ? -2 : 0);
      return ap - bp || b.weight - a.weight || (Math.random() < 0.5 ? -1 : 1);
    });
  } else if (mode === 'balanced') {
    arr.sort((a, b) => {
      const ap = (a.t === 'm' ? 0 : a.t === 'e' ? 1 : 2);
      const bp = (b.t === 'm' ? 0 : b.t === 'e' ? 1 : 2);
      return ap - bp || b.nearIsland - a.nearIsland || b.weight - a.weight || (Math.random() < 0.5 ? -1 : 1);
    });
  } else {
    arr.sort(() => Math.random() - 0.5);
  }
  return arr;
}

function ensureUniqueWithStrategy(harbor, mode, maxClues) {
  const base = clone(ctx.createInitialPuzzle(clone(harbor)));
  let current = annotateUnique(base);
  if (current) return current;

  const candidates = orderedCandidates(shipCandidatesFromSolution(harbor), mode);
  for (const cand of candidates) {
    if ((Object.keys(base.cl || {}).length) >= maxClues) break;
    if (base.cl[cand.i] !== undefined) continue;
    if (cand.t === 's' && mode !== 'fallback') continue;
    base.cl[cand.i] = cand.t;
    current = annotateUnique(base);
    if (current) return current;
  }

  if (mode !== 'fallback') {
    return ensureUniqueWithStrategy(harbor, 'fallback', Math.max(maxClues, 10));
  }
  return null;
}

function softMinimize(p, opts = {}) {
  const minClues = opts.minClues ?? 6;
  const keepAtLeastIslands = opts.minIslandClues ?? 2;
  let best = clone(p);
  let changed = true;

  while (changed) {
    changed = false;
    const keys = Object.keys(best.cl || {}).sort((a, b) => {
      const ta = best.cl[a], tb = best.cl[b];
      const pa = ta === 'w' ? -100 : ta === 's' ? 0 : ta === 'e' ? 10 : ta === 'm' ? 20 : 100;
      const pb = tb === 'w' ? -100 : tb === 's' ? 0 : tb === 'e' ? 10 : tb === 'm' ? 20 : 100;
      return pa - pb || (Math.random() < 0.5 ? -1 : 1);
    });
    for (const key of keys) {
      const t = best.cl[key];
      if (/^i\d+$/.test(t) && countIslandCluesLocal(best.cl) <= keepAtLeastIslands) continue;
      if (Object.keys(best.cl).length <= minClues) break;
      const cand = clone(best);
      delete cand.cl[key];
      const exact = annotateUnique(cand);
      if (!exact) continue;
      best = exact;
      changed = true;
      break;
    }
  }
  return best;
}

function candidateVariants(uniqueBase) {
  const variants = [];
  variants.push(clone(uniqueBase));

  const soft6 = softMinimize(uniqueBase, { minClues: 6, minIslandClues: 2 });
  variants.push(soft6);

  const soft7 = softMinimize(uniqueBase, { minClues: 7, minIslandClues: 2 });
  variants.push(soft7);

  const strengthened = ctx.strengthenIslandDependency(clone(uniqueBase)) || clone(uniqueBase);
  variants.push(strengthened);

  const strengthenedSoft = ctx.strengthenIslandDependency(clone(soft7)) || clone(soft7);
  variants.push(strengthenedSoft);

  const minimized = ctx.minimizePuzzle(clone(uniqueBase));
  if (minimized) variants.push(minimized);

  const dedup = new Map();
  for (const v of variants) {
    if (!v) continue;
    dedup.set(puzzleSignature(v), v);
  }
  return [...dedup.values()];
}

function generateOneStrongCandidate() {
  for (let outer = 0; outer < 16; outer++) {
    const harbor = ctx.genHarborSolution();
    if (!harbor) continue;
    const strategySpecs = [
      ['depth-first', 9],
      ['balanced', 8],
      ['minimal', 7],
      ['depth-first', 10],
    ];

    let best = null;
    for (const [mode, maxClues] of strategySpecs) {
      const unique = ensureUniqueWithStrategy(harbor, mode, maxClues);
      if (!unique) continue;
      const vars = candidateVariants(unique);
      for (const v of vars) {
        const analyzed = analyzeCandidate(v, `${mode}/${maxClues}`);
        if (!analyzed) continue;
        if (!best || analyzed.score > best.score) best = analyzed;
      }
    }
    if (best) return best;
  }
  return null;
}

function difficultyOrder(diff) {
  return diff === 'expert' ? 0 : diff === 'hard' ? 1 : diff === 'medium' ? 2 : 3;
}

function main() {
  const target = Number(process.argv[2] || 24);
  const maxAttempts = Number(process.argv[3] || 320);
  const timeLimitSec = Number(process.argv[4] || 1200);
  const outPath = path.join(ROOT, 'very_hard_puzzles_generated.json');
  const logPath = path.join(ROOT, 'very_hard_puzzles_generation.log');
  fs.writeFileSync(logPath, '');

  const chosen = [];
  const seen = new Set();
  const started = Date.now();

  console.log(`=== Very Hard Harbor Generator ===`);
  console.log(`target=${target} maxAttempts=${maxAttempts} timeLimitSec=${timeLimitSec}`);

  for (let attempt = 1; attempt <= maxAttempts && chosen.length < target; attempt++) {
    const elapsedSec = (Date.now() - started) / 1000;
    if (elapsedSec > timeLimitSec) {
      console.log(`Time limit reached after ${elapsedSec.toFixed(1)}s`);
      break;
    }

    const t0 = Date.now();
    const result = generateOneStrongCandidate();
    const ms = Date.now() - t0;

    if (!result) {
      if (attempt % 10 === 0) console.log(`  attempt ${attempt}: no strong candidate (${ms}ms)`);
      fs.appendFileSync(logPath, JSON.stringify({ attempt, ok: false, ms }) + '\n');
      continue;
    }

    const sig = puzzleSignature(result.puzzle);
    if (seen.has(sig)) {
      fs.appendFileSync(logPath, JSON.stringify({ attempt, ok: false, duplicate: true, ms, summary: result.summary }) + '\n');
      continue;
    }
    seen.add(sig);

    chosen.push(result);
    chosen.sort((a, b) => b.score - a.score || a.summary.clueCount - b.summary.clueCount);
    if (chosen.length > target) chosen.pop();

    console.log(
      `  #${chosen.length} @ attempt ${attempt}: ` +
      `${result.summary.difficulty} depth=${result.summary.logicalDepth} ` +
      `p>=2=${result.summary.pctDepthGe2} clues=${result.summary.clueCount} ship=${result.summary.shipClues} ` +
      `score=${result.score} (${ms}ms)`
    );
    fs.appendFileSync(logPath, JSON.stringify({ attempt, ok: true, ms, score: result.score, summary: result.summary }) + '\n');
  }

  chosen.sort((a, b) => {
    const d = difficultyOrder(a.summary.difficulty) - difficultyOrder(b.summary.difficulty);
    if (d !== 0) return d;
    return b.score - a.score || a.summary.clueCount - b.summary.clueCount;
  });

  const payload = chosen.map((entry, i) => ({
    id: i + 1,
    name: `Harbor Hard #${i + 1}`,
    difficulty: entry.summary.difficulty,
    grid: entry.puzzle.grid,
    rc: entry.puzzle.rc,
    cc: entry.puzzle.cc,
    cl: entry.puzzle.cl,
    meta: Object.assign({}, entry.puzzle.meta, {
      sampleIndex: i,
      generator: 'harbor_generate_depth_library',
      generatorSource: entry.sourceTag,
    }),
  }));

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const counts = payload.reduce((acc, p) => {
    acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
    return acc;
  }, {});

  console.log('\n=== Summary ===');
  console.log(JSON.stringify({
    count: payload.length,
    counts,
    outPath,
    logPath,
    top: payload.slice(0, 8).map(p => ({
      id: p.id,
      name: p.name,
      difficulty: p.difficulty,
      clues: Object.keys(p.cl).length,
      shipClues: countShipClues(p.cl),
      singles: countSingles(p.cl),
      islandClues: countIslandCluesLocal(p.cl),
      logicalDepth: p.meta.logicalDepth,
      pctDepthGe2: p.meta.pctDepthGe2,
      pctDepthGe3: p.meta.pctDepthGe3,
      score: p.meta.score,
    })),
  }, null, 2));
}

module.exports = {
  ctx,
  analyzePuzzle,
  classifyByLogicalDepth,
  annotateUnique,
  analyzeCandidate,
  ensureUniqueWithStrategy,
  candidateVariants,
  generateOneStrongCandidate,
  hardnessScore,
  summarizePuzzle,
  puzzleSignature,
};

if (require.main === module) {
  main();
}
