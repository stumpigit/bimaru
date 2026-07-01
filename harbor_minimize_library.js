const fs = require('fs');
const html = fs.readFileSync('/root/workspace/bimaru/bimaru-harbor.html','utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace('newGame();', '');
const bootstrap = `const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},classList:{add(){},remove(){}},dataset:{}}); global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){}}; global.window=globalThis;`;
eval(bootstrap + js);

function exactUnique(p, budget=180000){
  const r = countSolutionsForPuzzle(p,2,budget);
  return (r.exact && r.solutions===1) ? r : null;
}
function scoreCandidate(p, unique){
  const vals = Object.values(p.cl);
  const total = vals.length;
  const island = vals.filter(v => typeof v === 'string' && /^i[0-4]$/.test(v)).length;
  const ship = total - island;
  const singles = vals.filter(v => v === 's').length;
  const ends = vals.filter(v => v === 'e').length;
  const middles = vals.filter(v => v === 'm').length;
  return {
    total, island, ship, singles, ends, middles,
    solverCalls: unique.calls,
    rank: (30-total)*100000 + unique.calls - singles*12000 - ends*5000 - middles*1000
  };
}
function removalOrder(p){
  const keys = Object.keys(p.cl).filter(k => !isIslandClueType(p.cl[k]));
  const prio = {s:0,e:1,m:2,w:3};
  return keys.sort((a,b)=>{
    const ta=p.cl[a], tb=p.cl[b];
    if(prio[ta] !== prio[tb]) return prio[ta]-prio[tb];
    return Math.random() < 0.5 ? -1 : 1;
  });
}
function minimizeOne(base){
  let best = clonePuzzle(base);
  let bestUnique = exactUnique(best, 180000);
  if(!bestUnique) throw new Error('base not unique exact for sample '+(base.meta?.sampleIndex));
  best.meta = Object.assign({}, best.meta, scoreCandidate(best, bestUnique), {uniqueChecked:true, uniquenessExact:true});

  for(let pass=0; pass<5; pass++){
    let cur = clonePuzzle(best);
    let changed = false;
    const order = removalOrder(cur);
    for(const key of order){
      const saved = cur.cl[key];
      delete cur.cl[key];
      const unique = exactUnique(cur, 180000);
      if(unique){
        changed = true;
        cur.meta = Object.assign({}, cur.meta, scoreCandidate(cur, unique), {uniqueChecked:true, uniquenessExact:true});
      } else {
        cur.cl[key] = saved;
      }
    }
    const curUnique = exactUnique(cur, 180000);
    if(curUnique){
      const curMeta = scoreCandidate(cur, curUnique);
      const bestMeta = scoreCandidate(best, bestUnique);
      const better = (curMeta.total < bestMeta.total) || (curMeta.total === bestMeta.total && curMeta.rank > bestMeta.rank);
      if(better){
        best = clonePuzzle(cur);
        bestUnique = curUnique;
        best.meta = Object.assign({}, best.meta, curMeta, {uniqueChecked:true, uniquenessExact:true});
      }
    }
    if(!changed) break;
  }
  return best;
}

const requested = process.argv[2] ? Number(process.argv[2]) : null;
const lib = requested ? ARCHIPELAGO_LIBRARY.filter(p => (p.meta?.sampleIndex) === requested) : ARCHIPELAGO_LIBRARY;
const minimized = lib.map(minimizeOne);
console.log(JSON.stringify(minimized.map(p => ({sample:p.meta?.sampleIndex, clues:Object.keys(p.cl).length, clueMap:p.cl, solverCalls:p.meta.solverCalls, singles:p.meta.singles, ends:p.meta.ends, middles:p.meta.middles})), null, 2));
console.log('FINAL_LIBRARY_START');
console.log(JSON.stringify(minimized));
console.log('FINAL_LIBRARY_END');
