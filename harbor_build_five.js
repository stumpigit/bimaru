const fs = require('fs');

const html = fs.readFileSync('/root/workspace/bimaru/bimaru-harbor.html', 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace('newGame();', '');
const bootstrap = `
const dummyEl = ()=>({textContent:'', className:'', innerHTML:'', addEventListener(){}, classList:{add(){}, remove(){}}, dataset:{}});
global.document = {getElementById(){return dummyEl();}, querySelector(){return dummyEl();}, querySelectorAll(){return [];}, addEventListener(){}};
global.window = globalThis;
`;
eval(bootstrap + js);

const SAMPLES = [
  {"flat":[0,0,0,0,1,1,0,0,0,0,1,0,0,0,0,0,1,0,0,1,0,1,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,1,0,1,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,0],"islands":[[4,3,3],[6,2,1]],"rows":[2,2,3,1,4,2,2,3,1],"cols":[0,5,0,3,3,3,4,2,0],"diag_pairs":2},
  {"flat":[0,1,1,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0,0,1,0,1,0,0,0,1,0,0,0,1,0,0,0,0,1,0,1,0,1,0,0,0,0,0,0,1,0,1,0,0,1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0],"islands":[[1,6,3],[3,1,3],[5,7,1]],"rows":[3,1,2,3,3,2,2,2,2],"cols":[2,5,2,0,3,0,5,1,2],"diag_pairs":4},
  {"flat":[0,0,0,0,0,0,1,0,0,1,0,0,1,0,1,0,1,1,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,1,0,0],"islands":[[1,6,4],[4,6,1]],"rows":[1,5,3,3,1,0,4,0,3],"cols":[3,1,1,4,1,3,4,1,2],"diag_pairs":4},
  {"flat":[0,0,0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,0,0,0,1,0,1,0,1,0,0,1,0,0,0,1,0,1,0,0,1,0,1,0,1,0,1,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0],"islands":[[4,5,3],[7,6,1]],"rows":[1,2,3,3,4,2,0,3,2],"cols":[2,1,4,1,4,2,4,1,1],"diag_pairs":2},
  {"flat":[0,0,0,0,0,1,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1,1,0,1,1,1,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,1,0,0,0,0,0,1,1,0,0,0,0,1],"islands":[[4,3,1],[6,1,1],[6,5,3]],"rows":[2,1,3,4,1,2,3,1,3],"cols":[0,2,2,3,0,6,2,2,3],"diag_pairs":2},
  {"flat":[0,0,1,0,0,0,0,0,0,1,0,0,1,1,1,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,1,1,0,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,1,0,0,0],"islands":[[1,2,3],[3,3,1]],"rows":[1,4,2,3,4,0,3,0,3],"cols":[3,3,3,2,2,3,2,2,0],"diag_pairs":2}
];

function shuffled(arr){ const a=arr.slice(); shuffle(a); return a; }
function toIslandList(sample){ return sample.islands.map(([r,c,v])=>({r,c,v})); }
function buildPuzzleFromSample(sample){
  const cl={};
  for(const [r,c,v] of sample.islands) cl[idx(r,c)]='i'+v;
  return {grid:sample.flat.slice(), rc:sample.rows.slice(), cc:sample.cols.slice(), cl, meta:{}};
}
function shipTypeForBoard(flat, i){ return clueTypeForCell(flat, Math.floor(i/N), i%N); }
function isIslandArray(islands,r,c){ return islands.some(p=>p.r===r&&p.c===c); }
function candidateShipCluesForSample(sample){
  const out=[];
  for(let i=0;i<N*N;i++){
    if(sample.flat[i]!==SH) continue;
    const t=shipTypeForBoard(sample.flat,i);
    out.push({i,t,prio:(t==='m'?0:t==='e'?1:2)});
  }
  return out;
}
function candidateWaterCluesForSample(sample){
  const islands=toIslandList(sample);
  const out=[];
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    const i=idx(r,c);
    if(sample.flat[i]===SH || isIslandArray(islands,r,c)) continue;
    let near=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(dr===0&&dc===0) continue;
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=N||nc<0||nc>=N) continue;
      if(sample.flat[idx(nr,nc)]===SH) near++;
    }
    if(near>=2) out.push({i,t:'w',prio:-near});
  }
  out.sort((a,b)=>a.prio-b.prio || Math.random()-0.5);
  return out;
}
function exactUnique(puz,budget=160000){
  const r=countSolutionsForPuzzle(puz,2,budget);
  return (r.exact && r.solutions===1) ? r : null;
}
function noIslandNonUnique(puz,budget=200000){
  const r=countSolutionsForPuzzle(stripIslandClues(puz),2,budget);
  return (r.exact && r.solutions>=2) ? r : null;
}
function zeroPenalty(rows, cols){
  let z=0;
  for(let i=0;i<N;i++){
    if(rows[i]===0 || rows[i]===N) z++;
    if(cols[i]===0 || cols[i]===N) z++;
  }
  return z;
}
function scoreBuiltPuzzle(sample, puz, final, dep){
  const clueCount=Object.keys(puz.cl).length;
  const waterCount=Object.values(puz.cl).filter(v=>v==='w').length;
  const islandSum=sample.islands.reduce((s,x)=>s+x[2],0);
  return final.calls + (12-clueCount)*15000 + islandSum*3500 + sample.diag_pairs*5000 - waterCount*5000 - zeroPenalty(sample.rows,sample.cols)*5000 + dep.calls*0.15;
}

function buildOne(sample, sampleIndex){
  let best=null;
  for(let attempt=0; attempt<8; attempt++){
    const puz=buildPuzzleFromSample(sample);
    let ships=shuffled(candidateShipCluesForSample(sample));
    ships.sort((a,b)=>a.prio-b.prio || Math.random()-0.5);
    let waters=shuffled(candidateWaterCluesForSample(sample)).slice(0,2);

    const seed=[];
    const mids=ships.filter(x=>x.t==='m');
    const ends=ships.filter(x=>x.t==='e');
    const singles=ships.filter(x=>x.t==='s');
    if(mids[0]) seed.push(mids[0]);
    if(ends[0]) seed.push(ends[0]);
    if(ends[1]) seed.push(ends[1]);
    if(singles[0] && Math.random()<0.8) seed.push(singles[0]);
    while(seed.length<5 && ships.length){
      const c=ships.shift();
      if(!seed.includes(c)) seed.push(c);
    }
    if(waters[0] && Math.random()<0.25) seed.push(waters[0]);

    for(const clue of seed) puz.cl[clue.i]=clue.t;
    let unique=exactUnique(puz, 110000);

    if(!unique){
      const rest=[...ships.filter(x=>!seed.includes(x)), ...waters.slice(1)];
      for(const clue of rest){
        puz.cl[clue.i]=clue.t;
        unique=exactUnique(puz, 140000);
        if(unique) break;
        if(Object.keys(puz.cl).length>=11) break;
      }
    }
    if(!unique) continue;

    let keys=Object.keys(puz.cl).filter(k=>!isIslandClueType(puz.cl[k]));
    shuffle(keys);
    for(const key of keys.slice(0,5)){
      const save=puz.cl[key];
      delete puz.cl[key];
      if(!exactUnique(puz, 140000)) puz.cl[key]=save;
    }

    const dep=noIslandNonUnique(puz, 200000);
    if(!dep) continue;
    const final=exactUnique(puz, 180000);
    if(!final) continue;

    puz.meta={
      uniqueChecked:true,
      uniquenessExact:true,
      solverCalls:final.calls,
      clueCount:Object.keys(puz.cl).length,
      zeroLines:zeroLinesScore({r:puz.rc,c:puz.cc}),
      noIslandSolutions:dep.solutions,
      noIslandCalls:dep.calls,
      harborIslands:toIslandList(sample),
      harborTouches:{diagonalPairs:sample.diag_pairs},
      sampleIndex
    };
    puz.meta.score=scoreBuiltPuzzle(sample,puz,final,dep);
    if(!best || puz.meta.score>best.meta.score) best=clonePuzzle(puz);
  }
  return best;
}

const requested = process.argv[2] ? Number(process.argv[2]) : null;
const source = requested ? [SAMPLES[requested-1]].filter(Boolean) : SAMPLES;
const built=[];
for(let i=0;i<source.length;i++){
  const sample = source[i];
  const sampleIndex = requested || (i+1);
  const p=buildOne(sample, sampleIndex);
  if(p){
    built.push(p);
    console.log(JSON.stringify({sample:sampleIndex, clueCount:p.meta.clueCount, solverCalls:p.meta.solverCalls, noIslandCalls:p.meta.noIslandCalls, score:p.meta.score, islands:p.meta.harborIslands}, null, 2));
  } else {
    console.log(JSON.stringify({sample:sampleIndex, failed:true}, null, 2));
  }
}
built.sort((a,b)=>b.meta.score-a.meta.score);
const top=built.slice(0,5);
console.log('FINAL_LIBRARY_START');
console.log(JSON.stringify(top));
console.log('FINAL_LIBRARY_END');
console.log(JSON.stringify({built:built.length, selected:top.length, requested}, null, 2));
