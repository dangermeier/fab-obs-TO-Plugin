const test = require('node:test');
const assert = require('node:assert/strict');

const { isYoungFormat, pickHeroCard, printingImageUrls, roundsMissing } = require('../src/fetcher');

const BUCKET = 'https://legendstory-production-s3-public.s3.amazonaws.com/media/cards';

test('isYoungFormat: Blitz and limited formats play young heroes', () => {
  for (const f of ['Blitz', 'Booster Draft', 'Sealed Deck', 'Commoner', 'Versiegelt']) {
    assert.ok(isYoungFormat(f), f);
  }
  for (const f of ['Classic Constructed', 'Living Legend', '', null, undefined]) {
    assert.ok(!isYoungFormat(f), String(f));
  }
});

test('pickHeroCard: the adult or the young printing, as asked', () => {
  const adult = { name: 'Fai, Rising Rebellion', types: ['Hero', 'Ninja'] };
  const young = { name: 'Fai',                   types: ['Hero', 'Ninja', 'Young'] };
  const spell = { name: 'Fai\'s Fury',           types: ['Action'] };

  assert.equal(pickHeroCard([spell, young, adult], false), adult);
  assert.equal(pickHeroCard([spell, adult, young], true), young);
  // Only one of the two exists: better that than nothing.
  assert.equal(pickHeroCard([young], false), young);
  assert.equal(pickHeroCard([adult], true), adult);
  // No hero among the results: the first card.
  assert.equal(pickHeroCard([spell], false), spell);
  assert.equal(pickHeroCard([], false), null);
});

test('printingImageUrls: the regular printing first, dead CDN rewritten', () => {
  const urls = printingImageUrls({
    printings: [
      { id: '1HP001',    image_url: `${BUCKET}/large/1HP001.webp` },
      { id: 'HVY047-RF', image_url: `${BUCKET}/large/HVY047-RF.webp` },
      { id: 'HVY047',    image_url: 'https://d2wlb52bya4y8z.cloudfront.net/media/cards/large/HVY047.webp' }
    ]
  });

  assert.equal(urls[0], `${BUCKET}/large/HVY047.webp`);
  assert.ok(urls.every(u => !/cloudfront/.test(u)));
  assert.equal(new Set(urls).size, urls.length);
  // History Pack and foil variants come after every regular file.
  assert.ok(urls.indexOf(`${BUCKET}/large/1HP001.webp`) > 0);
  assert.ok(urls.indexOf(`${BUCKET}/large/HVY047-RF.webp`) > 0);
});

test('printingImageUrls: a candidate per printing even without listed images', () => {
  assert.deepEqual(printingImageUrls({ printings: [{ id: 'MPA002' }] }), [`${BUCKET}/large/MPA002.webp`]);
  assert.deepEqual(printingImageUrls({}), []);
});

test('printingImageUrls: clean scans before other renditions, card backs last', () => {
  const urls = printingImageUrls({
    printings: [
      { image_url: 'https://img.example/cardfaces/WTR001.png' },
      { image_url: 'https://img.example/media/width-450/WTR001.png' },
      { image_url: `${BUCKET}/large/WTR001_BACK.webp` },
      { image_url: `${BUCKET}/large/WTR001.webp` }
    ]
  });
  assert.deepEqual(urls, [
    `${BUCKET}/large/WTR001.webp`,
    'https://img.example/cardfaces/WTR001.png',
    'https://img.example/media/width-450/WTR001.png',
    `${BUCKET}/large/WTR001_BACK.webp`
  ]);
});

test('pickHeroCard: the card with exactly that name, whatever the format', () => {
  const adult = { name: 'Fai, Rising Rebellion', types: ['Hero', 'Ninja'] };
  const young = { name: 'Fai',                   types: ['Hero', 'Ninja', 'Young'] };

  assert.equal(pickHeroCard([adult, young], false, 'Fai'), young);
  assert.equal(pickHeroCard([young, adult], true, 'fai, rising rebellion'), adult);
  // no card of that exact name: the format decides as before
  assert.equal(pickHeroCard([adult, young], true, 'Fai the Ninja'), young);
});

test('isYoungFormat: Silver Age plays young heroes', () => {
  assert.ok(isYoungFormat('Silver Age'));
});

test('roundsMissing: asks for the export only when the page left tables out', () => {
  const info = [{ round: 1, total: 2 }, { round: 2, total: null }];
  assert.equal(roundsMissing({ roundInfo: info, rounds: [{ round: 1, total: 2 }, { round: 2, total: 1 }] }), false);
  assert.equal(roundsMissing({ roundInfo: info, rounds: [{ round: 2, total: 1 }] }), true);
  assert.equal(roundsMissing({ roundInfo: info, rounds: [{ round: 1, total: 1 }, { round: 2, total: 1 }] }), true);
  assert.equal(roundsMissing({ rounds: [] }), false);
});
