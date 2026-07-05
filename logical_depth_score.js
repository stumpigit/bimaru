#!/usr/bin/env node
/**
 * logical_depth_score.js
 *
 * Measures "logical depth" of Bimaru Harbor puzzles via constraint propagation.
 */

const fs = require('fs');
const path = require('path');

const N = 9;
const UNKNOWN = 0, SHIP = 1, WATER = -1;
const FLEET = { 4: 1, 3: 2, 2: 3, 1: 4 };

function idx(r, c) { return r * N + c; }
function rowOf(i) { return Math.floor(i / N); }
function colOf(i) { return i % N; }
function orthNeighbors(r, c) {
  const n = [];
  if (c > 0) n.push([r, c - 1]);
  if (c < N - 1) n.push([r, c + 1]);
  if (r > 0) n.push([r - 1, c]);
  if (r < N - 1) n.push([r + 1, c]);
  return n;
}
function isIslandClue(t) { return typeof t === 'string' && /^i\d$/.test(t); }
function islandTarget(t) { return Number(t.slice(1)); }

// ===========================================================================
// Utilities
// ===========================================================================

function remainingFleet(grid) {
  const cnt = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const vis = new Array(N * N).fill(false);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = idx(r, c);
      if (grid[i] !== SHIP || vis[i]) continue;
      const cells = [];
      const stk = [[r, c]];
      while (stk.length) {
        const [cr, cc] = stk.pop(), ci = idx(cr, cc);
        if (vis[ci] || grid[ci] !== SHIP) continue;
        vis[ci] = true; cells.push([cr, cc]);
        for (const [nr, nc] of orthNeighbors(cr, cc)) {
          const ni = idx(nr, nc);
          if (!vis[ni] && grid[ni] === SHIP) stk.push([nr, nc]);
        }
      }
      if (cells.length >= 1 && cells.length <= 4) cnt[cells.length]++;
    }
  }
  const rem = {};
  for (const l of Object.keys(FLEET)) rem[+l] = Math.max(0, FLEET[+l] - cnt[+l]);
  return rem;
}

function findShipComponents(grid) {
  const comps = [];
  const vis = new Array(N * N).fill(false);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = idx(r, c);
      if (grid[i] !== SHIP || vis[i]) continue;
      const cells = [];
      const stk = [[r, c]];
      while (stk.length) {
        const [cr, cc] = stk.pop(), ci = idx(cr, cc);
        if (vis[ci] || grid[ci] !== SHIP) continue;
        vis[ci] = true; cells.push([cr, cc]);
        for (const [nr, nc] of orthNeighbors(cr, cc)) {
          const ni = idx(nr, nc);
          if (!vis[ni] && grid[ni] === SHIP) stk.push([nr, nc]);
        }
      }
      comps.push(new Set(cells.map(([cr, cc]) => idx(cr, cc))));
    }
  }
  return comps;
}

function getWaterFromComponents(comps) {
  const waters = [];
  const seen = new Set();
  for (const comp of comps) {
    const arr = [...comp].map(i => ({ r: rowOf(i), c: colOf(i) }));
    const sz = arr.length;
    if (sz < 1 || sz > 4) continue;
    const rows = arr.map(p => p.r), cols = arr.map(p => p.c);
    const sameRow = rows.every(v => v === rows[0]);
    const sameCol = cols.every(v => v === cols[0]);
    if (!sameRow && !sameCol) continue;
    if (sameRow && Math.max(...rows) - Math.min(...rows) + 1 !== sz) continue;
    if (sameCol && Math.max(...cols) - Math.min(...cols) + 1 !== sz) continue;
    for (const cell of arr) {
      for (const [nr, nc] of orthNeighbors(cell.r, cell.c)) {
        const ni = idx(nr, nc);
        if (!comp.has(ni) && !seen.has(ni)) { waters.push([nr, nc]); seen.add(ni); }
      }
    }
  }
  return waters;
}

function diagAllowed(cl, r1, c1, r2, c2) {
  if (Math.abs(r1 - r2) !== 1 || Math.abs(c1 - c2) !== 1) return false;
  return isIslandClue(cl[idx(r1, c2)]) || isIslandClue(cl[idx(r2, c1)]);
}

// ===========================================================================
// Line analysis: enumerate valid placements, compute consensus
// ===========================================================================

/**
 * Enumerate all valid segment placements for one row or column.
 */
function enumerateLinePlacements(line, target, fleet, cl, grid, lineIdx, isRow) {
  const results = [];

  function rec(pos, segs, shipCount, fleetState) {
    if (shipCount === target) {
      // Validate diagonal constraints
      const segCells = new Set();
      for (const seg of segs) {
        for (let j = seg.start; j < seg.start + seg.len; j++) {
          if (isRow) segCells.add(idx(lineIdx, j));
          else segCells.add(idx(j, lineIdx));
        }
      }
      let ok = true;
      for (const ci of segCells) {
        const r = rowOf(ci), c = colOf(ci);
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
          const ni = idx(nr, nc);
          if (grid[ni] === SHIP && !segCells.has(ni)) {
            if (!diagAllowed(cl, r, c, nr, nc)) { ok = false; break; }
          }
        }
        if (!ok) break;
      }
      // Validate ship-type clues
      if (ok) {
        for (const key of Object.keys(cl)) {
          const k = +key, t = cl[key];
          if (t !== 's' && t !== 'e' && t !== 'm') continue;
          const inLine = isRow ? rowOf(k) === lineIdx : colOf(k) === lineIdx;
          if (!inLine) continue;
          const r = rowOf(k), c = colOf(k);
          if (!segCells.has(k)) continue;

          if (t === 's') {
            // Must be size-1 segment
            const mySeg = segs.find(s => {
              for (let j = s.start; j < s.start + s.len; j++) {
                if (isRow ? (lineIdx === r && j === c) : (lineIdx === c && j === r)) return true;
              }
              return false;
            });
            if (!mySeg || mySeg.len !== 1) { ok = false; break; }
          } else if (t === 'e') {
            let sn = 0;
            for (const [dr, dc] of [[0,-1],[0,1],[-1,0],[1,0]]) {
              const nr = r+dr, nc = c+dc;
              if (nr>=0 && nr<N && nc>=0 && nc<N && grid[idx(nr,nc)]===SHIP) sn++;
            }
            if (sn !== 1) { ok = false; break; }
          } else if (t === 'm') {
            const hL = c>0 && grid[idx(r,c-1)]===SHIP;
            const hR = c<N-1 && grid[idx(r,c+1)]===SHIP;
            const vU = r>0 && grid[idx(r-1,c)]===SHIP;
            const vD = r<N-1 && grid[idx(r+1,c)]===SHIP;
            if (!((hL&&hR)||(vU&&vD))) { ok = false; break; }
          }
        }
      }
      if (ok) {
        const cells = new Set();
        for (const seg of segs) {
          for (let j = seg.start; j < seg.start + seg.len; j++) {
            if (isRow) cells.add(idx(lineIdx, j));
            else cells.add(idx(j, lineIdx));
          }
        }
        results.push({ cells, segments: segs });
      }
      return;
    }

    let i = pos;
    while (i < N && line[i] !== UNKNOWN) i++;
    if (i >= N) return;

    for (let len = 4; len >= 1; len--) {
      if (i + len > N || shipCount + len > target || fleet[len] <= 0) continue;
      let ok = true;
      for (let j = 0; j < len; j++) { if (line[i+j] === WATER) { ok = false; break; } }
      if (!ok) continue;
      if (i > 0 && line[i-1] === SHIP) continue;
      if (i + len < N && line[i+len] === SHIP) continue;

      const nf = { ...fleetState }; nf[len]--;
      rec(i + len + 1, [...segs, { start: i, len }], shipCount + len, nf);
    }
  }

  rec(0, [], 0, { ...fleet });
  return results;
}

/**
 * Compute consensus from line placements.
 * Returns { alwaysShipPositions, alwaysWaterPositions } as Sets of positions along the line.
 * Returns empty sets if no valid placement found (puzzle needs backtracking for this line).
 */
function lineConsensus(line, target, fleet, cl, grid, lineIdx, isRow) {
  const placements = enumerateLinePlacements(line, target, fleet, cl, grid, lineIdx, isRow);
  const result = { alwaysShipPositions: new Set(), alwaysWaterPositions: new Set() };

  if (placements.length === 0) return result;

  // Collect all positions used as ship in any placement
  const usedAnywhere = new Set();
  for (const p of placements) {
    for (const ci of p.cells) {
      usedAnywhere.add(isRow ? colOf(ci) : rowOf(ci));
    }
  }

  // Always ship: position that's ship in ALL placements
  for (const pos of usedAnywhere) {
    let inAll = true;
    for (const p of placements) {
      let found = false;
      for (const ci of p.cells) {
        if ((isRow ? colOf(ci) : rowOf(ci)) === pos) { found = true; break; }
      }
      if (!found) { inAll = false; break; }
    }
    if (inAll) result.alwaysShipPositions.add(pos);
  }

  // Always water: positions that are never used in ANY placement
  // (but only among positions that are actually UNKNOWN in the line)
  for (let pos = 0; pos < N; pos++) {
    if (line[pos] !== UNKNOWN) continue; // Already determined
    if (!usedAnywhere.has(pos)) {
      result.alwaysWaterPositions.add(pos);
    }
  }

  return result;
}

// ===========================================================================
// Constraint propagation
// ===========================================================================

function logicalDepthScore(puzzle) {
  const cl = puzzle.cl || {};
  const rc = puzzle.rc || [];
  const cc = puzzle.cc || [];
  const grid = new Array(N * N).fill(UNKNOWN);

  // Init from clues
  for (const key of Object.keys(cl)) {
    const i = +key, t = cl[key];
    if (t === 'w' || isIslandClue(t)) grid[i] = WATER;
    else if (t === 's' || t === 'e' || t === 'm') grid[i] = SHIP;
  }

  let round = 0, changed = true;

  while (changed) {
    round++;
    changed = false;
    const newStates = [];

    function rec(r, c, st) {
      const i = idx(r, c);
      if (grid[i] === UNKNOWN) { newStates.push([r, c, st]); changed = true; }
    }

    // R1: Island area clearing
    for (const key of Object.keys(cl)) {
      if (isIslandClue(cl[key])) {
        const i = +key;
        if (grid[i] !== WATER) rec(rowOf(i), colOf(i), WATER);
      }
    }

    // R2: Ship type clues
    for (const key of Object.keys(cl)) {
      const t = cl[key];
      if (t !== 's' && t !== 'e' && t !== 'm') continue;
      const i = +key; if (grid[i] !== SHIP) continue;
      const r = rowOf(i), c = colOf(i);
      if (t === 's') {
        for (const [nr, nc] of orthNeighbors(r, c)) rec(nr, nc, WATER);
      } else if (t === 'e') {
        let sn = 0, un = [];
        for (const [nr, nc] of orthNeighbors(r, c)) {
          const ni = idx(nr, nc);
          if (grid[ni] === SHIP) sn++; else if (grid[ni] === UNKNOWN) un.push([nr, nc]);
        }
        if (sn === 1) for (const [nr, nc] of un) rec(nr, nc, WATER);
      } else if (t === 'm') {
        const sn2 = [], un = [];
        for (const [nr, nc] of orthNeighbors(r, c)) {
          const ni = idx(nr, nc);
          if (grid[ni] === SHIP) sn2.push([nr, nc]); else if (grid[ni] === UNKNOWN) un.push([nr, nc]);
        }
        if (sn2.length === 2) {
          const [ar, ac] = sn2[0], [br, bc] = sn2[1];
          if (ar === br || ac === bc) for (const [nr, nc] of un) rec(nr, nc, WATER);
        }
      }
    }

    // R3: Adjacency propagation
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (grid[idx(r, c)] === SHIP) {
          for (const [nr, nc] of orthNeighbors(r, c)) rec(nr, nc, WATER);
        }
      }
    }

    // R4: Component water
    const comps = findShipComponents(grid);
    for (const [wr, wc] of getWaterFromComponents(comps)) rec(wr, wc, WATER);

    // R5: Row/Column forced
    for (let r = 0; r < N; r++) {
      let sc = 0, uc = 0, un = [];
      for (let c = 0; c < N; c++) {
        const i = idx(r, c);
        if (grid[i] === SHIP) sc++;
        else if (grid[i] === UNKNOWN) { uc++; un.push(c); }
      }
      const rem = (rc[r] || 0) - sc;
      if (rem === uc && rem >= 0) for (const c of un) rec(r, c, SHIP);
      else if (rem === 0) for (const c of un) rec(r, c, WATER);
    }
    for (let c = 0; c < N; c++) {
      let sc = 0, uc = 0, un = [];
      for (let r = 0; r < N; r++) {
        const i = idx(r, c);
        if (grid[i] === SHIP) sc++;
        else if (grid[i] === UNKNOWN) { uc++; un.push(r); }
      }
      const rem = (cc[c] || 0) - sc;
      if (rem === uc && rem >= 0) for (const r of un) rec(r, c, SHIP);
      else if (rem === 0) for (const r of un) rec(r, c, WATER);
    }

    // R6: Island neighbor propagation
    for (const key of Object.keys(cl)) {
      const t = cl[key];
      if (!isIslandClue(t)) continue;
      const i = +key, ir = rowOf(i), ic = colOf(i), target = islandTarget(t);
      let ships = 0, unknowns = 0, unCells = [];
      for (const [nr, nc] of orthNeighbors(ir, ic)) {
        const ni = idx(nr, nc);
        if (grid[ni] === SHIP) ships++;
        else if (grid[ni] === UNKNOWN) { unknowns++; unCells.push([nr, nc]); }
      }
      if (ships + unknowns === target && ships < target)
        for (const [nr, nc] of unCells) rec(nr, nc, SHIP);
      else if (ships === target)
        for (const [nr, nc] of unCells) rec(nr, nc, WATER);
    }

    // R7: Line analysis with diagonal + ship-type constraints
    const remFleet = remainingFleet(grid);

    for (let r = 0; r < N; r++) {
      const line = [];
      for (let c = 0; c < N; c++) line.push(grid[idx(r, c)]);
      const sc = line.filter(v => v === SHIP).length;
      const rem = (rc[r] || 0) - sc;
      if (rem <= 0) continue;

      const res = lineConsensus(line, rem, remFleet, cl, grid, r, true);
      for (const c of res.alwaysShipPositions) if (line[c] === UNKNOWN) rec(r, c, SHIP);
      for (const c of res.alwaysWaterPositions) if (line[c] === UNKNOWN) rec(r, c, WATER);
    }

    for (let c = 0; c < N; c++) {
      const line = [];
      for (let r = 0; r < N; r++) line.push(grid[idx(r, c)]);
      const sc = line.filter(v => v === SHIP).length;
      const rem = (cc[c] || 0) - sc;
      if (rem <= 0) continue;

      const res = lineConsensus(line, rem, remFleet, cl, grid, c, false);
      for (const r of res.alwaysShipPositions) if (line[r] === UNKNOWN) rec(r, c, SHIP);
      for (const r of res.alwaysWaterPositions) if (line[r] === UNKNOWN) rec(r, c, WATER);
    }

    // Apply all changes
    for (const [r, c, st] of newStates) grid[idx(r, c)] = st;
  }

  return { rounds: round, solved: grid.every(v => v !== UNKNOWN) };
}

// ===========================================================================
// Chain length analysis
// ===========================================================================

function getLogicalChainLength(puzzle) {
  const cl = puzzle.cl || {}, rc = puzzle.rc || [], cc = puzzle.cc || [];
  const grid = new Array(N * N).fill(UNKNOWN);
  const detRound = new Array(N * N).fill(-1);
  const detReason = new Array(N * N).fill('');

  for (const key of Object.keys(cl)) {
    const i = +key, t = cl[key];
    if (t === 'w' || isIslandClue(t)) { grid[i] = WATER; detReason[i] = 'clue'; }
    else if (t === 's' || t === 'e' || t === 'm') { grid[i] = SHIP; detReason[i] = 'clue'; }
    detRound[i] = 0;
  }

  let round = 0, changed = true;

  while (changed) {
    round++;
    changed = false;

    for (const key of Object.keys(cl)) {
      if (isIslandClue(cl[key])) {
        const i = +key;
        if (grid[i] !== WATER) { grid[i] = WATER; detRound[i] = round; detReason[i] = 'island'; changed = true; }
      }
    }

    const changes = [];
    function rec(r, c, st, re) {
      const i = idx(r, c);
      if (grid[i] === UNKNOWN) { changes.push([r, c, st, re]); changed = true; }
    }

    // Ship type
    for (const key of Object.keys(cl)) {
      const t = cl[key];
      if (t !== 's' && t !== 'e' && t !== 'm') continue;
      const i = +key; if (grid[i] !== SHIP) continue;
      const r = rowOf(i), c = colOf(i);
      if (t === 's') for (const [nr,nc] of orthNeighbors(r,c)) rec(nr,nc,WATER,'s');
      else if (t === 'e') {
        let sn=0,un=[]; for (const [nr,nc] of orthNeighbors(r,c)) { const ni=idx(nr,nc); if(grid[ni]===SHIP)sn++; else if(grid[ni]===UNKNOWN)un.push([nr,nc]); }
        if (sn===1) for (const [nr,nc] of un) rec(nr,nc,WATER,'e');
      } else if (t === 'm') {
        const sn2=[],un=[]; for (const [nr,nc] of orthNeighbors(r,c)) { const ni=idx(nr,nc); if(grid[ni]===SHIP)sn2.push([nr,nc]); else if(grid[ni]===UNKNOWN)un.push([nr,nc]); }
        if (sn2.length===2) { const [ar,ac]=sn2[0],[br,bc]=sn2[1]; if(ar===br||ac===bc) for (const [nr,nc] of un) rec(nr,nc,WATER,'m'); }
      }
    }

    for (let r=0;r<N;r++) for (let c=0;c<N;c++) if (grid[idx(r,c)]===SHIP) for (const [nr,nc] of orthNeighbors(r,c)) rec(nr,nc,WATER,'adj');

    for (let r=0;r<N;r++) { let sc=0,uc=0,un=[]; for (let c=0;c<N;c++){const i=idx(r,c);if(grid[i]===SHIP)sc++;else if(grid[i]===UNKNOWN){uc++;un.push(c);}} const rem=(rc[r]||0)-sc;if(rem===uc&&rem>=0)for(const c of un)rec(r,c,SHIP,'row');else if(rem===0)for(const c of un)rec(r,c,WATER,'row');}
    for (let c=0;c<N;c++) { let sc=0,uc=0,un=[]; for (let r=0;r<N;r++){const i=idx(r,c);if(grid[i]===SHIP)sc++;else if(grid[i]===UNKNOWN){uc++;un.push(r);}} const rem=(cc[c]||0)-sc;if(rem===uc&&rem>=0)for(const r of un)rec(r,c,SHIP,'col');else if(rem===0)for(const r of un)rec(r,c,WATER,'col');}

    for (const key of Object.keys(cl)) {
      const t=cl[key]; if(!isIslandClue(t)) continue;
      const i=+key,ir=rowOf(i),ic=colOf(i),tgt=islandTarget(t);
      let sh=0,uk=0,uc=[]; for (const [nr,nc] of orthNeighbors(ir,ic)) { const ni=idx(nr,nc); if(grid[ni]===SHIP)sh++; else if(grid[ni]===UNKNOWN){uk++;uc.push([nr,nc]);} }
      if(sh+uk===tgt&&sh<tgt) for(const [nr,nc] of uc) rec(nr,nc,SHIP,'island');
      else if(sh===tgt) for(const [nr,nc] of uc) rec(nr,nc,WATER,'island');
    }

    const ws = getWaterFromComponents(findShipComponents(grid));
    for (const [wr,wc] of ws) rec(wr,wc,WATER,'comp');

    const rf = remainingFleet(grid);
    for (let r=0;r<N;r++) {
      const line=[]; for(let c=0;c<N;c++) line.push(grid[idx(r,c)]);
      const sc=line.filter(v=>v===SHIP).length, rem=(rc[r]||0)-sc; if(rem<=0) continue;
      const res = lineConsensus(line,rem,rf,cl,grid,r,true);
      for(const c of res.alwaysShipPositions) if(line[c]===UNKNOWN) rec(r,c,SHIP,'line');
      for(const c of res.alwaysWaterPositions) if(line[c]===UNKNOWN) rec(r,c,WATER,'line');
    }
    for (let c=0;c<N;c++) {
      const line=[]; for(let r=0;r<N;r++) line.push(grid[idx(r,c)]);
      const sc=line.filter(v=>v===SHIP).length, rem=(cc[c]||0)-sc; if(rem<=0) continue;
      const res = lineConsensus(line,rem,rf,cl,grid,c,false);
      for(const r of res.alwaysShipPositions) if(line[r]===UNKNOWN) rec(r,c,SHIP,'line');
      for(const r of res.alwaysWaterPositions) if(line[r]===UNKNOWN) rec(r,c,WATER,'line');
    }

    for (const [r,c,s,re] of changes) { grid[idx(r,c)]=s; detRound[idx(r,c)]=round; detReason[idx(r,c)]=re; }
  }

  let maxD = 0;
  for (const d of detRound) if (d > maxD) maxD = d;
  return { maxChainDepth: maxD };
}

// ===========================================================================
// New difficulty classification based on logical depth + backtracking + chain
// ===========================================================================

function classifyByLogicalDepth(depth, chain, needsBacktracking) {
  // Easy: easily solvable by constraint propagation alone
  if (depth <= 3) return 'easy';

  // Expert: very deep reasoning or long chains
  if (depth >= 7) return 'expert';
  if (depth >= 6 && (needsBacktracking || chain >= 6)) return 'expert';

  // Hard: requires some backthinking or long chains
  if (chain >= 5) return 'hard';
  if (depth >= 5 && (needsBacktracking || chain >= 4)) return 'hard';

  // Medium: moderate depth without backtracking
  return 'medium';
}

// ===========================================================================
// Main
// ===========================================================================

function main() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'bimaru-harbor-library.json'), 'utf-8'));

  console.log('='.repeat(115));
  console.log('  BIMARU HARBOR — LOGICAL DEPTH ANALYSIS');
  console.log('  Rules: island-clearing, ship-type(s/e/m), adjacency, component-water, forced(row/col), island-neighbor, line-analysis(diagonal+clue)');
  console.log('='.repeat(115));
  console.log();

  const THRESHOLDS = { easy: 4, medium: 6, hard: 7 };
  function classify(rd) {
    if (rd <= THRESHOLDS.easy) return 'easy';
    if (rd <= THRESHOLDS.medium) return 'medium';
    if (rd <= THRESHOLDS.hard) return 'hard';
    return 'expert';
  }

  const results = [];
  for (const puzzle of data) {
    const depth = logicalDepthScore(puzzle);
    const chain = getLogicalChainLength(puzzle);
    const clueCount = Object.keys(puzzle.cl || {}).length;
    const shipClues = Object.values(puzzle.cl || {}).filter(v => typeof v === 'string' && ['s','e','m'].includes(v)).length;
    const islandClues = Object.values(puzzle.cl || {}).filter(v => typeof v === 'string' && /^i\d$/.test(v)).length;
    const logDiff = classify(depth.rounds);
    const origDiff = puzzle.difficulty || 'unknown';
    const reclassified = logDiff !== origDiff;
    const needsBacktracking = !depth.solved;
    const newDifficulty = classifyByLogicalDepth(depth.rounds, chain.maxChainDepth, needsBacktracking);
    const newReclassified = newDifficulty !== origDiff;
    results.push({ id: puzzle.id, name: puzzle.meta?.name ? puzzle.meta.name : `Puzzle ${puzzle.id}`,
      originalDifficulty: origDiff, logicalDifficulty: logDiff,
      clueCount, shipClues, islandClues, logicalDepth: depth.rounds, solved: depth.solved,
      maxChainDepth: chain.maxChainDepth, reclassified, needsBacktracking,
      chainLength: chain.maxChainDepth, newDifficulty, newReclassified });
  }

  // --- Main table ---
  console.log(
    '┌──────┬────────────┬────────────────┬──────────────────┬────────┬───────┬──────────┬───────────┬───────────────┬───────┬────────┐'
  );
  console.log(
    '│ ID   │ Name       │ Difficulty     │ Logical Difficulty│ New    │ Clues │  Ships   │  Islands  │ Logical Depth │ Chain │  BT  │'
  );
  console.log(
    '├──────┼────────────┼────────────────┼──────────────────┼────────┼───────┼──────────┼───────────┼───────────────┼───────┼──────┤'
  );

  for (const r of results) {
    const nm = r.name.length > 11 ? r.name.slice(0,8)+'...' : r.name.padEnd(11);
    const od = r.originalDifficulty.padEnd(14);
    const ld = r.logicalDifficulty.padEnd(16);
    const cls = r.reclassified ? ' ⚠' : '';
    const nd = r.newDifficulty.padEnd(6);
    const ndCls = r.newReclassified ? ' ⚡' : '';
    const sol = r.solved ? '✓' : '✗';
    const bt = r.needsBacktracking ? '✗' : '✓';
    console.log(
      `│ ${String(r.id).padEnd(4)}  │ ${nm} │ ${od} │ ${ld}${cls} │ ${nd}${ndCls} │ ${String(r.clueCount).padEnd(5)} │ ${String(r.shipClues).padEnd(6)} │ ${String(r.islandClues).padEnd(7)} │ ${String(r.logicalDepth).padEnd(9)}${sol.padEnd(2)} │ ${String(r.maxChainDepth).padEnd(5)} │ ${bt.padEnd(2)} │`
    );
  }

  console.log(
    '└──────┴────────────┴────────────────┴──────────────────┴────────┴───────┴──────────┴───────────┴───────────────┴───────┴──────┘'
  );
  console.log('  BT = solved by propagation (✓) / needs backtracking (✗)');
  console.log('  ⚠ = logical depth mismatch with original difficulty');
  console.log('  ⚡ = new difficulty classification changed');
  console.log();

  // --- Cross-tabulation ---
  const origG = { easy:[], medium:[], hard:[], expert:[] };
  const logG = { easy:[], medium:[], hard:[], expert:[] };
  for (const r of results) {
    (origG[r.originalDifficulty]||origG.expert)?.push(r);
    (logG[r.logicalDifficulty]||logG.expert)?.push(r);
  }

  console.log('═'.repeat(115));
  console.log('  CURRENT DIFFICULTY → LOGICAL DEPTH DISTRIBUTION');
  console.log('═'.repeat(115));
  console.log();
  console.log(
    '┌────────────────┬──────┬──────────┬──────────┬──────────┬───────────┬──────────────────────┐'
  );
  console.log(
    '│ Original Diff  │  N   │ avgDepth │ minDepth │ maxDepth │ Solved?   │ Logical depth spread │'
  );
  console.log(
    '├────────────────┼──────┼──────────┼──────────┼──────────┼───────────┼──────────────────────┤'
  );
  for (const diff of ['easy','medium','hard','expert']) {
    const g = origG[diff]; if (!g?.length) continue;
    const depths = g.map(r=>r.logicalDepth);
    const avg=(depths.reduce((a,b)=>a+b,0)/depths.length).toFixed(1);
    const mn=Math.min(...depths), mx=Math.max(...depths);
    const sol=(g.filter(r=>r.solved).length).toString();
    const spread=[...new Set(g.map(r=>r.logicalDifficulty))].sort().join(', ');
    console.log(
      `│ ${diff.padEnd(14)} │ ${String(g.length).padEnd(4)} │ ${avg.padEnd(8)} │ ${String(mn).padEnd(8)} │ ${String(mx).padEnd(8)} │ ${sol.padEnd(7)} │ ${spread.padEnd(22)} │`
    );
  }
  console.log(
    '└────────────────┴──────┴──────────┴──────────┴──────────┴───────────┴──────────────────────┘'
  );
  console.log();

  console.log('Logical depth distribution:');
  for (const diff of ['easy','medium','hard','expert'])
    console.log(`  ${diff.padEnd(10)}: ${(logG[diff]||[]).length} puzzles`);
  console.log();

  const rec = results.filter(r=>r.reclassified);
  if (rec.length > 0) {
    console.log(`RECLASSIFIED (${rec.length} puzzles):`);
    console.log();
    const changes = {};
    for (const r of rec) {
      const key = `${r.originalDifficulty} → ${r.logicalDifficulty}`;
      (changes[key] = changes[key] || []).push(r);
    }
    for (const [change, puzzles] of Object.entries(changes)) {
      console.log(`  ${change}:`);
      for (const p of puzzles.sort((a,b)=>b.logicalDepth-a.logicalDepth)) {
        console.log(`    ID ${String(p.id).padEnd(2)}: ${p.solved?'✓':'✗'} depth=${String(p.logicalDepth).padEnd(2)} chain=${String(p.maxChainDepth).padEnd(2)} clues=${String(p.clueCount).padEnd(2)}`);
      }
      console.log();
    }
  }

  const depths = results.map(r=>r.logicalDepth);
  const solCount = results.filter(r=>r.solved).length;

  // --- New classification: Hard/Expert puzzles ---
  const hardExpert = results.filter(r => r.newDifficulty === 'hard' || r.newDifficulty === 'expert');
  if (hardExpert.length > 0) {
    console.log('═'.repeat(115));
    console.log('  NEW CLASSIFICATION — HARD / EXPERT PUZZLES');
    console.log('═'.repeat(115));
    console.log();

    // Expert subsection
    const expert = hardExpert.filter(r => r.newDifficulty === 'expert');
    if (expert.length > 0) {
      console.log(`EXPERT (${expert.length}):`);
      console.log();
      console.log(
        '┌──────┬────────────┬──────────┬──────────┬───────────┬────────┬──────────────────────────────┐'
      );
      console.log(
        '│ ID   │ Name       │ Original │ Depth    │ Chain     │ Solved │ Reason                       │'
      );
      console.log(
        '├──────┼────────────┼──────────┼──────────┼───────────┼────────┼──────────────────────────────┤'
      );
      for (const r of expert.sort((a,b) => b.logicalDepth - a.logicalDepth || b.maxChainDepth - a.maxChainDepth)) {
        const nm = r.name.length > 11 ? r.name.slice(0,8)+'...' : r.name.padEnd(11);
        const reasons = [];
        if (r.logicalDepth >= 7) reasons.push('depth≥7');
        if (r.logicalDepth >= 6 && r.needsBacktracking) reasons.push('d≥6+bt');
        if (r.logicalDepth >= 6 && r.chainLength >= 6) reasons.push('d≥6+c≥6');
        const reason = reasons.join(', ') || 'N/A';
        console.log(
          `│ ${String(r.id).padEnd(4)}  │ ${nm} │ ${r.originalDifficulty.padEnd(8)} │ ${String(r.logicalDepth).padEnd(8)} │ ${String(r.chainLength).padEnd(7)} │ ${r.solved?'Solved':'BT'}     │ ${reason.padEnd(30)} │`
        );
      }
      console.log(
        '└──────┴────────────┴──────────┴──────────┴───────────┴────────┴──────────────────────────────┘'
      );
      console.log();
    }

    // Hard subsection
    const hard = hardExpert.filter(r => r.newDifficulty === 'hard');
    if (hard.length > 0) {
      console.log(`HARD (${hard.length}):`);
      console.log();
      console.log(
        '┌──────┬────────────┬──────────┬──────────┬───────────┬────────┬──────────────────────────────┐'
      );
      console.log(
        '│ ID   │ Name       │ Original │ Depth    │ Chain     │ Solved │ Reason                       │'
      );
      console.log(
        '├──────┼────────────┼──────────┼──────────┼───────────┼────────┼──────────────────────────────┤'
      );
      for (const r of hard.sort((a,b) => b.logicalDepth - a.logicalDepth || b.maxChainDepth - a.maxChainDepth)) {
        const nm = r.name.length > 11 ? r.name.slice(0,8)+'...' : r.name.padEnd(11);
        const reasons = [];
        if (r.chainLength >= 5) reasons.push('chain≥5');
        if (r.logicalDepth >= 5 && r.needsBacktracking) reasons.push('d≥5+bt');
        if (r.logicalDepth >= 5 && r.chainLength >= 4) reasons.push('d≥5+c≥4');
        const reason = reasons.join(', ') || 'N/A';
        console.log(
          `│ ${String(r.id).padEnd(4)}  │ ${nm} │ ${r.originalDifficulty.padEnd(8)} │ ${String(r.logicalDepth).padEnd(8)} │ ${String(r.chainLength).padEnd(7)} │ ${r.solved?'Solved':'BT'}     │ ${reason.padEnd(30)} │`
        );
      }
      console.log(
        '└──────┴────────────┴──────────┴──────────┴───────────┴────────┴──────────────────────────────┘'
      );
      console.log();
    }
  }

  const depths2 = results.map(r=>r.logicalDepth);
  const solCount2 = results.filter(r=>r.solved).length;
  const btCount = results.filter(r=>r.needsBacktracking).length;
  const newRec = results.filter(r=>r.newReclassified);
  console.log('─'.repeat(115));
  console.log('Summary:');
  console.log(`  Total puzzles:              ${results.length}`);
  console.log(`  Solved by propagation:      ${solCount2}/${results.length}`);
  console.log(`  Stuck (need backtracking):  ${btCount}/${results.length}`);
  console.log(`  Avg logical depth:          ${(depths2.reduce((a,b)=>a+b,0)/depths2.length).toFixed(1)} rounds`);
  console.log(`  Min/Max logical depth:      ${Math.min(...depths2)} / ${Math.max(...depths2)}`);
  console.log(`  Puzzles reclassified:       ${newRec.length}/${results.length} (new criteria)`);
  console.log(`  New Hard puzzles:           ${hardExpert.filter(r=>r.newDifficulty==='hard').length}`);
  console.log(`  New Expert puzzles:         ${hardExpert.filter(r=>r.newDifficulty==='expert').length}`);
  console.log('═'.repeat(115));

  // --- Write classification JSON ---
  const classificationData = results.map(r => ({
    id: r.id,
    name: r.name,
    originalDifficulty: r.originalDifficulty,
    logicalDepth: r.logicalDepth,
    chainLength: r.chainLength,
    needsBacktracking: r.needsBacktracking,
    newDifficulty: r.newDifficulty,
    clueCount: r.clueCount
  }));
  fs.writeFileSync(
    path.join(__dirname, 'logical_depth_classification.json'),
    JSON.stringify(classificationData, null, 2) + '\n',
    'utf-8'
  );
  console.log(`\nClassification data written to logical_depth_classification.json`);
}

main();
