const { getSession } = require('./auth');
const {
  fetchTournamentData, fetchHeroesCsv, fetchHeroInfo, isYoungFormat
} = require('./fetcher');
const { getMatch, patchMatch } = require('./state');
const { nameKey } = require('./name');
const { isDemo } = require('./demo');

const ROUND_LABELS = ['Round of 16', 'Quarterfinals', 'Semifinals', 'Finals'];
const ROUND_STAGES = ['r16', 'qf', 'sf', 'f'];   // keys the overlays translate
const REFRESH_MS = 20 * 1000;

// pairing.table is a number, or the raw cell text if it did not parse.
function tableNum(pairing) {
  if (typeof pairing.table === 'number') return pairing.table;
  return parseInt(String(pairing.table).replace(/\D/g, ''), 10) || null;
}

// GEM's standings CSV has no usable loss column, losses are derived from this.
function completedSwissRounds(tdata) {
  return tdata.rounds.filter(r => !r.elimination && r.total > 0 && r.done >= r.total).length;
}

// Index into ROUND_LABELS / ROUND_STAGES, from the table count of the first
// top-cut round. -1 for Swiss.
function stageIndex(tdata, round) {
  if (!round?.elimination) return -1;

  const elim  = tdata.rounds.filter(r => r.elimination).sort((a, b) => a.round - b.round);
  const idx   = elim.findIndex(r => r.round === round.round);
  const first = elim[0]?.pairings.length || 0;
  const start = first >= 8 ? 0 : first >= 4 ? 1 : first >= 2 ? 2 : 3;

  return Math.min(start + Math.max(idx, 0), ROUND_LABELS.length - 1);
}

function labelForRound(tdata, round) {
  if (!round) return null;
  const i = stageIndex(tdata, round);
  return i < 0 ? `Round ${round.round}` : ROUND_LABELS[i];
}

function stageForRound(tdata, round) {
  const i = stageIndex(tdata, round);
  return i < 0 ? null : ROUND_STAGES[i];
}

// The 20 s refresh must not re-broadcast identical data to every overlay.
function hasChanges(patch) {
  const cur = getMatch();
  return Object.keys(patch).some(k => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]));
}

// Old match states have no eventId, only the title to compare.
function fromOtherEvent(m, eventId, title) {
  if (m.eventId) return String(m.eventId) !== String(eventId || '');
  return !!(m.eventTitle && title && m.eventTitle !== title);
}

// Drops players, counters, table and event info. The shown card stays.
function clearFields() {
  return {
    table: null, round: null,
    p1: null, p2: null,
    life:  { p1: null, p2: null },
    start: { p1: null, p2: null },
    ended: false, history: [],
    matchKey: null, eventId: null, eventTitle: null, format: null,
    roundLabel: null, roundStage: null, totalRounds: null,
    lastRound: null, warning: null
  };
}

function clearFeatured() {
  return patchMatch(clearFields());
}

// Another event was selected: the players go, the table number stays and is
// looked up in the new event's current round.
function moveToNewEvent(m) {
  return patchMatch({ ...clearFields(), table: m.table, followRound: true });
}

function setWarning(msg) {
  const m = getMatch();
  if (m.warning === msg) return m;
  return patchMatch({ warning: msg });
}

// Swiss record counted off the pairings. Draws count for neither side.
function recordOf(tdata, gemId, name) {
  if (!gemId && name === 'Bye') return { wins: 0, losses: 0 };
  const key = nameKey(name);
  const is  = (id, n) => (gemId ? id === gemId : !!key && nameKey(n) === key);
  let wins = 0, losses = 0;
  for (const round of tdata.rounds) {
    if (round.elimination) continue;
    for (const p of round.pairings) {
      const seat = is(p.p1GemId, p.p1) ? 'p1' : is(p.p2GemId, p.p2) ? 'p2' : null;
      if (!seat || !p.done || !p.winner) continue;
      if (p.winner === seat) wins++; else losses++;
    }
  }
  return { wins, losses };
}

async function buildPlayer(name, gemId, ctx) {
  const key  = nameKey(name);
  const hero = ctx.heroById[gemId] || (key && ctx.heroByName[key]) || null;

  let heroInfo = null;
  if (hero) {
    try {
      heroInfo = await fetchHeroInfo(hero, { young: ctx.young });
    } catch {
      // not in the card database (typo, new set), default life is used below
    }
  }

  return {
    name:      name || '',
    gemId:     gemId || '',
    hero,
    heroInfo,
    startLife: heroInfo?.health || (ctx.young ? 20 : 40),
    ...recordOf(ctx.tdata, gemId, name)
  };
}

// Only place where GEM data becomes featured-match state. No failure path may
// touch the life totals.
async function refreshFeatured({ force = false } = {}) {
  let m = getMatch();
  if (m.manual || m.table == null) return m;

  const session = getSession();
  const eventId = session?.eventId;

  // Event changed: drop the players first, or the old ones stay on screen if
  // the new event has no such table or GEM is down.
  if (fromOtherEvent(m, eventId)) m = moveToNewEvent(m);

  // demo needs no GEM session
  if (!isDemo(eventId)) {
    if (!session?.sessionId) return setWarning('Not logged in to GEM');
    if (!eventId) return setWarning('No event selected');
  }

  let tdata, heroes;
  try {
    [tdata, heroes] = await Promise.all([
      fetchTournamentData(eventId, { force }),
      fetchHeroesCsv(eventId, { force }).catch(() => [])
    ]);
  } catch (err) {
    // 4xx from GEM is nearly always an expired session, not an outage
    if (err.sessionExpired) return setWarning(err.message);
    const expired = /HTTP 4\d\d/.test(err.message);
    return setWarning(expired
      ? `GEM rejected the request (${err.message}) — log in again on the config page`
      : `GEM unreachable: ${err.message}`);
  }

  if (fromOtherEvent(m, eventId, tdata.meta?.title)) m = moveToNewEvent(m);

  // event info, set even if the table is not found
  const about = {
    eventId:     String(eventId),
    eventTitle:  tdata.meta?.title ?? null,
    format:      tdata.meta?.format ?? null,
    totalRounds: tdata.meta?.totalRounds ?? null
  };

  // A new round: the same table again with followRound, table 1 without.
  const last     = tdata.rounds[tdata.rounds.length - 1];
  const newRound = !!last && m.lastRound != null && last.round > m.lastRound;
  const table    = newRound && !m.followRound ? 1 : m.table;
  const round    = m.followRound || newRound || m.round == null
    ? last
    : tdata.rounds.find(r => r.round === m.round);

  if (!round) return setWarning(last ? `Round ${m.round} not found` : 'No rounds yet');
  about.table     = table;
  about.lastRound = last.round;

  const pairing = round.pairings.find(p => tableNum(p) === table);
  if (!pairing) {
    const patch = {
      ...about,
      round:      round.round,
      roundLabel: labelForRound(tdata, round),
      roundStage: stageForRound(tdata, round)
    };
    if (hasChanges(patch)) patchMatch(patch);
    return setWarning(`Table ${table} not found in round ${round.round}`);
  }

  const heroById = {}, heroByName = {};
  heroes.forEach(h => {
    if (h.gemId && h.hero) heroById[h.gemId] = h.hero;
    if (h.name  && h.hero) heroByName[nameKey(h.name)] = h.hero;
  });

  const ctx = { heroById, heroByName, tdata, young: isYoungFormat(tdata.meta?.format) };

  const [p1, p2] = await Promise.all([
    buildPlayer(pairing.p1, pairing.p1GemId, ctx),
    buildPlayer(pairing.p2, pairing.p2GemId, ctx)
  ]);

  const matchKey = `${round.round}|${table}|${p1.gemId || p1.name}|${p2.gemId || p2.name}`;

  const patch = {
    ...about,
    round:       round.round,
    roundLabel:  labelForRound(tdata, round),
    roundStage:  stageForRound(tdata, round),
    p1, p2, matchKey,
    warning: null
  };

  if (matchKey !== m.matchKey) {
    // other players at the table: new game, reset the counters
    patch.life    = { p1: p1.startLife, p2: p2.startLife };
    patch.start   = { p1: p1.startLife, p2: p2.startLife };
    patch.ended   = false;
    patch.history = [];
  } else {
    // Same match: only fill values still missing (card lookup failed earlier).
    // Never overwrite live counters.
    const start = { ...m.start }, life = { ...m.life };
    for (const [k, p] of [['p1', p1], ['p2', p2]]) {
      if (!Number.isFinite(start[k])) start[k] = p.startLife;
      if (!Number.isFinite(life[k]))  life[k]  = p.startLife;
    }
    patch.start = start;
    patch.life  = life;
  }

  if (!hasChanges(patch)) return getMatch();
  return patchMatch(patch);
}

async function selectMatch({ round, table, followRound }) {
  const patch = { manual: false, resume: null, matchKey: null, lastRound: null, warning: null, ended: false };

  if (table !== undefined) {
    patch.table = table === null || table === '' ? null : parseInt(table, 10) || null;
  }
  if (round !== undefined) {
    patch.round = round === null || round === '' ? null : parseInt(round, 10) || null;
  }
  if (followRound !== undefined) patch.followRound = !!followRound;

  patchMatch(patch);
  return refreshFeatured({ force: true });
}

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function count(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 0;
}

// "3" is round 3, anything else ("Finals", "Showmatch") is shown as typed.
function freeRound(value) {
  const label = text(value, 40);
  const n = /^\d{1,2}$/.test(label) ? parseInt(label, 10) : null;
  return {
    round:       n || null,
    roundLabel:  n ? `Round ${n}` : (label || null),
    roundStage:  null,
    totalRounds: null
  };
}

async function freePlayer(src, prev, format) {
  const given = key => src && src[key] !== undefined;
  const hero  = given('hero') ? (text(src.hero, 80) || null) : (prev?.hero || null);

  let startLife = parseInt(src?.startLife, 10);
  if (!Number.isFinite(startLife) || startLife <= 0) {
    startLife = 0;
    if (hero) {
      try {
        startLife = (await fetchHeroInfo(hero, { young: isYoungFormat(format) })).health || 0;
      } catch {
        // unknown hero name, the default below applies
      }
    }
    if (!startLife) startLife = (hero === prev?.hero && prev?.startLife) || (isYoungFormat(format) ? 20 : 40);
  }

  return {
    name:     given('name') ? text(src.name, 80) : (prev?.name || ''),
    gemId:    '',
    asTyped:  true,
    hero,
    heroInfo: null,
    startLife,
    // a record belongs to the GEM players, never carried over
    wins:     count(src?.wins),
    losses:   count(src?.losses)
  };
}

// Free mode: players, heroes, round and the other texts are typed by hand and
// GEM is left alone until it is switched off again. Only the featured match is
// affected, the boards keep showing the event.
async function setManualMatch(input = {}) {
  const m = getMatch();

  if (!input.enabled) {
    if (!m.manual) return m;
    const back = m.resume || {};
    if (back.table == null) return patchMatch({ ...clearFields(), manual: false, resume: null });
    // The typed players go at once, even if GEM cannot be reached right now.
    patchMatch({
      ...clearFields(), manual: false, resume: null, eventId: m.eventId,
      table: back.table, round: back.round ?? null, followRound: back.followRound !== false
    });
    return refreshFeatured({ force: true });
  }

  const format = input.format !== undefined ? (text(input.format, 40) || null) : m.format;
  const [p1, p2] = await Promise.all([
    freePlayer(input.p1, m.manual ? m.p1 : null, format),
    freePlayer(input.p2, m.manual ? m.p2 : null, format)
  ]);

  const patch = {
    manual: true, matchKey: null, warning: null, ended: false,
    // first switch only: what to return to
    resume: m.manual ? m.resume : { round: m.round, table: m.table, followRound: m.followRound },
    p1, p2, format,
    start: { p1: p1.startLife, p2: p2.startLife },
    life:  { p1: p1.startLife, p2: p2.startLife },
    history: []
  };

  // A correction during the game (a typo, the round) keeps the counters.
  const same = k => m.manual && m[k]?.hero === patch[k].hero && m.start?.[k] === patch[k].startLife;
  if (same('p1') && same('p2')) {
    patch.life    = m.life;
    patch.history = m.history;
    patch.ended   = m.ended;
  }

  if (input.round !== undefined || !m.manual) Object.assign(patch, freeRound(input.round));
  if (input.table !== undefined || !m.manual) patch.table = count(input.table) || null;
  if (input.eventTitle !== undefined) patch.eventTitle = text(input.eventTitle, 80) || null;
  if (input.swapped !== undefined) patch.swapped = !!input.swapped;

  return patchMatch(patch);
}

// Polls GEM only while a client is connected and a table is selected.
let timer = null;
function startAutoRefresh(hasClients) {
  if (timer) return;
  timer = setInterval(() => {
    if (!hasClients()) return;
    const m = getMatch();
    if (m.manual || m.table == null) return;
    refreshFeatured().catch(err => console.warn('[match] Refresh failed:', err.message));
  }, REFRESH_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  refreshFeatured, selectMatch, setManualMatch, startAutoRefresh,
  tableNum, completedSwissRounds, labelForRound, stageForRound,
  fromOtherEvent, clearFeatured, recordOf
};
