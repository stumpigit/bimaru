const fs = require('fs');
const path = '/root/workspace/bimaru/bimaru-harbor.html';
const html = fs.readFileSync(path, 'utf8');
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

function signature(p){
  return JSON.stringify({rc:p.rc, cc:p.cc, cl:Object.entries(p.cl).sort((a,b)=>Number(a[0])-Number(b[0]))});
}

function acceptance(s){
  const strongIslands = s.islandVals.filter(v=>v >= 3).length;
  return (
    s.essential &&
    s.noIslandExact &&
    s.noIslandSolutions >= 2 &&
    s.clues <= 5 &&
    s.shipClues <= 3 &&
    s.singles === 0 &&
    strongIslands >= 1 &&
    (s.islandClues >= 2 || s.islandVals.includes(4)) &&
    (s.bridge ?? 0) >= 4
  );
}

function rankValue(s){
  return [
    s.clues,
    s.shipClues,
    -s.noIslandSolutions,
    -(s.bridge ?? 0),
    -(s.solverCalls ?? 0)
  ];
}

function cmpRank(a,b){
  const ra = rankValue(a.summary);
  const rb = rankValue(b.summary);
  for(let i=0;i<ra.length;i++){
    if(ra[i] < rb[i]) return -1;
    if(ra[i] > rb[i]) return 1;
  }
  return 0;
}

const target = Number(process.argv[2] || 5);
const maxAttempts = Number(process.argv[3] || 12);
const outPath = '/root/workspace/bimaru/harbor_hard_library.json';
const logPath = '/root/workspace/bimaru/harbor_hard_library.log';
fs.writeFileSync(logPath, '');
const chosen = [];
const seen = new Set();

for(let attempt=1; attempt<=maxAttempts && chosen.length<target; attempt++){
  const t0 = Date.now();
  const puzzle = generateBestPuzzle();
  const ms = Date.now() - t0;
  if(!puzzle){
    fs.appendFileSync(logPath, JSON.stringify({attempt, ms, ok:false, reason:'null'})+'\n');
    continue;
  }
  const summary = summarizePuzzle(puzzle);
  const sig = signature(puzzle);
  const accepted = acceptance(summary) && !seen.has(sig);
  fs.appendFileSync(logPath, JSON.stringify({attempt, ms, accepted, summary})+'\n');
  if(!accepted) continue;
  seen.add(sig);
  chosen.push({puzzle, summary, ms});
  chosen.sort(cmpRank);
  while(chosen.length > target) chosen.pop();
}

chosen.sort(cmpRank);
const payload = chosen.map((x, i)=>({
  rank: i+1,
  ms: x.ms,
  summary: x.summary,
  puzzle: x.puzzle,
}));
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({target, maxAttempts, found: payload.length, outPath, logPath, summaries: payload.map(x=>x.summary)}, null, 2));
