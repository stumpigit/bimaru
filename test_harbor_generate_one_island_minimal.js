#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { execFileSync } = require('child_process');

const raw = execFileSync('node', ['/root/workspace/bimaru/harbor_generate_one_island_minimal.js', '1', '1'], { encoding: 'utf8' });
const data = JSON.parse(raw);

assert.equal(data.ok, true, 'generator should succeed on sample 1');
assert.equal(data.sample, 1, 'sample mismatch');
assert.ok(Array.isArray(data.candidates) && data.candidates.length >= 1, 'expected at least one candidate');

const first = data.candidates[0];
assert.equal(first.clueCount, 2, 'expected 1 island + 1 separator clue');
assert.equal(first.islandCount, 1, 'expected exactly one island clue');
assert.equal(first.separatorCount, 1, 'expected exactly one separator clue');
assert.equal(first.unique.exact, true, 'expected exact uniqueness');
assert.equal(first.unique.solutions, 1, 'expected exactly one solution');
assert.ok(first.separator && typeof first.separator.clue === 'string', 'separator clue missing');

console.log('ok');
