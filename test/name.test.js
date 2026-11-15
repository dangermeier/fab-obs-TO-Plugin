const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { nameKey } = require('../src/name');

// The browser helper is a plain <script>; give it the few globals it touches.
function loadOV(search = '') {
  global.location = { search };
  global.document = {
    documentElement: { style: { setProperty() {} }, classList: { add() {} } },
    getElementById() { return null; }
  };
  global.window = {};
  global.requestAnimationFrame = () => {};
  const file = path.join(__dirname, '..', 'public', 'shared', 'overlay.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return global.window.OV;
}

const NAMES = [
  'Ironsong, Dorinthea', 'Dorinthea Ironsong', 'Ironsong, Dorinthea "Dori"',
  'Rhinar, Katsu „Rhino“', 'Müller-Lüdenscheidt, Jörg (JJ)', 'Kılıç, Ömer',
  "O'Brien, Sean", 'O’Brien, Sean', 'Weiß, Lisa', 'von Hohenlohe, Max',
  'Łukasz Đorđević', 'İbrahim Þór', '', null, undefined
];

test('nameKey joins GEM\'s two spellings of one player', () => {
  assert.equal(nameKey('Ironsong, Dorinthea'), nameKey('Dorinthea Ironsong'));
  assert.equal(nameKey('Ironsong, Dorinthea "Dori"'), nameKey('Dorinthea Ironsong'));
  assert.equal(nameKey('Müller, Jörg'), nameKey('Jorg Muller'));
  assert.equal(nameKey("O'Brien, Sean"), nameKey('Sean O’Brien'));
  assert.equal(nameKey('Kılıç, Ömer'), 'kilic omer');
  assert.equal(nameKey(null), '');
});

test('browser nameKey matches the server one', () => {
  const OV = loadOV();
  for (const n of NAMES) assert.equal(OV.nameKey(n), nameKey(n), `mismatch for ${JSON.stringify(n)}`);
});

test('heroIndex prefers the gemId and falls back to the name', () => {
  const OV = loadOV();
  const heroOf = OV.heroIndex([
    { name: 'Dorinthea Ironsong', gemId: '11', hero: 'Kayo' },
    { name: 'Jörg Müller',        gemId: '',   hero: 'Prism' },
    { name: 'No Hero',            gemId: '33', hero: '' }
  ]);
  assert.equal(heroOf('11', 'someone else'), 'Kayo');
  assert.equal(heroOf('', 'Ironsong, Dorinthea "Dori"'), 'Kayo');
  assert.equal(heroOf('99', 'Müller, Jörg'), 'Prism');
  assert.equal(heroOf('33', 'No Hero'), null);
  assert.equal(OV.heroIndex({ error: 'Not authenticated' })('1', 'x'), null);
});

test('fmtName covers the three privacy modes and strips nicknames', () => {
  const OV = loadOV();
  assert.equal(OV.fmtName('Ironsong, Dorinthea', 'full'), 'Dorinthea Ironsong');
  assert.equal(OV.fmtName('Ironsong, Dorinthea', 'short'), 'Dorinthea I.');
  assert.equal(OV.fmtName('Ironsong, Dorinthea', 'initials'), 'D. I.');
  assert.equal(OV.fmtName('Rhinar, Katsu "Rhino"', 'short'), 'Katsu R.');
  assert.equal(OV.fmtName('', 'short'), '–');
});

test('language: default, URL override, fallback and top-cut stages', () => {
  let OV = loadOV();
  assert.equal(OV.t('round', { n: 3 }), 'Round 3');
  assert.equal(OV.t('no-such-key'), 'no-such-key');

  OV = loadOV('?lang=de');
  assert.equal(OV.t('round', { n: 3 }), 'Runde 3');
  assert.equal(OV.matchRoundName({ round: 7, roundStage: 'sf' }), 'Halbfinale');
  assert.equal(OV.matchRoundName({ round: 2, roundStage: null }), 'Runde 2');

  const tdata = { rounds: [
    { round: 5, elimination: false, pairings: [] },
    { round: 6, elimination: true, pairings: [1, 2, 3, 4] },
    { round: 7, elimination: true, pairings: [1, 2] },
    { round: 8, elimination: true, pairings: [1] }
  ] };
  assert.equal(OV.stageOf(tdata, tdata.rounds[0]), null);
  assert.deepEqual(tdata.rounds.slice(1).map(r => OV.stageOf(tdata, r)), ['qf', 'sf', 'f']);
});
