#!/usr/bin/env node
/**
 * merge_and_update.js
 *
 * Merges ARCHIPELAGO_LIBRARY (curated puzzles from bimaru-harbor.html)
 * with generated puzzles (hard_puzzles_generated.json), classifies all
 * 35 puzzles by difficulty, writes the merged JSON, and writes the full
 * updated bimaru-harbor.html.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = '/home/cs/bimaru';
const HTML_FILE = path.join(BASE, 'bimaru-harbor.html');
const GEN_JSON = path.join(BASE, 'hard_puzzles_generated.json');
const LIB_JSON = path.join(BASE, 'bimaru-harbor-library.json');

// ─── Step 1: Read existing data ───────────────────────────────────────────

const html = fs.readFileSync(HTML_FILE, 'utf8');

// Extract ARCHIPELAGO_LIBRARY from line ~149
const htmlLines = html.split('\n');
let archLibLine = '';
for (const line of htmlLines) {
  if (line.includes('ARCHIPELAGO_LIBRARY=')) {
    archLibLine = line;
    break;
  }
}
if (!archLibLine) {
  console.error('ERROR: Could not find ARCHIPELAGO_LIBRARY in HTML');
  process.exit(1);
}

let jsonStr = archLibLine.substring(archLibLine.indexOf('ARCHIPELAGO_LIBRARY='))
  .replace(/^ARCHIPELAGO_LIBRARY=\s*/, '');
if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1);

const curatedPuzzles = JSON.parse(jsonStr);
console.log(`\n=== Step 1: Read existing data ===`);
console.log(`Curated puzzles extracted: ${curatedPuzzles.length}`);
console.log(`Generated puzzles to merge:  30`);

const genPuzzles = JSON.parse(fs.readFileSync(GEN_JSON, 'utf8'));
console.log(`Total before merge: ${curatedPuzzles.length + genPuzzles.length}`);

// ─── Step 2: Classify each puzzle ─────────────────────────────────────────

/**
 * Determine difficulty for a single puzzle object.
 * Returns one of: "easy", "medium", "hard", "expert".
 */
function classifyPuzzle(p) {
  const meta = p.meta || {};
  const clueCount = meta.clueCount || Object.keys(p.cl || {}).length;
  const solverCalls = meta.solverCalls || 0;
  const harborBridgeCount = (meta.harborBridgeCount != null) ? meta.harborBridgeCount : 0;
  const score = (meta.score != null) ? meta.score : 0;

  // Detect puzzle source
  const hasName = typeof p.name === 'string';
  const hasHarborBridgeCount = (meta.harborBridgeCount != null);
  const isGenerated = hasName || hasHarborBridgeCount;
  const isCurated = !isGenerated;

  // Check for island clues (used for curated fallback)
  const hasIslandClues = p.cl && Object.values(p.cl).some(v => typeof v === 'string' && v.startsWith('i'));

  // Expert: clueCount ≤ 6 AND harborBridgeCount ≥ 4 AND (solverCalls ≥ 50K OR score ≤ 150)
  if (clueCount <= 6 && harborBridgeCount >= 4 && (solverCalls >= 50000 || score <= 150)) {
    return 'expert';
  }

  // Hard: clueCount ≤ 6 AND solverCalls ≥ 50K AND harborBridgeCount ≥ 3
  if (clueCount <= 6 && solverCalls >= 50000 && harborBridgeCount >= 3) {
    return 'hard';
  }

  // Curated fallback: high solverCalls + island clues = Hard
  if (isCurated && clueCount <= 6 && solverCalls >= 50000 && hasIslandClues) {
    return 'hard';
  }

  // Generated: score ≤ 208 AND harborBridgeCount ≥ 3 → Hard
  if (isGenerated && score <= 208 && harborBridgeCount >= 3) {
    return 'hard';
  }

  // Easy: clueCount ≥ 9, solverCalls < 100,000
  if (clueCount >= 9 && solverCalls < 100000) {
    return 'easy';
  }

  // Medium: generated with score > 208
  if (isGenerated && score > 208) {
    return 'medium';
  }

  // Medium: clueCount 5-8, solverCalls < 50K, bridges 3-5
  if (clueCount >= 5 && clueCount <= 8 && solverCalls < 50000 && harborBridgeCount >= 3 && harborBridgeCount <= 5) {
    return 'medium';
  }

  // Default fallback
  if (clueCount >= 7) { return 'easy'; }
  return 'medium';
}

// Classify both sets
for (const p of curatedPuzzles) { p.difficulty = classifyPuzzle(p); }
for (const p of genPuzzles)     { p.difficulty = classifyPuzzle(p); }

// ─── Step 3: Merge puzzles ────────────────────────────────────────────────

const merged = [...curatedPuzzles, ...genPuzzles];
for (let i = 0; i < merged.length; i++) { merged[i].id = i + 1; }

// ─── Step 4: Count and verify ─────────────────────────────────────────────

const counts = { easy: 0, medium: 0, hard: 0, expert: 0 };
for (const p of merged) { counts[p.difficulty]++; }

console.log(`\n=== Step 2 & 3: Classification & Merge ===`);
console.log(`\nDifficulty breakdown:`);
console.log(`  ⭐ Easy:    ${counts.easy}`);
console.log(`  ⭐⭐ Medium: ${counts.medium}`);
console.log(`  ⭐⭐⭐ Hard:  ${counts.hard}`);
console.log(`  ⭐⭐⭐⭐ Expert: ${counts.expert}`);
console.log(`  ─────────────────`);
console.log(`  Total:     ${merged.length}`);

if (merged.length !== 35) {
  console.error(`ERROR: Expected 35 total puzzles, got ${merged.length}`);
  process.exit(1);
}

console.log(`\nPer-puzzle classification:`);
for (const p of merged) {
  const meta = p.meta || {};
  const name = p.name || (meta.curated ? '(curated)' : `#${meta.sampleIndex != null ? meta.sampleIndex + 1 : '?'}`);
  console.log(
    `  [${String(p.difficulty).padEnd(8)}] ID=${p.id}  ${name.padEnd(22)} ` +
    `clues=${String(meta.clueCount || '?').padEnd(2)} ` +
    `calls=${String(meta.solverCalls || '?').padEnd(8)} ` +
    `bridges=${meta.harborBridgeCount || '?'} ` +
    `score=${meta.score || '?'}`
  );
}

// ─── Step 5: Write merged library JSON ────────────────────────────────────

const cleanMerged = merged.map(p => {
  const cleaned = { ...p };
  if ('difficultyOrder' in cleaned) { delete cleaned.difficultyOrder; }
  return cleaned;
});

const libJson = JSON.stringify(cleanMerged, null, 2);
fs.writeFileSync(LIB_JSON, libJson + '\n', 'utf8');
console.log(`\n=== Step 5: Output files ===`);
console.log(`✓ Merged library written: ${LIB_JSON} (${libJson.length.toLocaleString()} bytes)`);

// ─── Step 6: Write updated bimaru-harbor.html ─────────────────────────────

// Build the library JS variable
const libraryVar = `var ARCHIPELAGO_LIBRARY=${JSON.stringify(cleanMerged)};`;

// All modifications are done on the raw HTML string using .replaceAll()
// to avoid ordering issues.
let newHtml = html;

// 6a. Replace the ARCHIPELAGO_LIBRARY definition
const libraryMatch = newHtml.match(/var ARCHIPELAGO_LIBRARY=\[.*?\];/);
if (!libraryMatch) {
  console.error('ERROR: Could not find ARCHIPELAGO_LIBRARY in HTML content');
  process.exit(1);
}
newHtml = newHtml.replace(libraryMatch[0], libraryVar);

// 6b. Replace the newGame() function (brace-counting on raw string)
// Find "function newGame()" and its closing brace
const ngIdx = newHtml.indexOf('function newGame()');
if (ngIdx === -1) {
  console.error('ERROR: Could not find newGame() function');
  process.exit(1);
}

// Count braces starting from the opening brace after "function newGame()"
let braceDepth = 0;
let ngEndIdx = -1;
const afterFn = newHtml.substring(ngIdx);
for (let i = 0; i < afterFn.length; i++) {
  if (afterFn[i] === '{') braceDepth++;
  else if (afterFn[i] === '}') {
    braceDepth--;
    if (braceDepth === 0) {
      ngEndIdx = ngIdx + i + 1;
      break;
    }
  }
}

if (ngEndIdx === -1) {
  console.error('ERROR: Could not find end of newGame() function');
  process.exit(1);
}

const newNewGame = `function newGame(){
  hidePuzzleNotif();
  showPuzzleSelector();
}`;

newHtml = newHtml.substring(0, ngIdx) + newNewGame + newHtml.substring(ngEndIdx);

// 6c. Add puzzle selector overlay CSS
const overlayCSS = `
.puzzle-overlay {
  position: fixed; inset: 0; background: rgba(10,22,40,.95); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity .2s;
}
.puzzle-overlay.active { opacity: 1; pointer-events: all; }
.puzzle-panel {
  background: var(--panel); border: 1px solid rgba(79,195,247,.2); border-radius: 12px;
  width: 95vw; max-width: 900px; max-height: 80vh; overflow-y: auto;
  padding: 20px; text-align: left;
}
.puzzle-panel h2 { color: var(--accent); margin: 0 0 12px; text-align: center; }
.diff-filter { display: flex; gap: 8px; justify-content: center; margin-bottom: 16px; flex-wrap: wrap; }
.diff-filter button {
  padding: 6px 14px; border: 1px solid rgba(79,195,247,.3); border-radius: 20px;
  background: rgba(79,195,247,.06); color: var(--muted); cursor: pointer; font-size: .8rem;
}
.diff-filter button.active { background: var(--accent); color: #0a1628; border-color: var(--accent); }
.diff-filter button.active[data-diff="easy"] { background: #66bb6a; border-color: #66bb6a; }
.diff-filter button.active[data-diff="medium"] { background: #ffd54f; border-color: #ffd54f; color: #0a1628; }
.diff-filter button.active[data-diff="hard"] { background: #ff7043; border-color: #ff7043; }
.diff-filter button.active[data-diff="expert"] { background: #ab47bc; border-color: #ab47bc; }
.puzzle-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; margin-bottom: 16px; }
.puzzle-card {
  background: var(--panel2); border: 1px solid rgba(255,255,255,.06); border-radius: 8px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
  transition: border-color .15s;
}
.puzzle-card:hover { border-color: rgba(79,195,247,.3); }
.puzzle-card-header { display: flex; justify-content: space-between; align-items: center; }
.puzzle-diff { font-size: .78rem; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
.puzzle-diff.easy { background: #66bb6a22; color: #66bb6a; }
.puzzle-diff.medium { background: #ffd54f22; color: #ffd54f; }
.puzzle-diff.hard { background: #ff704322; color: #ff7043; }
.puzzle-diff.expert { background: #ab47bc22; color: #ab47bc; }
.puzzle-stats { font-size: .72rem; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; }
.puzzle-load { margin-top: 6px; padding: 4px 12px; border: 1px solid var(--accent); border-radius: 6px;
  background: rgba(79,195,247,.08); color: var(--accent); cursor: pointer; font-size: .76rem; align-self: flex-start; }
.puzzle-load:hover { background: var(--accent); color: #0a1628; }
.close-btn { float: right; background: none; border: none; color: var(--muted); font-size: 1.2rem; cursor: pointer; }
.random-btn { display: block; margin: 0 auto 12px; padding: 8px 20px; border: 1px solid var(--accent); border-radius: 20px;
  background: rgba(79,195,247,.1); color: var(--accent); cursor: pointer; font-size: .85rem; }
.count-badge { font-size: .76rem; color: var(--muted); text-align: center; margin-bottom: 8px; }
`;

newHtml = newHtml.replace('</style>', overlayCSS + '</style>');

// 6d. Add puzzle selector overlay HTML
const overlayHtml = `
<div class="puzzle-overlay" id="puzzle-overlay">
  <div class="puzzle-panel">
    <button class="close-btn" onclick="hidePuzzleSelector()">&times;</button>
    <h2>🏝️ Harbor-Rätsel auswählen</h2>
    <button class="random-btn" onclick="randomPuzzle()">🎲 Zufällig</button>
    <div class="count-badge" id="count-badge"></div>
    <div class="diff-filter" id="diff-filter">
      <button class="active" data-diff="all" onclick="filterPuzzles('all')">Alle (${merged.length})</button>
      <button data-diff="easy" onclick="filterPuzzles('easy')">⭐ Easy (${counts.easy})</button>
      <button data-diff="medium" onclick="filterPuzzles('medium')">⭐⭐ Medium (${counts.medium})</button>
      <button data-diff="hard" onclick="filterPuzzles('hard')">⭐⭐⭐ Hard (${counts.hard})</button>
      <button data-diff="expert" onclick="filterPuzzles('expert')">⭐⭐⭐⭐ Expert (${counts.expert})</button>
    </div>
    <div class="puzzle-list" id="puzzle-list"></div>
  </div>
</div>
`;

newHtml = newHtml.replace('</body>', overlayHtml + '</body>');

// 6e. Add puzzle selector JS functions
const selectorJS = `
var currentFilter='all';

function showPuzzleSelector(){
  var overlay=document.getElementById('puzzle-overlay');
  if(overlay){overlay.classList.add('active');}
  renderPuzzleCards('all');
}
function hidePuzzleSelector(){
  var overlay=document.getElementById('puzzle-overlay');
  if(overlay){overlay.classList.remove('active');}
}
function filterPuzzles(diff){
  currentFilter=diff;
  document.querySelectorAll('.diff-filter button').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-diff')===diff);
  });
  renderPuzzleCards(diff);
}
function getFilteredPuzzles(){
  if(currentFilter==='all') return ARCHIPELAGO_LIBRARY.slice();
  return ARCHIPELAGO_LIBRARY.filter(function(p){ return p.difficulty===currentFilter; });
}
function renderPuzzleCards(diff){
  var filtered=getFilteredPuzzles();
  var list=document.getElementById('puzzle-list');
  var badge=document.getElementById('count-badge');
  if(!list||!badge) return;
  badge.textContent=filtered.length+' Rätsel ausgewählt';
  var html='';
  var order={expert:0,hard:1,medium:2,easy:3};
  var sorted=filtered.slice().sort(function(a,b){
    var oa=order[a.difficulty]||4, ob=order[b.difficulty]||4;
    return oa-ob || a.id-b.id;
  });
  for(var i=0;i<sorted.length;i++){
    var p=sorted[i];
    var m=p.meta||{};
    var name=p.name||('Rätsel '+p.id);
    var clueCount=m.clueCount!=null?m.clueCount:Object.keys(p.cl||{}).length;
    var islandCount=0;
    if(p.cl){for(var k in p.cl){if(typeof p.cl[k]==='string'&&p.cl[k].startsWith('i'))islandCount++;}}
    var bridgeCount=m.harborBridgeCount||0;
    var score=m.score!=null?' Score: '+m.score:'';
    html+='<div class="puzzle-card"><div class="puzzle-card-header"><span class="puzzle-diff '+p.difficulty+'" data-diff="'+p.difficulty+'">'+difficultyLabel(p.difficulty)+'</span><span style="font-size:.72rem;color:var(--muted)">ID '+p.id+'</span></div><div style="font-size:.82rem;font-weight:600">'+name+'</div><div class="puzzle-stats"><span>Clues: '+clueCount+'</span><span>Inseln: '+islandCount+'</span><span>Brücken: '+bridgeCount+'</span>'+score+'</div><button class="puzzle-load" onclick="loadPuzzleById('+p.id+')">Laden</button></div>';
  }
  list.innerHTML=html;
}
function difficultyLabel(d){
  if(d==='easy') return '⭐ Easy';
  if(d==='medium') return '⭐⭐ Medium';
  if(d==='hard') return '⭐⭐⭐ Hard';
  if(d==='expert') return '⭐⭐⭐⭐ Expert';
  return d;
}
function loadPuzzleById(id){
  for(var i=0;i<ARCHIPELAGO_LIBRARY.length;i++){
    if(ARCHIPELAGO_LIBRARY[i].id===id){
      hidePuzzleSelector();
      loadPuzzleFromData(ARCHIPELAGO_LIBRARY[i]);
      setStatus('Rätsel '+id+' geladen · '+difficultyLabel(ARCHIPELAGO_LIBRARY[i].difficulty),'info');
      return;
    }
  }
  setStatus('Rätsel '+id+' nicht gefunden!','err');
}
function randomPuzzle(){
  var filtered=getFilteredPuzzles();
  if(filtered.length===0){
    setStatus('Kein Rätsel in dieser Kategorie verfügbar','err');
    return;
  }
  var pick=filtered[Math.floor(Math.random()*filtered.length)];
  hidePuzzleSelector();
  loadPuzzleFromData(pick);
  setStatus('Zufälliges '+difficultyLabel(pick.difficulty)+' Rätsel geladen','info');
}
`;

// Insert selector JS before </script>
const jsToAdd = selectorJS + '\n' + 'newGame();';
newHtml = newHtml.replace('</script>', jsToAdd + '\n' + '</script>');

// Write the updated HTML
const outputHtml = path.join(BASE, 'bimaru-harbor.html');
fs.writeFileSync(outputHtml, newHtml, 'utf8');
console.log(`✓ Updated bimaru-harbor.html written: ${outputHtml}`);
console.log(`\n=== Done! ===`);
console.log(`  Parsed:       ${curatedPuzzles.length} curated + ${genPuzzles.length} generated = ${merged.length} total`);
console.log(`  Easy:     ${counts.easy}  |  Medium: ${counts.medium}  |  Hard: ${counts.hard}  |  Expert: ${counts.expert}`);
console.log(`  Output:   ${LIB_JSON}`);
console.log(`  HTML:     ${outputHtml}`);
