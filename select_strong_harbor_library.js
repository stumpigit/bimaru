#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DEPTH_PATH = path.join(ROOT, 'logical_depth_score.js');

let code = fs.readFileSync(DEPTH_PATH, 'utf8')
  .replace(/main\(\);\s*$/, 'module.exports={analyzePuzzle,classifyByLogicalDepth};');
const sandbox = { console, require, module: { exports: {} }, exports: {}, __dirname: ROOT, __filename: DEPTH_PATH };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: DEPTH_PATH });
const { analyzePuzzle, classifyByLogicalDepth } = sandbox.module.exports;

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function maybeLoadHistoricalLibrary(commit, file) {
  try {
    const txt = execSync(`git -C ${ROOT} show ${commit}:${file}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const rows = JSON.parse(txt);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function maybeLoadHistoricalHtmlLibrary(commit, file) {
  try {
    const txt = execSync(`git -C ${ROOT} show ${commit}:${file}`, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 20 * 1024 * 1024 }).toString();
    const m = txt.match(/var ARCHIPELAGO_LIBRARY=(\[[\s\S]*?\]);/);
    if (!m) return [];
    const rows = JSON.parse(m[1]);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function clueStats(cl) {
  const vals = Object.values(cl || {});
  const islandVals = vals.filter(v => /^i/.test(v)).map(v => Number(v.slice(1))).sort((a, b) => a - b);
  return {
    clues: vals.length,
    islands: islandVals.length,
    islandVals,
    maxIsland: islandVals.length ? Math.max(...islandVals) : 0,
    ship: vals.filter(v => v === 's' || v === 'e' || v === 'm').length,
    singles: vals.filter(v => v === 's').length,
    ends: vals.filter(v => v === 'e').length,
    mids: vals.filter(v => v === 'm').length,
    water: vals.filter(v => v === 'w').length,
  };
}

function relationalScore(p, a) {
  const s = clueStats(p.cl);
  const isOneIslandMinimal = (p.meta?.style === 'one-island-minimal');
  const isOneIslandFamily = (p.meta?.style === 'one-island-family');
  let score = 0;

  // Keep some measured deduction signal, but lower than before.
  score += a.logicalDepth * 520;
  score += a.pctDepthGe3 * 45;
  score += a.pctDepthGe2 * 18;
  score += a.avgChainLength * 90;
  score += Math.min(120, ((p.meta?.solverCalls) || 0) / 400);
  if (a.needsBacktracking) score += 40;

  // Human-facing sparsity / relational reasoning bias.
  if (isOneIslandMinimal) score += 1400;
  if (isOneIslandFamily) score += 900;
  if (s.islands === 1) score += 320;
  else if (s.islands === 2) score += 120;
  else score -= (s.islands - 2) * 320;

  if (s.maxIsland >= 4) score += 120;
  else if (s.maxIsland >= 3) score += 40;

  if (s.ship <= 4) score += 220;
  else if (s.ship === 5) score += 60;

  const isLegacySparseTripleMid = s.clues === 5 && s.islands === 2 && s.ship === 3 && s.mids === 3 && s.ends === 0 && s.singles === 0 && s.maxIsland >= 4;
  if (isLegacySparseTripleMid) score += 520;

  score -= s.ship * 150;
  score -= s.mids * 260;
  score -= s.ends * 110;
  score -= s.singles * 60;
  score -= s.clues * 24;
  score -= s.water * 150;

  return Math.round(score);
}

function relationalEnough(p, a) {
  const s = clueStats(p.cl);
  const isOneIslandMinimal = (p.meta?.style === 'one-island-minimal');
  const isOneIslandFamily = (p.meta?.style === 'one-island-family');
  if (isOneIslandMinimal) {
    return s.water <= 1 && s.islands === 1 && s.maxIsland >= 3 && s.ship <= 1 && s.clues === 2;
  }
  if (isOneIslandFamily) {
    return s.islands === 1 && s.maxIsland >= 3 && s.clues === 3 && s.ship >= 1 && s.ship <= 2 && s.water <= 1;
  }
  if (s.water > 0) return false;
  if (s.islands < 1 || s.islands > 2) return false;
  if (s.maxIsland < 3) return false;
  if (s.ship < 3 || s.ship > 5) return false;
  if (s.clues < 5 || s.clues > 8) return false;
  const isLegacySparseTripleMid = s.clues === 5 && s.islands === 2 && s.ship === 3 && s.mids === 3 && s.ends === 0 && s.singles === 0 && s.maxIsland >= 4;
  if (s.mids > 2 && !isLegacySparseTripleMid) return false;
  if (s.ends > 3) return false;

  if (isLegacySparseTripleMid) return true;

  // Lower floor than the old library curation: we want sparse/global puzzles
  // even if the current depth analyzer underrates them.
  if (a.logicalDepth >= 2) return true;
  if (a.pctDepthGe2 >= 8 && s.ship <= 5) return true;
  return false;
}

const sources = [];
for (const name of [
  'hard_puzzles_generated.json',
  'hard_puzzles_run_a.json',
  'hard_puzzles_run_b.json',
  'hard_puzzles_run_c.json',
  'one_island_minimal_library.json',
  'one_island_family_library.json',
]) {
  const filePath = path.join(ROOT, name);
  if (!fs.existsSync(filePath)) continue;
  const rows = loadJsonFile(filePath);
  for (const p of rows) sources.push({ source: name, puzzle: p });
}

for (const p of maybeLoadHistoricalLibrary('8a24b26', 'bimaru-harbor-library.json')) {
  sources.push({ source: 'history:8a24b26:bimaru-harbor-library.json', puzzle: p });
}
for (const p of maybeLoadHistoricalHtmlLibrary('a471a46', 'bimaru-harbor.html')) {
  sources.push({ source: 'history:a471a46:bimaru-harbor.html', puzzle: p });
}
for (const p of maybeLoadHistoricalHtmlLibrary('fbba6c5', 'bimaru-harbor.html')) {
  sources.push({ source: 'history:fbba6c5:bimaru-harbor.html', puzzle: p });
}

const seen = new Set();
const ranked = [];
for (const { source, puzzle } of sources) {
  const sig = JSON.stringify({
    rc: puzzle.rc,
    cc: puzzle.cc,
    cl: Object.entries(puzzle.cl || {}).sort((a, b) => Number(a[0]) - Number(b[0])),
  });
  if (seen.has(sig)) continue;
  seen.add(sig);
  const analysis = analyzePuzzle(JSON.parse(JSON.stringify(puzzle)));
  const stats = clueStats(puzzle.cl);
  ranked.push({
    source,
    puzzle,
    analysis,
    stats,
    difficulty: classifyByLogicalDepth(analysis),
    relational: relationalEnough(puzzle, analysis),
    score: relationalScore(puzzle, analysis),
  });
}

ranked.sort((x, y) =>
  y.score - x.score ||
  x.stats.ship - y.stats.ship ||
  x.stats.clues - y.stats.clues ||
  x.stats.islands - y.stats.islands
);

function shapeKey(r) {
  return `${r.puzzle.rc.join(',')}|${r.puzzle.cc.join(',')}`;
}
function styleKey(r) {
  if (r.puzzle.meta?.style === 'one-island-minimal') return 'one-island-minimal-v1';
  if (r.puzzle.meta?.style === 'one-island-family') return 'one-island-family-v1';
  return 'relational-sparse-v1';
}
function displayDifficulty(r) {
  if (r.puzzle.meta?.style === 'one-island-minimal') return 'hard';
  if (r.puzzle.meta?.style === 'one-island-family') {
    if (r.analysis.logicalDepth >= 3 || r.analysis.pctDepthGe2 >= 8) return 'medium';
    return 'hard';
  }
  if (r.analysis.logicalDepth >= 3 || r.analysis.pctDepthGe2 >= 10) return 'medium';
  return 'hard';
}

const relational = ranked.filter(r => r.relational);
const selected = [];
const used = new Set();
const perShape = new Map();
function canTake(r, maxSameShape) {
  const sig = shapeKey(r);
  return !used.has(r) && (perShape.get(sig) || 0) < maxSameShape;
}
function takeFrom(pool, count, maxSameShape, extraPredicate = () => true) {
  for (const r of pool) {
    if (selected.length >= 12 || count <= 0) break;
    if (!canTake(r, maxSameShape) || !extraPredicate(r)) continue;
    selected.push(r);
    used.add(r);
    const sig = shapeKey(r);
    perShape.set(sig, (perShape.get(sig) || 0) + 1);
    count--;
  }
}

const minimalPool = relational.filter(r => r.puzzle.meta?.style === 'one-island-minimal');
const familyPool = relational.filter(r => r.puzzle.meta?.style === 'one-island-family');
const legacyPool = relational.filter(r => !r.puzzle.meta?.style);

// Keep a few sparse 1-island hammers, but stop them from dominating the whole set.
takeFrom(minimalPool, 2, 3);
// Main target band: medium-hard sparse puzzles with one island and one extra clue.
takeFrom(familyPool, 3, 3, r => r.analysis.logicalDepth >= 2 || r.analysis.pctDepthGe2 >= 8 || r.stats.water > 0);
// Prioritize structurally different legacy puzzles for variety and less lookahead-heavy solving.
takeFrom(legacyPool, 5, 1, r => r.analysis.logicalDepth >= 2 && r.stats.clues <= 6);
// Add more varied legacy candidates before more repeats of the same 1-island shape.
takeFrom(legacyPool, 2, 1);
// Fill the rest from the best remaining family/legacy rows, with a strict shape cap.
takeFrom(familyPool, 12, 3);
takeFrom(legacyPool, 12, 1);
takeFrom(minimalPool, 12, 3);

const curated = selected
  .slice(0, 12)
  .map((r, i) => ({
    id: i + 1,
    name: `Harbor Logic #${i + 1}`,
    difficulty: displayDifficulty(r),
    grid: r.puzzle.grid,
    rc: r.puzzle.rc,
    cc: r.puzzle.cc,
    cl: r.puzzle.cl,
    meta: Object.assign({}, r.puzzle.meta || {}, {
      logicalDepth: r.analysis.logicalDepth,
      chainLength: r.analysis.avgChainLength,
      pctDepthGe2: r.analysis.pctDepthGe2,
      pctDepthGe3: r.analysis.pctDepthGe3,
      needsBacktracking: r.analysis.needsBacktracking,
      selectedFrom: r.source,
      score: r.score,
      curationStyle: styleKey(r),
      depthDifficulty: r.difficulty,
    }),
  }));

fs.writeFileSync(path.join(ROOT, 'selected_strong_harbor_library.json'), JSON.stringify(curated, null, 2) + '\n');
console.log(JSON.stringify({
  totalSources: ranked.length,
  relationalCount: ranked.filter(r => r.relational).length,
  curated: curated.length,
  top: curated.map(p => ({
    id: p.id,
    name: p.name,
    diff: p.difficulty,
    clues: Object.keys(p.cl).length,
    ship: Object.values(p.cl).filter(v => v === 's' || v === 'e' || v === 'm').length,
    islands: Object.values(p.cl).filter(v => /^i/.test(v)).length,
    rc: p.rc.join(','),
    cc: p.cc.join(','),
    ld: p.meta.logicalDepth,
    pg2: p.meta.pctDepthGe2,
    pg3: p.meta.pctDepthGe3,
    src: p.meta.selectedFrom,
    style: p.meta.curationStyle,
    score: p.meta.score,
  })),
}, null, 2));
