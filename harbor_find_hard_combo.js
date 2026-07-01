const fs = require('fs');
const html = fs.readFileSync('/root/workspace/bimaru/bimaru-harbor.html','utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace('newGame();', '');
const bootstrap = `const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},classList:{add(){},remove(){}},dataset:{}}); global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){},createElement(){return dummyEl();}}; global.window=globalThis;`;
eval(bootstrap + js);
const SAMPLES = require('/root/workspace/bimaru/harbor_samples.json');
const sampleId = Number(process.argv[2]);
const sample = SAMPLES[sampleId-1];
if(!sample){ console.error('sample not found'); process.exit(1); }
const pool = (process.argv[3]||'').split(',').filter(Boolean).map(Number);
const minK = Number(process.argv[4]||2);
const maxK = Number(process.argv[5]||minK);
function comb(arr,k,start=0,prefix=[],out=[]){
  if(prefix.length===k){ out.push(prefix.slice()); return out; }
  for(let i=start;i<=arr.length-(k-prefix.length);i++){
    prefix.push(arr[i]);
    comb(arr,k,i+1,prefix,out);
    prefix.pop();
  }
  return out;
}
let best=[];
for(let k=minK;k<=maxK;k++){
  const combos=comb(pool,k);
  for(const chosen of combos){
    const clueMap={};
    for(const [r,c,v] of sample.islands) clueMap[idx(r,c)]='i'+v;
    for(const i of chosen) clueMap[i]=clueTypeForCell(sample.flat, Math.floor(i/N), i%N);
    const puz={grid:sample.flat.slice(), rc:sample.rows.slice(), cc:sample.cols.slice(), cl:clueMap, meta:{}};
    const unique=countSolutionsForPuzzle(puz,2,140000);
    if(!(unique.exact && unique.solutions===1)) continue;
    const noIs=countSolutionsForPuzzle(stripIslandClues(puz),2,160000);
    if(!(noIs.exact && noIs.solutions>=2)) continue;
    best.push({chosen, clues:Object.keys(clueMap).length, shipClues:chosen.length, unique, noIsland:noIs, clueMap});
  }
  if(best.length) break;
}
best.sort((a,b)=>a.shipClues-b.shipClues || b.noIsland.solutions-a.noIsland.solutions);
console.log(JSON.stringify({sample:sampleId, pool, minK, maxK, found:best.length, best:best.slice(0,12)}, null, 2));
