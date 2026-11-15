const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Its own data directory, so the real settings are never touched.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-state-'));
process.env.DATA_DIR = dir;
delete process.env.CONTROL_PIN;

const state = require('../src/state');
state.loadState();

test.after(() => {
  state.flushMatch();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('settings: a fresh install starts on the default theme with a PIN', () => {
  const s = state.publicSettings();
  assert.equal(s.theme, s.defaultTheme);
  assert.equal(s.theme, 'usurp');
  assert.equal(s.pinRequired, true);
  assert.match(state.getSettings().pin, /^\d{4}$/);
  // Neither secret may reach the unauthenticated channel.
  assert.ok(!('pin' in s) && !('controlToken' in s));
});

test('themes: the newest set is listed first but is not the default', () => {
  const { themes, defaultTheme } = state.publicSettings();
  assert.deepEqual(themes.map(t => t.id), ['mpa', 'usurp', 'dark', 'light']);
  assert.notEqual(themes[0].id, defaultTheme);
  for (const t of themes) {
    assert.ok(t.label, t.id);
    assert.ok(t.preview.bg && t.preview.text && t.preview.accent, t.id);
  }
});

test('settings: unknown values are refused and leave the setting alone', () => {
  state.setTheme('mpa');
  assert.throws(() => state.setTheme('gold'), /theme must be one of/);
  assert.equal(state.publicSettings().theme, 'mpa');

  assert.throws(() => state.setLang('fr'), /lang must be one of/);
  assert.throws(() => state.setNameMode('nickname'), /nameMode must be one of/);
  state.setLang('de');
  state.setNameMode('initials');
  assert.equal(state.publicSettings().lang, 'de');
  assert.equal(state.publicSettings().nameMode, 'initials');
});

test('settings: survive a restart', () => {
  state.setTheme('dark');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(stored.theme, 'dark');
  state.loadState();
  assert.equal(state.publicSettings().theme, 'dark');
});

test('pin: 4 to 8 digits, a change issues a new token, empty switches it off', () => {
  assert.throws(() => state.setPin('12'), /4 to 8 digits/);
  assert.throws(() => state.setPin('12ab'), /4 to 8 digits/);

  state.setPin('1234');
  const first = state.getSettings().controlToken;
  state.setPin('56789');
  assert.equal(state.getSettings().pin, '56789');
  assert.notEqual(state.getSettings().controlToken, first);

  state.setPin('');
  assert.equal(state.publicSettings().pinRequired, false);
  assert.equal(state.getSettings().controlToken, null);
});

test('life: deltas add up, are clamped, and each one can be undone', () => {
  state.patchMatch({ life: { p1: 40, p2: 40 }, start: { p1: 40, p2: 40 }, history: [] });

  state.adjustLife('p1', -7);
  state.adjustLife('p1', -3);
  state.adjustLife('p2', 2);
  assert.deepEqual(state.getMatch().life, { p1: 30, p2: 42 });
  assert.equal(state.matchView().canUndo, true);

  state.undo();
  assert.deepEqual(state.getMatch().life, { p1: 30, p2: 40 });
  state.undo();
  state.undo();
  assert.deepEqual(state.getMatch().life, { p1: 40, p2: 40 });
  assert.equal(state.matchView().canUndo, false);

  // Nothing left to undo: a no-op, not an error.
  const rev = state.getMatch().rev;
  state.undo();
  assert.equal(state.getMatch().rev, rev);

  state.setLife('p1', 5000);
  assert.equal(state.getMatch().life.p1, 999);
  state.setLife('p1', -5000);
  assert.equal(state.getMatch().life.p1, -50);
});

test('life: bad input is refused or ignored', () => {
  assert.throws(() => state.adjustLife('p3', 1), /player must be/);
  assert.throws(() => state.setLife('p1', 'many'), /must be a number/);

  const rev = state.getMatch().rev;
  state.adjustLife('p1', 0);
  state.adjustLife('p1', 'x');
  assert.equal(state.getMatch().rev, rev);
});

test('life: falls back to the starting total until the first change', () => {
  state.patchMatch({ life: { p1: null, p2: null }, start: { p1: 20, p2: 20 }, history: [] });
  state.adjustLife('p2', -4);
  assert.equal(state.getMatch().life.p2, 16);
});

test('match: every change raises rev, and the undo stack stays on the server', () => {
  const before = state.getMatch().rev;
  state.swapSides();
  state.setEnded(true);
  assert.equal(state.getMatch().rev, before + 2);
  assert.equal(state.getMatch().ended, true);

  const view = state.matchView();
  assert.ok(!('history' in view));
  assert.equal(typeof view.canUndo, 'boolean');
});

test('card: only https images are shown, and text is cut to size', () => {
  assert.throws(() => state.setCard({ name: 'x', images: [] }), /no image/);
  assert.throws(() => state.setCard({ name: 'x', images: ['http://plain.example/a.png'] }), /no image/);

  state.setCard({ name: 'N'.repeat(300), images: ['https://img.example/a.webp', 'javascript:alert(1)', 7] });
  const card = state.getMatch().card;
  assert.deepEqual(card.images, ['https://img.example/a.webp']);
  assert.equal(card.name.length, 120);

  state.setCard(null);
  assert.equal(state.getMatch().card, null);
});

test('recent cards: newest first, each card once, ten at most', () => {
  const card = n => ({ name: 'Card ' + n, images: [`https://img.example/${n}.webp`] });
  for (let n = 1; n <= 12; n++) state.setCard(card(n));

  let names = state.recentCards().map(c => c.name);
  assert.equal(names.length, 10);
  assert.equal(names[0], 'Card 12');
  assert.equal(names[9], 'Card 3');

  // Showing one again moves it to the front instead of listing it twice.
  state.setCard(card(5));
  names = state.recentCards().map(c => c.name);
  assert.equal(names.length, 10);
  assert.equal(names[0], 'Card 5');
  assert.equal(names.filter(n => n === 'Card 5').length, 1);
});
