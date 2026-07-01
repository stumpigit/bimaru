const fs = require('fs');
const html = fs.readFileSync('/root/workspace/bimaru/bimaru-harbor.html','utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace('newGame();', '');
const bootstrap = `const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},classList:{add(){},remove(){}},dataset:{}}); global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){}}; global.window=globalThis;`;
eval(bootstrap + js);

const sample = Number(process.argv[2]);
const base = ARCHIPELAGO_LIBRARY.find(p => (p.meta?.sampleIndex) === sample);
if(!base){ console.error('sample not found'); process.exit(1); }
const removed = new Set((process.argv[3]||'').split(',').filter(Boolean));
const budget = 180000;
const working = clonePuzzle(base);
for(const key of removed) delete working.cl[key];
const baseCheck = countSolutionsForPuzzle(working,2,budget);
const target = process.argv[4] || null;
const out = [];
for(const key of Object.keys(working.cl).sort((a,b)=>Number(a)-Number(b))){
  if(target && key !== target) continue;
  if(isIslandClueType(working.cl[key])) continue;
  const p = clonePuzzle(working);
  delete p.cl[key];
  const r = countSolutionsForPuzzle(p,2,budget);
  out.push({remove:key, type:working.cl[key], unique:(r.exact && r.solutions===1), solutions:r.solutions, exact:r.exact, calls:r.calls, clueCount:Object.keys(p.cl).length});
}
console.log(JSON.stringify({sample, removed:[...removed], target, currentClues:Object.keys(working.cl).length, currentUnique:baseCheck, tests:out}, null, 2));
