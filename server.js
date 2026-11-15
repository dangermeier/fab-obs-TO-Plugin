// Optional .env next to the server. Real environment variables win.
try { if (process.loadEnvFile && require('fs').existsSync('.env')) process.loadEnvFile('.env'); } catch { /* not fatal */ }

const express = require('express');
const path = require('path');
const { loadSession, saveSession, canBrowserLogin } = require('./src/auth');
const demo = require('./src/demo');
const { loadState, flushMatch } = require('./src/state');
const { lanAddresses, needsPublicHost } = require('./src/lan');
const routes = require('./src/routes');

const PORT = process.env.PORT || 3000;
// All interfaces, so the tablet can reach /control/. HOST=127.0.0.1 for local-only.
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', routes);

app.get('/', (req, res) => res.redirect('/config/'));

// Load before listen(): the first request must already see the session and PIN.
let session = loadSession();
// Demo event still selected but DEMO_MODE is off now: restore the real event.
if (!demo.enabled() && session && demo.isDemoId(session.eventId)) {
  const { demoPrevEventId, ...rest } = session;
  session = { ...rest, eventId: demoPrevEventId || null };
  saveSession(session);
}
const { settings } = loadState();

app.listen(PORT, HOST, () => {
  const lan = HOST === '127.0.0.1' ? [] : lanAddresses(PORT);

  // In a container PORT is the inner port and the published one can differ,
  // so print PUBLIC_HOST when it is set.
  const pub  = (process.env.PUBLIC_HOST || '').trim();
  const base = !pub                         ? `http://localhost:${PORT}`
             : /^https?:\/\//.test(pub)     ? pub.replace(/\/+$/, '')
             : pub.includes(':')            ? `http://${pub}`
                                            : `http://${pub}:${PORT}`;

  console.log('');
  console.log('  FAB OBS TO Plugin');
  console.log('  ==================');
  console.log(`  Running at: ${base}`);
  console.log('');

  if (session?.sessionId) {
    console.log(`  Logged in as: ${session.email || 'unknown'}`);
    console.log(`  Event ID:     ${session.eventId || '(not set)'}`);
  } else {
    console.log('  No saved session — please log in via the config page.');
  }

  console.log('');
  console.log('  Config page:  ' + base + '/config/');
  console.log('  Pairings:     ' + base + '/overlays/pairings.html');
  console.log('  Standings:    ' + base + '/overlays/standings.html');
  console.log('  Bracket:      ' + base + '/overlays/bracket.html');
  console.log('  Breakdown:    ' + base + '/overlays/breakdown.html');
  console.log('  Match:        ' + base + '/overlays/match.html');
  console.log('  Life:         ' + base + '/overlays/life.html');
  console.log('  Round status: ' + base + '/overlays/round.html');
  console.log('  Winner:       ' + base + '/overlays/winner.html?side=left   (or side=right)');
  console.log('');

  if (lan.length) {
    console.log('  ── Life counter for your tablet ────────────────────────');
    lan.forEach(e => {
      const note = e.virtual ? '  (virtual adapter — probably not this one)' : '';
      console.log(`     ${e.url}   [${e.name}]${note}`);
    });
    console.log('');
  } else if (HOST === '127.0.0.1') {
    console.log('  Local-only mode (HOST=127.0.0.1) — the tablet cannot connect.');
    console.log('');
  } else {
    console.log('  No network interface found — the tablet cannot connect yet.');
    console.log('');
  }

  // PIN also guards the config page, so print it even without a tablet address.
  console.log(`  PIN (config page + tablet): ${settings.pin || 'disabled — everyone can change settings'}`);

  if (needsPublicHost()) {
    console.log('');
    console.log('  Running in a container: the addresses above are the container\'s own');
    console.log('  and no tablet can reach them. Set PUBLIC_HOST to the host machine\'s');
    console.log('  LAN address, e.g.  PUBLIC_HOST=192.168.2.10');
  } else if (lan.length && !process.env.FAB_IN_CONTAINER) {
    console.log('');
    console.log('  Windows may ask to allow node.exe through the firewall — say yes');
    console.log('  for private networks. Start with HOST=127.0.0.1 to disable this.');
  }

  if (!canBrowserLogin()) {
    console.log('');
    console.log('  No Chrome/Edge on this machine — the one-click GEM login is');
    console.log('  unavailable. Use the manual session cookie on the config page.');
  }

  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ERROR: Port ${PORT} is already in use.`);
    console.error(`  Is the plugin already running?`);
    console.error(`  Close the other instance and try again.\n`);
  } else {
    console.error('\n  ERROR:', err.message, '\n');
  }
  process.exit(1);
});

// Runs unattended all day: log a stray rejection, don't take the server down.
process.on('unhandledRejection', err => {
  console.error('[server] Unhandled rejection:', err?.stack || err);
});

// Life totals are saved debounced, so flush the last taps on Ctrl+C.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushMatch(); process.exit(0); });
}
