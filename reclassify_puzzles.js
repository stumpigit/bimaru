#!/usr/bin/env node

// reclassify_puzzles.js
// Reclassify puzzles using the NEW logical-depth analysis,
// update the JSON library and the inline ARCHIPELAGO_LIBRARY in the HTML.

const fs = require("fs");
const path = require("path");

const BASE = "/home/cs/bimaru";

// ── Read input files ─────────────────────────────────────────────────

const analysis = JSON.parse(
  fs.readFileSync(path.join(BASE, "better_logical_depth.json"), "utf-8")
);
const library = JSON.parse(
  fs.readFileSync(path.join(BASE, "bimaru-harbor-library.json"), "utf-8")
);
const html = fs.readFileSync(path.join(BASE, "bimaru-harbor.html"), "utf-8");

// Index analysis by ID for O(1) lookup
const analysisMap = new Map();
for (const a of analysis) {
  analysisMap.set(a.id, a);
}

// ── Classification function ──────────────────────────────────────────

function classify(p) {
  const { pctDepthGe2, logicalDepth, pctDepthGe3 } = p;

  // Expert: pctDepthGe2 >= 25 OR logicalDepth >= 7
  if (pctDepthGe2 >= 25 || logicalDepth >= 7) return "expert";

  // Hard: (15 <= pctDepthGe2 < 25) OR (4 <= logicalDepth < 7) OR pctDepthGe3 >= 6
  if (
    (pctDepthGe2 >= 15 && pctDepthGe2 < 25) ||
    (logicalDepth >= 4 && logicalDepth < 7) ||
    pctDepthGe3 >= 6
  )
    return "hard";

  // Medium: (5 <= pctDepthGe2 < 15) OR (2 <= logicalDepth < 4)
  if (
    (pctDepthGe2 >= 5 && pctDepthGe2 < 15) ||
    (logicalDepth >= 2 && logicalDepth < 4)
  )
    return "medium";

  // Easy: pctDepthGe2 < 5 AND logicalDepth < 2
  return "easy";
}

// ── Update the library JSON ──────────────────────────────────────────

const distribution = { easy: 0, medium: 0, hard: 0, expert: 0 };
const results = [];

for (const libPuzzle of library) {
  const id = libPuzzle.id;
  const analy = analysisMap.get(id);

  if (!analy) {
    console.error(`WARNING: No analysis data for puzzle id=${id}`);
    continue;
  }

  const oldDifficulty = libPuzzle.difficulty;
  const newDifficulty = classify(analy);

  distribution[newDifficulty]++;

  // Update difficulty
  libPuzzle.difficulty = newDifficulty;

  // Add / update meta fields
  libPuzzle.meta.logicalDepth = analy.logicalDepth;
  libPuzzle.meta.chainLength = Math.round(analy.avgChainLength * 100) / 100;
  libPuzzle.meta.pctDepthGe2 = analy.pctDepthGe2;
  libPuzzle.meta.pctDepthGe3 = analy.pctDepthGe3;

  results.push({
    id,
    name: libPuzzle.name,
    oldDifficulty,
    newDifficulty,
    pctDepthGe2: analy.pctDepthGe2,
    pctDepthGe3: analy.pctDepthGe3,
    logicalDepth: analy.logicalDepth,
  });
}

// ── Write updated library JSON ───────────────────────────────────────

fs.writeFileSync(
  path.join(BASE, "bimaru-harbor-library.json"),
  JSON.stringify(library, null, 2),
  "utf-8"
);

// ── Update ARCHIPELAGO_LIBRARY in the HTML ───────────────────────────

const libraryJson = JSON.stringify(library);
const libraryRegex = /(var ARCHIPELAGO_LIBRARY=\[)(\s|\S)*?(\];)/;
const replacement = `var ARCHIPELAGO_LIBRARY=${libraryJson};`;

let newHtml = html.replace(libraryRegex, replacement);

if (!newHtml.includes("var ARCHIPELAGO_LIBRARY=")) {
  console.error("ERROR: Could not find ARCHIPELAGO_LIBRARY in HTML");
  process.exit(1);
}

// ── Update filter button counts ──────────────────────────────────────

const filterButtonRegex =
  /(<button[^>]+data-diff="(\w+)"[^>]*>)([^<]*)(\))(<\/button>)/g;

const labels = {
  all: "Alle",
  easy: "⭐ Easy",
  medium: "⭐⭐ Medium",
  hard: "⭐⭐⭐ Hard",
  expert: "⭐⭐⭐⭐ Expert",
};

const totalCount = results.length;

newHtml = newHtml.replace(filterButtonRegex, (match, open, diff, _label, close, end) => {
  const count = diff === "all" ? totalCount : distribution[diff];
  const label = labels[diff] ?? diff;
  return `${open}${label} (${count})${close}${end}`;
});

// ── Write updated HTML ───────────────────────────────────────────────

fs.writeFileSync(path.join(BASE, "bimaru-harbor.html"), newHtml, "utf-8");

// ── Print detailed summary ──────────────────────────────────────────

console.log("=".repeat(80));
console.log("RECLASSIFICATION SUMMARY");
console.log("=".repeat(80));
console.log();

console.log("-".repeat(80));
console.log("ALL PUZZLES");
console.log("-".repeat(80));
console.log(
  `  ${"ID".padEnd(4)}  ${"Name".padEnd(24)}  ${"Old".padEnd(8)}  ${"New".padEnd(8)}  ${"pctDepthGe2".padEnd(10)}  ${"pctDepthGe3".padEnd(10)}  ${"logicalDepth"}`
);
console.log(
  "  " +
    "-".repeat(4) +
    "  " +
    "-".repeat(24) +
    "  " +
    "-".repeat(8) +
    "  " +
    "-".repeat(8) +
    "  " +
    "-".repeat(10) +
    "  " +
    "-".repeat(10) +
    "  " +
    "-".repeat(12)
);

for (const r of results) {
  const marker = r.oldDifficulty !== r.newDifficulty ? " ◀" : "";
  console.log(
    `  ${String(r.id).padEnd(4)}  ${(r.name || "").padEnd(24)}  ${(r.oldDifficulty || "").padEnd(8)}  ${(r.newDifficulty || "").padEnd(8)}  ${(String(r.pctDepthGe2)).padEnd(10)}  ${(String(r.pctDepthGe3)).padEnd(10)}  ${String(r.logicalDepth).padEnd(2)}${marker}`
  );
}

console.log();
console.log("-".repeat(80));
console.log("NEW DISTRIBUTION");
console.log("-".repeat(80));
console.log(`  ⭐ Easy:    ${distribution.easy}`);
console.log(`  ⭐⭐ Medium: ${distribution.medium}`);
console.log(`  ⭐⭐⭐ Hard:  ${distribution.hard}`);
console.log(`  ⭐⭐⭐⭐ Expert: ${distribution.expert}`);
console.log(`  TOTAL:     ${totalCount}`);

const reclassified = results.filter((r) => r.oldDifficulty !== r.newDifficulty);

console.log();
console.log("-".repeat(80));
console.log("RECLASSIFIED PUZZLES");
console.log("-".repeat(80));

if (reclassified.length === 0) {
  console.log("  (none)");
} else {
  for (const r of reclassified) {
    console.log(
      `  #${r.id} ${r.name}: ${r.oldDifficulty} → ${r.newDifficulty} (pctDepthGe2=${r.pctDepthGe2}, logicalDepth=${r.logicalDepth})`
    );
  }
}

console.log();
console.log(`Files updated:`);
console.log(`  ✓ ${path.join(BASE, "bimaru-harbor-library.json")}`);
console.log(`  ✓ ${path.join(BASE, "bimaru-harbor.html")}`);
console.log("=".repeat(80));
