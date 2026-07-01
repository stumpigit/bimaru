const fs = require('fs');
const html = fs.readFileSync('/root/workspace/bimaru/bimaru-harbor.html','utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace('newGame();', '');
const bootstrap = `const dummyEl=()=>({textContent:'',className:'',innerHTML:'',addEventListener(){},classList:{add(){},remove(){}},dataset:{}}); global.document={getElementById(){return dummyEl();},querySelector(){return dummyEl();},querySelectorAll(){return [];},addEventListener(){}}; global.window=globalThis;`;
eval(bootstrap + js);
const SAMPLES = require('/root/workspace/bimaru/harbor_samples.json');
const idxSample = Number(process.argv[2]) - 1;
const sample = SAMPLES[idxSample];
if(!sample){ console.error('sample not found'); process.exit(1); }
for(let i=0;i<N*N;i++){
  if(sample.flat[i]===SH){
    const t = clueTypeForCell(sample.flat, Math.floor(i/N), i%N);
    console.log(i, Math.floor(i/N), i%N, t);
  }
}
