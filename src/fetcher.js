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

/* GEM answers an expired cookie with a redirect to its login page. node-fetch
 * follows it, so what comes back is a 200 that parses as an event with no
 * rounds — every overlay would quietly go blank instead of saying why.
 */
function assertSession(res) {
  if (res.redirected && /\/(accounts|login|signup)\b/i.test(res.url)) {
    const err = new Error('GEM session expired — log in again on the config page');
    err.sessionExpired = true;
    throw err;
  }
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

// The demo event is served from memory and never cached: it changes the
// moment someone presses a button on the config page.
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

/* Card search for the operator's card page: every card whose name contains
 * the query, trimmed down to what the page shows and the overlay needs —
 *   { id, name, color, pitch, typeText, thumb, images: [url, …] }
 * Each pitch colour is its own entry.
 *
 * Two sources. The publisher's own card database comes first: it has every
 * card from the day it is revealed, and a picture for each. Its API is the
 * one behind cards.fabtcg.com and is not a documented, promised interface —
 * so if it fails or finds nothing, the community database (GoAgain) answers
 * instead.
 */
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
    .filter(c => !/^[A-Z]{2}_/.test(c.print_id || ''))        // FR_, JA_, … translations
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

/* Every artwork URL of a card, best candidate first.
 *
 * The card database lists several printings per hero, hosted in different
 * places, and not all of those hosts are alive — one CDN that many "large"
 * images point at no longer resolves at all. So this is a list to try in
 * order, never a single pick.
 */
const CARD_IMAGES = 'https://legendstory-production-s3-public.s3.amazonaws.com/media/cards';

function printingImageUrls(card) {
  const listed = (card.printings || []).map(p => p.image_url).filter(Boolean)
    // One CDN the database still points at is gone; the very same files are
    // on the publisher's own bucket.
    .map(u => u.replace(/^https:\/\/[a-z0-9]+\.cloudfront\.net\/media\/cards\//i, CARD_IMAGES + '/'));

  // The publisher's bucket names its scans after the printing id, so every
  // printing yields one more candidate even where the database lists only
  // dead links (which is how a card ends up with no picture at all).
  const derived = (card.printings || []).map(p => p.id).filter(Boolean)
    .map(id => `${CARD_IMAGES}/large/${encodeURIComponent(id)}.webp`);

  const urls = [...new Set([...listed, ...derived])];
  /* Two things decide the order.
   *
   * Which printing: the regular one from a booster set or a deck first. The
   * others look different on stream — History Pack reprints (1HP, 2HP) have a
   * white border, promos (HER, WIN, FAB, LGS, JDG, LSS …) and the foil,
   * extended- and alternate-art variants (-RF, -EA, -MV, _MARVEL …) have
   * their own frames — so two hero cards side by side would not match.
   *
   * Which file of it:
   *   0  /cards/large/  small, clean scans — what the portrait crop was tuned on
   *   1  /cardfaces/    clean too, but several hundred kB each
   *   2  anything else  e.g. the "width-450" renditions, which carry a white margin
   */
  const file    = u => decodeURIComponent(u.split('/').pop().replace(/\.[a-z0-9]+$/i, ''));
  const special = u => /\/promos?\//i.test(u) ||
                       /^(1HP|2HP|HER|WIN|FAB|LGS|JDG|LSS|OXO|XXX)\d/i.test(file(u)) ||
                       /[-_](RF|CF|GF|MV|EA|AA|FA|V\d|MARVEL)\b/i.test(file(u));
  const host    = u => (/\/cards\/large\//i.test(u) ? 0 : /\/cardfaces\//i.test(u) ? 1 : 2);
  const rank    = u => (/_BACK\b/i.test(file(u)) ? 100 : 0) + (special(u) ? 10 : 0) + host(u);
  return urls.sort((a, b) => rank(a) - rank(b));
}

/* Names the card database does not know (a typo in GEM, a brand-new set).
 * Remembered for a while, because every overlay asks again for the same
 * portrait on each refresh. Network failures are not remembered — those
 * should heal on the next try.
 */
const HERO_MISS_TTL = 10 * 60 * 1000;
const heroMisses = new Map(); // key -> timestamp

// Hero stats + artwork in one lookup. `health` is the life counter's start value.
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

/* The portrait itself, as bytes: { buffer, contentType }.
 *
 * Walks the candidate URLs until one actually delivers an image, and keeps
 * the result in memory for the day. A 128-player board asks for the same two
 * dozen portraits hundreds of times; without this each of those would be a
 * fresh download from the artwork host.
 */
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
        lastError = err;       // dead host, missing file — try the next printing
      }
    }
    throw lastError;
  });
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
  fetchCardByName, fetchHeroImage, fetchAllEvents,
  fetchHeroInfo, isYoungFormat, searchCards
};
