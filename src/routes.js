const express = require('express');
const router = express.Router();
const {
  launchGemLogin, setSessionCookie, checkAuth,
  clearSession, getSession, saveSession, isLoginInProgress, canBrowserLogin
} = require('./auth');
const { fetchTournamentData, fetchHeroesCsv, fetchStandingsCsv, fetchImageProxy, fetchCardByName, fetchHeroImageUrl, fetchAllEvents } = require('./fetcher');
const {
  bus, getSettings, publicSettings, setNameMode, setPin, regeneratePin,
  matchView, adjustLife, setLife, swapSides, undo, setEnded
} = require('./state');
const { refreshFeatured, selectMatch, setManualMatch, startAutoRefresh } = require('./match');
const { lanAddresses } = require('./lan');

// ── access control ───────────────────────────────────────────────────────────
//
// Reading is open: OBS browser sources must never face a prompt, and the
// tournament data is semi-public anyway. Every write — config page and tablet
// alike — needs the PIN. There is deliberately no localhost exemption: it would
// not stop anyone on the venue Wi-Fi, and relying on the source IP breaks the
// moment the server runs in a container behind a bridge.

function isAuthed(req) {
  const { pin, controlToken } = getSettings();
  if (!pin) return true;                       // protection turned off
  const token = req.get('X-Control-Token') || req.query.token || '';
  return !!controlToken && token === controlToken;
}

function requireControl(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(403).json({ error: 'PIN required' });
}

/* Is this request coming from the machine the server runs on?
 *
 * Used only to decide whether the one-click GEM login can be offered — it
 * drives a browser on the *server's* desktop, so from any other computer the
 * window opens somewhere the operator cannot see. This is a usability hint,
 * never an access decision; the PIN is the only thing guarding writes.
 */
function isLocalRequest(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  const ip = raw.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  // Same machine reached through its own LAN address rather than localhost.
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
    // The one-click login needs a desktop browser *and* someone sitting at the
    // machine that browser opens on. Either missing and the config page offers
    // the manual session cookie instead — `browserLoginBlocked` says which.
    canBrowserLogin:     canBrowserLogin() && isLocalRequest(req),
    browserLoginBlocked: !canBrowserLogin() ? 'no-browser'
                       : !isLocalRequest(req) ? 'remote' : null,
    unlocked:            isAuthed(req)
  });
});

// Launch Puppeteer browser for GEM login — runs async, frontend polls /status
router.post('/launch-login', requireControl, (req, res) => {
  if (!canBrowserLogin()) {
    return res.status(501).json({
      error: 'No desktop browser available on the machine running the server — use the manual session cookie instead.'
    });
  }
  // Refusing here rather than opening a window nobody is sitting in front of.
  if (!isLocalRequest(req)) {
    return res.status(409).json({
      error: 'The login window would open on the computer running the server, not on this one — use the manual session cookie instead.'
    });
  }
  if (isLoginInProgress()) return res.json({ success: true, message: 'Already in progress' });

  // Fire and forget — frontend polls /api/status
  launchGemLogin().catch(err => console.error('[auth] Login failed:', err.message));
  res.json({ success: true });
});

// Fallback: manual session cookie paste
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
  res.json({ success: true, eventId: String(eventId).trim() });
});

router.get('/events', async (req, res) => {
  const session = getSession();
  if (!session?.sessionId) return res.status(401).json({ error: 'Not authenticated' });
  const mode = req.query.mode || 'judge'; // 'judge', 'store', 'all'
  try {
    res.json(await fetchAllEvents(mode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tournament', async (req, res) => {
  const session = getSession();
  if (!session?.sessionId) return res.status(401).json({ error: 'Not authenticated' });
  const eventId = req.query.eventId || session.eventId;
  if (!eventId) return res.status(400).json({ error: 'No event ID configured' });
  try {
    res.json(await fetchTournamentData(eventId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/heroes', async (req, res) => {
  const session = getSession();
  if (!session?.sessionId) return res.status(401).json({ error: 'Not authenticated' });
  const eventId = req.query.eventId || session.eventId;
  if (!eventId) return res.status(400).json({ error: 'No event ID configured' });
  try {
    res.json(await fetchHeroesCsv(eventId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/standings', async (req, res) => {
  const session = getSession();
  if (!session?.sessionId) return res.status(401).json({ error: 'Not authenticated' });
  const eventId = req.query.eventId || session.eventId;
  if (!eventId) return res.status(400).json({ error: 'No event ID configured' });
  try {
    res.json(await fetchStandingsCsv(eventId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convenience: card lookup + image proxy in one request — use as <img src="/api/hero-image?name=Fai">
// &young=1 picks the Blitz/Limited printing; without it the adult hero wins.
router.get('/hero-image', async (req, res) => {
  const { name, young } = req.query;
  if (!name) return res.status(400).json({ error: 'name param required' });
  try {
    const imageUrl = await fetchHeroImageUrl(name, { young: young === '1' || young === 'true' });
    const imgRes   = await fetchImageProxy(imageUrl);
    res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    imgRes.body.pipe(res);
  } catch (err) {
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

// ── FEATURED MATCH / LIFE COUNTER ────────────────────────────────────────────

// A 4-digit PIN is only 10 000 combinations, so unlock attempts are throttled.
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
  // The PIN and the tablet addresses are only handed out once unlocked.
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
    res.json({ success: true, ...publicSettings() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Changing the PIN requires the current one. Locked yourself out? The server
// prints the PIN on every start (`docker logs` in the container variant).
router.post('/settings/pin', requireControl, (req, res) => {
  try {
    const s = req.body?.regenerate ? regeneratePin() : setPin(req.body?.pin ?? null);
    res.json({ success: true, pin: s.pin || '', pinRequired: !!s.pin });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── SSE: one stream carries both match and settings updates ──────────────────

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
  bus.on('match', onMatch);
  bus.on('settings', onSettings);

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    bus.off('match', onMatch);
    bus.off('settings', onSettings);
    liveClients.delete(res);
  });

  // A newly opened overlay should not wait for the next background tick.
  refreshFeatured().catch(() => {});
});

// GEM is only polled while at least one overlay or tablet is watching.
startAutoRefresh(() => liveClients.size > 0);

// ── match state ──────────────────────────────────────────────────────────────

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

// { ended: true } after a player hits 0 and the operator confirms; { ended: false }
// hides the round overlay again.
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
