const fetch = require('node-fetch');
const { getCookieHeader } = require('./auth');
const {
  parseTournamentHtml, parseHeroesCsv, parseStandingsCsv,
  parseProfileEventsFromHtml, parseStoreEventsFromHtml, findMaxPage
} = require('./parser');

const GEM_BASE = 'https://gem.fabtcg.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function gemFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { Cookie: getCookieHeader(), Accept: 'text/html', ...opts.headers }
  });
}

// ── short-lived cache + single-flight ─────────────────────────────────────────
// Six overlays, the control page and the featured-match refresh all want the
// same three GEM pages. Without this, every one of them scrapes separately.

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

async function fetchTournamentData(eventId, { force = false } = {}) {
  return cached(`tournament:${eventId}`, GEM_TTL, async () => {
    const res = await gemFetch(`${GEM_BASE}/gem/${eventId}/run/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseTournamentHtml(await res.text(), eventId);
  }, force);
}

async function fetchHeroesCsv(eventId, { force = false } = {}) {
  return cached(`heroes:${eventId}`, GEM_TTL, async () => {
    const res = await gemFetch(`${GEM_BASE}/gem/${eventId}/coverage/heroes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseHeroesCsv(await res.text());
  }, force);
}

async function fetchStandingsCsv(eventId, { force = false } = {}) {
  return cached(`standings:${eventId}`, GEM_TTL, async () => {
    const res = await gemFetch(`${GEM_BASE}/gem/${eventId}/coverage/standings`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseStandingsCsv(await res.text());
  }, force);
}

async function fetchImageProxy(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function fetchCardByName(name) {
  const res = await fetch(`https://api.goagain.dev/v1/cards?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Blitz, Draft, Sealed and Commoner are played with young heroes (20 life);
// Classic Constructed and Living Legend use the adult printings.
function isYoungFormat(format) {
  return /blitz|draft|sealed|versiegelt|booster|commoner|limited/i.test(String(format || ''));
}

// GoAgain returns every card matching the name, so "Fai" yields both the young
// hero (20 life, Blitz artwork) and the adult one (40 life, CC artwork). Which
// of the two is data[0] is arbitrary, hence the explicit pick.
function pickHeroCard(cards, wantYoung) {
  const heroes = cards.filter(c => (c.types || []).includes('Hero'));
  const pool   = heroes.length ? heroes : cards;
  if (!pool.length) return null;

  const young = pool.filter(c =>  (c.types || []).includes('Young'));
  const adult = pool.filter(c => !(c.types || []).includes('Young'));

  return wantYoung ? (young[0] || adult[0] || pool[0])
                   : (adult[0] || young[0] || pool[0]);
}

function printingImageUrl(card) {
  const p = card.printings?.find(x => x.image_url?.includes('large'))
         || card.printings?.find(x => x.image_url);
  return p?.image_url || null;
}

// Hero stats + artwork in one lookup. `health` is the life counter's start value.
async function fetchHeroInfo(name, { young = false } = {}) {
  const key = `hero:${String(name).toLowerCase()}|${young ? 'young' : 'adult'}`;
  return cached(key, HERO_TTL, async () => {
    const json = await fetchCardByName(name);
    const card = pickHeroCard(json.data || [], young);
    if (!card) throw new Error(`No card found for "${name}"`);
    return {
      name:         card.name,
      health:       parseInt(card.health, 10) || null,
      intelligence: parseInt(card.intelligence, 10) || null,
      young:        (card.types || []).includes('Young'),
      types:        card.types || [],
      imageUrl:     printingImageUrl(card)
    };
  });
}

async function fetchHeroImageUrl(name, { young = false } = {}) {
  const info = await fetchHeroInfo(name, { young });
  if (!info.imageUrl) throw new Error('No image URL');
  return info.imageUrl;
}

// ── EVENT DISCOVERY ───────────────────────────────────────────────────────────

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

  // Profile history pages — judge/scorekeeper events
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

  // Active events from profile/player (catches currently running events)
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

    // Match /store/slug/anything — slug must end with digits, don't require closing quote immediately after
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

  // mode === 'all': merge both
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
  fetchImageProxy, fetchCardByName, fetchHeroImageUrl, fetchAllEvents,
  fetchHeroInfo, isYoungFormat
};
