#!/usr/bin/env node
/**
 * embed_library.js
 *
 * Reads the canonical bimaru-harbor-library.json, replaces the inline
 * ARCHIPELAGO_LIBRARY definition inside bimaru-harbor.html, and updates
 * the filter-button counts to reflect the new distribution.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LIB_PATH = path.join(__dirname, 'bimaru-harbor-library.json');
const HTML_PATH = path.join(__dirname, 'bimaru-harbor.html');

// ── Read source files ──────────────────────────────────────────────

if (!fs.existsSync(LIB_PATH)) {
  console.error('ERROR: Library file not found:', LIB_PATH);
  process.exit(1);
}
if (!fs.existsSync(HTML_PATH)) {
  console.error('ERROR: HTML file not found:', HTML_PATH);
  process.exit(1);
}

const libraryRaw = fs.readFileSync(LIB_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');

const library = JSON.parse(libraryRaw);

// ── Compute new distribution ───────────────────────────────────────

const distribution = {};
for (const puzzle of library) {
  const diff = puzzle.difficulty || 'unknown';
  distribution[diff] = (distribution[diff] || 0) + 1;
}

const total = library.length;
const totalLabel = total;

// ── Serialize library as compact inline JS ─────────────────────────

const libraryJson = JSON.stringify(library);

// ── Replace ARCHIPELAGO_LIBRARY inline definition ──────────────────

const libraryRegex = /(var ARCHIPELAGO_LIBRARY=\[)(\s|\S)*?(\];)/;

const replacement = `var ARCHIPELAGO_LIBRARY=${libraryJson};`;

let newHtml = html.replace(libraryRegex, replacement);

if (newHtml === html) {
  console.error('ERROR: Could not find ARCHIPELAGO_LIBRARY in HTML');
  process.exit(1);
}

// ── Update filter button counts ────────────────────────────────────

const buttonLabels = {
  easy:   '⭐ Easy (' + (distribution.easy ?? 0) + ')',
  medium: '⭐⭐ Medium (' + (distribution.medium ?? 0) + ')',
  hard:   '⭐⭐⭐ Hard (' + (distribution.hard ?? 0) + ')',
  expert: '⭐⭐⭐⭐ Expert (' + (distribution.expert ?? 0) + ')',
};

function replaceButton(labelKey, count) {
  const escaped = labelKey
    .replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    .replace(/\*/g, '\\*');
  const btnRegex = new RegExp(
    `(data-diff="${escaped}"[^>]*>([^<]*?)\\([0-9]+\\))`
  );
  const needle = `data-diff="${labelKey}"`;
  if (!btnRegex.test(html)) {
    console.warn('WARNING: Could not find button for', labelKey);
    return;
  }
  newHtml = newHtml.replace(
    new RegExp(`(data-diff="${escaped}"[^>]*>)[^<]+(\\))`),
    `$1${labelKey === 'all' ? 'Alle (' + totalLabel : buttonLabels[labelKey]}$2`
  );
}

// We need a simpler approach — just match and replace the count numbers
// in the filter button section
const filterSectionRegex = /(<div class="diff-filter"[^>]*>[\s\S]*?<\/div>)/;
const filterMatch = newHtml.match(filterSectionRegex);

if (!filterMatch) {
  console.error('ERROR: Could not find diff-filter section');
  process.exit(1);
}

let filterHtml = filterMatch[0];

// Replace each button's count
for (const diff of ['easy', 'medium', 'hard', 'expert']) {
  const count = distribution[diff] ?? 0;
  // Match: data-diff="easy">... (N) where N is any number
  filterHtml = filterHtml.replace(
    new RegExp(`(data-diff="${diff}"[^>]*>[^\\(]*)\\([0-9]+\\)`, 'g'),
    `$1(${count})`
  );
}

// Replace the "All" count
filterHtml = filterHtml.replace(
  /(<button[^>]*data-diff="all"[^>]*>[^\\(]*)\\([0-9]+\\)/,
  '$1(' + totalLabel + ')'
);

// Also fix the "Alle" button
filterHtml = filterHtml.replace(
  /(<button[^>]*data-diff="all"[^>]*>Alle )\\([^)]+\\)/,
  '$1' + totalLabel + ')'
);

newHtml = newHtml.replace(filterSectionRegex, filterHtml);

// ── Write updated HTML ─────────────────────────────────────────────

fs.writeFileSync(HTML_PATH, newHtml, 'utf8');

// ── Print summary ──────────────────────────────────────────────────

console.log('=== embed_library.js — Summary ===\n');
console.log('Library puzzles:', total);
console.log('\nDifficulty distribution:');
for (const diff of ['easy', 'medium', 'hard', 'expert']) {
  console.log(`  ${diff.charAt(0).toUpperCase() + diff.slice(1)}: ${distribution[diff] ?? 0}`);
}

// Verify logicalDepth and chainLength
let depthCount = 0;
let chainCount = 0;
let depthOnly = 0;
let chainOnly = 0;
let bothPresent = 0;

for (const p of library) {
  const hasDepth = p.meta && p.meta.logicalDepth !== undefined;
  const hasChain = p.meta && p.meta.chainLength !== undefined;
  if (hasDepth) depthCount++;
  if (hasChain) chainCount++;
  if (hasDepth && hasChain) bothPresent++;
  else if (hasDepth) depthOnly++;
  else if (hasChain) chainOnly++;
}

console.log('\nMeta field presence:');
console.log(`  logicalDepth: ${depthCount}/${total} puzzles`);
console.log(`  chainLength:  ${chainCount}/${total} puzzles`);
console.log(`  Both present: ${bothPresent}/${total} puzzles`);

if (bothPresent === total) {
  console.log('\n✓ All puzzles have logicalDepth AND chainLength.');
} else {
  console.log(`\n⚠ ${total - bothPresent} puzzle(s) missing one or both fields.`);
}

console.log('\nHTML updated:', HTML_PATH);
console.log('Done.\n');
