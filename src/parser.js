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

function parseTournamentHtml(html, eventId) {
  const result = { eventId, rounds: [], players: [], meta: {} };

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

  // Players list
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

  // Rounds
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
        p1:       p1M ? p1M[1].trim() : p1raw,
        p1GemId:  p1M ? p1M[2] : '',
        p2:       p2M ? p2M[1].trim() : p2raw,
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

function parseStandingsCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const standings = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    standings.push({
      rank:   parseInt(parts[0]) || i,
      name:   parts[1].trim(),
      gemId:  parts[2].trim(),
      wins:   parseInt(parts[3]) || 0,
      losses: parseInt(parts[4]) || 0
    });
  }
  return standings.sort((a, b) => a.rank - b.rank);
}

function parseHeroesCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const heroes = [];

  function parseLine(line) {
    const fields = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { fields.push(cur); cur = ''; continue; }
      cur += ch;
    }
    fields.push(cur);
    return fields;
  }

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const parts = parseLine(lines[i]);
    const name   = (parts[0] || '').trim();
    const gemId  = (parts[1] || '').trim();
    const heroRaw = (parts[3] || '').trim();
    const hero   = heroRaw.replace(/\s*\([A-Z]{1,4}\)\s*$/, '').trim();
    if (name) heroes.push({ name, gemId, hero });
  }
  return heroes;
}

// ── EVENT LIST PARSING ────────────────────────────────────────────────────────

function findMaxPage(html) {
  const matches = [...html.matchAll(/[?&]page=(\d+)/g)];
  return matches.length ? Math.max(...matches.map(m => parseInt(m[1]))) : 1;
}

// Parse profile history HTML — returns only judge/scorekeeper events
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

    events.push({ id: eventId, title, dateText, status: isActive ? 'active' : 'past', role, runUrl, eventType, format });
  }
  return events;
}

// Parse store tournament listing HTML — marks all as 'store-owner'
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

    const knownFormats = ['Classic Constructed', 'Silver Age', 'Sealed Deck', 'Blitz', 'Draft'];
    const monthRe = /January|February|March|April|May|June|July|August|September|October|November|December/;
    let dateText = '', eventType = null, format = null;
    for (const s of metaSpans) {
      if (!dateText && (monthRe.test(s) || /\d{4}/.test(s))) { dateText = s; continue; }
      if (!format && knownFormats.some(f => s.includes(f)))   { format = s; continue; }
      if (!eventType && s.length > 3 && !s.match(/^\d/))      eventType = s;
    }

    const runM   = block.match(/href="(\/gem\/\d+\/run\/)"/);
    const runUrl = runM ? runM[1] : null;

    events.push({ id, title, dateText, status, role: 'store-owner', runUrl, eventType, format });
  }
  return events;
}

module.exports = {
  parseTournamentHtml, parseStandingsCsv, parseHeroesCsv,
  parseProfileEventsFromHtml, parseStoreEventsFromHtml, findMaxPage
};
