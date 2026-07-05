const fs = require('fs');
const path = require('path');
const hw = path.join(__dirname, 'bimaru-harbor.html');
const html = fs.readFileSync(hw, 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace(/newGame\(\);\s*$/, '');
const bootstrap = `
const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},appendChild(){},classList:{add(){},remove(){}},dataset:{}});
global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){},createElement(){return dummyEl();}};
global.window=globalThis;
`;
eval(bootstrap + js);
function summarizePuzzle(p){
  const vals = Object.values(p.cl || {});
  const dep = p.meta?.islandDependency || islandDependencyReport(p);
  return {
    clues: vals.length,
    islandClues: vals.filter(v=>/^i/.test(v)).length,
    shipClues: vals.filter(v=>v==='s'||v==='e'||v==='m').length,
    singles: vals.filter(v=>v==='s').length,
    ends: vals.filter(v=>v==='e').length,
    mids: vals.filter(v=>v==='m').length,
    islandVals: vals.filter(v=>/^i/.test(v)).map(v=>Number(v.slice(1))).sort((a,b)=>a-b),
    noIslandSolutions: dep.solutions,
    noIslandExact: dep.exact,
    essential: dep.essential,
    score: p.meta?.score ?? null,
    solverCalls: p.meta?.solverCalls ?? null,
    bridge: p.meta?.harborBridgeCount ?? null,
    zeroLines: p.meta?.zeroLines ?? null,
  };
}
const started = Date.now();
const p = generateBestPuzzle();
const ms = Date.now() - started;
if(!p){ console.log(JSON.stringify({ok:false, ms, reason:'null'})); process.exit(0); }
console.log(JSON.stringify({ok:true, ms, summary:summarizePuzzle(p), puzzle:p}));
