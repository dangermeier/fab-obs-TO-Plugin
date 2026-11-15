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
