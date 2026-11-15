const { getSession } = require('./auth');
const {
  fetchTournamentData, fetchHeroesCsv, fetchStandingsCsv,
  fetchHeroInfo, isYoungFormat
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
function clearFeatured() {
  return patchMatch({
    table: null, round: null,
    p1: null, p2: null,
    life:  { p1: null, p2: null },
    start: { p1: null, p2: null },
    ended: false, history: [],
    matchKey: null, eventId: null, eventTitle: null, format: null,
    roundLabel: null, roundStage: null, totalRounds: null,
    warning: null
  });
}

function setWarning(msg) {
  const m = getMatch();
  if (m.warning === msg) return m;
  return patchMatch({ warning: msg });
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

  const wins = ctx.winsById[gemId] ?? (key ? ctx.winsByName[key] : undefined) ?? 0;

  return {
    name:      name || '',
    gemId:     gemId || '',
    hero,
    heroInfo,
    startLife: heroInfo?.health || (ctx.young ? 20 : 40),
    wins,
    losses:    Math.max(0, ctx.roundsDone - wins)
  };
}

// Only place where GEM data becomes featured-match state. No failure path may
// touch the life totals.
async function refreshFeatured({ force = false } = {}) {
  const m = getMatch();
  if (m.manual || m.table == null) return m;

  const session = getSession();
  const eventId = session?.eventId;

  // Event changed: clear first, or the old players stay on screen if the new
  // event has no such table or GEM is down.
  if (fromOtherEvent(m, eventId)) return clearFeatured();

  // demo needs no GEM session
  if (!isDemo(eventId)) {
    if (!session?.sessionId) return setWarning('Not logged in to GEM');
    if (!eventId) return setWarning('No event selected');
  }

  let tdata, heroes, standings;
  try {
    [tdata, heroes] = await Promise.all([
      fetchTournamentData(eventId, { force }),
      fetchHeroesCsv(eventId, { force }).catch(() => [])
    ]);
    standings = await fetchStandingsCsv(eventId, { force }).catch(() => []);
  } catch (err) {
    // 4xx from GEM is nearly always an expired session, not an outage
    if (err.sessionExpired) return setWarning(err.message);
    const expired = /HTTP 4\d\d/.test(err.message);
    return setWarning(expired
      ? `GEM rejected the request (${err.message}) — log in again on the config page`
      : `GEM unreachable: ${err.message}`);
  }

  if (fromOtherEvent(m, eventId, tdata.meta?.title)) return clearFeatured();

  // event info, set even if the table is not found
  const about = {
    eventId:     String(eventId),
    eventTitle:  tdata.meta?.title ?? null,
    format:      tdata.meta?.format ?? null,
    totalRounds: tdata.meta?.totalRounds ?? null
  };

  const round = m.followRound
    ? tdata.rounds[tdata.rounds.length - 1]
    : tdata.rounds.find(r => r.round === m.round);

  if (!round) return setWarning(m.followRound ? 'No rounds yet' : `Round ${m.round} not found`);

  const pairing = round.pairings.find(p => tableNum(p) === m.table);
  if (!pairing) {
    const patch = {
      ...about,
      round:      round.round,
      roundLabel: labelForRound(tdata, round),
      roundStage: stageForRound(tdata, round)
    };
    if (hasChanges(patch)) patchMatch(patch);
    return setWarning(`Table ${m.table} not found in round ${round.round}`);
  }

  const heroById = {}, heroByName = {};
  heroes.forEach(h => {
    if (h.gemId && h.hero) heroById[h.gemId] = h.hero;
    if (h.name  && h.hero) heroByName[nameKey(h.name)] = h.hero;
  });

  const winsById = {}, winsByName = {};
  standings.forEach(s => {
    if (s.gemId) winsById[s.gemId] = s.wins || 0;
    if (s.name)  winsByName[nameKey(s.name)] = s.wins || 0;
  });

  const ctx = {
    heroById, heroByName, winsById, winsByName,
    young: isYoungFormat(tdata.meta?.format),
    roundsDone: completedSwissRounds(tdata)
  };

  const [p1, p2] = await Promise.all([
    buildPlayer(pairing.p1, pairing.p1GemId, ctx),
    buildPlayer(pairing.p2, pairing.p2GemId, ctx)
  ]);

  const matchKey = `${round.round}|${m.table}|${p1.gemId || p1.name}|${p2.gemId || p2.name}`;

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
  const patch = { manual: false, matchKey: null, warning: null, ended: false };

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

// Hand-typed names, for when GEM is down or the match is not in the event.
async function setManualMatch({ enabled, p1, p2, swapped }) {
  if (!enabled) {
    patchMatch({ manual: false, matchKey: null });
    return refreshFeatured({ force: true });
  }

  const m = getMatch();

  async function build(src, prev) {
    const hero = src?.hero !== undefined ? (src.hero || null) : (prev?.hero || null);

    let startLife = parseInt(src?.startLife, 10);
    if (!Number.isFinite(startLife) || startLife <= 0) {
      startLife = 0;
      if (hero) {
        try {
          const info = await fetchHeroInfo(hero, { young: isYoungFormat(m.format) });
          startLife = info.health || 0;
        } catch {}
      }
      if (!startLife) startLife = prev?.startLife || 40;
    }

    return {
      name:      src?.name !== undefined ? String(src.name || '') : (prev?.name || ''),
      gemId:     '',
      hero,
      heroInfo:  null,
      startLife,
      wins:      prev?.wins   ?? 0,
      losses:    prev?.losses ?? 0
    };
  }

  const np1 = await build(p1, m.p1);
  const np2 = await build(p2, m.p2);

  const patch = {
    manual: true, matchKey: null, warning: null, ended: false,
    p1: np1, p2: np2,
    start: { p1: np1.startLife, p2: np2.startLife },
    life:  { p1: np1.startLife, p2: np2.startLife },
    history: []
  };
  if (swapped !== undefined) patch.swapped = !!swapped;

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
  fromOtherEvent, clearFeatured
};
