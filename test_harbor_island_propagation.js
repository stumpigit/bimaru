#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('/root/workspace/bimaru/bimaru-harbor.html', 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
js = js.replace("document.addEventListener('mouseup',()=>{drag=false; wasDrag=false;});", '');
js = js.replace(/newGame\(\);\s*$/, '');

const sandbox = { console, Math, JSON, Date, setTimeout, clearTimeout };
const dummy = () => ({ textContent:'', className:'', innerHTML:'', addEventListener(){}, appendChild(){}, classList:{add(){}, remove(){}}, dataset:{}, style:{} });
sandbox.document = { getElementById(){ return dummy(); }, querySelector(){ return dummy(); }, querySelectorAll(){ return []; }, addEventListener(){}, createElement(){ return dummy(); } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(js, sandbox, { filename: 'bimaru-harbor.html' });

assert.equal(typeof sandbox.propagateForcedAssignments, 'function', 'propagateForcedAssignments() missing');

const { N, idx, WA, SH } = sandbox;
const r = 4, c = 4, i = idx(r,c);
const clueMap = { [i]: 'i4' };
const rowTarget = new Array(N).fill(0);
const colTarget = new Array(N).fill(0);
rowTarget[r] = 2;
colTarget[c] = 2;
rowTarget[r-1] = 1;
rowTarget[r+1] = 1;
colTarget[c-1] = 1;
colTarget[c+1] = 1;

const assign = new Array(N*N).fill(null);
const res = sandbox.propagateForcedAssignments(assign, rowTarget, colTarget, clueMap);
assert.equal(res.ok, true, 'propagation returned not-ok');
assert.equal(assign[i], WA, 'island center should be forced to water');
assert.equal(assign[idx(r-1,c)], SH, 'north dock should be forced ship');
assert.equal(assign[idx(r+1,c)], SH, 'south dock should be forced ship');
assert.equal(assign[idx(r,c-1)], SH, 'west dock should be forced ship');
assert.equal(assign[idx(r,c+1)], SH, 'east dock should be forced ship');
assert.equal(assign[idx(r-1,0)], WA, 'row propagation should force water across row r-1');
assert.equal(assign[idx(0,c-1)], WA, 'column propagation should force water across col c-1');
console.log('ok');
