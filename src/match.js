const { getSession } = require('./auth');
const {
  fetchTournamentData, fetchHeroesCsv, fetchStandingsCsv,
  fetchHeroInfo, isYoungFormat
} = require('./fetcher');
const { getMatch, patchMatch } = require('./state');

const ROUND_LABELS = ['Round of 16', 'Quarterfinals', 'Semifinals', 'Finals'];
const REFRESH_MS = 20 * 1000;

// pairing.table is a number when GEM's cell parsed cleanly and the raw string
// otherwise — same normalisation the bracket overlay does.
function tableNum(pairing) {
  if (typeof pairing.table === 'number') return pairing.table;
  return parseInt(String(pairing.table).replace(/\D/g, ''), 10) || null;
}

// Basis for the loss calculation: GEM's standings CSV has no usable loss column.
function completedSwissRounds(tdata) {
  return tdata.rounds.filter(r => !r.elimination && r.total > 0 && r.done >= r.total).length;
}

function labelForRound(tdata, round) {
  if (!round) return null;
  if (!round.elimination) return `Round ${round.round}`;

  const elim  = tdata.rounds.filter(r => r.elimination).sort((a, b) => a.round - b.round);
  const idx   = elim.findIndex(r => r.round === round.round);
  const first = elim[0]?.pairings.length || 0;
  const start = first >= 8 ? 0 : first >= 4 ? 1 : first >= 2 ? 2 : 3;

  return ROUND_LABELS[Math.min(start + idx, ROUND_LABELS.length - 1)] || `Round ${round.round}`;
}

// Only broadcast when something actually differs — a background refresh every
// 20 s must not churn every overlay for identical data.
function hasChanges(patch) {
  const cur = getMatch();
  return Object.keys(patch).some(k => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]));
}

function setWarning(msg) {
  const m = getMatch();
  if (m.warning === msg) return m;
  return patchMatch({ warning: msg });
}

async function buildPlayer(name, gemId, ctx) {
  const hero = ctx.heroById[gemId] || ctx.heroByName[(name || '').toLowerCase()] || null;

  let heroInfo = null;
  if (hero) {
    try {
      heroInfo = await fetchHeroInfo(hero, { young: ctx.young });
    } catch {
      // Hero not in the card database (typo, brand-new set): fall back below.
    }
  }

  const wins = ctx.winsById[gemId] ?? ctx.winsByName[(name || '').toLowerCase()] ?? 0;

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

// The single place GEM data is turned into featured-match state. Every failure
// path leaves life totals untouched — mid-stream that matters more than freshness.
async function refreshFeatured({ force = false } = {}) {
  const m = getMatch();
  if (m.manual || m.table == null) return m;

  const session = getSession();
  if (!session?.sessionId) return setWarning('Not logged in to GEM');

  const eventId = session.eventId;
  if (!eventId) return setWarning('No event selected');

  let tdata, heroes, standings;
  try {
    [tdata, heroes] = await Promise.all([
      fetchTournamentData(eventId, { force }),
      fetchHeroesCsv(eventId, { force }).catch(() => [])
    ]);
    standings = await fetchStandingsCsv(eventId, { force }).catch(() => []);
  } catch (err) {
    // A 4xx here almost always means the GEM session expired rather than the
    // site being down — point the operator at the fix.
    const expired = /HTTP 4\d\d/.test(err.message);
    return setWarning(expired
      ? `GEM rejected the request (${err.message}) — log in again on the config page`
      : `GEM unreachable: ${err.message}`);
  }

  const round = m.followRound
    ? tdata.rounds[tdata.rounds.length - 1]
    : tdata.rounds.find(r => r.round === m.round);

  if (!round) return setWarning(m.followRound ? 'No rounds yet' : `Round ${m.round} not found`);

  const pairing = round.pairings.find(p => tableNum(p) === m.table);
  if (!pairing) {
    const patch = { round: round.round, roundLabel: labelForRound(tdata, round) };
    if (hasChanges(patch)) patchMatch(patch);
    return setWarning(`Table ${m.table} not found in round ${round.round}`);
  }

  const heroById = {}, heroByName = {};
  heroes.forEach(h => {
    if (h.gemId && h.hero) heroById[h.gemId] = h.hero;
    if (h.name  && h.hero) heroByName[h.name.toLowerCase()] = h.hero;
  });

  const winsById = {}, winsByName = {};
  standings.forEach(s => {
    if (s.gemId) winsById[s.gemId] = s.wins || 0;
    if (s.name)  winsByName[s.name.toLowerCase()] = s.wins || 0;
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
    round:       round.round,
    roundLabel:  labelForRound(tdata, round),
    totalRounds: tdata.meta?.totalRounds ?? null,
    eventTitle:  tdata.meta?.title ?? null,
    format:      tdata.meta?.format ?? null,
    p1, p2, matchKey,
    warning: null
  };

  if (matchKey !== m.matchKey) {
    // Different players at the table — new game, fresh counters, and the round
    // overlay from the previous match disappears on its own.
    patch.life    = { p1: p1.startLife, p2: p2.startLife };
    patch.start   = { p1: p1.startLife, p2: p2.startLife };
    patch.ended   = false;
    patch.history = [];
  } else {
    // Same match. Only backfill values that were never resolved — e.g. because
    // the card lookup failed on an earlier pass. Never overwrite live counters.
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

// Escape hatch: run the counter with hand-typed names when GEM is unavailable
// or the match on stream is not in the tournament at all.
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

// Polls GEM only while something is actually watching and a table is selected —
// an idle server makes no requests at all.
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
  refreshFeatured, selectMatch, setManualMatch, startAutoRefresh
};
