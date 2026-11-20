const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-match-'));
test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const {
  tableNum, completedSwissRounds, labelForRound, stageForRound,
  fromOtherEvent, clearFeatured, setManualMatch, recordOf
} = require('../src/match');
const state = require('../src/state');

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

test('fromOtherEvent: by event id, or by title for states that predate it', () => {
  assert.equal(fromOtherEvent({ eventId: 'demo' }, '508239'), true);
  assert.equal(fromOtherEvent({ eventId: '508239' }, '508239'), false);
  assert.equal(fromOtherEvent({ eventId: '508239' }, 508239), false);
  assert.equal(fromOtherEvent({ eventId: '508239' }, null), true);

  const old = { eventId: null, eventTitle: 'Demo Open' };
  assert.equal(fromOtherEvent(old, '508239', '1a Armory'), true);
  assert.equal(fromOtherEvent(old, '508239', 'Demo Open'), false);
  assert.equal(fromOtherEvent(old, '508239'), false);          // title not known yet
  assert.equal(fromOtherEvent({ eventId: null, eventTitle: null }, '508239', '1a Armory'), false);
});

test('clearFeatured: nothing of the old match is left, the card stays', () => {
  state.loadState();
  const card = { name: 'Card', images: ['https://img.example/c.webp'] };
  state.patchMatch({
    table: 3, round: 2, eventId: 'demo', eventTitle: 'Demo Open', format: 'Classic Constructed',
    p1: { name: 'A' }, p2: { name: 'B' }, life: { p1: 12, p2: 40 }, start: { p1: 40, p2: 40 },
    matchKey: '2|3|A|B', roundLabel: 'Round 2', totalRounds: 7, ended: true,
    history: [{ life: { p1: 40, p2: 40 } }], warning: 'Table 3 not found in round 2', card
  });

  const m = clearFeatured();
  for (const k of ['table', 'round', 'p1', 'p2', 'matchKey', 'eventId', 'eventTitle', 'format',
                   'roundLabel', 'roundStage', 'totalRounds', 'warning']) {
    assert.equal(m[k], null, k);
  }
  assert.deepEqual(m.life, { p1: null, p2: null });
  assert.deepEqual(m.start, { p1: null, p2: null });
  assert.equal(m.ended, false);
  assert.deepEqual(m.history, []);
  assert.deepEqual(m.card, card);
  state.flushMatch();
});

// Free mode. Start life is always given, so no card lookup goes out.
const free = (extra = {}) => setManualMatch({
  enabled: true,
  p1: { name: 'Team Red', hero: 'Arakni', startLife: 40, wins: 2, losses: 1 },
  p2: { name: 'Mustermann, Max', hero: 'Fai', startLife: 20 },
  ...extra
});

test('free mode: typed players replace the match and are marked as typed', async () => {
  clearFeatured();
  const m = await free({ round: 'Showmatch', eventTitle: '  Store   Open ', format: 'Blitz' });

  assert.equal(m.manual, true);
  assert.deepEqual([m.p1.name, m.p1.hero, m.p1.wins, m.p1.losses], ['Team Red', 'Arakni', 2, 1]);
  assert.ok(m.p1.asTyped && m.p2.asTyped);
  assert.deepEqual([m.p2.wins, m.p2.losses], [0, 0]);
  assert.deepEqual(m.life, { p1: 40, p2: 20 });
  assert.deepEqual([m.round, m.roundLabel, m.roundStage], [null, 'Showmatch', null]);
  assert.equal(m.eventTitle, 'Store Open');
  assert.equal(m.format, 'Blitz');
});

test('free mode: a number is a round, anything else a label', async () => {
  let m = await free({ round: '3', table: '5' });
  assert.deepEqual([m.round, m.roundLabel, m.table], [3, 'Round 3', 5]);
  m = await free({ round: 'Finals', table: '' });
  assert.deepEqual([m.round, m.roundLabel, m.table], [null, 'Finals', null]);
});

test('free mode: a correction keeps the life totals, another hero resets them', async () => {
  await free();
  state.adjustLife('p1', -7);

  let m = await free({ p1: { name: 'Team Rot', hero: 'Arakni', startLife: 40 } });
  assert.equal(m.p1.name, 'Team Rot');
  assert.equal(m.life.p1, 33);
  assert.equal(state.matchView().canUndo, true);

  m = await free({ p1: { name: 'Team Rot', hero: 'Dash', startLife: 40 } });
  assert.deepEqual(m.life, { p1: 40, p2: 20 });
});

test('free mode: remembers the GEM table and gives it back', async () => {
  await setManualMatch({ enabled: false });
  state.patchMatch({ table: 4, round: 2, followRound: false });
  let m = await free();
  assert.deepEqual(m.resume, { round: 2, table: 4, followRound: false });
  // a second apply must not overwrite what to return to
  m = await free({ table: '9' });
  assert.deepEqual(m.resume, { round: 2, table: 4, followRound: false });

  m = await setManualMatch({ enabled: false });
  assert.deepEqual([m.manual, m.resume, m.table, m.round, m.followRound], [false, null, 4, 2, false]);
  assert.equal(m.p1, null);
});

test('free mode: switched off with no table to return to, the match is empty', async () => {
  state.patchMatch({ table: null });
  await free({ eventTitle: 'Showmatch' });
  const m = await setManualMatch({ enabled: false });
  assert.deepEqual([m.manual, m.p1, m.p2, m.eventTitle, m.roundLabel], [false, null, null, null, null]);
});

test('recordOf: Swiss wins and losses off the pairings', () => {
  const row = (p1GemId, p2GemId, winner, done = true) => ({ p1: 'a', p1GemId, p2: 'b', p2GemId, winner, done });
  const tdata = { rounds: [
    { round: 1, elimination: false, pairings: [row('1', '2', 'p1'), row('3', '', 'p1')] },
    { round: 2, elimination: false, pairings: [row('2', '1', null), row('3', '4', 'p2')] },
    { round: 3, elimination: false, pairings: [row('1', '3', null, false)] },
    { round: 4, elimination: true,  pairings: [row('1', '3', 'p2')] }
  ] };
  assert.deepEqual(recordOf(tdata, '1', 'a'), { wins: 1, losses: 0 });   // win, draw, running, cut
  assert.deepEqual(recordOf(tdata, '2', 'b'), { wins: 0, losses: 1 });
  assert.deepEqual(recordOf(tdata, '3', 'x'), { wins: 1, losses: 1 });   // bye counts as a win
  assert.deepEqual(recordOf(tdata, '9', 'nobody'), { wins: 0, losses: 0 });
  // the empty seat of a bye has no record
  assert.deepEqual(recordOf({ rounds: [{ pairings: [{ p1: 'a', p1GemId: '1', p2: 'Bye', p2GemId: '', winner: 'p1', done: true }] }] }, '', 'Bye'),
    { wins: 0, losses: 0 });
});
