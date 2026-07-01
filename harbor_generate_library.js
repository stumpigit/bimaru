const fs = require('fs');
const path = require('path');

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

function randInt(n){ return Math.floor(Math.random()*n); }
function shuffled(arr){ const a=arr.slice(); shuffle(a); return a; }
function keyOf(r,c){ return r+','+c; }
function parseKey(k){ const [r,c]=k.split(',').map(Number); return {r,c}; }
function islandSetFromList(list){ return new Set(list.map(p=>keyOf(p.r,p.c))); }
function isIslandInSet(set, r, c){
  if(set && typeof set.has==='function') return set.has(keyOf(r,c));
  if(Array.isArray(set)) return set.some(p=>p.r===r && p.c===c);
  return false;
}
function bridgedByIslandSet(islands, r1,c1,r2,c2){
  if(Math.abs(r1-r2)!==1 || Math.abs(c1-c2)!==1) return false;
  return isIslandInSet(islands, r1, c2) || isIslandInSet(islands, r2, c1);
}
function shipTypeForBoard(flat, i){ return clueTypeForCell(flat, Math.floor(i/N), i%N); }
function zeroLinePenalty(rc, cc){
  let z=0;
  for(let i=0;i<N;i++){
    if(rc[i]===0 || rc[i]===N) z++;
    if(cc[i]===0 || cc[i]===N) z++;
  }
  return z;
}
function islandClueMapFromList(flat, islands){
  const cl={};
  for(const p of islands){
    const v=islandAdjCount(flat,p.r,p.c);
    cl[idx(p.r,p.c)]='i'+v;
  }
  return cl;
}
function harborTouchStats(flat, islands){
  let diagonalPairs=0;
  let usedIslands=0;
  let highIslands=0;
  for(const p of islands){
    const sides=[
      {r:p.r-1,c:p.c},
      {r:p.r+1,c:p.c},
      {r:p.r,c:p.c-1},
      {r:p.r,c:p.c+1},
    ].filter(x=>x.r>=0&&x.r<N&&x.c>=0&&x.c<N&&flat[idx(x.r,x.c)]===SH);
    if(sides.length>=2) usedIslands++;
    if(sides.length>=3) highIslands++;
    for(let i=0;i<sides.length;i++){
      for(let j=i+1;j<sides.length;j++){
        const a=sides[i], b=sides[j];
        if(Math.abs(a.r-b.r)===1 && Math.abs(a.c-b.c)===1) diagonalPairs++;
      }
    }
  }
  return {diagonalPairs, usedIslands, highIslands};
}

function chooseIslandPattern(){
  const candidates=[];
  for(let r=1;r<N-1;r++) for(let c=1;c<N-1;c++) candidates.push({r,c});
  shuffle(candidates);
  const want = Math.random()<0.55 ? 2 : 3;
  const out=[];
  for(const p of candidates){
    if(out.every(q=>Math.abs(q.r-p.r)+Math.abs(q.c-p.c)>=3 && !(Math.abs(q.r-p.r)<=1 && Math.abs(q.c-p.c)<=1))){
      out.push(p);
      if(out.length===want) break;
    }
  }
  return out.length===want ? out : null;
}

function cellsForShip(r,c,len,dir){
  const out=[];
  for(let i=0;i<len;i++) out.push({r:r+(dir==='v'?i:0), c:c+(dir==='h'?i:0)});
  return out;
}

function canPlaceShip(flat, islands, cells){
  for(const cell of cells){
    const {r,c}=cell;
    if(r<0||r>=N||c<0||c>=N) return false;
    if(isIslandInSet(islands,r,c)) return false;
    if(flat[idx(r,c)]===SH) return false;
  }
  const compSet = new Set(cells.map(x=>keyOf(x.r,x.c)));
  for(const cell of cells){
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(dr===0&&dc===0) continue;
      const nr=cell.r+dr, nc=cell.c+dc;
      if(nr<0||nr>=N||nc<0||nc>=N) continue;
      if(compSet.has(keyOf(nr,nc))) continue;
      if(flat[idx(nr,nc)]!==SH) continue;
      if(Math.abs(dr)===1 && Math.abs(dc)===1 && bridgedByIslandSet(islands, cell.r, cell.c, nr, nc)) continue;
      return false;
    }
  }
  return true;
}

function placeShipsRandom(islands){
  const flat=new Array(N*N).fill(WA);
  const ships=[];
  const lengths=shuffled(SHIPS).sort((a,b)=>b-a);

  function backtrack(pos){
    if(pos===lengths.length) return true;
    const len=lengths[pos];
    const placements=[];
    for(const dir of shuffled(['h','v'])){
      for(let r=0;r<N;r++) for(let c=0;c<N;c++) {
        const cells=cellsForShip(r,c,len,dir);
        if(canPlaceShip(flat,islands,cells)) placements.push(cells);
      }
    }
    shuffle(placements);
    placements.sort((a,b)=>{
      const ac=a.reduce((s,p)=>s+Math.abs(p.r-4)+Math.abs(p.c-4),0);
      const bc=b.reduce((s,p)=>s+Math.abs(p.r-4)+Math.abs(p.c-4),0);
      return Math.random()<0.2 ? ac-bc : bc-ac;
    });
    for(const cells of placements){
      for(const p of cells) flat[idx(p.r,p.c)]=SH;
      ships.push(cells);
      if(backtrack(pos+1)) return true;
      ships.pop();
      for(const p of cells) flat[idx(p.r,p.c)]=WA;
    }
    return false;
  }

  if(!backtrack(0)) return null;
  return flat;
}

function buildBasePuzzle(flat, islands){
  const rc=rcFromFlat(flat);
  const cl=islandClueMapFromList(flat, islands);
  return {grid:flat.slice(), rc:rc.r, cc:rc.c, cl, meta:{}};
}

function exactCount(puz, limit=2, budget=250000){
  return countSolutionsForPuzzle(puz, limit, budget);
}

function exactUnique(puz, budget=250000){
  const r=exactCount(puz, 2, budget);
  return r.exact && r.solutions===1 ? r : null;
}

function nonUniqueWithoutIslands(puz, budget=250000){
  const r=exactCount(stripIslandClues(puz), 2, budget);
  return r.exact && r.solutions>=2 ? r : null;
}

function candidateShipClues(flat){
  const out=[];
  for(let i=0;i<N*N;i++){
    if(flat[i]!==SH) continue;
    const t=shipTypeForBoard(flat,i);
    out.push({i,t,prio:(t==='m'?0:t==='e'?1:2)});
  }
  out.sort((a,b)=>a.prio-b.prio || Math.random()-0.5);
  return out;
}

function candidateWaterClues(flat, islands){
  const out=[];
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    const i=idx(r,c);
    if(flat[i]===SH || isIslandInSet(islands,r,c)) continue;
    let near=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(dr===0&&dc===0) continue;
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=N||nc<0||nc>=N) continue;
      if(flat[idx(nr,nc)]===SH) near++;
    }
    if(near>=2) out.push({i,t:'w',prio:-near});
  }
  out.sort((a,b)=>a.prio-b.prio || Math.random()-0.5);
  return out;
}

function addClue(cl,i,t){ cl[i]=t; }

function buildUniquePuzzle(flat, islands){
  const base=buildBasePuzzle(flat, islands);
  let best=null;

  for(let attempt=0; attempt<8; attempt++){
    const puz=clonePuzzle(base);
    const shipPool=shuffled(candidateShipClues(flat));
    shipPool.sort((a,b)=>a.prio-b.prio || Math.random()-0.5);
    const waterPool=shuffled(candidateWaterClues(flat,islands)).slice(0,2);

    // start with a sparse but informative seed
    const seed=[];
    for(const clue of shipPool){
      if(seed.length>=5) break;
      seed.push(clue);
    }
    if(waterPool.length && Math.random()<0.35) seed.push(waterPool[0]);
    for(const clue of seed) addClue(puz.cl, clue.i, clue.t);

    let unique=exactUnique(puz, 120000);
    if(!unique){
      const remaining=[...shipPool.filter(c=>!seed.includes(c)), ...waterPool.slice(1)];
      for(const clue of remaining){
        addClue(puz.cl, clue.i, clue.t);
        unique=exactUnique(puz, 160000);
        if(unique) break;
        if(Object.keys(puz.cl).length>=11) break;
      }
    }
    if(!unique) continue;

    // light minimization only on a few removable clues
    let keys=Object.keys(puz.cl).filter(k=>!isIslandClueType(puz.cl[k]));
    shuffle(keys);
    for(const key of keys.slice(0,4)){
      const saved=puz.cl[key];
      delete puz.cl[key];
      if(!exactUnique(puz, 160000)) puz.cl[key]=saved;
    }

    const dep=nonUniqueWithoutIslands(puz, 220000);
    if(!dep) continue;

    const final=exactUnique(puz, 220000);
    if(!final) continue;

    puz.meta={
      uniqueChecked:true,
      uniquenessExact:true,
      solverCalls:final.calls,
      clueCount:Object.keys(puz.cl).length,
      zeroLines:zeroLinesScore({r:puz.rc,c:puz.cc}),
      noIslandSolutions:dep.solutions,
      noIslandCalls:dep.calls,
    };

    if(!best || scorePuzzleCandidate(puz,islands)>scorePuzzleCandidate(best,islands)) best=clonePuzzle(puz);
  }

  return best;
}

function scorePuzzleCandidate(puz, islands){
  const clueCount=Object.keys(puz.cl).length;
  const waterCount=Object.values(puz.cl).filter(v=>v==='w').length;
  const zeroPenalty=zeroLinePenalty(puz.rc,puz.cc);
  const islandVals=Object.values(puz.cl).filter(isIslandClueType).map(islandClueTarget);
  const islandSum=islandVals.reduce((a,b)=>a+b,0);
  const touch=harborTouchStats(puz.grid, islands);
  return (puz.meta?.solverCalls || 0)
    + (12-clueCount)*18000
    + islandSum*4500
    + touch.diagonalPairs*7000
    + touch.highIslands*6000
    - waterCount*5000
    - zeroPenalty*9000;
}

function generateCandidate(){
  for(let tries=0; tries<140; tries++){
    const islands=chooseIslandPattern();
    if(!islands) continue;
    const islandSet=islandSetFromList(islands);
    const flat=placeShipsRandom(islandSet);
    if(!flat) continue;
    const islandValues=islands.map(p=>islandAdjCount(flat,p.r,p.c));
    if(islandValues.some(v=>v<2 || v>4)) continue;
    if(!islandValues.some(v=>v>=3)) continue;
    const touch=harborTouchStats(flat,islands);
    if(touch.diagonalPairs < 2 || touch.highIslands < 1) continue;
    const puz=buildUniquePuzzle(flat,islands);
    if(!puz) continue;
    puz.meta.harborIslands=islands.map(p=>({r:p.r,c:p.c,v:islandAdjCount(flat,p.r,p.c)}));
    puz.meta.harborTouches=touch;
    puz.meta.score=scorePuzzleCandidate(puz,islands);
    return puz;
  }
  return null;
}

function distinctSignature(p){
  return p.grid.join('')+'|'+p.rc.join(',')+'|'+p.cc.join(',')+'|'+Object.keys(p.cl).sort((a,b)=>a-b).map(k=>k+':'+p.cl[k]).join(',');
}

const best=[];
const seen=new Set();
const target=5;
const outerStart=Date.now();
for(let round=1; round<=180 && best.length<target; round++){
  const puz=generateCandidate();
  if(!puz) {
    if(round%15===0) console.log(JSON.stringify({progress:'search', round, found:best.length}, null, 2));
    continue;
  }
  const sig=distinctSignature(puz);
  if(seen.has(sig)) continue;
  seen.add(sig);
  best.push(puz);
  best.sort((a,b)=>(b.meta.score||0)-(a.meta.score||0));
  console.log(JSON.stringify({progress:'found', round, found:best.length, clueCount:puz.meta.clueCount, solverCalls:puz.meta.solverCalls, score:puz.meta.score, islands:puz.meta.harborIslands, noIslandSolutions:puz.meta.noIslandSolutions}, null, 2));
}

best.sort((a,b)=>(b.meta.score||0)-(a.meta.score||0));
const out=best.slice(0,target);
console.log('FINAL_LIBRARY_START');
console.log(JSON.stringify(out));
console.log('FINAL_LIBRARY_END');
console.log(JSON.stringify({count:out.length, elapsedMs:Date.now()-outerStart}, null, 2));
