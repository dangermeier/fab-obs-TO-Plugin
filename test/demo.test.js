const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEMO_MODE = 'on';
const demo = require('../src/demo');

test('demo: 128 unique players, 64 tables, parser-shaped data', () => {
  demo.reset();
  const t = demo.tournament();

  assert.equal(t.players.length, 128);
  assert.equal(new Set(t.players.map(p => p.name)).size, 128);
  assert.equal(new Set(t.players.map(p => p.gemId)).size, 128);
  assert.equal(t.rounds.length, 1);
  assert.equal(t.rounds[0].total, 64);
  assert.equal(t.rounds[0].live, 64);
  assert.deepEqual(Object.keys(t.rounds[0].pairings[0]),
    ['table', 'p1', 'p1GemId', 'p2', 'p2GemId', 'result', 'winner', 'done']);
  assert.equal(demo.heroes().length, 128);
  assert.ok(demo.heroes().every(h => h.hero));
});

test('demo: results, finishing and pairing advance the round', () => {
  demo.reset();
  demo.reportResults();
  assert.equal(demo.info().done, 16);

  demo.finishRound();
  assert.equal(demo.info().done, 64);
  assert.equal(demo.standings().reduce((n, s) => n + s.wins, 0), 64);

  demo.nextRound();
  assert.deepEqual([demo.info().stage, demo.info().done], ['r2', 0]);
});

test('demo: every stage can be jumped to, and the cut is a real bracket', () => {
  for (const { key } of demo.info().stages) {
    demo.goTo(key);
    assert.equal(demo.info().stage, key);
  }

  const t = demo.tournament();           // left at "done"
  const elim = t.rounds.filter(r => r.elimination);
  assert.deepEqual(elim.map(r => r.total), [4, 2, 1]);
  assert.equal(t.meta.status, 'Finished');
  assert.equal(demo.nextRound(), false);

  // Each semifinalist won a quarterfinal.
  const winners = elim[0].pairings.map(p => (p.winner === 'p1' ? p.p1GemId : p.p2GemId));
  const semis   = elim[1].pairings.flatMap(p => [p.p1GemId, p.p2GemId]);
  assert.deepEqual([...semis].sort(), [...winners].sort());

  assert.throws(() => demo.goTo('nope'));
});

test('demo: restarting replays the same tournament', () => {
  demo.goTo('r4');
  const first = JSON.stringify(demo.tournament());
  demo.goTo('r4');
  assert.equal(JSON.stringify(demo.tournament()), first);
});

test('demo: only the id "demo" is the demo', () => {
  assert.ok(demo.isDemo('demo'));
  assert.ok(demo.isDemo('DEMO'));
  assert.ok(!demo.isDemo('455574'));
  assert.ok(!demo.isDemo(null));
});

test('demo: switched off unless DEMO_MODE says so', () => {
  const was = process.env.DEMO_MODE;
  try {
    delete process.env.DEMO_MODE;
    assert.ok(!demo.enabled());
    assert.ok(!demo.isDemo('demo'));
    assert.ok(demo.isDemoId('demo'));
    for (const v of ['on', 'true', '1', 'YES']) {
      process.env.DEMO_MODE = v;
      assert.ok(demo.enabled(), v);
    }
    for (const v of ['', 'off', 'false', '0']) {
      process.env.DEMO_MODE = v;
      assert.ok(!demo.enabled(), v);
    }
  } finally {
    process.env.DEMO_MODE = was;
  }
});

test('featured match: the table is kept when another event is selected', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-demo-'));
  process.env.DATA_DIR = dir;
  const state = require('../src/state');
  const { saveSession } = require('../src/auth');
  const { selectMatch, refreshFeatured } = require('../src/match');
  state.loadState();
  saveSession({ eventId: demo.DEMO_ID });
  demo.goTo('r3');

  let m = await selectMatch({ table: 3, followRound: true });
  assert.deepEqual([m.eventId, m.round, m.table], ['demo', 3, 3]);
  const players = [m.p1.name, m.p2.name];
  state.adjustLife('p1', -9);

  // as if the match had been read from another event
  state.patchMatch({ eventId: '12345', p1: { ...m.p1, name: 'Somebody Else' }, matchKey: 'old' });
  m = await refreshFeatured({ force: true });
  assert.deepEqual([m.eventId, m.round, m.table], ['demo', 3, 3]);
  assert.deepEqual([m.p1.name, m.p2.name], players);
  assert.equal(m.life.p1, m.p1.startLife);
  assert.equal(m.warning, null);

  // a table the new event does not have: no players, and a warning says why
  state.patchMatch({ eventId: '12345', table: 99 });
  m = await refreshFeatured({ force: true });
  assert.equal(m.p1, null);
  assert.match(m.warning, /Table 99 not found/);


  const nextRound = () => { demo.reportResults(); demo.finishRound(); demo.nextRound(); };

  // new round with "stay on this table": the same table again
  demo.goTo('r2');
  m = await selectMatch({ table: 5, followRound: true });
  nextRound();
  m = await refreshFeatured({ force: true });
  assert.deepEqual([m.round, m.table], [3, 5]);

  // without it: table 1 of the new round
  m = await selectMatch({ round: 3, table: 7, followRound: false });
  assert.deepEqual([m.round, m.table], [3, 7]);
  m = await refreshFeatured({ force: true });
  assert.deepEqual([m.round, m.table], [3, 7]);
  nextRound();
  m = await refreshFeatured({ force: true });
  assert.deepEqual([m.round, m.table, m.followRound], [4, 1, false]);
  assert.equal(m.life.p1, m.p1.startLife);

  // an older round picked by hand stays until the next round starts
  m = await selectMatch({ round: 2, table: 6, followRound: false });
  m = await refreshFeatured({ force: true });
  assert.deepEqual([m.round, m.table], [2, 6]);
  nextRound();
  m = await refreshFeatured({ force: true });
  assert.deepEqual([m.round, m.table], [5, 1]);

  state.flushMatch();
  fs.rmSync(dir, { recursive: true, force: true });
});
