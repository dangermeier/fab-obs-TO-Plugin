/* Demo tournament — a made-up 128-player event that lives entirely in memory.
 *
 * It exists so every overlay and the tablet can be tried out, and a stream
 * layout built, without a GEM login or a running event. Selecting the event id
 * "demo" makes the fetcher serve this instead of scraping GEM; the data has
 * exactly the shape parser.js produces, so nothing downstream knows the
 * difference.
 *
 * The tournament is advanced by hand from the config page: report a few
 * results, finish the round, pair the next one, or jump straight to a stage.
 * Everything is driven by a seeded generator, so "reset" always replays the
 * same event.
 */

const DEMO_ID      = 'demo';
const PLAYER_COUNT = 128;
const SWISS_ROUNDS = 7;     // 2^7 = 128
const CUT          = 8;

const TITLE = 'Demo Open — 128 Players';

const FIRST = ['Alexander', 'Marie', 'Jonas', 'Lea', 'Maximilian', 'Sophie', 'Paul', 'Emma',
  'Felix', 'Hannah', 'Lukas', 'Mia', 'Tim', 'Lena', 'Noah', 'Clara',
  'Ben', 'Anna', 'Finn', 'Laura', 'Elias', 'Julia', 'Leon', 'Sarah',
  'Moritz', 'Nina', 'David', 'Katharina', 'Jan', 'Lisa', 'Ömer', 'Christoph-Maximilian'];

const LAST = ['Schauer', 'Müller', 'Kılıç', "O'Brien", 'Hoffmann', 'Wagner', 'Becker', 'Schulz',
  'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Braun', 'Zimmermann',
  'Krüger', 'Hartmann', 'Lange', 'Werner', 'Lehmann', 'Krause', 'Meier', 'Huber',
  'Kaiser', 'Fuchs', 'Peters', 'Scholz', 'Möller', 'Weiß', 'Jung', 'von Hohenlohe-Langenburg'];

// [hero, weight] — a plausible metagame: a few popular heroes, a long tail.
// All of these resolve in the card database, so the portraits are real.
const META = [
  ['Cindra, Dracai of Retribution', 14], ['Gravy Bones, Shipwrecked Looter', 12],
  ['Verdance, Thorn of the Rose', 11],   ['Fang, Dracai of Blades', 10],
  ['Aurora, Shooting Star', 9],          ['Kayo, Armed and Dangerous', 8],
  ['Dorinthea Ironsong', 8],             ['Oscilio, Constella Intelligence', 7],
  ['Florian, Rotwood Harbinger', 7],     ['Arakni, Marionette', 6],
  ['Dash I/O', 5],                       ['Nuu, Alluring Desire', 5],
  ['Enigma, Ledger of Ancestry', 4],     ['Prism, Awakener of Sol', 4],
  ['Azalea, Ace in the Hole', 3],        ['Victor Goldmane, High and Mighty', 3],
  ['Katsu, the Wanderer', 3],            ['Bravo, Showstopper', 2],
  ['Fai, Rising Rebellion', 2],          ['Viserai, Rune Blood', 2],
  ['Rhinar, Reckless Rampage', 1],       ['Levia, Shadowborn Abomination', 1],
  ['Betsy, Skin in the Game', 1]
];

// The stages the config page can jump to, in tournament order.
const STAGES = [
  ...Array.from({ length: SWISS_ROUNDS }, (_, i) => ({ key: `r${i + 1}`, label: `Round ${i + 1}` })),
  { key: 'qf', label: 'Quarterfinals' },
  { key: 'sf', label: 'Semifinals' },
  { key: 'f',  label: 'Finals' },
  { key: 'done', label: 'Finished' }
];

/* The demo is off unless the configuration turns it on: DEMO_MODE=on in the
 * environment (or in .env). While it is off the id "demo" means nothing —
 * no overlay can show it and the config page does not offer it. Read on
 * every call rather than once, so the tests can flip it. */
function enabled() {
  return /^(1|true|on|yes)$/i.test(String(process.env.DEMO_MODE || '').trim());
}

function isDemoId(eventId) { return String(eventId || '').toLowerCase() === DEMO_ID; }
function isDemo(eventId)   { return enabled() && isDemoId(eventId); }

// ── seeded randomness ────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand, players, rounds;

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickHero() {
  const total = META.reduce((n, m) => n + m[1], 0);
  let roll = rand() * total;
  for (const [hero, weight] of META) { roll -= weight; if (roll < 0) return hero; }
  return META[0][0];
}

// ── building the event ───────────────────────────────────────────────────────

function reset() {
  rand = mulberry32(20261115);

  players = Array.from({ length: PLAYER_COUNT }, (_, i) => {
    const first = FIRST[i % FIRST.length];
    // Offsetting the surname per block of 32 keeps all 128 combinations unique.
    const last  = LAST[(i * 7 + Math.floor(i / FIRST.length) * 5) % LAST.length];
    return {
      first, last,
      gemId: String(48000000 + i * 7919),
      hero:  pickHero(),
      // A handful of players carry a nickname, like real GEM profiles do.
      nick:  i % 37 === 5 ? ' "Ace"' : '',
      skill: 0.6 + rand() * 0.8,    // makes some players actually win more
      wins:  0
    };
  });

  rounds = [];
  pairSwiss();
}

// GEM's run page writes "Last, First"; its coverage CSVs write "First Last".
const runName = p => `${p.last}, ${p.first}${p.nick}`;
const csvName = p => `${p.first} ${p.last}`;

function pairing(table, a, b) {
  return {
    table,
    p1: runName(a), p1GemId: a.gemId,
    p2: runName(b), p2GemId: b.gemId,
    result: '', winner: null, done: false,
    _a: a, _b: b                      // stripped again before anything leaves here
  };
}

function ranked() {
  // Shuffle first, then a stable sort by wins: ties come out in random order.
  return shuffled(players).sort((x, y) => y.wins - x.wins);
}

function pairSwiss() {
  const order = ranked();
  const list  = [];
  for (let i = 0; i < order.length; i += 2) list.push(pairing(i / 2 + 1, order[i], order[i + 1]));
  rounds.push({ round: rounds.length + 1, elimination: false, pairings: list });
}

function pairElimination() {
  const elim = rounds.filter(r => r.elimination);
  const last = elim[elim.length - 1];
  let list;

  if (!last) {
    // 1 v 8, 4 v 5, 2 v 7, 3 v 6 — tables 1+2 and 3+4 meet in the semifinals.
    const top = standingsOrder().slice(0, CUT);
    list = [[0, 7], [3, 4], [1, 6], [2, 5]].map(([x, y], i) => pairing(i + 1, top[x], top[y]));
  } else {
    const winners = last.pairings.map(p => (p.winner === 'p1' ? p._a : p._b));
    list = [];
    for (let i = 0; i < winners.length; i += 2) list.push(pairing(i / 2 + 1, winners[i], winners[i + 1]));
  }
  rounds.push({ round: rounds.length + 1, elimination: true, pairings: list });
}

function standingsOrder() {
  // Stable on the player index, so the table does not reshuffle between reads.
  return [...players].sort((x, y) => y.wins - x.wins || players.indexOf(x) - players.indexOf(y));
}

function decide(p, round) {
  const chance = p._a.skill / (p._a.skill + p._b.skill);
  p.winner = rand() < chance ? 'p1' : 'p2';
  p.result = p.winner === 'p1' ? 'Player 1 Win' : 'Player 2 Win';
  p.done   = true;
  if (!round.elimination) (p.winner === 'p1' ? p._a : p._b).wins++;
}

// ── state queries ────────────────────────────────────────────────────────────

function current()  { return rounds[rounds.length - 1]; }
function running(r) { return r.pairings.filter(p => !p.done); }

function stageKey() {
  const r = current();
  if (!r.elimination) return `r${r.round}`;
  const tables = r.pairings.length;
  if (tables === 1) return running(r).length ? 'f' : 'done';
  return tables === 2 ? 'sf' : 'qf';
}

function isFinished() { return stageKey() === 'done'; }

// ── actions ──────────────────────────────────────────────────────────────────

// Finish a share of the tables still playing — at least one.
function reportResults(share = 0.25) {
  const r = current();
  const open = running(r);
  if (!open.length) return false;
  const n = Math.max(1, Math.round(open.length * share));
  shuffled(open).slice(0, n).forEach(p => decide(p, r));
  return true;
}

function finishRound() {
  const r = current();
  const open = running(r);
  open.forEach(p => decide(p, r));
  return open.length > 0;
}

// Pair the next round; a round still being played is finished first.
function nextRound() {
  if (isFinished()) return false;
  finishRound();
  const r = current();
  if (!r.elimination && r.round < SWISS_ROUNDS) pairSwiss();
  else if (!r.elimination || r.pairings.length > 1) pairElimination();
  return true;
}

// Replay from the start up to the given stage, freshly paired.
function goTo(key) {
  if (!STAGES.some(s => s.key === key)) throw new Error(`Unknown stage "${key}"`);
  reset();
  let guard = 0;
  while (stageKey() !== key && guard++ < 30) {
    if (key === 'done' && stageKey() === 'f') { finishRound(); break; }
    nextRound();
  }
}

// ── what the rest of the server reads ────────────────────────────────────────

function tournament() {
  const out = rounds.map(r => {
    const live = running(r).length;
    return {
      round: r.round,
      elimination: r.elimination,
      live,
      done: r.pairings.length - live,
      total: r.pairings.length,
      pairings: r.pairings.map(({ _a, _b, ...p }) => ({ ...p }))
    };
  });

  return {
    eventId: DEMO_ID,
    meta: {
      title:       TITLE,
      status:      isFinished() ? 'Finished' : 'In Progress',
      type:        'Demo',
      format:      'Classic Constructed',
      totalRounds: SWISS_ROUNDS,
      playerCount: PLAYER_COUNT
    },
    players: players.map(p => ({ name: runName(p), gemId: p.gemId, hero: null })),
    rounds: out,
    currentRound: current().round
  };
}

function heroes() {
  return players.map(p => ({ name: csvName(p), gemId: p.gemId, hero: p.hero }));
}

function standings() {
  return standingsOrder().map((p, i) => ({
    rank: i + 1, name: csvName(p), gemId: p.gemId, wins: p.wins, losses: 0
  }));
}

// Compact state for the config page.
function info() {
  const r   = current();
  const key = stageKey();
  const open = running(r).length;
  return {
    stage:    key,
    label:    STAGES.find(s => s.key === key).label,
    round:    r.round,
    done:     r.pairings.length - open,
    total:    r.pairings.length,
    finished: key === 'done',
    players:  PLAYER_COUNT,
    title:    TITLE,
    stages:   STAGES
  };
}

reset();

module.exports = {
  DEMO_ID, isDemo, isDemoId, enabled,
  tournament, heroes, standings, info,
  reset, reportResults, finishRound, nextRound, goTo
};
