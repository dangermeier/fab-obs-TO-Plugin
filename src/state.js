const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { DATA_DIR } = require('./paths');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MATCH_FILE    = path.join(DATA_DIR, 'match.json');

// one listener per SSE client, so no cap
const bus = new EventEmitter();
bus.setMaxListeners(0);

const NAME_MODES = ['full', 'short', 'initials'];
const LANGS      = ['en', 'de'];

// New theme: add an entry here plus a `.theme-<id>` block in
// public/shared/overlay.css. `preview` styles the dropdown entry on the config
// page. Listed in this order, newest set first.
const THEMES = [
  { id: 'mpa',   label: 'Mastery Pack Assassin',
    preview: { bg: 'linear-gradient(118deg, #02050b 0%, #0e4a68 52%, #5a1a5e 100%)', text: '#eaf3f8', accent: '#4fd8f5' } },
  { id: 'usurp', label: 'Usurp the Shadow Throne',
    preview: { bg: 'linear-gradient(120deg, #3a1560 0%, #170a2b 60%, #0b0514 100%)', text: '#f1eafb', accent: '#f06bff' } },
  { id: 'dark',  label: 'Black',
    preview: { bg: 'linear-gradient(120deg, #1c2433 0%, #0f1319 100%)', text: '#eceef1', accent: '#86a9f5' } },
  { id: 'light', label: 'White',
    preview: { bg: 'linear-gradient(120deg, #ffffff 0%, #e9edf4 100%)', text: '#14181f', accent: '#2456c7' } }
];

// Current main set. Supplementary sets (Mastery Pack) are never the default.
const DEFAULT_THEME = 'usurp';

// Life may go below zero (overkill) and above the start value (healing heroes).
const LIFE_MIN = -50;
const LIFE_MAX = 999;
const HISTORY_MAX = 25;

const DEFAULT_SETTINGS = {
  nameMode:     'short',
  lang:         'en',   // overlay language
  theme:        DEFAULT_THEME,
  recentCards:  [],     // newest first
  pin:          null,
  controlToken: null
};

const DEFAULT_MATCH = {
  table:       null,
  round:       null,
  followRound: true,   // new round: same table again, otherwise table 1
  lastRound:   null,   // latest round seen, to notice a new one
  manual:      false,  // free mode: everything typed by hand, GEM not used
  resume:      null,   // { round, table, followRound } to go back to after free mode
  swapped:     false,  // seating is mirrored vs. GEM's p1/p2

  p1: null,            // { name, gemId, hero, heroInfo, startLife, wins, losses }
  p2: null,

  life:  { p1: null, p2: null },
  start: { p1: null, p2: null },

  // operator confirmed the result, shows the round overlay. Reset on a new match.
  ended: false,

  // { name, color, pitch, typeText, images: [url] } or null
  card: null,

  history: [],

  matchKey:    null,
  eventId:     null,   // event the players were read from
  eventTitle:  null,
  format:      null,
  roundLabel:  null,
  roundStage:  null,   // 'r16' | 'qf' | 'sf' | 'f' in the top cut, else null
  totalRounds: null,
  warning:     null,

  rev: 0,
  updatedAt: 0
};

// --- persistence ---

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      // Windows editors and PowerShell add a BOM that JSON.parse rejects.
      // Without the strip the settings silently reset, new PIN included.
      return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) };
    }
  } catch (err) {
    console.warn(`[state] Could not read ${path.basename(file)}: ${err.message}`);
  }
  return { ...fallback };
}

// Temp file + rename: a crash mid-write must not leave half a file, that
// would reset the life totals.
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file.replace(/\.json$/, '.tmp.json');   // still covered by data/*.json in .gitignore
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
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

  // drop keys of removed features (old best-of-3 counter)
  const stored = readJson(MATCH_FILE, DEFAULT_MATCH);
  match = {};
  for (const k of Object.keys(DEFAULT_MATCH)) match[k] = stored[k];
  match.history = (Array.isArray(match.history) ? match.history : [])
    .map(h => ({ life: { ...(h && h.life) } }));

  if (!NAME_MODES.includes(settings.nameMode)) settings.nameMode = DEFAULT_SETTINGS.nameMode;
  if (!LANGS.includes(settings.lang))          settings.lang     = DEFAULT_SETTINGS.lang;
  if (!THEMES.some(t => t.id === settings.theme)) settings.theme  = DEFAULT_SETTINGS.theme;
  delete settings.font;        // leftover of the removed typeface picker
  if (!Array.isArray(settings.recentCards)) settings.recentCards = [];

  // CONTROL_PIN from the environment wins. Needed in a container, where a
  // generated PIN would change on every recreate. "off" disables it.
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

  // First run: generate a PIN. '' means switched off on purpose, null means
  // never generated.
  if (settings.pin == null) {
    settings.pin = randomPin();
    settings.controlToken = randomToken();
  } else if (settings.pin && !settings.controlToken) {
    settings.controlToken = randomToken();
  }
  writeJson(SETTINGS_FILE, settings);

  return { settings, match };
}

// Life taps come in bursts: debounce the file write only, memory and SSE stay immediate.
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

// --- settings ---

function getSettings() { return settings; }

// SSE is unauthenticated: no PIN, no token in here.
function publicSettings() {
  return {
    nameMode: settings.nameMode,
    lang:     settings.lang,
    theme:    settings.theme,
    themes:   THEMES,
    defaultTheme: DEFAULT_THEME,
    pinRequired: !!settings.pin
  };
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

function setLang(lang) {
  if (!LANGS.includes(lang)) throw new Error(`lang must be one of ${LANGS.join(', ')}`);
  return patchSettings({ lang });
}

function setTheme(theme) {
  if (!THEMES.some(t => t.id === theme)) {
    throw new Error(`theme must be one of ${THEMES.map(t => t.id).join(', ')}`);
  }
  return patchSettings({ theme });
}

// null or '' disables the PIN (persisted). Any change issues a new token, so
// paired tablets have to enter the PIN again.
function setPin(pin) {
  if (pin === null || pin === '') return patchSettings({ pin: '', controlToken: null });
  const clean = String(pin).trim();
  if (!/^\d{4,8}$/.test(clean)) throw new Error('PIN must be 4 to 8 digits');
  return patchSettings({ pin: clean, controlToken: randomToken() });
}

function regeneratePin() { return setPin(randomPin()); }

// --- match state ---

function getMatch() { return match; }

// Clients get canUndo instead of the undo stack.
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

// pushes an undo snapshot, use for every life change
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

// Deltas, not absolute values: two taps in flight must not overwrite each other.
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

// null hides the card
function setCard(card) {
  if (card === null) return patchMatch({ card: null });

  const images = (Array.isArray(card?.images) ? card.images : [])
    .filter(u => typeof u === 'string' && /^https:\/\//.test(u) && u.length < 500)
    .slice(0, 12);
  if (!images.length) throw new Error('The card has no image to show');

  const text = v => String(v == null ? '' : v).slice(0, 120);
  const shown = { name: text(card.name), color: text(card.color), pitch: text(card.pitch), typeText: text(card.typeText), images };
  rememberCard(shown);
  return patchMatch({ card: shown });
}

// Recently shown cards, newest first, each once. Stored with the settings to
// survive a restart, but written without the settings broadcast (no overlay needs it).
const RECENT_CARDS = 10;

function rememberCard(card) {
  const key = c => (c.images || []).join('|');
  settings.recentCards = [card, ...(settings.recentCards || []).filter(c => key(c) !== key(card))]
    .slice(0, RECENT_CARDS);
  writeJson(SETTINGS_FILE, settings);
}

function recentCards() { return settings.recentCards || []; }

// shows/hides the round overlay
function setEnded(ended) { return patchMatch({ ended: !!ended }); }

module.exports = {
  bus, loadState, flushMatch,
  getSettings, publicSettings, setNameMode, setLang, setTheme, setPin, regeneratePin,
  getMatch, matchView, patchMatch,
  adjustLife, setLife, swapSides, undo, setEnded, setCard, recentCards
};
