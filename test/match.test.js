const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-match-'));
test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const { tableNum, completedSwissRounds, labelForRound, stageForRound } = require('../src/match');

const swiss = (round, done, total) => ({ round, elimination: false, done, total, pairings: [] });
const cut   = (round, tables) => ({ round, elimination: true, done: 0, total: tables, pairings: Array(tables).fill({}) });

test('tableNum: a number as it is, digits out of a raw cell, null for none', () => {
  assert.equal(tableNum({ table: 7 }), 7);
  assert.equal(tableNum({ table: 'Table 12' }), 12);
  assert.equal(tableNum({ table: '—' }), null);
  assert.equal(tableNum({}), null);
});

test('completedSwissRounds: only finished Swiss rounds count', () => {
  const tdata = { rounds: [swiss(1, 8, 8), swiss(2, 8, 8), swiss(3, 5, 8), swiss(4, 0, 0), cut(5, 4)] };
  assert.equal(completedSwissRounds(tdata), 2);
});

test('top cut: stages follow from the size of the first elimination round', () => {
  const top8 = { rounds: [swiss(1, 8, 8), cut(2, 4), cut(3, 2), cut(4, 1)] };
  assert.deepEqual(top8.rounds.map(r => labelForRound(top8, r)),
    ['Round 1', 'Quarterfinals', 'Semifinals', 'Finals']);
  assert.deepEqual(top8.rounds.map(r => stageForRound(top8, r)), [null, 'qf', 'sf', 'f']);

  const top16 = { rounds: [cut(8, 8), cut(9, 4), cut(10, 2), cut(11, 1)] };
  assert.deepEqual(top16.rounds.map(r => stageForRound(top16, r)), ['r16', 'qf', 'sf', 'f']);

  const top4 = { rounds: [swiss(1, 4, 4), cut(2, 2), cut(3, 1)] };
  assert.deepEqual(top4.rounds.map(r => stageForRound(top4, r)), [null, 'sf', 'f']);

  const finalOnly = { rounds: [cut(5, 1)] };
  assert.equal(labelForRound(finalOnly, finalOnly.rounds[0]), 'Finals');
});

test('top cut: more elimination rounds than stages end on the finals', () => {
  const t = { rounds: [cut(1, 2), cut(2, 1), cut(3, 1)] };
  assert.equal(stageForRound(t, t.rounds[2]), 'f');
});

test('labelForRound: no round, no label', () => {
  assert.equal(labelForRound({ rounds: [] }, null), null);
  assert.equal(stageForRound({ rounds: [] }, null), null);
});
