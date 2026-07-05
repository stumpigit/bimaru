#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const LIBRARY_PATH = path.join(__dirname, "bimaru-harbor-library.json");
const CLASSIFICATION_PATH = path.join(__dirname, "logical_depth_classification.json");

// --- Load data ---
const library = JSON.parse(fs.readFileSync(LIBRARY_PATH, "utf-8"));
const classification = JSON.parse(
  fs.readFileSync(CLASSIFICATION_PATH, "utf-8")
);

// Build a lookup by id for O(1) matching
const classMap = new Map();
for (const c of classification) {
  classMap.set(c.id, c);
}

// --- Save old state for diff reporting ---
const oldState = new Map();
for (const puzzle of library) {
  oldState.set(puzzle.id, {
    difficulty: puzzle.difficulty,
    name: puzzle.name || `Puzzle ${puzzle.id}`,
  });
}

// --- Update each puzzle ---
let reclassifiedCount = 0;
const summaryRows = [];

for (const puzzle of library) {
  const cls = classMap.get(puzzle.id);

  if (!cls) {
    console.error(`WARNING: No classification found for puzzle id=${puzzle.id}`);
    continue;
  }

  const oldDiff = puzzle.difficulty;
  const newDiff = cls.newDifficulty;
  const changed = oldDiff !== newDiff;

  // Update difficulty
  puzzle.difficulty = newDiff;

  // Add logicalDepth and chainLength to meta
  puzzle.meta.logicalDepth = cls.logicalDepth;
  puzzle.meta.chainLength = cls.chainLength;

  if (changed) reclassifiedCount++;

  summaryRows.push({
    id: puzzle.id,
    name: cls.name,
    oldDifficulty: oldDiff,
    newDifficulty: newDiff,
    logicalDepth: cls.logicalDepth,
    chainLength: cls.chainLength,
  });
}

// --- Write updated library (compact, 2-space indent) ---
fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2) + "\n", "utf-8");

// --- Print summary table ---
console.log("=".repeat(80));
console.log("BIMARU LIBRARY DIFFICULTY UPDATE");
console.log("=".repeat(80));
console.log("");

// Header
const header =
  `${"ID".padEnd(4)}  ${"Name".padEnd(22)}  ${"Old".padEnd(9)}  ${"New".padEnd(9)}  ${"Depth".padEnd(7)}  ${"Chain".padEnd(7)}`;
console.log(header);
console.log("-".repeat(80));

for (const row of summaryRows) {
  const name = row.name.length > 22 ? row.name.substring(0, 19) + "..." : row.name;
  const line = `${row.id.toString().padEnd(4)}  ${name.padEnd(22)}  ${row.oldDifficulty.padEnd(9)}  ${row.newDifficulty.padEnd(9)}  ${row.logicalDepth.toString().padEnd(7)}  ${row.chainLength.toString().padEnd(7)}`;
  console.log(line);
}

console.log("-".repeat(80));
console.log("");

// --- Print reclassified puzzles ---
const reclassifiedRows = summaryRows.filter(
  (r) => r.oldDifficulty !== r.newDifficulty
);

console.log("RECLASSIFIED PUZZLES:");
console.log("=".repeat(80));

if (reclassifiedRows.length === 0) {
  console.log("  (none)");
} else {
  for (const row of reclassifiedRows) {
    const arrow = `  ${row.oldDifficulty.padEnd(9)} → ${row.newDifficulty.padEnd(9)}`;
    console.log(
      `  ${"ID".padEnd(4)}${row.id}  ${row.name.padEnd(22)}${arrow}  [depth:${row.logicalDepth}, chain:${row.chainLength}]`
    );
  }
}

console.log("");
console.log(`Total puzzles: ${summaryRows.length}`);
console.log(`Reclassified:  ${reclassifiedCount}`);
console.log(`Unchanged:     ${summaryRows.length - reclassifiedCount}`);
console.log("");
