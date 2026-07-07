#!/usr/bin/env node
/**
 * logical_depth_score.js
 *
 * Measures "logical depth" of Bimaru Harbor puzzles via a decision-tree approach.
 * Simulates solving by running deduction rounds, then uses proof-by-contradiction
 * and backtracking to determine cells that require forward reasoning.
 *
 * Depth model:
 *   Depth 1: Directly deducible from initial clues
 *   Depth 2: Deduced from depth-1 deductions (one chain step)
 *   Depth N: Deduced from depth-(N-1) deductions (N-1 chain steps)
 *   Depth N+: Requires proof-by-contradiction or backtracking
 */

'use strict';

const fs = require('fs');
const path = require('path');

const N = 9;
const UNKNOWN = 0, SHIP = 1, WATER = -1;

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

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

function isIslandClue(t) { return typeof t === 'string' && /^i\d+$/.test(t); }
function islandTarget(t) { return Number(t.slice(1)); }

// ---------------------------------------------------------------------------
// Deduction engine
// ---------------------------------------------------------------------------

/**
 * A single reasoning step.
 */
class Deduction {
  constructor(cell, state, depth, reason, dependsOn) {
    this.cell = cell;
    this.state = state;
    this.depth = depth;
    this.reason = reason;
    this.dependsOn = dependsOn || []; // indices of other deductions this depends on
  }
}

/**
 * Run all direct deduction rules until no more deductions are possible.
 *
 * The function works on a partially-determined grid.  Cells already set
 * (to SHIP or WATER) are treated as known; UNKNOWN cells are candidates.
 *
 * Each deduction is assigned a depth: 1 + max depth of cells it depends on.
 * Direct deductions from the initial clue-set have depth 1.
 *
 * @param {number[]} grid - Partially determined grid (UNKNOWN/SHIP/WATER)
 * @param {number[]} rc   - Row ship counts
 * @param {number[]} cc   - Column ship counts
 * @param {object}   cl   - Clue map: cellIndex → 's'|'e'|'m'|'w'|'iN'
 * @param {object}   opts - { knownDepths: Map<cell,depth>, maxDepth: number }
 * @returns {{ grid: number[], deductions: Deduction[], rounds: number, solved: boolean }}
 */
function runDeductionRound(grid, rc, cl, cc, opts) {
  const { knownDepths = new Map(), maxDepth = 0 } = opts;
  const newDeductions = [];
  const newDepths = new Map(knownDepths);
  const newStates = [];

  function addDeduction(cell, state, depth, reason) {
    if (grid[cell] !== UNKNOWN) return;
    const depOn = [];
    let maxDep = 0;

    switch (reason) {
      case 'island_area':
        // Depends on clue-level knowledge (depth 0 cells)
        for (const [k, v] of knownDepths) {
          if (v === 0) depOn.push(k);
        }
        break;
      case 'adj_water':
        for (const [k, v] of knownDepths) {
          if (grid[k] === SHIP && v > maxDep) { maxDep = v; depOn.push(k); }
        }
        break;
      case 'row_count':
      case 'col_count':
        for (const [k, v] of knownDepths) {
          if (grid[k] !== UNKNOWN && v > maxDep) { maxDep = v; depOn.push(k); }
        }
        break;
      case 'island_neighbor':
      case 'component_water':
        for (const [k, v] of knownDepths) {
          if (grid[k] !== UNKNOWN && v > maxDep) { maxDep = v; depOn.push(k); }
        }
        break;
      default:
        // 'ship_type_s', 'ship_type_e', 'ship_type_m', 'line_analysis'
        for (const [k, v] of knownDepths) {
          if (grid[k] !== UNKNOWN && v > maxDep) { maxDep = v; depOn.push(k); }
        }
    }

    const deductionDepth = maxDep + 1;
    newDeductions.push(new Deduction(cell, state, deductionDepth, reason, depOn));
    newStates.push([cell, state]);
    newDepths.set(cell, deductionDepth);
  }

  // --- Rule 1: Island area cells are water ---
  for (const [cellStr, clue] of Object.entries(cl)) {
    if (isIslandClue(clue)) {
      const cell = Number(cellStr);
      addDeduction(cell, WATER, 0, 'island_area');
    }
  }

  // --- Rule 2: Ship type clues ---
  for (const [cellStr, clue] of Object.entries(cl)) {
    if (clue === 's' && grid[+cellStr] === SHIP) {
      const r = rowOf(+cellStr), c = colOf(+cellStr);
      for (const [nr, nc] of orthNeighbors(r, c)) addDeduction(idx(nr, nc), WATER, 0, 'ship_type_s');
    }
    if (clue === 'e' && grid[+cellStr] === SHIP) {
      const r = rowOf(+cellStr), c = colOf(+cellStr);
      let knownShip = 0, unknowns = [];
      for (const [nr, nc] of orthNeighbors(r, c)) {
        const ni = idx(nr, nc);
        if (grid[ni] === SHIP) knownShip++;
        else if (grid[ni] === UNKNOWN) unknowns.push([nr, nc]);
      }
      if (knownShip === 1) for (const [nr, nc] of unknowns) addDeduction(idx(nr, nc), WATER, 0, 'ship_type_e');
    }
    if (clue === 'm' && grid[+cellStr] === SHIP) {
      const r = rowOf(+cellStr), c = colOf(+cellStr);
      const shipN = [], unN = [];
      for (const [nr, nc] of orthNeighbors(r, c)) {
        const ni = idx(nr, nc);
        if (grid[ni] === SHIP) shipN.push([nr, nc]);
        else if (grid[ni] === UNKNOWN) unN.push([nr, nc]);
      }
      if (shipN.length === 2) {
        const [a, b] = [shipN[0], shipN[1]];
        if (a[0] === b[0] || a[1] === b[1]) for (const [nr, nc] of unN) addDeduction(idx(nr, nc), WATER, 0, 'ship_type_m');
      }
    }
  }

  // --- Rule 3: Adjacency water ---
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[idx(r, c)] === SHIP) {
        for (const [nr, nc] of orthNeighbors(r, c)) addDeduction(idx(nr, nc), WATER, 0, 'adj_water');
      }
    }
  }

  // --- Rule 4: Component-based water ---
  const comps = findShipComponents(grid);
  for (const cell of getWaterFromComponents(comps)) {
    addDeduction(cell, WATER, 0, 'component_water');
  }

  // --- Rule 5: Island neighbor constraint ---
  for (const [cellStr, clue] of Object.entries(cl)) {
    if (!isIslandClue(clue)) continue;
    const cell = +cellStr;
    const ir = rowOf(cell), ic = colOf(cell);
    const target = islandTarget(clue);
    let knownShips = 0, unknowns = [];
    for (const [nr, nc] of orthNeighbors(ir, ic)) {
      const ni = idx(nr, nc);
      if (grid[ni] === SHIP) knownShips++;
      else if (grid[ni] === UNKNOWN) unknowns.push([nr, nc]);
    }
    if (knownShips + unknowns.length < target) continue;
    if (knownShips + unknowns.length === target && knownShips < target) {
      for (const [nr, nc] of unknowns) addDeduction(idx(nr, nc), SHIP, 0, 'island_neighbor');
    }
    if (knownShips === target) {
      for (const [nr, nc] of unknowns) addDeduction(idx(nr, nc), WATER, 0, 'island_neighbor');
    }
  }

  // --- Rule 6: Row / column forced by count ---
  for (let r = 0; r < N; r++) {
    let ships = 0, unknowns = [];
    for (let c = 0; c < N; c++) {
      const cell = idx(r, c);
      if (grid[cell] === SHIP) ships++;
      else if (grid[cell] === UNKNOWN) unknowns.push(c);
    }
    const needed = (rc[r] || 0) - ships;
    if (needed === unknowns.length && needed >= 0)
      for (const c of unknowns) addDeduction(idx(r, c), SHIP, 0, 'row_count');
    else if (needed === 0)
      for (const c of unknowns) addDeduction(idx(r, c), WATER, 0, 'row_count');
  }

  for (let c = 0; c < N; c++) {
    let ships = 0, unknowns = [];
    for (let r = 0; r < N; r++) {
      const cell = idx(r, c);
      if (grid[cell] === SHIP) ships++;
      else if (grid[cell] === UNKNOWN) unknowns.push(r);
    }
    const needed = (cc[c] || 0) - ships;
    if (needed === unknowns.length && needed >= 0)
      for (const r of unknowns) addDeduction(idx(r, c), SHIP, 0, 'col_count');
    else if (needed === 0)
      for (const r of unknowns) addDeduction(idx(r, c), WATER, 0, 'col_count');
  }

  // --- Rule 7: Line analysis with fleet constraint (depth 0 → gets depth from deps) ---
  const fleet = remainingFleetCount(grid, rc, cc);
  const lineAnalysisResults = analyzeAllLines(grid, rc, cc, cl, fleet);

  for (const { cell, state, reason } of lineAnalysisResults) {
    addDeduction(cell, state, 0, reason);
  }

  // --- Apply all deductions ---
  for (const [cell, state] of newStates) {
    grid[cell] = state;
  }

  const solved = grid.every(v => v !== UNKNOWN);

  return { grid, deductions: newDeductions, newDepths, solved };
}

/**
 * Iteratively run deduction rounds until stable.
 * Returns the full deduction history with depths.
 */
function runDeductions(grid, rc, cl, cc, knownDepths) {
  let allDeductions = [];
  let currentGrid = new Array(N * N);
  for (let i = 0; i < grid.length; i++) currentGrid[i] = grid[i];

  let rounds = 0;
  let changed = true;

  while (changed) {
    rounds++;
    changed = false;

    const { grid: newGrid, deductions, newDepths, solved } =
      runDeductionRound(currentGrid, rc, cl, cc, { knownDepths, maxDepth: 0 });

    // Calculate actual depths for this round
    for (const d of deductions) {
      d.depth = Math.max(1, ...d.dependsOn.map(k => knownDepths.get(k) || 0)) + 1;
    }

    allDeductions.push(...deductions);
    for (const dep of newDepths) knownDepths.set(dep[0], dep[1]);

    for (let i = 0; i < newGrid.length; i++) currentGrid[i] = newGrid[i];

    changed = deductions.length > 0;
    if (solved) changed = false;
  }

  const solved = currentGrid.every(v => v !== UNKNOWN);
  return { grid: currentGrid, deductions: allDeductions, knownDepths, rounds, solved };
}

// ---------------------------------------------------------------------------
// Component analysis
// ---------------------------------------------------------------------------

function findShipComponents(grid) {
  const comps = [];
  const vis = new Array(N * N).fill(false);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = idx(r, c);
      if (grid[cell] !== SHIP || vis[cell]) continue;
      const cells = [];
      const stk = [[r, c]];
      while (stk.length) {
        const [cr, cc] = stk.pop(), ci = idx(cr, cc);
        if (vis[ci] || grid[ci] !== SHIP) continue;
        vis[ci] = true;
        cells.push({ r: cr, c: cc });
        for (const [nr, nc] of orthNeighbors(cr, cc)) {
          const ni = idx(nr, nc);
          if (!vis[ni] && grid[ni] === SHIP) stk.push([nr, nc]);
        }
      }
      if (cells.length >= 1 && cells.length <= 4) {
        comps.push(new Set(cells.map(p => idx(p.r, p.c))));
      }
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
        if (!comp.has(ni) && !seen.has(ni)) { waters.push(ni); seen.add(ni); }
      }
    }
  }
  return waters;
}

// ---------------------------------------------------------------------------
// Fleet helpers
// ---------------------------------------------------------------------------

function remainingFleetCount(grid, rc, cc) {
  const comps = findShipComponents(grid);
  const placed = {};
  for (const comp of comps) {
    const sz = comp.size;
    placed[sz] = (placed[sz] || 0) + 1;
  }
  // Fleet: 1×4, 2×3, 3×2, 4×1 (total = 4+6+6+4 = 20 ships)
  const total = { 4: 1, 3: 2, 2: 3, 1: 4 };
  const rem = {};
  for (const l of [4, 3, 2, 1]) rem[l] = Math.max(0, (total[l] || 0) - (placed[l] || 0));
  return rem;
}

// ---------------------------------------------------------------------------
// Line analysis with fleet constraints
// ---------------------------------------------------------------------------

function analyzeAllLines(grid, rc, cc, cl, fleet) {
  const results = [];

  for (let r = 0; r < N; r++) {
    const line = [];
    for (let c = 0; c < N; c++) line.push(grid[idx(r, c)]);
    const ships = line.filter(v => v === SHIP).length;
    const needed = (rc[r] || 0) - ships;
    if (needed <= 0) continue;

    const placements = enumerateLinePlacements(line, needed, fleet, cl, r, true);
    if (placements.length === 0) continue;

    // Cells in ALL placements → forced ship
    const allShipCells = new Set();
    for (const p of placements) { for (const ci of p.cells) allShipCells.add(ci); }
    for (const ci of allShipCells) {
      if (grid[ci] !== UNKNOWN) continue;
      let inAll = true;
      for (const p of placements) { if (!p.cells.has(ci)) { inAll = false; break; } }
      if (inAll) results.push({ cell: ci, state: SHIP, reason: 'line_analysis' });
    }

    // Cells in NO placement among UNKNOWN cells → forced water
    const usedCells = new Set();
    for (const p of placements) { for (const ci of p.cells) usedCells.add(ci); }
    for (let c = 0; c < N; c++) {
      const ci = idx(r, c);
      if (grid[ci] === UNKNOWN && !usedCells.has(ci)) {
        results.push({ cell: ci, state: WATER, reason: 'line_analysis' });
      }
    }
  }

  for (let c = 0; c < N; c++) {
    const line = [];
    for (let r = 0; r < N; r++) line.push(grid[idx(r, c)]);
    const ships = line.filter(v => v === SHIP).length;
    const needed = (cc[c] || 0) - ships;
    if (needed <= 0) continue;

    const placements = enumerateLinePlacements(line, needed, fleet, cl, c, false);
    if (placements.length === 0) continue;

    const allShipCells = new Set();
    for (const p of placements) { for (const ci of p.cells) allShipCells.add(ci); }
    for (const ci of allShipCells) {
      if (grid[ci] !== UNKNOWN) continue;
      let inAll = true;
      for (const p of placements) { if (!p.cells.has(ci)) { inAll = false; break; } }
      if (inAll) results.push({ cell: ci, state: SHIP, reason: 'line_analysis' });
    }

    const usedCells = new Set();
    for (const p of placements) { for (const ci of p.cells) usedCells.add(ci); }
    for (let r = 0; r < N; r++) {
      const ci = idx(r, c);
      if (grid[ci] === UNKNOWN && !usedCells.has(ci)) {
        results.push({ cell: ci, state: WATER, reason: 'line_analysis' });
      }
    }
  }

  return results;
}

function enumerateLinePlacements(line, needed, fleet, cl, lineIdx, isRow) {
  const results = [];

  function rec(pos, segments, shipCount, fleetState) {
    if (shipCount === needed) {
      const cells = new Set();
      for (const seg of segments) {
        for (let j = seg.start; j < seg.start + seg.len; j++) {
          if (isRow) cells.add(idx(lineIdx, j));
          else cells.add(idx(j, lineIdx));
        }
      }
      results.push({ cells, segments });
      return;
    }

    let i = pos;
    while (i < N && line[i] !== UNKNOWN) i++;
    if (i >= N) return;

    for (let len = 4; len >= 1; len--) {
      if (i + len > N) continue;
      if (shipCount + len > needed) continue;
      if (fleetState[len] <= 0) continue;
      let ok = true;
      for (let j = 0; j < len; j++) {
        if (line[i + j] === WATER) { ok = false; break; }
      }
      if (!ok) continue;
      if (i > 0 && line[i - 1] === SHIP) continue;
      if (i + len < N && line[i + len] === SHIP) continue;

      const nf = { ...fleetState };
      nf[len]--;
      rec(i + len + 1, [...segments, { start: i, len }], shipCount + len, nf);
    }
  }

  rec(0, [], 0, { ...fleet });
  return results;
}

// ---------------------------------------------------------------------------
// Proof by contradiction solver
// ---------------------------------------------------------------------------

/**
 * Resolve a single cell using proof by contradiction.
 *
 * Tests both possible states (SHIP / WATER) for a cell and runs deductions
 * on each branch.  If both branches force the same state on another cell,
 * that cell is proved by contradiction.
 *
 * The depth of the contradiction result is max(branchDepths) + 1.
 */
function resolveContradiction(grid, rc, cc, cl, knownDepths, cell) {
  // Branch 1: assume cell is SHIP
  const branch1 = simulateBranch(grid, cell, SHIP, rc, cc, cl, knownDepths);
  // Branch 2: assume cell is WATER
  const branch2 = simulateBranch(grid, cell, WATER, rc, cc, cl, knownDepths);

  // Find cells determined in BOTH branches
  const result = { resolved: [], contradictionCells: [] };

  for (const ci of branch1.shipCells) {
    if (branch2.shipCells.has(ci) || branch2.waterCells.has(ci)) continue;
    // Only if the other branch also has it as a ship
  }

  // Check cells that are ships in branch1 and also ships in branch2
  for (const ci of branch1.shipCells) {
    if (branch2.shipCells.has(ci)) {
      const d1 = branch1.cellDepths.get(ci) || 0;
      const d2 = branch2.cellDepths.get(ci) || 0;
      result.resolved.push({ cell: ci, state: SHIP, depth: Math.max(d1, d2) + 1 });
      result.contradictionCells.push(cell);
    }
  }

  for (const ci of branch1.waterCells) {
    if (branch2.waterCells.has(ci)) {
      const d1 = branch1.cellDepths.get(ci) || 0;
      const d2 = branch2.cellDepths.get(ci) || 0;
      result.resolved.push({ cell: ci, state: WATER, depth: Math.max(d1, d2) + 1 });
      result.contradictionCells.push(cell);
    }
  }

  return result;
}

/**
 * Simulate a single branch: set a cell to a state and run deductions.
 */
function simulateBranch(grid, cell, state, rc, cc, cl, knownDepths) {
  const sim = new Array(N * N);
  for (let i = 0; i < grid.length; i++) sim[i] = grid[i];
  sim[cell] = state;

  const depClone = new Map(knownDepths);
  depClone.set(cell, 1);

  // Run one round of deductions on the branch
  const { deductions, newDepths, solved } =
    runDeductionRound(sim, rc, cc, cl, { knownDepths: depClone, maxDepth: 0 });

  // Calculate depths
  for (const d of deductions) {
    d.depth = Math.max(1, ...d.dependsOn.map(k => depClone.get(k) || 0)) + 1;
  }

  for (const dep of newDepths) depClone.set(dep[0], dep[1]);

  // Apply
  for (let i = 0; i < sim.length; i++) sim[i] = grid[i];
  sim[cell] = state;
  for (const d of deductions) {
    sim[d.cell] = d.state;
  }

  const shipCells = new Set();
  const waterCells = new Set();
  for (let i = 0; i < sim.length; i++) {
    if (sim[i] === SHIP) shipCells.add(i);
    else if (sim[i] === WATER) waterCells.add(i);
  }

  return { grid: sim, shipCells, waterCells, cellDepths: depClone, solved };
}

/**
 * Proof-by-contradiction solver.
 * Iterates through undetermined cells and resolves them using PBC.
 */
function proofByContradictionSolver(grid, rc, cc, cl, knownDepths) {
  const allResolved = [];
  let maxIter = N * N; // safety limit

  while (maxIter-- > 0) {
    // Find undetermined cells
    const undetermined = [];
    for (let i = 0; i < N * N; i++) {
      if (grid[i] === UNKNOWN) undetermined.push(i);
    }

    if (undetermined.length === 0) break;

    let progress = false;
    let nextRoundResolved = [];

    // Try contradiction on each undetermined cell
    for (const cell of undetermined) {
      const result = resolveContradiction(grid, rc, cc, cl, knownDepths, cell);

      for (const r of result.resolved) {
        if (grid[r.cell] !== UNKNOWN) continue;
        // Only accept if this is a NEW determination (not already found in this round)
        const exists = nextRoundResolved.find(x => x.cell === r.cell);
        if (exists) continue;

        grid[r.cell] = r.state;
        knownDepths.set(r.cell, r.depth);
        nextRoundResolved.push(r);
        allResolved.push(r);
        progress = true;
      }
    }

    if (!progress) break;

    // Run another round of direct deductions to propagate new knowledge
    runDeductions(grid, rc, cc, cl, knownDepths);
  }

  return { grid, resolved: allResolved };
}

// ---------------------------------------------------------------------------
// Full backtracking solver (for puzzles not solvable by deduction)
// ---------------------------------------------------------------------------

function solveWithBacktracking(grid, rc, cc, cl) {
  const knownDepths = new Map();
  const reasons = new Map();
  let maxDepth = 0;

  // Seed initial clue depths
  for (const [cellStr, clue] of Object.entries(cl)) {
    const cell = +cellStr;
    if (isIslandClue(clue)) {
      if (grid[cell] === UNKNOWN) { grid[cell] = WATER; knownDepths.set(cell, 0); reasons.set(cell, 'clue'); }
    } else if (['s', 'e', 'm'].includes(clue)) {
      if (grid[cell] === UNKNOWN) { grid[cell] = SHIP; knownDepths.set(cell, 0); reasons.set(cell, 'clue'); }
    }
  }

  // Run direct deductions first
  const { grid: deduced, knownDepths: afterDeduction } =
    runDeductions(grid, rc, cl, cc, knownDepths);

  for (const dep of afterDeduction) {
    knownDepths.set(dep[0], dep[1]);
  }

  maxDepth = 0;
  for (const [cell, state] of Object.entries(deduced)) {
    if (state === SHIP) reasons.set(+cell, 'direct');
    else if (state === WATER) reasons.set(+cell, 'direct');
  }

  const solved = deduced.every(v => v !== UNKNOWN);
  if (solved) {
    return { grid: deduced, knownDepths, reasons, maxDepth, solved, needsBacktracking: false };
  }

  // Backtracking
  const btResult = backtrack(deduced, 0, rc, cl, cc, knownDepths, reasons);
  return btResult;
}

function backtrack(grid, depth, rc, cl, cc, knownDepths, reasons) {
  // Check if solved
  if (grid.every(v => v !== UNKNOWN)) {
    let maxD = 0;
    for (const d of knownDepths.values()) if (d > maxD) maxD = d;
    return { grid, knownDepths, reasons, maxDepth: maxD, solved: true, needsBacktracking: true };
  }

  // Run direct deductions from current state
  const { grid: deduced, knownDepths: afterDed, solved } =
    runDeductions(grid, rc, cl, cc, new Map(knownDepths));

  for (const dep of afterDed) knownDepths.set(dep[0], dep[1]);
  let maxD = 0;
  for (const d of afterDed) if (d[1] > maxD) maxD = d[1];

  if (solved) {
    return { grid: deduced, knownDepths, reasons, maxDepth: maxD, solved: true, needsBacktracking: true };
  }

  // Find best cell to branch on (one with fewest remaining options)
  let bestCell = -1;
  for (let i = 0; i < N * N; i++) {
    if (grid[i] === UNKNOWN && deduced[i] === UNKNOWN) {
      bestCell = i;
      break;
    }
  }

  if (bestCell < 0) {
    // Check remaining unknowns
    for (let i = 0; i < N * N; i++) {
      if (deduced[i] === UNKNOWN) { bestCell = i; break; }
    }
  }

  if (bestCell < 0) {
    // All determined somehow
    let maxD2 = 0;
    for (const d of knownDepths.values()) if (d > maxD2) maxD2 = d;
    return { grid: deduced, knownDepths, reasons, maxDepth: maxD2, solved: deduced.every(v => v !== UNKNOWN), needsBacktracking: true };
  }

  // Try SHIP first
  const gridShip = new Array(N * N);
  for (let i = 0; i < deduced.length; i++) gridShip[i] = deduced[i];
  gridShip[bestCell] = SHIP;
  knownDepths.set(bestCell, depth + 1);
  reasons.set(bestCell, 'branch');

  const result = backtrack(gridShip, depth + 1, rc, cl, cc, knownDepths, reasons);
  if (result.solved) return result;

  // Try WATER
  const gridWater = new Array(N * N);
  for (let i = 0; i < deduced.length; i++) gridWater[i] = deduced[i];
  gridWater[bestCell] = WATER;
  knownDepths.set(bestCell, depth + 1);
  reasons.set(bestCell, 'branch');

  return backtrack(gridWater, depth + 1, rc, cl, cc, knownDepths, reasons);
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

function analyzePuzzle(puzzle) {
  const cl = puzzle.cl || {};
  const rc = puzzle.rc || [];
  const cc = puzzle.cc || [];
  const grid = new Array(N * N).fill(UNKNOWN);

  // Seed initial clues
  for (const [cellStr, clue] of Object.entries(cl)) {
    const cell = +cellStr;
    if (clue === 'w' || isIslandClue(clue)) grid[cell] = WATER;
    else if (['s', 'e', 'm'].includes(clue)) grid[cell] = SHIP;
  }

  // Phase 1: Direct deductions with depth tracking
  const knownDepths = new Map();
  const reasons = new Map();

  // Seed: clues that set a cell have depth 0
  for (let i = 0; i < N * N; i++) {
    if (grid[i] !== UNKNOWN) {
      knownDepths.set(i, 0);
      reasons.set(i, 'clue');
    }
  }

  const direct = runDeductions(grid, rc, cl, cc, knownDepths);
  for (const dep of direct.knownDepths) knownDepths.set(dep[0], dep[1]);

  const afterDirectSolved = direct.grid.every(v => v !== UNKNOWN);

  // Phase 2: Proof by contradiction for remaining cells
  let pbcResolved = [];
  let pbcGrid = null;
  if (!afterDirectSolved) {
    const pbc = proofByContradictionSolver(direct.grid, rc, cc, cl, knownDepths);
    pbcResolved = pbc.resolved;
    pbcGrid = pbc.grid;
    for (let i = 0; i < pbcGrid.length; i++) {
      if (pbcGrid[i] !== UNKNOWN) {
        knownDepths.set(i, knownDepths.get(i) || 0);
      }
    }
  }

  // Phase 3: Full backtracking if still not solved
  let btResult = null;
  let ded2Grid = null;
  if (pbcResolved.length > 0 && pbcGrid) {
    const stillUnsolved = pbcResolved.filter(r => pbcGrid[r.cell] !== UNKNOWN);
    if (stillUnsolved.length > 0 || pbcGrid.some(v => v === UNKNOWN)) {
      // Re-run deductions on PBC result
      ded2Grid = runDeductions(pbcGrid, rc, cl, cc, new Map(knownDepths));
      for (const dep of ded2Grid.knownDepths) knownDepths.set(dep[0], dep[1]);

      if (!ded2Grid.grid.every(v => v !== UNKNOWN)) {
        btResult = solveWithBacktracking(ded2Grid.grid, rc, cl, cc);
        for (const dep of btResult.knownDepths) knownDepths.set(dep[0], dep[1]);
      }
    }
  }

  if (!afterDirectSolved && pbcResolved.length === 0) {
    btResult = solveWithBacktracking(direct.grid, rc, cl, cc);
    for (const dep of btResult.knownDepths) knownDepths.set(dep[0], dep[1]);
  }

  // Determine final solved state — check in priority order:
  // 1. Direct solved
  // 2. Deductions after PBC (ded2Grid) — if it solved the puzzle, use it
  // 3. PBC grid (only if it's fully solved)
  // 4. Backtracking result
  // 5. Direct grid as fallback
  let finalGrid, finalSolved, finalMaxDepth, needsBacktracking;

  if (afterDirectSolved) {
    finalGrid = direct.grid;
    finalSolved = true;
    finalMaxDepth = 0;
    needsBacktracking = false;
    for (const d of knownDepths.values()) if (d > finalMaxDepth) finalMaxDepth = d;
  } else if (ded2Grid && ded2Grid.grid.every(v => v !== UNKNOWN)) {
    // Deductions after PBC solved the puzzle
    finalGrid = ded2Grid.grid;
    finalSolved = true;
    finalMaxDepth = 0;
    needsBacktracking = false;
    for (const d of knownDepths.values()) if (d > finalMaxDepth) finalMaxDepth = d;
  } else if (pbcGrid && pbcGrid.every(v => v !== UNKNOWN)) {
    // PBC grid is fully solved
    finalGrid = pbcGrid;
    finalSolved = true;
    finalMaxDepth = 0;
    needsBacktracking = false;
    for (const d of knownDepths.values()) if (d > finalMaxDepth) finalMaxDepth = d;
  } else if (btResult) {
    finalGrid = btResult.grid;
    finalSolved = btResult.solved;
    finalMaxDepth = btResult.maxDepth;
    needsBacktracking = btResult.needsBacktracking;
  } else {
    finalGrid = direct.grid;
    finalSolved = false;
    finalMaxDepth = 0;
    needsBacktracking = true;
  }

  // Calculate statistics
  let determinedCells = 0, totalUnknowns = 0;
  let reasoningCells = 0, reasoningDepthSum = 0;
  const depthDistribution = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  let totalDepth = 0;
  let maxDirectDepth = 0;

  for (let i = 0; i < N * N; i++) {
    if (finalGrid[i] === UNKNOWN) {
      totalUnknowns++;
      continue;
    }
    determinedCells++;
    const d = knownDepths.get(i) || 0;
    totalDepth += d;
    depthDistribution[d] = (depthDistribution[d] || 0) + 1;

    // Reasoning cells (depth >= 1, not just given clues)
    if (d >= 1) {
      reasoningCells++;
      reasoningDepthSum += d;
      if (d > maxDirectDepth) maxDirectDepth = d;
    }
  }

  // Average chain length across reasoning cells (depth >= 1), excluding clue-only cells
  const avgDepth = reasoningCells > 0 ? reasoningDepthSum / reasoningCells : 0;

  // Percentages based on all determined cells (including clues for denominator)
  const cellsDepthGe2 = (depthDistribution[2] || 0) + (depthDistribution[3] || 0) +
    (depthDistribution[4] || 0) + (depthDistribution[5] || 0) +
    (depthDistribution[6] || 0) + (depthDistribution[7] || 0) +
    (depthDistribution[8] || 0) + (depthDistribution[9] || 0);
  const cellsDepthGe3 = (depthDistribution[3] || 0) + (depthDistribution[4] || 0) +
    (depthDistribution[5] || 0) + (depthDistribution[6] || 0) +
    (depthDistribution[7] || 0) + (depthDistribution[8] || 0) +
    (depthDistribution[9] || 0);
  const pctGe2 = determinedCells > 0 ? (cellsDepthGe2 / determinedCells) * 100 : 0;
  const pctGe3 = determinedCells > 0 ? (cellsDepthGe3 / determinedCells) * 100 : 0;

  const directRounds = direct.rounds;

  return {
    logicalDepth: Math.max(finalMaxDepth, 0),
    avgChainLength: Math.round(avgDepth * 100) / 100,
    pctDepthGe2: Math.round(pctGe2 * 10) / 10,
    pctDepthGe3: Math.round(pctGe3 * 10) / 10,
    maxDirectDepth,
    determinedCells,
    reasoningCells,
    totalUnknowns: totalUnknowns,
    depthDistribution,
    solved: finalSolved,
    needsBacktracking: needsBacktracking,
    directRounds,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'bimaru-harbor-library.json'), 'utf-8'));

  console.log('═'.repeat(110));
  console.log('  BIMARU HARBOR — REASONING DEPTH ANALYSIS (Decision-Tree Approach)');
  console.log('═'.repeat(110));
  console.log();
  console.log('  Depth = number of logical reasoning steps from initial clues');
  console.log('  Depth 1: Directly deducible from clues (ships, water, adj, counts)');
  console.log('  Depth 2: Deduced from depth-1 knowledge (island neighbors, line analysis)');
  console.log('  Depth 3+: Proof-by-contradiction or backtracking required');
  console.log();

  const results = [];
  for (const puzzle of data) {
    const analysis = analyzePuzzle(puzzle);
    const clueCount = Object.keys(puzzle.cl || {}).length;
    const shipClues = Object.values(puzzle.cl || {}).filter(v =>
      typeof v === 'string' && ['s', 'e', 'm'].includes(v)
    ).length;
    const islandClues = Object.values(puzzle.cl || {}).filter(v =>
      typeof v === 'string' && /^i\d+$/.test(v)
    ).length;

    const logDiff = classifyByLogicalDepth(analysis);
    const origDiff = puzzle.difficulty || 'unknown';
    const reclassified = logDiff !== origDiff;

    results.push({
      id: puzzle.id,
      name: puzzle.meta?.name ? puzzle.meta.name : `Puzzle ${puzzle.id}`,
      originalDifficulty: origDiff,
      logicalDepth: analysis.logicalDepth,
      avgChainLength: analysis.avgChainLength,
      pctDepthGe2: analysis.pctDepthGe2,
      pctDepthGe3: analysis.pctDepthGe3,
      solved: analysis.solved,
      needsBacktracking: analysis.needsBacktracking,
      directRounds: analysis.directRounds,
      determinedCells: analysis.determinedCells,
      totalUnknowns: analysis.totalUnknowns,
      depthDistribution: analysis.depthDistribution,
      clueCount,
      shipClues,
      islandClues,
      reclassified,
    });
  }

  // --- Main table ---
  console.log('┌──────┬────────────────────────┬──────────────┬───────────┬──────────┬───────────┬───────┬────────┬────────┬───────┐');
  console.log('│ ID   │ Name                   │ Difficulty   │ Depth     │ Avg Chain│ % ≥ Depth2│ % ≥3  │ Direct │ Solved │  BT   │');
  console.log('├──────┼────────────────────────┼──────────────┼───────────┼──────────┼───────────┼───────┼────────┼────────┼───────┤');

  for (const r of results) {
    const nm = r.name.length > 22 ? r.name.slice(0, 19) + '...' : r.name.padEnd(22);
    const od = r.originalDifficulty.padEnd(10);
    const ld = String(r.logicalDepth).padEnd(9);
    const acl = String(r.avgChainLength).padEnd(8);
    const p2 = `${String(r.pctDepthGe2).padEnd(5)}%`;
    const p3 = `${String(r.pctDepthGe3).padEnd(5)}%`;
    const dr = String(r.directRounds).padEnd(6);
    const sol = r.solved ? '✓' : '✗';
    const bt = r.needsBacktracking ? '✗' : '✓';
    const cls = r.reclassified ? ' ⚡' : '';
    console.log(`│ ${String(r.id).padEnd(4)}  │ ${nm} │ ${od}${cls} │ ${ld}   │ ${acl}  │ ${p2} │ ${p3} │ ${dr}  │ ${sol}    │ ${bt}    │`);
  }

  console.log('└──────┴────────────────────────┴──────────────┴───────────┴──────────┴───────────┴───────┴────────┴────────┴───────┘');
  console.log();
  console.log('  Depth = max reasoning chain length for any cell');
  console.log('  Avg Chain = mean reasoning steps across all determined cells');
  console.log('  % ≥ Depth2 = cells requiring proof-by-contradiction or deeper');
  console.log('  Direct = rounds of pure deduction before contradiction/backtracking');
  console.log('  ⚡ = difficulty reclassified');
  console.log('  BT = backtracking needed (✗) / pure deduction (✓)');
  console.log();

  // --- Summary statistics ---
  const depths = results.map(r => r.logicalDepth);
  const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
  const solCount = results.filter(r => r.solved).length;
  const btCount = results.filter(r => r.needsBacktracking).length;
  const recCount = results.filter(r => r.reclassified).length;
  const pctGe2 = results.map(r => r.pctDepthGe2).reduce((a, b) => a + b, 0) / results.length;
  const pctGe3 = results.map(r => r.pctDepthGe3).reduce((a, b) => a + b, 0) / results.length;

  console.log('─'.repeat(110));
  console.log('  SUMMARY');
  console.log('─'.repeat(110));
  console.log(`  Total puzzles:              ${results.length}`);
  console.log(`  Fully solved by deduction:  ${solCount}/${results.length}`);
  console.log(`  Needed backtracking:        ${btCount}/${results.length}`);
  console.log(`  Avg logical depth:          ${avgDepth.toFixed(1)}`);
  console.log(`  Min/Max logical depth:      ${Math.min(...depths)} / ${Math.max(...depths)}`);
  console.log(`  Avg % cells at depth ≥ 2:   ${pctGe2.toFixed(1)}%`);
  console.log(`  Avg % cells at depth ≥ 3:   ${pctGe3.toFixed(1)}%`);
  console.log(`  Puzzles reclassified:       ${recCount}/${results.length}`);
  console.log();

  // --- Depth distribution ---
  const depthBins = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
  for (const d of depths) {
    if (d > 10) depthBins[10]++;
    else depthBins[d]++;
  }
  console.log('  Depth distribution:');
  for (const [depth, count] of Object.entries(depthBins)) {
    if (count === 0) continue;
    const bar = '█'.repeat(count * 2);
    console.log(`    Depth ${depth}: ${String(count).padEnd(2)} ${bar}`);
  }
  console.log();

  // --- Reclassified puzzles ---
  const rec = results.filter(r => r.reclassified);
  if (rec.length > 0) {
    console.log('─'.repeat(110));
    console.log(`  RECLASSIFIED (${rec.length} puzzles)`);
    console.log('─'.repeat(110));
    console.log();

    const changes = {};
    for (const r of rec) {
      const key = `${r.originalDifficulty} → ${classifyByLogicalDepth(r)}`;
      (changes[key] = changes[key] || []).push(r);
    }
    for (const [change, puzzles] of Object.entries(changes)) {
      console.log(`  ${change}:`);
      for (const p of puzzles.sort((a, b) => b.logicalDepth - a.logicalDepth)) {
        console.log(`    ID ${String(p.id).padEnd(2)}: depth=${String(p.logicalDepth).padEnd(2)} avg=${String(p.avgChainLength).padEnd(5)} %≥2=${String(p.pctDepthGe2).padEnd(4)}% clues=${String(p.clueCount).padEnd(2)}`);
      }
      console.log();
    }
  }

  // --- Hard/Expert puzzles ---
  const hardExpert = results.filter(r => classifyByLogicalDepth(r) === 'hard' || classifyByLogicalDepth(r) === 'expert');
  if (hardExpert.length > 0) {
    console.log('─'.repeat(110));
    console.log(`  HARD / EXPERT PUZZLES (${hardExpert.length})`);
    console.log('─'.repeat(110));
    console.log();

    const expert = hardExpert.filter(r => classifyByLogicalDepth(r) === 'expert');
    if (expert.length > 0) {
      console.log(`  EXPERT (${expert.length}):`);
      console.log();
      console.log('  ┌──────┬────────────────────────┬──────────┬───────────┬──────────┬───────────┬──────────────────────┐');
      console.log('  │ ID   │ Name                   │ Original │ Depth     │ Avg Chain│ % ≥ Depth2│ Reason               │');
      console.log('  ├──────┼────────────────────────┼──────────┼───────────┼──────────┼───────────┼──────────────────────┤');
      for (const r of expert.sort((a, b) => b.logicalDepth - a.logicalDepth)) {
        const nm = r.name.length > 22 ? r.name.slice(0, 19) + '...' : r.name.padEnd(22);
        const reasons = [];
        if (r.logicalDepth >= 6) reasons.push(`depth=${r.logicalDepth}`);
        if (r.needsBacktracking) reasons.push('bt');
        if (r.pctDepthGe2 >= 50) reasons.push(`%≥2=${r.pctDepthGe2}%`);
        const reason = reasons.join(', ') || 'N/A';
        console.log(`  │ ${String(r.id).padEnd(4)}  │ ${nm} │ ${r.originalDifficulty.padEnd(8)} │ ${String(r.logicalDepth).padEnd(9)} │ ${String(r.avgChainLength).padEnd(8)} │ ${String(r.pctDepthGe2).padEnd(7)}% │ ${reason.padEnd(22)} │`);
      }
      console.log('  └──────┴────────────────────────┴──────────┴───────────┴──────────┴───────────┴──────────────────────┘');
      console.log();
    }

    const hard = hardExpert.filter(r => classifyByLogicalDepth(r) === 'hard');
    if (hard.length > 0) {
      console.log(`  HARD (${hard.length}):`);
      console.log();
      console.log('  ┌──────┬────────────────────────┬──────────┬───────────┬──────────┬───────────┬──────────────────────┐');
      console.log('  │ ID   │ Name                   │ Original │ Depth     │ Avg Chain│ % ≥ Depth2│ Reason               │');
      console.log('  ├──────┼────────────────────────┼──────────┼───────────┼──────────┼───────────┼──────────────────────┤');
      for (const r of hard.sort((a, b) => b.logicalDepth - a.logicalDepth)) {
        const nm = r.name.length > 22 ? r.name.slice(0, 19) + '...' : r.name.padEnd(22);
        const reasons = [];
        if (r.logicalDepth >= 4) reasons.push(`depth=${r.logicalDepth}`);
        if (r.needsBacktracking) reasons.push('bt');
        if (r.pctDepthGe2 >= 25) reasons.push(`%≥2=${r.pctDepthGe2}%`);
        const reason = reasons.join(', ') || 'N/A';
        console.log(`  │ ${String(r.id).padEnd(4)}  │ ${nm} │ ${r.originalDifficulty.padEnd(8)} │ ${String(r.logicalDepth).padEnd(9)} │ ${String(r.avgChainLength).padEnd(8)} │ ${String(r.pctDepthGe2).padEnd(7)}% │ ${reason.padEnd(22)} │`);
      }
      console.log('  └──────┴────────────────────────┴──────────┴───────────┴──────────┴───────────┴──────────────────────┘');
      console.log();
    }
  }

  // --- Cross-tabulation with original difficulty ---
  const origG = { easy: [], medium: [], hard: [], expert: [] };
  for (const r of results) {
    const g = origG[r.originalDifficulty] || origG.expert;
    if (Array.isArray(g)) g.push(r);
  }

  console.log('─'.repeat(110));
  console.log('  ORIGINAL DIFFICULTY → LOGICAL DEPTH DISTRIBUTION');
  console.log('─'.repeat(110));
  console.log();
  console.log('  ┌──────────────┬──────┬───────────┬───────────┬───────────┬───────────┬──────────┬─────────┐');
  console.log('  │ Original Diff│  N   │ avgDepth  │ minDepth  │ maxDepth  │ Solved?   │ % avg ≥2 │ BT rate │');
  console.log('  ├──────────────┼──────┼───────────┼───────────┼───────────┼───────────┼──────────┼─────────┤');
  for (const diff of ['easy', 'medium', 'hard', 'expert']) {
    const g = origG[diff];
    if (!g?.length) continue;
    const depthsArr = g.map(r => r.logicalDepth);
    const avg = (depthsArr.reduce((a, b) => a + b, 0) / depthsArr.length).toFixed(2);
    const mn = Math.min(...depthsArr);
    const mx = Math.max(...depthsArr);
    const solPct = ((g.filter(r => r.solved).length / g.length) * 100).toFixed(1);
    const pct2 = (g.map(r => r.pctDepthGe2).reduce((a, b) => a + b, 0) / g.length).toFixed(1);
    const btRate = ((g.filter(r => r.needsBacktracking).length / g.length) * 100).toFixed(1);
    console.log(`  │ ${diff.padEnd(12)} │ ${String(g.length).padEnd(4)} │ ${avg.padEnd(9)} │ ${String(mn).padEnd(9)} │ ${String(mx).padEnd(9)} │ ${solPct.padEnd(7)}% │ ${pct2.padEnd(8)}% │ ${btRate.padEnd(7)}% │`);
  }
  console.log('  └──────────────┴──────┴───────────┴───────────┴───────────┴───────────┴──────────┴─────────┘');
  console.log();

  // --- Write results to JSON ---
  const classificationData = results.map(r => ({
    id: r.id,
    name: r.name,
    originalDifficulty: r.originalDifficulty,
    logicalDepth: r.logicalDepth,
    avgChainLength: r.avgChainLength,
    pctDepthGe2: r.pctDepthGe2,
    pctDepthGe3: r.pctDepthGe3,
    needsBacktracking: r.needsBacktracking,
    directRounds: r.directRounds,
    solved: r.solved,
    clueCount: r.clueCount,
    depthDistribution: r.depthDistribution,
  }));

  fs.writeFileSync(
    path.join(__dirname, 'better_logical_depth.json'),
    JSON.stringify(classificationData, null, 2) + '\n',
    'utf-8'
  );

  console.log('  Results written to better_logical_depth.json');
  console.log('═'.repeat(110));
}

/**
 * Classify puzzle by its logical depth metrics.
 */
function classifyByLogicalDepth(analysis) {
  if (typeof analysis === 'object' && analysis.logicalDepth !== undefined) {
    analysis = { logicalDepth: analysis.logicalDepth, avgChainLength: analysis.avgChainLength, pctDepthGe2: analysis.pctDepthGe2, needsBacktracking: analysis.needsBacktracking };
  }

  const { logicalDepth, pctDepthGe2, needsBacktracking } = analysis;

  // Expert: deep reasoning chains (≥6) OR high percentage of deep cells with backtracking
  if (logicalDepth >= 7) return 'expert';
  if (logicalDepth >= 6 && pctDepthGe2 >= 40) return 'expert';
  if (logicalDepth >= 6 && needsBacktracking) return 'expert';

  // Hard: moderate depth with significant deep cells
  if (logicalDepth >= 5 && pctDepthGe2 >= 30) return 'hard';
  if (logicalDepth >= 5 && needsBacktracking) return 'hard';
  if (logicalDepth >= 4 && pctDepthGe2 >= 50) return 'hard';

  // Medium: some depth but mostly straightforward
  if (logicalDepth >= 3) return 'medium';
  if (logicalDepth >= 2 && pctDepthGe2 >= 20) return 'medium';

  // Easy: shallow reasoning
  return 'easy';
}

main();
