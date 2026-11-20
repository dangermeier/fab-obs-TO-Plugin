const express = require('express');
const router = express.Router();
const {
  launchGemLogin, setSessionCookie, checkAuth,
  clearSession, getSession, saveSession, isLoginInProgress, canBrowserLogin
} = require('./auth');
const {
  fetchTournamentData, fetchHeroesCsv, fetchStandingsCsv, fetchCardByName, fetchHeroImage,
  fetchAllEvents, searchCards, unknownHeroes
} = require('./fetcher');
const {
  bus, getSettings, publicSettings, setNameMode, setLang, setTheme, setPin, regeneratePin,
  matchView, adjustLife, setLife, swapSides, undo, setEnded, setCard, recentCards
} = require('./state');
const { refreshFeatured, selectMatch, setManualMatch, startAutoRefresh } = require('./match');
const { lanAddresses } = require('./lan');
const demo = require('./demo');

// --- access control ---
// Reads are open (OBS browser sources cannot answer a prompt). Every write
// needs the PIN. No localhost exemption on purpose: source IPs are useless
// behind a container bridge.

function isAuthed(req) {
  const { pin, controlToken } = getSettings();
  if (!pin) return true;                       // PIN disabled
  const token = req.get('X-Control-Token') || req.query.token || '';
  return !!controlToken && token === controlToken;
}

function requireControl(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(403).json({ error: 'PIN required' });
}

// Only decides whether the one-click GEM login is offered (the browser opens
// on the server's desktop). Not an access check, that is the PIN.
function isLocalRequest(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  const ip = raw.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  // same machine via its own LAN address
  return lanAddresses().some(e => e.address === ip);
}

router.get('/status', async (req, res) => {
  const session      = getSession();
  const authenticated = session?.sessionId ? await checkAuth() : false;
  res.json({
    authenticated,
    email:           session?.email   || null,
    eventId:         session?.eventId || null,
    loginInProgress: isLoginInProgress(),
    // Needs a desktop browser and a local request. browserLoginBlocked says
    // which one is missing.
    canBrowserLogin:     canBrowserLogin() && isLocalRequest(req),
    browserLoginBlocked: !canBrowserLogin() ? 'no-browser'
                       : !isLocalRequest(req) ? 'remote' : null,
    unlocked:            isAuthed(req)
  });
});

router.post('/launch-login', requireControl, (req, res) => {
  if (!canBrowserLogin()) {
    return res.status(501).json({
      error: 'No desktop browser available on the machine running the server — use the manual session cookie instead.'
    });
  }
  if (!isLocalRequest(req)) {
    return res.status(409).json({
      error: 'The login window would open on the computer running the server, not on this one — use the manual session cookie instead.'
    });
  }
  if (isLoginInProgress()) return res.json({ success: true, message: 'Already in progress' });

  // not awaited, the frontend polls /api/status
  launchGemLogin().catch(err => console.error('[auth] Login failed:', err.message));
  res.json({ success: true });
});

// fallback: pasted session cookie
router.post('/login', requireControl, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });
  try {
    await setSessionCookie(sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.post('/logout', requireControl, (req, res) => {
  clearSession();
  res.json({ success: true });
});

router.post('/event', requireControl, (req, res) => {
  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ error: 'Event ID required' });
  const session = getSession();
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  saveSession({ ...session, eventId: String(eventId).trim() });
  eventChanged();
  res.json({ success: true, eventId: String(eventId).trim() });
});

// Overlays reload now instead of on their next poll.
function eventChanged() {
  refreshFeatured({ force: true }).catch(() => {});
  bus.emit('refresh');
}

// --- demo tournament ---
// See src/demo.js. "on" selects event id "demo" and remembers the real one,
// "off" restores it. Refused unless DEMO_MODE=on.

function demoState() {
  if (!demo.enabled()) return { enabled: false, active: false };
  return { enabled: true, active: demo.isDemo(getSession()?.eventId), ...demo.info() };
}

router.get('/demo', (req, res) => res.json(demoState()));

router.post('/demo', requireControl, (req, res) => {
  if (!demo.enabled()) {
    return res.status(403).json({ error: 'Demo mode is switched off. Start the server with DEMO_MODE=on to use it.' });
  }
  const { action, stage } = req.body || {};
  const session = getSession() || {};

  try {
    switch (action) {
      case 'on':
        if (!demo.isDemo(session.eventId)) {
          saveSession({ ...session, eventId: demo.DEMO_ID, demoPrevEventId: session.eventId || null });
        }
        break;
      case 'off': {
        if (demo.isDemo(session.eventId)) {
          const { demoPrevEventId, ...rest } = session;
          saveSession({ ...rest, eventId: demoPrevEventId || null });
        }
        break;
      }
      case 'results': demo.reportResults(); break;
      case 'finish':  demo.finishRound();   break;
      case 'next':    demo.nextRound();     break;
      case 'goto':    demo.goTo(stage);     break;
      case 'reset':   demo.reset();         break;
      default: return res.status(400).json({ error: 'Unknown demo action' });
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  eventChanged();
  res.json(demoState());
});

router.get('/events', async (req, res) => {
  const session = getSession();
  if (!session?.sessionId) return res.status(401).json({ error: 'Not authenticated' });
  // unknown mode would end up as 'all', which scrapes both and is slow
  const mode = ['judge', 'store', 'all'].includes(req.query.mode) ? req.query.mode : 'judge';
  try {
    res.json(await fetchAllEvents(mode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Polled by the config page. Empty overlays usually mean the event is not
// paired yet, this makes that visible. Uses the cached scrape, no extra GEM traffic.
router.get('/event/summary', async (req, res) => {
  const session = getSession();
  const eventId = req.query.eventId || session?.eventId || null;

  const base = { eventId, ok: false, reason: null };
  if (!demo.isDemo(eventId)) {
    if (!session?.sessionId) return res.json({ ...base, reason: 'not-logged-in' });
    if (!eventId)            return res.json({ ...base, reason: 'no-event' });
  }

  try {
    const t = await fetchTournamentData(eventId);
    const rounds  = t.rounds || [];
    const last    = rounds[rounds.length - 1] || null;
    const tables  = rounds.reduce((n, r) => n + (r.total || 0), 0);
    const heroes  = await fetchHeroesCsv(eventId).catch(() => []);

    res.json({
      eventId,
      ok: true,
      reason: null,
      demo:        demo.isDemo(eventId),
      title:       t.meta?.title  ?? null,
      status:      t.meta?.status ?? null,
      type:        t.meta?.type   ?? null,
      format:      t.meta?.format ?? null,
      playerCount: t.meta?.playerCount ?? 0,
      totalRounds: t.meta?.totalRounds ?? null,
      roundsSeen:  rounds.length,
      currentRound: last ? last.round : 0,
      tables,
      heroesSet:     heroes.filter(h => h.hero).length,
      unknownHeroes: await unknownHeroes(heroes.map(h => h.hero)).catch(() => []),
      hasData: rounds.length > 0 && tables > 0
    });
  } catch (err) {
    res.json({ ...base, reason: 'fetch-failed', error: err.message });
  }
});

// Returns null after sending the error. Demo works without a GEM session.
function eventFor(req, res) {
  const session = getSession();
  const eventId = req.query.eventId || session?.eventId;
  if (demo.isDemo(eventId)) return eventId;
  if (demo.isDemoId(eventId)) { res.status(404).json({ error: 'Demo mode is switched off' }); return null; }

  if (!session?.sessionId) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  if (!eventId)            { res.status(400).json({ error: 'No event ID configured' }); return null; }
  return eventId;
}

for (const [path, load] of [
  ['/tournament', fetchTournamentData],
  ['/heroes',     fetchHeroesCsv],
  ['/standings',  fetchStandingsCsv]
]) {
  router.get(path, async (req, res) => {
    const eventId = eventFor(req, res);
    if (!eventId) return;
    try {
      res.json(await load(eventId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// Card lookup + image proxy, e.g. <img src="/api/hero-image?name=Fai">
// &young=1 picks the Blitz/Limited printing, default is the adult hero.
router.get('/hero-image', async (req, res) => {
  const { name, young } = req.query;
  if (!name) return res.status(400).json({ error: 'name param required' });
  try {
    const img = await fetchHeroImage(name, { young: young === '1' || young === 'true' });
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(img.buffer);
  } catch (err) {
    // no-store: the overlay retries and the next try may work
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send('');
  }
});

router.get('/card', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name param required' });
  try {
    res.json(await fetchCardByName(name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- card on show ---
// The shown card is part of the match state, so overlays get it over SSE.

router.get('/cards/search', async (req, res) => {
  try {
    res.json(await searchCards(req.query.q));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/cards/recent', (req, res) => res.json(recentCards()));

router.post('/card/show', requireControl, (req, res) => {
  try {
    setCard(req.body || {});
    res.json({ success: true, match: matchView() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/card/clear', requireControl, (req, res) => {
  setCard(null);
  res.json({ success: true, match: matchView() });
});

// --- featured match / life counter ---

// 4-digit PIN = 10 000 combinations, so throttle the attempts.
const authAttempts = new Map(); // ip -> { count, until }
const AUTH_MAX_TRIES = 5;
const AUTH_LOCKOUT   = 30 * 1000;

router.post('/control/auth', (req, res) => {
  const ip  = req.ip || 'unknown';
  const now = Date.now();
  let rec   = authAttempts.get(ip);

  if (rec?.until && rec.until > now) {
    return res.status(429).json({ error: `Too many attempts — wait ${Math.ceil((rec.until - now) / 1000)}s` });
  }
  if (rec?.until && rec.until <= now) { authAttempts.delete(ip); rec = null; }

  const { pin, controlToken } = getSettings();
  if (!pin) return res.json({ success: true, token: null, pinRequired: false });

  if (String(req.body?.pin ?? '').trim() !== pin) {
    const count = (rec?.count || 0) + 1;
    authAttempts.set(ip, { count, until: count >= AUTH_MAX_TRIES ? now + AUTH_LOCKOUT : 0 });
    return res.status(401).json({ error: 'Wrong PIN' });
  }

  authAttempts.delete(ip);
  res.json({ success: true, token: controlToken, pinRequired: true });
});

router.get('/settings', (req, res) => {
  // PIN and tablet addresses only when unlocked
  if (!isAuthed(req)) return res.json(publicSettings());

  const full = getSettings();
  const port = req.socket?.localPort || process.env.PORT || 3000;
  res.json({
    ...publicSettings(),
    pin: full.pin || '',
    lanUrls: lanAddresses(port).map(e => ({
      url: e.url, adapter: e.name, virtual: e.virtual
    }))
  });
});

router.post('/settings', requireControl, (req, res) => {
  try {
    if (req.body?.nameMode !== undefined) setNameMode(req.body.nameMode);
    if (req.body?.lang     !== undefined) setLang(req.body.lang);
    if (req.body?.theme    !== undefined) setTheme(req.body.theme);
    res.json({ success: true, ...publicSettings() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Needs the current PIN. Locked out: the server prints it on every start
// (`docker logs` in a container).
router.post('/settings/pin', requireControl, (req, res) => {
  try {
    const s = req.body?.regenerate ? regeneratePin() : setPin(req.body?.pin ?? null);
    res.json({ success: true, pin: s.pin || '', pinRequired: !!s.pin });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- SSE: one stream for match and settings updates ---

const liveClients = new Set();

router.get('/live', (req, res) => {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream; charset=utf-8',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (res.flushHeaders) res.flushHeaders();
  res.setTimeout?.(0);
  req.socket?.setNoDelay?.(true);
  res.write('retry: 2000\n\n');

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  liveClients.add(res);
  send('match', matchView());
  send('settings', publicSettings());

  const onMatch    = m => send('match', m);
  const onSettings = s => send('settings', s);
  const onRefresh  = () => send('refresh', {});
  bus.on('match', onMatch);
  bus.on('settings', onSettings);
  bus.on('refresh', onRefresh);

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    bus.off('match', onMatch);
    bus.off('settings', onSettings);
    bus.off('refresh', onRefresh);
    liveClients.delete(res);
  });

  // don't make a new overlay wait for the next tick
  refreshFeatured().catch(() => {});
});

// GEM is polled only while a client is connected.
startAutoRefresh(() => liveClients.size > 0);

// --- match state ---

router.get('/match', async (req, res) => {
  if (req.query.refresh === '1') {
    try { await refreshFeatured({ force: true }); } catch {}
  }
  res.json(matchView());
});

function respond(res, fn) {
  try {
    fn();
    res.json({ success: true, match: matchView() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post('/match/select', requireControl, async (req, res) => {
  try {
    await selectMatch(req.body || {});
    res.json({ success: true, match: matchView() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// { player: 'p1'|'p2', delta: -3 }  or  { player, value: 37 }
router.post('/match/life', requireControl, (req, res) => {
  const { player, delta, value } = req.body || {};
  respond(res, () => {
    if (value !== undefined && value !== null) setLife(player, value);
    else adjustLife(player, delta);
  });
});

router.post('/match/swap', requireControl, (req, res) => respond(res, () => swapSides()));
router.post('/match/undo', requireControl, (req, res) => respond(res, () => undo()));

// { ended: true } once the operator confirms the result, false hides the round overlay again
router.post('/match/end', requireControl, (req, res) => {
  const { ended } = req.body || {};
  respond(res, () => setEnded(ended === undefined ? true : ended));
});

router.post('/match/manual', requireControl, async (req, res) => {
  try {
    await setManualMatch(req.body || {});
    res.json({ success: true, match: matchView() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
