#!/usr/bin/env node
/**
 * Bimaru Puzzle Solver — backtracking with constraint propagation
 *
 * Grid encoding:
 *   0 = water (.)
 *   null = unknown (?)
 *   >0 = ship cell (component ID)
 *   Islands are stored in a separate Set, grid cell is 0
 */

const N = 9;
const rc = [4, 1, 6, 1, 3, 1, 3, 0, 1];
const cc = [2, 1, 5, 3, 2, 3, 1, 2, 1];
const cl = {
  "2": "m",        // (0,2): middle ship
  "23": "i4",      // (2,5): island, 4 orth ship neighbors
  "25": "m",       // (2,7): middle ship
  "41": "e",       // (4,5): end ship
  "54": "s",       // (6,0): single ship (0 neighbors)
  "56": "i2",      // (6,2): island, 2 orth ship neighbors
  "57": "e",       // (6,3): end ship
};
const SHIPS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]; // fleet

let grid;
let islands;
let waterForced;
let components;
let remaining;
let deductions;
let solutionCount = 0;
let solutions = [];

function key(r, c) { return r + "," + c; }
// Clue keys are linear grid indices (row-major): "23" = row 2, col 5
// Internal keys are "r,c" format
function rkey(k) {
  if (typeof k === "string" && k.includes(",")) {
    return k.split(",").map(Number);
  }
  const n = parseInt(k);
  return [Math.floor(n / N), n % N];
}

function isIsland(r, c) { return islands.has(key(r, c)); }
function isWater(r, c) { return grid[r][c] === 0 || isIsland(r, c); }
function isShip(r, c) { return typeof grid[r][c] === "number" && grid[r][c] > 0; }
function isUnknown(r, c) { return grid[r][c] === null; }
function getShipId(r, c) { return grid[r][c]; }

function orthNeighbors(r, c) {
  const n = [];
  if (r > 0) n.push([r - 1, c]);
  if (r < N - 1) n.push([r + 1, c]);
  if (c > 0) n.push([r, c - 1]);
  if (c < N - 1) n.push([r, c + 1]);
  return n;
}

function diagNeighbors(r, c) {
  const n = [];
  if (r > 0 && c > 0) n.push([r - 1, c - 1]);
  if (r > 0 && c < N - 1) n.push([r - 1, c + 1]);
  if (r < N - 1 && c > 0) n.push([r + 1, c - 1]);
  if (r < N - 1 && c < N - 1) n.push([r + 1, c + 1]);
  return n;
}

function allNeighbors(r, c) { return [...orthNeighbors(r, c), ...diagNeighbors(r, c)]; }

function orthShipCount(r, c) {
  let count = 0;
  for (const [nr, nc] of orthNeighbors(r, c)) {
    if (isShip(nr, nc)) count++;
  }
  return count;
}

function checkAdjacency() {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!isShip(r, c)) continue;
      const sid = getShipId(r, c);
      for (const [nr, nc] of allNeighbors(r, c)) {
        if (!isShip(nr, nc)) continue;
        if (getShipId(nr, nc) !== sid) return false;
      }
    }
  }
  return true;
}

function isShipValid(shipId) {
  const cells = components.get(shipId);
  if (!cells || cells.length === 0) return true;
  const len = cells.length;
  const rows = cells.map(([r]) => r);
  const cols = cells.map(([, c]) => c);
  const isRow = rows.every(r => r === rows[0]);
  const isCol = cols.every(c => c === cols[0]);
  if (!isRow && !isCol) return false;
  if (isRow) {
    const sorted = [...cols].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return false;
    }
  }
  if (isCol) {
    const sorted = [...rows].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return false;
    }
  }
  if (!checkAdjacency()) return false;
  return true;
}

function checkRowColCounts() {
  for (let r = 0; r < N; r++) {
    let count = 0;
    for (let c = 0; c < N; c++) { if (isShip(r, c)) count++; }
    if (count > rc[r]) return false;
  }
  for (let c = 0; c < N; c++) {
    let count = 0;
    for (let r = 0; r < N; r++) { if (isShip(r, c)) count++; }
    if (count > cc[c]) return false;
  }
  return true;
}

function areRowColCountsSatisfied() {
  for (let r = 0; r < N; r++) {
    let count = 0;
    for (let c = 0; c < N; c++) { if (isShip(r, c)) count++; }
    if (count !== rc[r]) return false;
  }
  for (let c = 0; c < N; c++) {
    let count = 0;
    for (let r = 0; r < N; r++) { if (isShip(r, c)) count++; }
    if (count !== cc[c]) return false;
  }
  return true;
}

function checkClueConstraints() {
  for (const k of Object.keys(cl)) {
    const type = cl[k];
    const [r, c] = rkey(k);

    if (type.startsWith("i")) {
      const expected = parseInt(type.substring(1));
      if (orthShipCount(r, c) !== expected) return false;
      continue;
    }

    if (!isShip(r, c)) return false;
    const sid = getShipId(r, c);
    const orthCount = orthShipCount(r, c);

    if (type === "s") {
      if (orthCount !== 0) return false;
      // Single means length-1 ship
      const cells = components.get(sid);
      if (cells && cells.length > 1) return false;
    } else if (type === "e") {
      if (orthCount !== 1) return false;
    } else if (type === "m") {
      if (orthCount !== 2) return false;
      const neighbors = orthNeighbors(r, c);
      for (const [nr, nc] of neighbors) {
        if (isShip(nr, nc) && getShipId(nr, nc) !== sid) return false;
      }
    }
  }
  return true;
}

function checkIslandFeasibility() {
  // Iterate over clue entries to get both linear key and type
  for (const [ck, type] of Object.entries(cl)) {
    if (!type.startsWith("i")) continue;
    const [r, c] = rkey(ck);
    const expected = parseInt(type.substring(1));
    const current = orthShipCount(r, c);
    let unknownN = 0;
    let totalN = 0;
    for (const [nr, nc] of orthNeighbors(r, c)) {
      totalN++;
      if (isUnknown(nr, nc)) unknownN++;
    }
    const waterN = totalN - unknownN;
    if (current > expected || current + unknownN < expected) {
      console.error("  ISLAND FAIL: (" + r + "," + c + ") need=" + expected +
        " current=" + current + " unknown=" + unknownN + " water=" + waterN);
      return false;
    }
  }
  return true;
}

function canPlace(shipId, cells) {
  for (const [r, c] of cells) {
    if (r < 0 || r >= N || c < 0 || c >= N) return false;
    if (isIsland(r, c)) return false;
    if (grid[r][c] !== null && grid[r][c] !== 0) return false;
  }
  return true;
}

function placeShip(shipId, cells) {
  for (const [r, c] of cells) {
    if (isShip(r, c) && getShipId(r, c) === shipId) continue;
    grid[r][c] = shipId;
  }
  const existing = components.get(shipId) || [];
  const merged = new Map();
  for (const [r, c] of existing) merged.set(key(r, c), true);
  for (const [r, c] of cells) merged.set(key(r, c), true);
  components.set(shipId, Array.from(merged.entries()).map(e => rkey(e[0])));
  const total = components.get(shipId).length;
  remaining.set(shipId, SHIPS[shipId - 1] - total);
}

function removeShip(shipId, cells) {
  for (const [r, c] of cells) {
    if (isIsland(r, c)) continue;
    if (isShip(r, c) && getShipId(r, c) === shipId) {
      grid[r][c] = null;
    }
  }
  const existing = components.get(shipId) || [];
  const kept = new Map();
  for (const [r, c] of existing) {
    const k = key(r, c);
    let inNew = false;
    for (const [r2, c2] of cells) {
      if (key(r2, c2) === k) { inNew = true; break; }
    }
    if (!inNew) kept.set(k, [r, c]);
  }
  components.set(shipId, Array.from(kept.values()));
  const total = components.get(shipId).length;
  remaining.set(shipId, SHIPS[shipId - 1] - total);
}

function generatePlacements(shipId) {
  const len = SHIPS[shipId - 1];
  const placements = [];

  for (let r = 0; r < N; r++) {
    for (let c = 0; c <= N - len; c++) {
      const cells = [];
      let valid = true;
      for (let i = 0; i < len; i++) {
        if (isIsland(r, c + i) || grid[r][c + i] === 0) { valid = false; break; }
        cells.push([r, c + i]);
      }
      if (valid) placements.push(cells);
    }
  }

  for (let c = 0; c < N; c++) {
    for (let r = 0; r <= N - len; r++) {
      const cells = [];
      let valid = true;
      for (let i = 0; i < len; i++) {
        if (isIsland(r + i, c) || grid[r + i][c] === 0) { valid = false; break; }
        cells.push([r + i, c]);
      }
      if (valid) placements.push(cells);
    }
  }

  return placements;
}

function placementFitsCounts(shipId, cells) {
  // Count cells per row and column for this placement
  const rowCounts = {};
  const colCounts = {};
  for (const [r, c] of cells) {
    rowCounts[r] = (rowCounts[r] || 0) + 1;
    colCounts[c] = (colCounts[c] || 0) + 1;
  }

  // Check row counts
  for (const r of Object.keys(rowCounts)) {
    let existing = 0;
    for (let c = 0; c < N; c++) {
      if (isShip(r, c) && getShipId(r, c) !== shipId) existing++;
    }
    if (existing + rowCounts[r] > rc[r]) return false;
  }

  // Check col counts
  for (const c of Object.keys(colCounts)) {
    let existing = 0;
    for (let r = 0; r < N; r++) {
      if (isShip(r, c) && getShipId(r, c) !== shipId) existing++;
    }
    if (existing + colCounts[c] > cc[c]) return false;
  }

  return true;
}

function checkClueFeasibility() {
  for (const k of Object.keys(cl)) {
    const type = cl[k];
    if (type.startsWith("i")) continue;
    const [r, c] = rkey(k);
    if (!isShip(r, c)) continue;
    const sid = getShipId(r, c);
    const len = SHIPS[sid - 1];
    if (type === "s" && len > 1) return false;
    if (type === "m" && len < 3) return false;
    if (type === "e" && len < 2) return false;
  }
  return true;
}

function propagateWater(shipId) {
  const cells = components.get(shipId);
  if (!cells) return;
  if (cells.length !== SHIPS[shipId - 1]) return;

  const waterCells = new Set();
  for (const [r, c] of cells) {
    for (const [nr, nc] of allNeighbors(r, c)) {
      if (isShip(nr, nc) && getShipId(nr, nc) === shipId) continue;
      if (isIsland(nr, nc)) continue;
      waterCells.add(key(nr, nc));
    }
  }
  let didPropagate = false;
  for (const k of waterCells) {
    const [wr, wc] = rkey(k);
    if (grid[wr][wc] === 0) continue;
    // Don't force water on cells that must be ships (clue cells)
    if (Object.keys(cl).some(ck => {
      const [cr, cc2] = rkey(ck);
      return cr === wr && cc2 === wc && !cl[ck].startsWith("i");
    })) continue;
    // Don't force water if it would make an island impossible
    if (wouldMakeIslandImpossible(wr, wc)) continue;
    grid[wr][wc] = 0;
    waterForced.add(k);
    didPropagate = true;
    deductions.push("  Ship " + shipId + " complete (" + SHIPS[shipId - 1] + " cells) -> " +
      "cell (" + wr + "," + wc + ") forced WATER (adjacency rule)");
  }
  return didPropagate;
}

function wouldMakeIslandImpossible(r, c) {
  // Check if setting (r,c) to water would make any island impossible
  for (const [ck, type] of Object.entries(cl)) {
    if (!type.startsWith("i")) continue;
    const [ir, ic] = rkey(ck);
    // Is (r,c) an orth neighbor of this island?
    const isNeighbor = (Math.abs(r - ir) === 1 && c === ic) || (r === ir && Math.abs(c - ic) === 1);
    if (!isNeighbor) continue;

    // If this neighbor becomes water, check if the island can still reach its target
    const expected = parseInt(type.substring(1));
    const current = orthShipCount(ir, ic);
    // Count unknown neighbors of this island (excluding (r,c) which would become water)
    let unknownN = 0;
    for (const [nr, nc] of orthNeighbors(ir, ic)) {
      if (nr === r && nc === c) continue; // This would become water
      if (isUnknown(nr, nc)) unknownN++;
    }
    // current + unknownN would be the max achievable
    if (current + unknownN < expected) return true;
  }
  return false;
}

function saveState() {
  return {
    grid: grid.map(row => [...row]),
    islands: new Set(islands),
    waterForced: new Set(waterForced),
    components: new Map(components),
    remaining: new Map(remaining),
  };
}

function restoreState(st) {
  grid = st.grid;
  islands = new Set(st.islands);
  waterForced = new Set(st.waterForced);
  components = new Map(st.components);
  remaining = new Map(st.remaining);
}

// ─── Pre-solve deduction: force water around completed ships ──
function initialDeductions() {
  // Row/column analysis
  for (let r = 0; r < N; r++) {
    if (rc[r] === 0) {
      deductions.push("  Row " + r + ": 0 ships -> all cells WATER");
      for (let c = 0; c < N; c++) {
        if (!isIsland(r, c) && grid[r][c] !== 0) {
          const k = key(r, c);
          if (!Object.keys(cl).some(ck => key(rkey(ck)[0], rkey(ck)[1]) === k && !cl[ck].startsWith("i"))) {
            grid[r][c] = 0;
            waterForced.add(k);
            deductions.push("    -> (" + r + "," + c + ") WATER");
          }
        }
      }
    }
  }

  // Analyze 's' clues (single ships)
  for (const k of Object.keys(cl)) {
    const type = cl[k];
    if (type !== "s") continue;
    const [r, c] = rkey(k);
    deductions.push("  Clue " + k + " ('s') at (" + r + "," + c + "): length-1 ship, 0 neighbors");
    for (const [nr, nc] of allNeighbors(r, c)) {
      if (isIsland(nr, nc)) continue;
      const nk = key(nr, nc);
      if (grid[nr][nc] !== 0 && !Object.keys(cl).some(ck => key(rkey(ck)[0], rkey(ck)[1]) === nk && !cl[ck].startsWith("i"))) {
        grid[nr][nc] = 0;
        waterForced.add(nk);
        deductions.push("    -> (" + nr + "," + nc + ") forced WATER (diagonal/ortho neighbor of single)");
      }
    }
  }

  // Analyze 'm' clues (middle ships)
  for (const k of Object.keys(cl)) {
    const type = cl[k];
    if (type !== "m") continue;
    const [r, c] = rkey(k);
    deductions.push("  Clue " + k + " ('m') at (" + r + "," + c + "): middle of >=3 ship");

    let canH = false, canV = false;

    // Horizontal check: need at least 1 free cell on each side
    if (c > 0 && c < N - 1 && !isWater(r, c - 1) && !isWater(r, c + 1)) {
      canH = true;
    }

    // Vertical check: need at least 1 free cell on each side
    if (r > 0 && r < N - 1 && !isWater(r - 1, c) && !isWater(r + 1, c)) {
      canV = true;
    }

    if (canH && !canV) {
      deductions.push("    -> Direction forced: HORIZONTAL");
    } else if (canV && !canH) {
      deductions.push("    -> Direction forced: VERTICAL");
    } else if (canH && canV) {
      deductions.push("    -> Direction ambiguous (H or V possible)");
    } else {
      deductions.push("    -> WARNING: No valid direction!");
    }
  }

  // Analyze 'e' clues (end ships)
  for (const k of Object.keys(cl)) {
    const type = cl[k];
    if (type !== "e") continue;
    const [r, c] = rkey(k);
    deductions.push("  Clue " + k + " ('e') at (" + r + "," + c + "): end of ship (1 orth neighbor)");

    // Check if adjacent water cells eliminate directions
    const dirs = [];
    if (c < N - 1 && !isWater(r, c + 1)) dirs.push([0, 1, "right"]);
    if (c > 0 && !isWater(r, c - 1)) dirs.push([0, -1, "left"]);
    if (r < N - 1 && !isWater(r + 1, c)) dirs.push([1, 0, "down"]);
    if (r > 0 && !isWater(r - 1, c)) dirs.push([-1, 0, "up"]);

    // Filter out directions blocked by water or boundaries
    const validDirs = dirs.filter(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) return false;
      if (isWater(nr, nc)) return false;
      return true;
    });

    deductions.push("    -> Valid extension directions: " + (validDirs.length || "NONE!") +
      (validDirs.length ? ": " + validDirs.map(d => d[2]).join(", ") : ""));
  }

  // Analyze islands
  for (const [ck, type] of Object.entries(cl)) {
    if (!type.startsWith("i")) continue;
    const [r, c] = rkey(ck);
    const expected = parseInt(type.substring(1));
    deductions.push("  Island at (" + r + "," + c + "): needs " + expected + " orth ship neighbors");

    let shipN = orthShipCount(r, c);
    let unkN = 0;
    for (const [nr, nc] of orthNeighbors(r, c)) {
      if (isUnknown(nr, nc)) unkN++;
    }
    deductions.push("    -> Currently: " + shipN + " ship neighbors, " + unkN + " unknown");

    // Water neighbors of island must remain water (no ship can touch island orthogonally from water side)
    // Actually, all orth neighbors of island should be checked
    for (const [nr, nc] of orthNeighbors(r, c)) {
      if (isWater(nr, nc)) {
        // This water neighbor cannot be a ship cell
        // (already is water, just noting it)
      }
    }
  }
}

function solve(results) {
  // Find incomplete ships (remaining > 0 means ship not yet complete)
  const incomplete = [];
  for (const [shipId, rem] of remaining) {
    if (rem > 0) incomplete.push(shipId);
  }

  if (incomplete.length === 0) {
    // All ships placed — check all constraints
    if (!checkClueConstraints()) return;
    if (!areRowColCountsSatisfied()) return;
    if (!checkAdjacency()) return;
    if (!checkIslandFeasibility()) return;

    solutionCount++;
    if (solutionCount <= 5) {
      results.push(grid.map(row => [...row]));
    }
    return;
  }

  const prevState = saveState();

  // Sort: most constrained first (fewest valid placements)
  incomplete.sort((a, b) => {
    const pa = generatePlacements(a).filter(cells => {
      let newC = 0;
      for (const [r, c] of cells) { if (!isShip(r, c) || getShipId(r, c) !== a) newC++; }
      return newC === SHIPS[a - 1] - (components.get(a) || []).length;
    });
    const pb = generatePlacements(b).filter(cells => {
      let newC = 0;
      for (const [r, c] of cells) { if (!isShip(r, c) || getShipId(r, c) !== b) newC++; }
      return newC === SHIPS[b - 1] - (components.get(b) || []).length;
    });
    return pa.length - pb.length;
  });

  const shipId = incomplete[0];
  const placedCells = components.get(shipId) || [];
  const currentLen = placedCells.length;
  const shipLen = SHIPS[shipId - 1];
  const needLen = shipLen - currentLen;

  const placements = generatePlacements(shipId).filter(cells => {
    let newCount = 0;
    for (const [r, c] of cells) {
      if (!isShip(r, c) || getShipId(r, c) !== shipId) newCount++;
    }
    return newCount === needLen;
  });

  let totalPlacements = placements.length;
  let loopCount = 0;
  let afterPlacementCheck = 0;
  let afterClueCheck = 0;
  let afterIslandCheck = 0;
  let afterRowColCheck = 0;

  for (const cells of placements) {
    loopCount++;
    if (!placementFitsCounts(shipId, cells)) continue;
    afterPlacementCheck++;
    if (!checkClueFeasibility) continue;
    afterClueCheck++;
    if (!checkIslandFeasibility()) continue;
    afterIslandCheck++;
    if (!checkRowColCounts()) continue;
    afterRowColCheck++;
    afterIslandCheck++;
    if (!checkIslandFeasibility()) continue;
    afterRowColCheck++;

    placeShip(shipId, cells);
    propagateWater(shipId);

    if (!checkRowColCounts()) {
      restoreState(prevState);
      continue;
    }

    solve(results);

    restoreState(prevState);
  }

  // Debug output on first call
  if (shipId === incomplete[0] && incomplete.indexOf(shipId) === 0 && solutionCount === 0) {
    console.log("  Ship " + shipId + " (" + shipLen + " cells): " + totalPlacements + " raw placements");
    console.log("    After placementFitsCounts: " + afterPlacementCheck);
    console.log("    After checkClueFeasibility: " + afterClueCheck);
    console.log("    After checkIslandFeasibility: " + afterIslandCheck);
    console.log("    After checkRowColCounts: " + afterRowColCheck);
  }

  restoreState(prevState);
}

function printGrid(g) {
  const symbols = {};
  const shipIds = new Set();
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (typeof g[r][c] === "number" && g[r][c] > 0) shipIds.add(g[r][c]);
    }
  }
  shipIds.forEach((id, i) => { symbols[id] = String.fromCharCode(65 + ((id - 1) % 26)); });

  const sym = (r, c) => {
    if (isIsland(r, c)) return "I";
    const val = g[r][c];
    if (val === 0) return ".";
    if (typeof val === "number" && val > 0) return symbols[val] || "S";
    return "?";
  };

  const hdr = "    " + [...Array(N).keys()].map(c => String(c).padStart(3)).join("");
  console.log(hdr);
  for (let r = 0; r < N; r++) {
    const row = [...Array(N).keys()].map(c => sym(r, c)).join(" ");
    console.log(String(r).padStart(2) + ": " + row);
  }
}

function printComponents(g) {
  const shipIds = new Set();
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (typeof g[r][c] === "number" && g[r][c] > 0) shipIds.add(g[r][c]);

  const counts = {};
  for (const id of shipIds) {
    const cells = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (g[r][c] === id) cells.push([r, c]);
    const len = cells.length;
    const sorted = cells.sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
    const [sr, sc] = sorted[0];
    const isRow = cells.every(([r]) => r === sr);
    const dir = isRow ? "H" : "V";
    const pos = isRow ? "[" + sr + "," + sc + "]" : "(" + sr + "," + sc + ")";
    counts[len] = (counts[len] || 0) + 1;
    console.log("  Ship #" + id + ": " + len + " cells, " + dir +
      " starting at " + pos);
  }

  // Verify fleet
  console.log("\nFleet verification:");
  const expected = {};
  SHIPS.forEach(l => { expected[l] = (expected[l] || 0) + 1; });

  let match = true;
  const sortedKeys = Object.keys(expected).map(Number).sort((a, b) => a - b);
  for (const l of sortedKeys) {
    const exp = expected[l];
    const act = counts[l] || 0;
    const status = act === exp ? "OK" : "MISMATCH";
    if (act !== exp) match = false;
    console.log("  " + l + "-cell ships: expected " + exp + ", found " + act + " [" + status + "]");
  }
  console.log(match ? "  Fleet matches!" : "  Fleet MISMATCH!");
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("========================================");
  console.log("  BIMARU PUZZLE SOLVER - ID 17");
  console.log("========================================\n");

  console.log("Grid:        " + N + "x" + N);
  console.log("Row counts:  [" + rc.join(", ") + "]");
  console.log("Col counts:  [" + cc.join(", ") + "]");
  console.log("Fleet:       [" + SHIPS.join(", ") + "] (total: " + SHIPS.reduce((a, b) => a + b, 0) + ")\n");

  console.log("Clues:");
  for (const k of Object.keys(cl)) {
    const [r, c] = rkey(k);
    const t = cl[k];
    let desc;
    if (t.startsWith("i")) desc = "island (" + parseInt(t.substring(1)) + " ship neighbors)";
    else if (t === "s") desc = "single (0 neighbors)";
    else if (t === "e") desc = "end (1 neighbor)";
    else if (t === "m") desc = "middle (2 neighbors)";
    console.log("  (" + r + "," + c + ")='" + k + "' -> " + t + " : " + desc);
  }
  console.log();

  // Initialize state
  grid = Array.from({ length: N }, () => Array(N).fill(null));
  islands = new Set();
  waterForced = new Set();
  components = new Map();
  remaining = new Map();
  deductions = [];

  for (const [k, type] of Object.entries(cl)) {
    const [r, c] = rkey(k);
    if (type.startsWith("i")) {
      islands.add(key(r, c));  // store as "r,c" format
      grid[r][c] = 0;
    }
  }
  for (let i = 1; i <= SHIPS.length; i++) remaining.set(i, SHIPS[i - 1]);

  console.log("========================================");
  console.log("  LOGICAL DEDUCTION CHAIN");
  console.log("========================================\n");

  console.log("Phase 1: Initial Analysis");
  console.log("----------------------------------------");

  // Row 7 has 0 ships
  console.log("  Row 7: 0 ships (rc[7]=0) -> all cells water");

  // Row counts visualization
  console.log("\n  Row utilization:");
  for (let r = 0; r < N; r++) {
    const bar = "█".repeat(rc[r]) + "░".repeat(N - rc[r]);
    console.log("    Row " + r + ": [" + bar + "] " + rc[r] + "/" + N);
  }
  console.log("\n  Col utilization:");
  for (let c = 0; c < N; c++) {
    const bar = "█".repeat(cc[c]) + "░".repeat(N - cc[c]);
    console.log("    Col " + c + ": [" + bar + "] " + cc[c] + "/" + N);
  }
  console.log();

  console.log("Phase 2: Constraint Propagation");
  console.log("----------------------------------------");
  initialDeductions();

  console.log("\nPhase 3: Deduction Results");
  console.log("----------------------------------------");
  for (const d of deductions) {
    console.log(d);
  }

  // Show initial grid state
  console.log("\n  Initial grid (after clue initialization):");
  printGrid(grid);
  console.log();

  console.log("========================================");
  console.log("  BACKTRACKING SEARCH");
  console.log("========================================\n");

  const startTime = Date.now();
  const results = [];
  solve(results);
  const elapsed = Date.now() - startTime;

  console.log("\n========================================");
  console.log("  RESULTS");
  console.log("========================================\n");

  console.log("Solutions found: " + solutionCount);
  console.log("Search time: " + elapsed + "ms\n");

  if (solutionCount === 0) {
    console.log("*** NO SOLUTION ***");
    console.log("\nPuzzle is unsatisfiable. Possible reasons:");
    console.log("  1. Clue conflicts (e.g., ship cell must be both 's' and 'e')");
    console.log("  2. Row/column counts incompatible with fleet composition");
    console.log("  3. Island neighbor requirements cannot be met");
    console.log("  4. Adjacency separation rules prevent valid placements");
    console.log("  5. Backtracking explored all possibilities without success");
  } else if (solutionCount === 1) {
    console.log("*** UNIQUE SOLUTION ***\n");
    printGrid(results[0]);
    console.log();
    printComponents(results[0]);
  } else {
    console.log("*** MULTIPLE SOLUTIONS ***\n");
    for (let i = 0; i < Math.min(solutionCount, 5); i++) {
      console.log("Solution " + (i + 1) + ":");
      printGrid(results[i]);
      console.log();
      printComponents(results[i]);
      console.log();
    }
    if (solutionCount > 5) {
      console.log("... and " + (solutionCount - 5) + " more solutions");
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
