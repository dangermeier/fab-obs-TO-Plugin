const fetch = require('node-fetch');
const { getCookieHeader } = require('./auth');
const {
  parseTournamentHtml, parseHeroesCsv, parseStandingsCsv,
  parseProfileEventsFromHtml, parseStoreEventsFromHtml, findMaxPage
} = require('./parser');

const demo = require('./demo');

const GEM_BASE = 'https://gem.fabtcg.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function gemFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { Cookie: getCookieHeader(), Accept: 'text/html', ...opts.headers }
  });
}

// Expired cookie: GEM redirects to its login page and node-fetch follows, so
// we get a 200 that parses as an event with no rounds. Catch it here.
function assertSession(res) {
  if (res.redirected && /\/(accounts|login|signup)\b/i.test(res.url)) {
    const err = new Error('GEM session expired — log in again on the config page');
    err.sessionExpired = true;
    throw err;
  }
}

// --- short-lived cache + single-flight ---
// All overlays, the control page and the match refresh want the same three
// GEM pages. Scrape once.

const GEM_TTL  = 15 * 1000;
const HERO_TTL = 24 * 60 * 60 * 1000;

const cache    = new Map(); // key -> { ts, data }
const inFlight = new Map(); // key -> Promise

function cached(key, ttl, producer, force = false) {
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data);
  }
  const running = inFlight.get(key);
  if (running) return running;

  const p = producer()
    .then(data => { cache.set(key, { ts: Date.now(), data }); return data; })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

// Demo data is never cached, it changes on every button press in the config page.
async function fetchTournamentData(eventId, { force = false } = {}) {
  if (demo.isDemo(eventId)) return demo.tournament();
  return cached(`tournament:${eventId}`, GEM_TTL, async () => {
    const res = await gemFetch(`${GEM_BASE}/gem/${eventId}/run/`);
    assertSession(res);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseTournamentHtml(await res.text(), eventId);
  }, force);
}

async function fetchHeroesCsv(eventId, { force = false } = {}) {
  if (demo.isDemo(eventId)) return demo.heroes();
  return cached(`heroes:${eventId}`, GEM_TTL, async () => {
    const res = await gemFetch(`${GEM_BASE}/gem/${eventId}/coverage/heroes`);
    assertSession(res);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseHeroesCsv(await res.text());
  }, force);
}

async function fetchStandingsCsv(eventId, { force = false } = {}) {
  if (demo.isDemo(eventId)) return demo.standings();
  return cached(`standings:${eventId}`, GEM_TTL, async () => {
    const res = await gemFetch(`${GEM_BASE}/gem/${eventId}/coverage/standings`);
    assertSession(res);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseStandingsCsv(await res.text());
  }, force);
}

async function fetchCardByName(name) {
  const res = await fetch(`https://api.goagain.dev/v1/cards?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Card search. Result: { id, name, color, pitch, typeText, thumb, images: [url] },
// one entry per pitch colour.
// Official database first (the API behind cards.fabtcg.com, undocumented, has
// new cards from reveal day). GoAgain is the fallback if it fails or finds nothing.
const OFFICIAL_CARDS = 'https://api.cardvault.fabtcg.com/carddb/api/v1';
const PITCH_COLOR = { 1: 'Red', 2: 'Yellow', 3: 'Blue' };

async function searchOfficialCards(q) {
  const res = await fetch(`${OFFICIAL_CARDS}/advanced-search/?page_size=30&name=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/json' },
    timeout: 8000
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const seen = new Set();
  return (json.results || [])
    .filter(c => !/^[A-Z]{2}_/.test(c.print_id || ''))        // skip translations (FR_, JA_ ...)
    .map(c => {
      const img = c.faces?.[0]?.image || {};
      return {
        id:       c.card_id,
        name:     c.printed_name || '',
        color:    PITCH_COLOR[c.printed_pitch] || '',
        pitch:    c.printed_pitch == null ? '' : String(c.printed_pitch),
        typeText: c.printed_typebox || '',
        thumb:    img.small || img.normal || img.large || null,
        images:   [img.large, img.normal, img.small].filter(Boolean)
      };
    })
    .filter(c => c.id && c.images.length && !seen.has(c.id) && seen.add(c.id));
}

async function searchCommunityCards(q) {
  const res = await fetch(`https://api.goagain.dev/v1/cards?limit=30&name=${encodeURIComponent(q)}`, { timeout: 8000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  return (json.data || []).map(card => {
    const images = printingImageUrls(card).filter(u => !/_BACK\./i.test(u));
    return {
      id:       card.unique_id,
      name:     card.name,
      color:    card.color || '',
      pitch:    card.pitch || '',
      typeText: card.type_text || (card.types || []).join(' '),
      thumb:    images[0] || null,
      images
    };
  }).filter(c => c.images.length);
}

async function searchCards(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  return cached(`cards:${q.toLowerCase()}`, 5 * 60 * 1000, async () => {
    let official = [];
    try {
      official = await searchOfficialCards(q);
    } catch (err) {
      console.warn(`[cards] Official card database failed (${err.message}) — using the community one`);
    }
    if (official.length) return official;

    try {
      return await searchCommunityCards(q);
    } catch (err) {
      throw new Error(`No card database answered (${err.message})`);
    }
  });
}

// Blitz, Draft, Sealed, Commoner: young heroes (20 life). CC and LL: adult.
function isYoungFormat(format) {
  return /blitz|draft|sealed|versiegelt|booster|commoner|limited/i.test(String(format || ''));
}

// GoAgain returns every name match, e.g. "Fai" gives the young and the adult
// hero in arbitrary order. Don't trust data[0].
function pickHeroCard(cards, wantYoung) {
  const heroes = cards.filter(c => (c.types || []).includes('Hero'));
  const pool   = heroes.length ? heroes : cards;
  if (!pool.length) return null;

  const young = pool.filter(c =>  (c.types || []).includes('Young'));
  const adult = pool.filter(c => !(c.types || []).includes('Young'));

  return wantYoung ? (young[0] || adult[0] || pool[0])
                   : (adult[0] || young[0] || pool[0]);
}

// All artwork URLs of a card, best first. Some image hosts in the database
// are dead, so callers try the list in order.
const CARD_IMAGES = 'https://legendstory-production-s3-public.s3.amazonaws.com/media/cards';

function printingImageUrls(card) {
  const listed = (card.printings || []).map(p => p.image_url).filter(Boolean)
    // the cloudfront CDN is gone, same files are on the publisher's bucket
    .map(u => u.replace(/^https:\/\/[a-z0-9]+\.cloudfront\.net\/media\/cards\//i, CARD_IMAGES + '/'));

  // Bucket files are named after the printing id: one extra candidate per
  // printing, for cards where the database only lists dead links.
  const derived = (card.printings || []).map(p => p.id).filter(Boolean)
    .map(id => `${CARD_IMAGES}/large/${encodeURIComponent(id)}.webp`);

  const urls = [...new Set([...listed, ...derived])];
  // Regular printings first: History Pack (white border), promos and
  // foil/alt-art frames would not match the other hero on screen.
  // Then by file: /cards/large/ (the portrait crop is tuned on these),
  // /cardfaces/ (clean but heavy), rest (width-450 has a white margin).
  const file    = u => decodeURIComponent(u.split('/').pop().replace(/\.[a-z0-9]+$/i, ''));
  const special = u => /\/promos?\//i.test(u) ||
                       /^(1HP|2HP|HER|WIN|FAB|LGS|JDG|LSS|OXO|XXX)\d/i.test(file(u)) ||
                       /[-_](RF|CF|GF|MV|EA|AA|FA|V\d|MARVEL)\b/i.test(file(u));
  const host    = u => (/\/cards\/large\//i.test(u) ? 0 : /\/cardfaces\//i.test(u) ? 1 : 2);
  const rank    = u => (/_BACK\b/i.test(file(u)) ? 100 : 0) + (special(u) ? 10 : 0) + host(u);
  return urls.sort((a, b) => rank(a) - rank(b));
}

// Unknown hero names (GEM typo, new set) are remembered for a while, the
// overlays ask again on every refresh. Network errors are not remembered.
const HERO_MISS_TTL = 10 * 60 * 1000;
const heroMisses = new Map(); // key -> timestamp

// `health` is the start value of the life counter.
async function fetchHeroInfo(name, { young = false } = {}) {
  const key = `hero:${String(name).toLowerCase()}|${young ? 'young' : 'adult'}`;

  const missed = heroMisses.get(key);
  if (missed && Date.now() - missed < HERO_MISS_TTL) throw new Error(`No card found for "${name}"`);

  return cached(key, HERO_TTL, async () => {
    const json = await fetchCardByName(name);
    const card = pickHeroCard(json.data || [], young);
    if (!card) {
      heroMisses.set(key, Date.now());
      throw new Error(`No card found for "${name}"`);
    }
    return {
      name:         card.name,
      health:       parseInt(card.health, 10) || null,
      intelligence: parseInt(card.intelligence, 10) || null,
      young:        (card.types || []).includes('Young'),
      types:        card.types || [],
      imageUrls:    printingImageUrls(card)
    };
  });
}

// Portrait bytes: { buffer, contentType }. Tries the candidates until one is
// an image, cached for a day (a big board requests the same portraits a lot).
async function fetchHeroImage(name, { young = false } = {}) {
  const key = `img:${String(name).toLowerCase()}|${young ? 'young' : 'adult'}`;
  return cached(key, HERO_TTL, async () => {
    const info = await fetchHeroInfo(name, { young });
    let lastError = new Error('No image URL');

    for (const url of info.imageUrls) {
      try {
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get('content-type') || 'image/webp';
        if (!/^image\//i.test(contentType)) throw new Error(`not an image (${contentType})`);
        return { buffer: await res.buffer(), contentType };
      } catch (err) {
        lastError = err;       // dead host or missing file, try the next one
      }
    }
    throw lastError;
  });
}

// --- event discovery ---

function sortByStatus(results) {
  const order = { active: 0, upcoming: 1, past: 2 };
  results.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
}

async function fetchJudgeEvents() {
  const results = [];
  const seenIds = new Set();

  function add(events) {
    for (const ev of events) {
      if (!seenIds.has(ev.id)) { results.push(ev); seenIds.add(ev.id); }
    }
  }

  // profile history: judge/scorekeeper events
  try {
    const firstRes  = await gemFetch(`${GEM_BASE}/profile/history/`);
    const firstHtml = await firstRes.text();
    const maxPage   = findMaxPage(firstHtml);
    add(parseProfileEventsFromHtml(firstHtml));

    for (let page = 2; page <= Math.min(maxPage, 20); page++) {
      const html = await gemFetch(`${GEM_BASE}/profile/history/?page=${page}`).then(r => r.text());
      add(parseProfileEventsFromHtml(html));
      await sleep(250);
    }
  } catch (err) {
    console.warn('[events] Profile history fetch failed:', err.message);
  }

  // running events only show up on profile/player
  try {
    const html = await gemFetch(`${GEM_BASE}/profile/player/`).then(r => r.text());
    add(parseProfileEventsFromHtml(html).map(e => ({ ...e, status: 'active' })));
  } catch {}

  sortByStatus(results);
  return results;
}

async function fetchStoreEvents() {
  const results = [];
  const seenIds = new Set();

  function add(events) {
    for (const ev of events) {
      if (!seenIds.has(ev.id)) { results.push(ev); seenIds.add(ev.id); }
    }
  }

  try {
    const storeRes  = await gemFetch(`${GEM_BASE}/store/`);
    console.log('[events] Store page status:', storeRes.status, storeRes.url);
    const storeHtml = await storeRes.text();

    // /store/<slug>/..., slug ends in digits
    const re    = /href="\/store\/([a-z0-9][a-z0-9-]+-\d+)\//gi;
    const slugs = new Set();
    let m;
    while ((m = re.exec(storeHtml)) !== null) slugs.add(m[1].toLowerCase());
    console.log('[events] Found', slugs.size, 'store slugs:', [...slugs]);

    for (const slug of slugs) {
      try {
        console.log('[events] Fetching store:', slug);
        const activeHtml = await gemFetch(`${GEM_BASE}/store/${slug}/tournaments/`).then(r => r.text());
        const activeEvs  = parseStoreEventsFromHtml(activeHtml);
        console.log(`[events]   ${slug}: ${activeEvs.length} active/upcoming`);
        add(activeEvs);
        await sleep(200);

        const histHtml = await gemFetch(`${GEM_BASE}/store/${slug}/tournaments/history/`).then(r => r.text());
        const histEvs  = parseStoreEventsFromHtml(histHtml);
        console.log(`[events]   ${slug}: ${histEvs.length} past`);
        add(histEvs);
        await sleep(200);
      } catch (err) {
        console.warn(`[events] Store ${slug} failed:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[events] Store fetch failed:', err.message);
  }

  sortByStatus(results);
  return results;
}

async function fetchAllEvents(mode = 'judge') {
  if (mode === 'store') return fetchStoreEvents();
  if (mode === 'judge') return fetchJudgeEvents();

  // 'all': merge both
  const [judgeEvs, storeEvs] = await Promise.all([fetchJudgeEvents(), fetchStoreEvents()]);
  const seenIds = new Set();
  const results = [];
  for (const ev of [...judgeEvs, ...storeEvs]) {
    if (!seenIds.has(ev.id)) { results.push(ev); seenIds.add(ev.id); }
  }
  sortByStatus(results);
  return results;
}

module.exports = {
  fetchTournamentData, fetchHeroesCsv, fetchStandingsCsv,
  fetchCardByName, fetchHeroImage, fetchAllEvents,
  fetchHeroInfo, isYoungFormat, searchCards,
  pickHeroCard, printingImageUrls
};
