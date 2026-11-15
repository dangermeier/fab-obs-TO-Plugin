const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStandingsCsv, parseHeroesCsv, parseTournamentHtml, findMaxPage } = require('../src/parser');

test('standings CSV: quoted names with commas and escaped quotes', () => {
  const csv = [
    'Rank,Name,GEM ID,Wins',
    '2,"Ironsong, Dorinthea",1001,3',
    '1,"Rhinar, Katsu ""Rhino""",1002,4',
    '',
    '3,Plain Name,1003,'
  ].join('\r\n');

  const rows = parseStandingsCsv(csv);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3]);
  assert.equal(rows[0].name, 'Rhinar, Katsu "Rhino"');
  assert.equal(rows[0].gemId, '1002');
  assert.equal(rows[0].wins, 4);
  assert.equal(rows[1].name, 'Ironsong, Dorinthea');
  assert.equal(rows[2].wins, 0);
});

test('heroes CSV: hero in the fourth column, set code stripped', () => {
  const csv = [
    'Name,GEM ID,Country,Hero',
    '"Ironsong, Dorinthea",1001,DE,"Kayo, Armed and Dangerous (HVY)"',
    'Plain Name,1002,DE,Dash I/O'
  ].join('\n');

  assert.deepEqual(parseHeroesCsv(csv), [
    { name: 'Ironsong, Dorinthea', gemId: '1001', hero: 'Kayo, Armed and Dangerous' },
    { name: 'Plain Name',          gemId: '1002', hero: 'Dash I/O' }
  ]);
});

test('run page: a page without rounds parses as an empty event, not an error', () => {
  const t = parseTournamentHtml('<html><h1>Armory &amp; Friends</h1></html>', '42');
  assert.equal(t.eventId, '42');
  assert.equal(t.meta.title, 'Armory & Friends');
  assert.deepEqual(t.rounds, []);
  assert.equal(t.currentRound, 0);
});

test('findMaxPage reads the highest page link', () => {
  assert.equal(findMaxPage('<a href="?page=2">2</a><a href="?page=7">7</a>'), 7);
  assert.equal(findMaxPage('<p>no pager</p>'), 1);
});
