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
const shipPool = (process.argv[3]||'').split(',').filter(Boolean).map(Number);
const minK = Number(process.argv[4]||2);
const maxK = Number(process.argv[5]||shipPool.length);
const uniqueBudget = Number(process.argv[6]||120000);
const noIslandBudget = Number(process.argv[7]||140000);
function combos(arr,k,start=0,prefix=[],out=[]){
  if(prefix.length===k){ out.push(prefix.slice()); return out; }
  for(let i=start;i<=arr.length-(k-prefix.length);i++){
    prefix.push(arr[i]);
    combos(arr,k,i+1,prefix,out);
    prefix.pop();
  }
  return out;
}
function summarize(chosen){
  const cl={};
  for(const [r,c,v] of sample.islands) cl[idx(r,c)]='i'+v;
  for(const i of chosen) cl[i]=clueTypeForCell(sample.flat, Math.floor(i/N), i%N);
  const puz={grid:sample.flat.slice(), rc:sample.rows.slice(), cc:sample.cols.slice(), cl, meta:{}};
  const unique=countSolutionsForPuzzle(puz,2,uniqueBudget);
  if(!(unique.exact && unique.solutions===1)) return {ok:false, chosen, cl, unique};
  const noIs=countSolutionsForPuzzle(stripIslandClues(puz),2,noIslandBudget);
  return {
    ok:true, chosen, clueCount:Object.keys(cl).length,
    shipClues:chosen.length,
    clueMap:cl,
    unique,
    noIsland:noIs,
    exactNoIsland:noIs.exact,
    noIslandSolutions:noIs.solutions,
  };
}
let found=[];
for(let k=minK;k<=maxK;k++){
  for(const chosen of combos(shipPool,k)){
    const res=summarize(chosen);
    if(res.ok) found.push(res);
  }
  if(found.length) break;
}
found.sort((a,b)=> a.shipClues-b.shipClues || b.noIslandSolutions-a.noIslandSolutions || a.unique.calls-b.unique.calls);
console.log(JSON.stringify({sample:sampleId, minK, maxK, testedPool:shipPool, found:found.slice(0,20)}, null, 2));
