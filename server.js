const express = require('express');
const path = require('path');
const { loadSession, canBrowserLogin } = require('./src/auth');
const { loadState, flushMatch } = require('./src/state');
const { lanAddresses, needsPublicHost } = require('./src/lan');
const routes = require('./src/routes');

const PORT = process.env.PORT || 3000;
// Bind to every interface so a tablet on the same network can reach the control
// page. Set HOST=127.0.0.1 to go back to local-only.
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', routes);

app.get('/', (req, res) => res.redirect('/config/'));

// Loaded before the socket opens so the very first request already sees the
// saved session and the PIN guard.
const session = loadSession();
const { settings } = loadState();

app.listen(PORT, HOST, () => {
  const lan = HOST === '127.0.0.1' ? [] : lanAddresses(PORT);

  console.log('');
  console.log('  FAB OBS TO Plugin');
  console.log('  ==================');
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log('');

  if (session?.sessionId) {
    console.log(`  Logged in as: ${session.email || 'unknown'}`);
    console.log(`  Event ID:     ${session.eventId || '(not set)'}`);
  } else {
    console.log('  No saved session — please log in via the config page.');
  }

  console.log('');
  console.log('  Config page:  http://localhost:' + PORT + '/config/');
  console.log('  Pairings:     http://localhost:' + PORT + '/overlays/pairings.html');
  console.log('  Standings:    http://localhost:' + PORT + '/overlays/standings.html');
  console.log('  Bracket:      http://localhost:' + PORT + '/overlays/bracket.html');
  console.log('  Breakdown:    http://localhost:' + PORT + '/overlays/breakdown.html');
  console.log('  Match:        http://localhost:' + PORT + '/overlays/match.html');
  console.log('  Life:         http://localhost:' + PORT + '/overlays/life.html');
  console.log('  Round status: http://localhost:' + PORT + '/overlays/round.html');
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

  // The PIN now gates the config page too, so it belongs in the banner
  // regardless of whether a tablet address was found.
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

// Life totals are written to disk with a short debounce — make sure the last
// taps survive a Ctrl+C mid-round.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushMatch(); process.exit(0); });
}
