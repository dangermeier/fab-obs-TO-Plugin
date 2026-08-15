const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR      = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MATCH_FILE    = path.join(DATA_DIR, 'match.json');

// Overlays, the control page and the config UI all subscribe — no listener cap.
const bus = new EventEmitter();
bus.setMaxListeners(0);

const NAME_MODES = ['full', 'short', 'initials'];

// Life can go below zero (overkill damage stays visible) and above the starting
// total (Bravo, Prism and Oldhim all heal past it).
const LIFE_MIN = -50;
const LIFE_MAX = 999;
const HISTORY_MAX = 25;

const DEFAULT_SETTINGS = {
  nameMode:     'short',
  pin:          null,
  controlToken: null
};

const DEFAULT_MATCH = {
  table:       null,
  round:       null,
  followRound: true,   // re-resolve the same table every round
  manual:      false,  // names/heroes entered by hand, GEM is not consulted
  swapped:     false,  // physical seating is mirrored relative to GEM's p1/p2

  p1: null,            // { name, gemId, hero, heroInfo, startLife, wins, losses }
  p2: null,

  life:  { p1: null, p2: null },
  start: { p1: null, p2: null },

  // Set once the operator confirms the match is over — drives the round
  // overlay in OBS. Cleared automatically as soon as a new match loads.
  ended: false,

  history: [],

  matchKey:    null,
  eventTitle:  null,
  format:      null,
  roundLabel:  null,
  totalRounds: null,
  warning:     null,

  rev: 0,
  updatedAt: 0
};

// ── persistence ───────────────────────────────────────────────────────────────

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  } catch (err) {
    console.warn(`[state] Could not read ${path.basename(file)}: ${err.message}`);
  }
  return { ...fallback };
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`[state] Could not write ${path.basename(file)}: ${err.message}`);
  }
}

let settings = { ...DEFAULT_SETTINGS };
let match    = { ...DEFAULT_MATCH };

function randomPin()   { return String(crypto.randomInt(0, 10000)).padStart(4, '0'); }
function randomToken() { return crypto.randomBytes(24).toString('hex'); }

function loadState() {
  settings = readJson(SETTINGS_FILE, DEFAULT_SETTINGS);

  // Keep only keys the current schema knows, so fields from removed features
  // (the old best-of-3 counter) do not linger in the file forever.
  const stored = readJson(MATCH_FILE, DEFAULT_MATCH);
  match = {};
  for (const k of Object.keys(DEFAULT_MATCH)) match[k] = stored[k];
  match.history = (Array.isArray(match.history) ? match.history : [])
    .map(h => ({ life: { ...(h && h.life) } }));

  if (!NAME_MODES.includes(settings.nameMode)) settings.nameMode = DEFAULT_SETTINGS.nameMode;

  // CONTROL_PIN pins the value from the environment — the container variant
  // needs this, because a PIN that only exists inside an ephemeral filesystem
  // would change on every recreate. "off" runs without protection.
  const envPin = (process.env.CONTROL_PIN || '').trim();
  if (envPin) {
    const wanted = /^(off|none|false|0)$/i.test(envPin) ? '' : envPin;
    if (wanted && !/^\d{4,8}$/.test(wanted)) {
      console.warn(`[state] CONTROL_PIN must be 4–8 digits or "off" — ignoring "${envPin}"`);
    } else if (settings.pin !== wanted) {
      settings.pin = wanted;
      settings.controlToken = wanted ? randomToken() : null;
    }
  }

  // First run only: hand out a PIN so the control page is protected out of the
  // box. An empty string means protection is off on purpose — null/undefined
  // means we have never generated one.
  if (settings.pin == null) {
    settings.pin = randomPin();
    settings.controlToken = randomToken();
  } else if (settings.pin && !settings.controlToken) {
    settings.controlToken = randomToken();
  }
  writeJson(SETTINGS_FILE, settings);

  return { settings, match };
}

// Life taps arrive in bursts, so the file write is debounced while the in-memory
// state and the SSE broadcast stay immediate.
let writeTimer = null;
function persistMatch() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => writeJson(MATCH_FILE, match), 200);
  if (writeTimer.unref) writeTimer.unref();
}

function flushMatch() {
  clearTimeout(writeTimer);
  writeTimer = null;
  writeJson(MATCH_FILE, match);
}

// ── settings ──────────────────────────────────────────────────────────────────

function getSettings() { return settings; }

// The SSE channel is unauthenticated, so the PIN and token never leave here.
function publicSettings() {
  return { nameMode: settings.nameMode, pinRequired: !!settings.pin };
}

function patchSettings(patch) {
  settings = { ...settings, ...patch };
  writeJson(SETTINGS_FILE, settings);
  bus.emit('settings', publicSettings());
  return settings;
}

function setNameMode(mode) {
  if (!NAME_MODES.includes(mode)) throw new Error(`nameMode must be one of ${NAME_MODES.join(', ')}`);
  return patchSettings({ nameMode: mode });
}

// Passing null or '' disables protection and is remembered across restarts.
// Any change invalidates the token, so already-paired tablets must re-enter it.
function setPin(pin) {
  if (pin === null || pin === '') return patchSettings({ pin: '', controlToken: null });
  const clean = String(pin).trim();
  if (!/^\d{4,8}$/.test(clean)) throw new Error('PIN must be 4 to 8 digits');
  return patchSettings({ pin: clean, controlToken: randomToken() });
}

function regeneratePin() { return setPin(randomPin()); }

// ── match state ───────────────────────────────────────────────────────────────

function getMatch() { return match; }

// What clients receive: the undo stack itself is server business, they only
// need to know whether the button should be enabled.
function matchView() {
  const { history, ...rest } = match;
  return { ...rest, canUndo: (history || []).length > 0 };
}

function patchMatch(patch) {
  match = { ...match, ...patch, rev: match.rev + 1, updatedAt: Date.now() };
  persistMatch();
  bus.emit('match', matchView());
  return match;
}

function clampLife(v) { return Math.max(LIFE_MIN, Math.min(LIFE_MAX, Math.trunc(v))); }

function assertPlayer(player) {
  if (player !== 'p1' && player !== 'p2') throw new Error("player must be 'p1' or 'p2'");
}

// Every life mutation pushes an undo snapshot first.
function withUndo(patch) {
  const history = [
    ...(match.history || []),
    { life: { ...match.life } }
  ].slice(-HISTORY_MAX);
  return patchMatch({ ...patch, history });
}

function currentLife(player) {
  const v = match.life?.[player];
  if (Number.isFinite(v)) return v;
  const s = match.start?.[player];
  return Number.isFinite(s) ? s : 0;
}

// Deltas rather than absolute values: two taps can be in flight at once without
// one clobbering the other.
function adjustLife(player, delta) {
  assertPlayer(player);
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) return match;
  return withUndo({ life: { ...match.life, [player]: clampLife(currentLife(player) + d) } });
}

function setLife(player, value) {
  assertPlayer(player);
  const v = Math.trunc(Number(value));
  if (!Number.isFinite(v)) throw new Error('value must be a number');
  return withUndo({ life: { ...match.life, [player]: clampLife(v) } });
}

function swapSides() { return patchMatch({ swapped: !match.swapped }); }

function undo() {
  const history = [...(match.history || [])];
  const prev = history.pop();
  if (!prev) return match;
  return patchMatch({ life: { ...prev.life }, history });
}

// Confirmed by the operator once a player hits 0 — reveals the round overlay.
function setEnded(ended) { return patchMatch({ ended: !!ended }); }

module.exports = {
  bus, loadState, flushMatch,
  getSettings, publicSettings, setNameMode, setPin, regeneratePin,
  getMatch, matchView, patchMatch,
  adjustLife, setLife, swapSides, undo, setEnded
};
