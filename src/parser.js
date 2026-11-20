function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// GEM lists a bye as a player called "None" without an id.
function seatName(name, gemId) {
  return !gemId && /^none$/i.test(name) ? 'Bye' : name;
}

// One "content-card" per round: number, kind, the id its exports are filed
// under, and the match counts where the page prints them.
function parseRoundInfo(html) {
  const info = [];
  html.split(/(?=<div class="content-card">)/).forEach(block => {
    const head = block.match(/<h3[^>]*>\s*(?:Runde|Round)\s+(\d+)\s*(?:\(([^)]*)\))?/);
    if (!head) return;
    const idM  = block.match(/coverage\/results\/(\d+)/);
    const cntM = block.match(/<th>Live<\/th>[\s\S]*?<td><span>(\d+)<\/span><\/td>\s*<td><span>(\d+)<\/span><\/td>\s*<td><span>(\d+)<\/span><\/td>/);
    info.push({
      round:       parseInt(head[1]),
      elimination: /elimination|playoff/i.test(head[2] || ''),
      roundId:     idM ? idM[1] : null,
      live:        cntM ? parseInt(cntM[1]) : null,
      total:       cntM ? parseInt(cntM[3]) : null
    });
  });
  return info.sort((a, b) => a.round - b.round);
}

function parseTournamentHtml(html, eventId) {
  const result = { eventId, rounds: [], roundInfo: parseRoundInfo(html), players: [], meta: {} };

  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (titleM) result.meta.title = stripTags(titleM[1]).trim();

  const statusM = html.match(/Status[\s\S]*?<td>([\s\S]*?)<\/td>/);
  if (statusM) result.meta.status = stripTags(statusM[1]).trim();

  const typeM = html.match(/(?:Typ|Type)[\s\S]*?<td>([\s\S]*?)<\/td>/);
  if (typeM) result.meta.type = stripTags(typeM[1]).trim();

  const formatM = html.match(/Format[\s\S]*?<td>([\s\S]*?)<\/td>/);
  if (formatM) result.meta.format = stripTags(formatM[1]).trim();

  const roundsM = html.match(/(?:Runden|Rounds)[\s\S]*?<td>([\s\S]*?)<\/td>/);
  if (roundsM) result.meta.totalRounds = parseInt(stripTags(roundsM[1]).trim()) || null;

  const playersM = html.match(/(\d+)\s+(?:registrierte Spieler|registered player)/);
  if (playersM) result.meta.playerCount = parseInt(playersM[1]);

  const playerListM = html.match(/(?:Registrierte Spieler|Registered Players?)[\s\S]*?<ol[^>]*>([\s\S]*?)<\/ol>/);
  if (playerListM) {
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let lm;
    while ((lm = liRe.exec(playerListM[1])) !== null) {
      const row = stripTags(lm[1]).replace(/\s+/g, ' ').trim();
      const playerM = row.match(/^(.+?)\s*\((\d+)\)\s*(.*)/);
      if (playerM) {
        const heroRaw = playerM[3].trim();
        result.players.push({
          name: playerM[1].trim(),
          gemId: playerM[2],
          hero: heroRaw ? heroRaw.replace(/\s*\([A-Z]{1,4}\)\s*$/, '').trim() : null
        });
      }
    }
  }

  // one content-card per round
  const roundBlocks = html.split(/(?=<div class="content-card">)/);
  roundBlocks.forEach(block => {
    if (!block.includes('match-row')) return;

    const roundNumM = block.match(/(?:Runde|Round)\s+(\d+)/);
    if (!roundNumM) return;
    const roundNum = parseInt(roundNumM[1]);
    const isElimination = /elimination|playoff/i.test(block.substring(0, 500));

    const liveM = block.match(/Live[\s\S]*?<td><span>(\d+)<\/span>/);

    const pairings = [];
    const matchRowRe = /match-row([\s\S]*?)(?=match-row|btn-group|$)/g;
    let mr;
    while ((mr = matchRowRe.exec(block)) !== null) {
      const cells = [...mr[1].matchAll(/<div[^>]*col-[^>]*py-3[^>]*>([\s\S]*?)<\/div>/g)];
      if (cells.length < 4) continue;
      const table   = cells[0] ? stripTags(cells[0][1]).trim() : '';
      const p1raw   = cells[1] ? stripTags(cells[1][1]).trim() : '';
      const p2raw   = cells[2] ? stripTags(cells[2][1]).trim() : '';
      const resultRaw = cells[3] ? stripTags(cells[3][1]).trim() : '';
      if (!p1raw || !p2raw) continue;

      const p1M = p1raw.match(/^(.+?)\s*\((\d+)\)$/);
      const p2M = p2raw.match(/^(.+?)\s*\((\d+)\)$/);

      const p2Win = resultRaw.toLowerCase().includes('player 2') ||
                    resultRaw.toLowerCase().includes('spieler 2');
      const p1Win = !p2Win && (
        resultRaw.toLowerCase().includes('player 1') ||
        resultRaw.toLowerCase().includes('spieler 1')
      );

      pairings.push({
        table:    parseInt(table.replace(/[^0-9]/g, '')) || table,
        p1:       p1M ? p1M[1].trim() : seatName(p1raw, ''),
        p1GemId:  p1M ? p1M[2] : '',
        p2:       p2M ? p2M[1].trim() : seatName(p2raw, ''),
        p2GemId:  p2M ? p2M[2] : '',
        result:   resultRaw,
        winner:   p2Win ? 'p2' : p1Win ? 'p1' : null,
        done:     !!resultRaw && !resultRaw.toLowerCase().includes('live')
      });
    }

    if (pairings.length > 0) {
      const liveCount = liveM ? parseInt(liveM[1]) : 0;
      result.rounds.push({
        round: roundNum,
        elimination: isElimination,
        live: liveCount,
        done: pairings.length - liveCount,
        total: pairings.length,
        pairings
      });
    }
  });

  result.rounds.sort((a, b) => a.round - b.round);
  result.currentRound = result.rounds.length > 0 ? result.rounds[result.rounds.length - 1].round : 0;
  return result;
}

// RFC 4180 quoting. GEM quotes names with a comma ("Ironsong, Dorinthea") or a
// nickname (`Rhinar, Katsu "Rhino"`), so a plain split(',') is not enough.
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch !== '"') { cur += ch; continue; }
      if (line[i + 1] === '"') { cur += '"'; i++; }   // "" = literal quote
      else inQuote = false;
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// The coverage export of all rounds: Round, Table, Player 1 Name, Player 1 ID,
// Player 2 Name, Player 2 ID, Result (1WIN, 2WIN, DRAW, empty while running).
// The run page leaves the match rows out for large rounds, this file has them.
const RESULT_TEXT = { '1WIN': 'Player 1 Win', '2WIN': 'Player 2 Win', 'DRAW': 'Draw' };

function parsePairingsCsv(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]).map(v => v.trim());
    const round = parseInt(c[0]);
    if (c.length < 7 || !round || !c[2] || !c[4]) continue;
    const code = c[6].toUpperCase();
    rows.push({
      round,
      table:   parseInt(c[1]) || c[1],
      p1:      seatName(c[2], c[3]),
      p1GemId: c[3],
      p2:      seatName(c[4], c[5]),
      p2GemId: c[5],
      result:  RESULT_TEXT[code] || c[6],
      winner:  code.startsWith('1WIN') ? 'p1' : code.startsWith('2WIN') ? 'p2' : null,
      done:    !!code && !/LIVE|PENDING|PROGRESS/.test(code)
    });
  }
  return rows;
}

// Rounds from the export replace what the page had, unless the page shows
// more rows for a round. Round kind and live count come from the page.
function applyPairingsCsv(tdata, rows) {
  const info   = new Map((tdata.roundInfo || []).map(r => [r.round, r]));
  const rounds = new Map(tdata.rounds.map(r => [r.round, r]));

  const byRound = new Map();
  rows.forEach(({ round, ...pairing }) => {
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(pairing);
  });

  for (const [n, pairings] of byRound) {
    const onPage = rounds.get(n);
    if (onPage && onPage.pairings.length > pairings.length) continue;
    pairings.sort((a, b) => (parseInt(a.table) || 0) - (parseInt(b.table) || 0));

    const known = info.get(n);
    const open  = pairings.filter(p => !p.done).length;
    const live  = known && known.live != null && known.total === pairings.length ? known.live : open;
    rounds.set(n, {
      round: n,
      elimination: known ? known.elimination : !!(onPage && onPage.elimination),
      live,
      done: pairings.length - live,
      total: pairings.length,
      pairings
    });
  }

  tdata.rounds = [...rounds.values()].sort((a, b) => a.round - b.round);
  tdata.currentRound = tdata.rounds.length ? tdata.rounds[tdata.rounds.length - 1].round : 0;
  return tdata;
}

// Rank, Name, Player ID, Wins. GEM writes "Dropped" for the rank of a player
// who left, and from the last Swiss round on lists most players twice (ranked
// and dropped). Ranked rows win, players who only appear as dropped follow.
function parseStandingsCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const ranked = [], dropped = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 3) continue;
    const rank = parseInt(parts[0]);
    const row = {
      rank,
      name:   parts[1].trim(),
      gemId:  parts[2].trim(),
      wins:   parseInt(parts[3]) || 0,
      losses: parseInt(parts[4]) || 0
    };
    if (Number.isFinite(rank)) ranked.push(row);
    else dropped.push({ ...row, dropped: true });
  }
  ranked.sort((a, b) => a.rank - b.rank);

  const seen = new Set();
  const out = [];
  for (const row of [...ranked, ...dropped]) {
    const key = row.gemId || row.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.dropped ? { ...row, rank: out.length + 1 } : row);
  }
  return out;
}

function parseHeroesCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const heroes = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const parts = parseCsvLine(lines[i]);
    const name   = (parts[0] || '').trim();
    const gemId  = (parts[1] || '').trim();
    const heroRaw = (parts[3] || '').trim();
    const hero   = heroRaw.replace(/\s*\([A-Z]{1,4}\)\s*$/, '').trim();
    if (name) heroes.push({ name, gemId, hero });
  }
  return heroes;
}

// --- event lists ---

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "Wed Nov. 25th, 2026" -> "2026-11-25", null if there is no date in the text.
function parseEventDate(text) {
  const m = String(text || '').match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// Running first, then upcoming (the next one first), then past (latest first).
// Events without a date keep the order GEM listed them in.
function sortEvents(events) {
  const rank = { active: 0, upcoming: 1 };
  return events
    .map((ev, i) => ({ ev, i }))
    .sort((a, b) => {
      const ra = rank[a.ev.status] ?? 2, rb = rank[b.ev.status] ?? 2;
      if (ra !== rb) return ra - rb;
      if (a.ev.date && b.ev.date && a.ev.date !== b.ev.date) {
        const later = a.ev.date > b.ev.date ? 1 : -1;
        return ra === 2 ? -later : later;
      }
      return a.i - b.i;
    })
    .map(x => x.ev);
}

// The heading of a store's tournament list: "Tournaments for 1A Gamer Lounge".
function parseStoreName(html) {
  const h1 = String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const m  = h1 && stripTags(h1[1]).match(/Tournaments for\s+(.+)/i);
  return m ? m[1].trim() : null;
}

function findMaxPage(html) {
  const matches = [...html.matchAll(/[?&]page=(\d+)/g)];
  return matches.length ? Math.max(...matches.map(m => parseInt(m[1]))) : 1;
}

// Profile history. Judge/scorekeeper events only, player entries are skipped.
function parseProfileEventsFromHtml(html) {
  const events = [];
  const parts = html.split(/<div class="event" id="/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const idMatch = block.match(/^(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const role = block.includes('event__judge-icon') ? 'judge'
               : block.includes('Scorekeeper')        ? 'scorekeeper'
               : 'player';
    if (role === 'player') continue;

    let title = 'Unknown';
    const h4M = block.match(/<h4[^>]*class="event__title"[^>]*>([\s\S]*?)<\/h4>/);
    if (h4M) title = stripTags(h4M[1]).replace(/\s+/g, ' ').trim();

    const isActive = block.includes('event__when--active');
    const dateM    = block.match(/class="event__when[^"]*"[^>]*>\s*([\w.,\s:]+?)\s*<\/div>/);
    const dateText = dateM ? dateM[1].trim() : '';

    const runM   = block.match(/href="(\/gem\/\d+\/run\/)"/);
    const runUrl = runM ? runM[1] : null;
    const eventId = runM ? runM[1].match(/\/gem\/(\d+)\//)?.[1] || id : id;

    const metaM = block.match(/class="event__meta">([\s\S]*?)(?:<div class="btn-group"|<details)/);
    let eventType = null, format = null;
    if (metaM) {
      const spans = [...metaM[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map(m => stripTags(m[1]).trim());
      const knownFormats = ['Classic Constructed', 'Silver Age', 'Sealed Deck', 'Blitz', 'Draft'];
      for (const s of spans) {
        if (!format && knownFormats.some(f => s.includes(f))) { format = s; continue; }
        if (!eventType && s.length > 3 && !s.match(/^\d/)) eventType = s;
      }
    }

    events.push({ id: eventId, title, dateText, date: parseEventDate(dateText), status: isActive ? 'active' : 'past', role, runUrl, eventType, format });
  }
  return events;
}

// Store tournament listing, every event gets role 'store-owner'.
function parseStoreEventsFromHtml(html) {
  const events = [];
  const parts = html.split(/<div class="event" id="/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const idMatch = block.match(/^(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];

    let title = 'Unknown';
    const h4M = block.match(/<h4[^>]*class="event__title"[^>]*>([\s\S]*?)<\/h4>/);
    if (h4M) title = stripTags(h4M[1]).replace(/\s+/g, ' ').trim();

    const whenClass = (block.match(/class="event__when([^"]*)"/)?.[1] || '');
    const status = whenClass.includes('--active')   ? 'active'
                 : whenClass.includes('--upcoming') ? 'upcoming'
                 : 'past';

    const metaM = block.match(/class="event__meta">([\s\S]*?)(?:<div class="btn-group"|<\/div>\s*<\/div>)/);
    const metaSpans = [];
    if (metaM) {
      const spanRe = /<span>([\s\S]*?)<\/span>/g;
      let sm;
      while ((sm = spanRe.exec(metaM[1])) !== null) {
        const t = stripTags(sm[1]).trim();
        if (t) metaSpans.push(t);
      }
    }

    const knownFormats = ['Classic Constructed', 'Silver Age', 'Living Legend', 'Sealed Deck', 'Booster Draft', 'Blitz', 'Commoner', 'Draft'];
    const monthRe = /January|February|March|April|May|June|July|August|September|October|November|December/;
    let dateText = '', eventType = null, format = null;
    const rest = [];
    for (const s of metaSpans) {
      if (!dateText && (monthRe.test(s) || /\d{4}/.test(s))) dateText = s;
      else rest.push(s);
    }
    // "Pro Quest: London (Classic Constructed)" is a type that names a format:
    // the span that is nothing but a format wins.
    const exact = rest.find(s => knownFormats.includes(s));
    for (const s of rest) {
      if (!format && (exact ? s === exact : knownFormats.some(f => s.includes(f)))) { format = s; continue; }
      if (!eventType && s.length > 3 && !s.match(/^\d/)) eventType = s;
    }

    const runM   = block.match(/href="(\/gem\/\d+\/run\/)"/);
    const runUrl = runM ? runM[1] : null;

    events.push({ id, title, dateText, date: parseEventDate(dateText), status, role: 'store-owner', runUrl, eventType, format });
  }
  return events;
}

module.exports = {
  parseTournamentHtml, parseStandingsCsv, parseHeroesCsv,
  parseProfileEventsFromHtml, parseStoreEventsFromHtml, findMaxPage,
  parseEventDate, parseStoreName, sortEvents,
  parseRoundInfo, parsePairingsCsv, applyPairingsCsv
};
