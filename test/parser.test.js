const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseStandingsCsv, parseHeroesCsv, parseTournamentHtml, findMaxPage,
  parseEventDate, parseStoreName, sortEvents,
  parseRoundInfo, parsePairingsCsv, applyPairingsCsv, parseStoreEventsFromHtml, parseMatchHeroes
} = require('../src/parser');

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

test('event dates: both spellings GEM uses, null without a date', () => {
  assert.equal(parseEventDate('Wed Nov. 25th, 2026'), '2026-11-25');
  assert.equal(parseEventDate('November 21, 2026, 11:00 AM'), '2026-11-21');
  assert.equal(parseEventDate('Feb. 2, 2026'), '2026-02-02');
  assert.equal(parseEventDate('tomorrow'), null);
  assert.equal(parseEventDate(''), null);
});

test('event order: running, then the next upcoming, then the latest past', () => {
  const ev = (id, status, date) => ({ id, status, date });
  const sorted = sortEvents([
    ev('old', 'past', '2026-01-10'),
    ev('later', 'upcoming', '2026-12-02'),
    ev('undated', 'past', null),
    ev('recent', 'past', '2026-11-18'),
    ev('live', 'active', '2026-11-20'),
    ev('next', 'upcoming', '2026-11-21')
  ]);
  assert.deepEqual(sorted.map(e => e.id).slice(0, 3), ['live', 'next', 'later']);
  assert.ok(sorted.findIndex(e => e.id === 'recent') < sorted.findIndex(e => e.id === 'old'));
  assert.equal(sorted.length, 6);
});

test('store name: read from the heading of the tournament list', () => {
  assert.equal(parseStoreName('<h2>Switch profile</h2><h1> Tournaments for\n 1A Gamer Lounge </h1>'), '1A Gamer Lounge');
  assert.equal(parseStoreName('<h1>Choose a store</h1>'), null);
  assert.equal(parseStoreName(''), null);
});

// The run page as GEM writes it: a large round is a count only, a small one
// lists its tables.
const roundCard = (n, kind, id, body) => `
  <div class="content-card">
    <div class="${kind === 'Swiss' ? 'swiss' : 'playoff'}">
      <h3 class="mb-3">
              Round ${n} (${kind})
      </h3>
      ${body}
      <div class="btn-group mt-3"><span>Export:</span>
        <a href="/gem/1/coverage/standings/${id}">Standings.csv</a>
        <a href="/gem/1/coverage/results/${id}">Results.csv</a>
      </div>
    </div>
  </div>`;
const counts = (live, done, total) => `<b>Matches</b><table><tr><th>Live</th><th>Done</th><th>Total</th></tr>
  <tr class="win1"><td><span>${live}</span></td><td><span>${done}</span></td><td><span>${total}</span></td></tr></table>`;
const matchRow = (table, p1, p2, result) => `<div class="row match-row">
  <div class="col-2 py-3">Table ${table}</div><div class="col-4 py-3">${p1}</div>
  <div class="col-4 py-3">${p2}</div><div class="col-2 py-3">${result}</div></div>`;

const bigEvent = '<h1>Big Open</h1>' +
  roundCard(3, 'Elimination Playoffs', 903, matchRow(1, 'Ash, Ann (11)', 'Birch, Bo (12)', 'Player 2 Win')) +
  roundCard(2, 'Swiss', 902, counts(1, 1, 2)) +
  roundCard(1, 'Swiss', 901, counts(0, 2, 2));

const bigExport = [
  'Round,Table,Player 1 Name,Player 1 ID,Player 2 Name,Player 2 ID,Result',
  '1,2,"Cedar, Cy",13,None,,1WIN',
  '1,1,"Ash, Ann",11,"Birch, Bo",12,DRAW',
  '2,1,"Ash, Ann",11,"Cedar, Cy",13,2WIN',
  '2,2,"Birch, Bo",12,"Dorn, Di",14,',
  '3,1,"Ash, Ann",11,"Birch, Bo",12,2WIN'
].join('\n');

test('round info: number, kind, export id and counts of every round on the page', () => {
  assert.deepEqual(parseRoundInfo(bigEvent), [
    { round: 1, elimination: false, roundId: '901', live: 0, total: 2 },
    { round: 2, elimination: false, roundId: '902', live: 1, total: 2 },
    { round: 3, elimination: true,  roundId: '903', live: null, total: null }
  ]);
});

test('pairings export: fills in the rounds the page only counts', () => {
  const t = parseTournamentHtml(bigEvent, '1');
  assert.deepEqual(t.rounds.map(r => r.round), [3]);

  applyPairingsCsv(t, parsePairingsCsv(bigExport));
  assert.deepEqual(t.rounds.map(r => [r.round, r.elimination, r.done, r.total]),
    [[1, false, 2, 2], [2, false, 1, 2], [3, true, 1, 1]]);
  assert.equal(t.currentRound, 3);

  const [r1, r2, r3] = t.rounds;
  assert.deepEqual(r1.pairings.map(p => p.table), [1, 2]);
  assert.deepEqual([r1.pairings[0].result, r1.pairings[0].winner, r1.pairings[0].done], ['Draw', null, true]);
  // a bye: named so, no id, a win for the player
  assert.deepEqual([r1.pairings[1].p2, r1.pairings[1].p2GemId, r1.pairings[1].winner], ['Bye', '', 'p1']);
  assert.deepEqual([r2.pairings[0].p2, r2.pairings[0].p2GemId, r2.pairings[0].winner], ['Cedar, Cy', '13', 'p2']);
  assert.deepEqual([r2.pairings[1].done, r2.pairings[1].winner], [false, null]);
  // the round that was on the page reads the same from the export
  assert.deepEqual([r3.pairings[0].result, r3.pairings[0].winner], ['Player 2 Win', 'p2']);
});

test('round info: a running round takes its id from the report link', () => {
  const running = '<div class="content-card"><div class="swiss"><h3 class="mb-3"> Round 1 (Swiss) </h3>' +
    counts(37, 0, 37) + '<a href="/gem/1/run/1422412/report/" class="fab-btn">Enter Results</a></div></div>';
  assert.deepEqual(parseRoundInfo(running), [{ round: 1, elimination: false, roundId: '1422412', live: 37, total: 37 }]);

  const t = parseTournamentHtml('<h1>x</h1>' + running, '1');
  applyPairingsCsv(t, parsePairingsCsv('Round,Table,Player 1 Name,Player 1 ID,Player 2 Name,Player 2 ID,Result\n1,1,A B,1,C D,2,\n1,2,E F,3,G H,4,1WIN'));
  // the page's own count of running matches is not overruled by a shorter export
  assert.deepEqual([t.rounds[0].live, t.rounds[0].done, t.rounds[0].total], [1, 1, 2]);
  assert.deepEqual(t.rounds[0].pairings.map(p => p.done), [false, true]);
});

test('run page: the player list without the organiser\'s links and repeats', () => {
  const t = parseTournamentHtml(`<h1>x</h1><h3>Registered Players</h3><ol>
    <li>Ash, Ann (11) <a href="#">Fai, Rising Rebellion &nbsp; (change)</a></li>
    <li>Birch, Bo (12) <a href="#">Assign Hero</a></li>
    <li>Birch, Bo (12) <a href="#">Assign Hero</a></li>
    <li>Cedar, Cy (13) <a href="#">Rhinar (LL) &nbsp; (change)</a></li>
  </ol>`, '1');
  assert.deepEqual(t.players, [
    { name: 'Ash, Ann',  gemId: '11', hero: 'Fai, Rising Rebellion' },
    { name: 'Birch, Bo', gemId: '12', hero: null },
    { name: 'Cedar, Cy', gemId: '13', hero: 'Rhinar' }
  ]);
});

test('pairings export: a double loss is finished, with no winner', () => {
  const [row] = parsePairingsCsv('Round,Table,Player 1 Name,Player 1 ID,Player 2 Name,Player 2 ID,Result\n1,4,A B,1,C D,2,LOSSALL');
  assert.deepEqual([row.result, row.winner, row.bothLose, row.done], ['Double Loss', null, true, true]);
});

test('standings CSV: nothing but drops is no standings yet', () => {
  assert.deepEqual(parseStandingsCsv('Rank,Name,Player ID,Wins\nDropped,A B,1,0\nDropped,C D,2,0'), []);
  assert.deepEqual(parseStandingsCsv('Rank,Name,Player ID,Wins\n'), []);
});

test('heroes CSV: a player GEM lists twice is kept once', () => {
  const rows = parseHeroesCsv('Player Name,Player ID,Country/Region,Hero\nA B,1,,\nA B,1,,Fai\nC D,2,DE,Dash\nC D,2,DE,');
  assert.deepEqual(rows, [{ name: 'A B', gemId: '1', hero: 'Fai' }, { name: 'C D', gemId: '2', hero: 'Dash' }]);
});

test('run page: a dash in the result column is a match that is still running', () => {
  const t = parseTournamentHtml('<h1>x</h1>' + roundCard(10, 'Elimination Playoffs', 5,
    matchRow(1, 'Ash, Ann (11)', 'Birch, Bo (12)', '-') + matchRow(2, 'Cedar, Cy (13)', 'Dorn, Di (14)', 'Player 2 Win')), '1');
  assert.deepEqual(t.rounds[0].pairings.map(p => [p.done, p.winner]), [[false, null], [true, 'p2']]);
  assert.deepEqual([t.rounds[0].live, t.rounds[0].done, t.rounds[0].total], [1, 1, 2]);
});

test('run page: a bye is called Bye there too', () => {
  const t = parseTournamentHtml('<h1>x</h1>' + roundCard(1, 'Swiss', 1, matchRow(3, 'Ash, Ann (11)', 'None', 'Player 1 Win')), '1');
  assert.deepEqual([t.rounds[0].pairings[0].p2, t.rounds[0].pairings[0].p2GemId], ['Bye', '']);
});

test('standings CSV: dropped rows, and players GEM lists twice', () => {
  const rows = parseStandingsCsv([
    'Rank,Name,Player ID,Wins',
    '1,"Ash, Ann",11,3',
    '2,"Birch, Bo",12,2',
    'Dropped,"Birch, Bo",12,2',
    'Dropped,"Cedar, Cy",13,1',
    'Dropped,"Ash, Ann",11,3'
  ].join('\n'));
  assert.deepEqual(rows.map(r => [r.rank, r.gemId, r.wins, !!r.dropped]),
    [[1, '11', 3, false], [2, '12', 2, false], [3, '13', 1, true]]);
});

test('store list: a type that names a format is not taken for the format', () => {
  const html = `<div class="event" id="7"><h4 class="event__title">PQ</h4>
    <div class="event__when ">x</div>
    <div class="event__meta">
      <div class="event__meta-item"><span>October 10, 2026, 10:00 AM</span></div>
      <div class="event__meta-item"><span>Pro Quest: London (Classic Constructed)</span></div>
      <div class="event__meta-item"><span>Classic Constructed</span></div>
    </div><div class="btn-group"></div></div>`;
  const [ev] = parseStoreEventsFromHtml(html);
  assert.deepEqual([ev.eventType, ev.format, ev.date], ['Pro Quest: London (Classic Constructed)', 'Classic Constructed', '2026-10-10']);
});

test('match heroes: read off the results page, unassigned seats left out', () => {
  const seat = (table, n, name, id, hero) => `<div id="match-${table}-player${n}" class="match-element width-25">
    <span> ${name} (${id})
      <span class="d-block pt-2">
        <a href="/gem/tournament/1/round/2/match/3/player/${id}/hero/">
                ${hero}
        </a>
      </span>
    </span></div>`;
  const html = '<div class="match-row">' + seat(1, 1, 'Ash, Ann', 11, 'Arakni, 5L!p3d 7hRu 7h3 cR4X') + seat(1, 2, 'Birch, Bo', 12, 'Assign Match Hero') + '</div>' +
               '<div class="match-row">' + seat(2, 1, 'Cedar, Cy', 13, 'Rhinar (LL)') + seat(2, 2, 'Dorn, Di', 14, 'Dr. Mortimer, Blight of the Pits') + '</div>';
  assert.deepEqual(parseMatchHeroes(html), {
    11: 'Arakni, 5L!p3d 7hRu 7h3 cR4X',
    13: 'Rhinar',
    14: 'Dr. Mortimer, Blight of the Pits'
  });
  assert.deepEqual(parseMatchHeroes(''), {});
});
