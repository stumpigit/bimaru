#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const ROOT=__dirname;
const DEPTH_PATH=path.join(ROOT,'logical_depth_score.js');
let code=fs.readFileSync(DEPTH_PATH,'utf8').replace(/main\(\);\s*$/,'module.exports={analyzePuzzle,classifyByLogicalDepth};');
const sandbox={console,require,module:{exports:{}},exports:{},__dirname:ROOT,__filename:DEPTH_PATH};
vm.createContext(sandbox); vm.runInContext(code,sandbox, {filename:DEPTH_PATH});
const {analyzePuzzle,classifyByLogicalDepth}=sandbox.module.exports;

function loadJson(name){ return JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8')); }
function clueStats(cl){
  const vals=Object.values(cl||{});
  return {
    clues: vals.length,
    islands: vals.filter(v=>/^i/.test(v)).length,
    ship: vals.filter(v=>v==='s'||v==='e'||v==='m').length,
    singles: vals.filter(v=>v==='s').length,
    water: vals.filter(v=>v==='w').length,
    highIsland: vals.filter(v=>/^i/.test(v)).map(v=>Number(v.slice(1))).some(v=>v>=3),
  };
}
function strengthScore(p, a){
  const s=clueStats(p.cl);
  let score=0;
  score += a.logicalDepth*1000 + a.pctDepthGe3*80 + a.pctDepthGe2*30 + a.avgChainLength*150;
  score += Math.min(250, ((p.meta?.solverCalls)||0)/150);
  score -= s.clues*25 + s.ship*18 + s.singles*70 + s.water*120;
  if(s.highIsland) score += 80;
  if(a.needsBacktracking) score += 100;
  return Math.round(score);
}
function strongEnough(p,a){
  const s=clueStats(p.cl);
  if(s.islands<2 || !s.highIsland || s.water>0 || s.singles>2) return false;
  if(a.logicalDepth>=4) return true;
  if(a.pctDepthGe3>=6) return true;
  if(a.logicalDepth>=3 && a.pctDepthGe2>=18 && s.ship<=10) return true;
  return false;
}

const sources=[];
for(const name of ['bimaru-harbor-library.json','hard_puzzles_generated.json','hard_puzzles_run_a.json','hard_puzzles_run_b.json','hard_puzzles_run_c.json']){
  if(fs.existsSync(path.join(ROOT,name))){
    const rows=loadJson(name);
    for(const p of rows) sources.push({source:name, puzzle:p});
  }
}
const seen=new Set();
const ranked=[];
for(const {source,puzzle} of sources){
  const sig=JSON.stringify({rc:puzzle.rc,cc:puzzle.cc,cl:Object.entries(puzzle.cl||{}).sort((a,b)=>Number(a[0])-Number(b[0]))});
  if(seen.has(sig)) continue;
  seen.add(sig);
  const a=analyzePuzzle(puzzle);
  const s=clueStats(puzzle.cl);
  const diff=classifyByLogicalDepth(a);
  const strong=strongEnough(puzzle,a);
  ranked.push({source,puzzle,analysis:a,stats:s,difficulty:diff,strong,score:strengthScore(puzzle,a)});
}
ranked.sort((x,y)=>y.score-x.score || x.stats.clues-y.stats.clues);
const curated=ranked.filter(r=>r.stats.islands>=2 && r.stats.water===0 && r.stats.highIsland && r.stats.ship>=4).slice(0,12).map((r,i)=>({
  id:i+1,
  name:`Harbor Hard #${i+1}`,
  difficulty:r.difficulty,
  grid:r.puzzle.grid,
  rc:r.puzzle.rc,
  cc:r.puzzle.cc,
  cl:r.puzzle.cl,
  meta:Object.assign({}, r.puzzle.meta||{}, {
    logicalDepth:r.analysis.logicalDepth,
    chainLength:r.analysis.avgChainLength,
    pctDepthGe2:r.analysis.pctDepthGe2,
    pctDepthGe3:r.analysis.pctDepthGe3,
    needsBacktracking:r.analysis.needsBacktracking,
    selectedFrom:r.source,
    score:r.score,
  }),
}));
fs.writeFileSync(path.join(ROOT,'selected_strong_harbor_library.json'), JSON.stringify(curated,null,2)+'\n');
console.log(JSON.stringify({
  totalSources: ranked.length,
  strongCount: ranked.filter(r=>r.strong).length,
  curated: curated.length,
  top:curated.slice(0,12).map(p=>({id:p.id,name:p.name,diff:p.difficulty,clues:Object.keys(p.cl).length,ship:Object.values(p.cl).filter(v=>v==='s'||v==='e'||v==='m').length,ld:p.meta.logicalDepth,pg2:p.meta.pctDepthGe2,pg3:p.meta.pctDepthGe3,src:p.meta.selectedFrom,score:p.meta.score}))
}, null, 2));
