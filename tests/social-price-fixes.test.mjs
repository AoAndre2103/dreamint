import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { lookupExternalCatalog } from '../functions/lib/catalog-search.js';
import { refreshModelPrice, priceCardRef } from '../functions/lib/price-history.js';

const file = (name) => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

function shareHarness(failBack = false) {
  const operations = [];
  const g = {
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {}, fill() {}, stroke() {}, rect() {}, roundRect() {}, beginPath() {},
    arc() {}, save() {}, restore() {}, clip() {},
    drawImage(img) { operations.push(['image', img.source]); },
    fillText(text) { operations.push(['text', text]); },
    measureText(text) { return { width: String(text).length * 17 }; }
  };
  const canvas = { width: 0, height: 0, getContext: () => g };
  class MockImage {
    width = 744;
    height = 1039;
    set src(source) {
      this.source = source;
      queueMicrotask(() => (failBack && source === '/back-photo' ? this.onerror() : this.onload()));
    }
  }
  const window = {};
  vm.runInNewContext(file('public/js/share.js'), {
    window, Image: MockImage, document: { createElement: () => canvas },
    navigator: {}, queueMicrotask, setTimeout
  });
  return { share: window.DreaMintShare, operations, canvas };
}

test('social: post 1080×1350 non gradata renders seller front AND back; story 1080×1920 too', async () => {
  const h = shareHarness();
  const data = { name: 'Gengar', art: '/front-photo', backArt: '/back-photo', ungraded: true, badge: 'NON GRADATA' };
  await h.share.renderListingCanvas(data, 'post');
  assert.equal(h.canvas.width, 1080);
  assert.equal(h.canvas.height, 1350);
  assert.ok(h.operations.some(([a, b]) => a === 'image' && b === '/front-photo'));
  assert.ok(h.operations.some(([a, b]) => a === 'image' && b === '/back-photo'));
  assert.ok(h.operations.some(([a, b]) => a === 'text' && b === 'FRONTE'));
  assert.ok(h.operations.some(([a, b]) => a === 'text' && b === 'RETRO'));
  h.operations.length = 0;
  await h.share.renderListingCanvas(data, 'story');
  assert.equal(h.canvas.height, 1920);
  assert.ok(h.operations.some(([a, b]) => a === 'image' && b === '/back-photo'));
});

test('social: never shows back on a graded card; missing back falls back gracefully', async () => {
  const h = shareHarness();
  await h.share.renderListingCanvas({ name: 'Gengar', art: '/front-photo', backArt: '/back-photo', ungraded: false }, 'post');
  assert.ok(!h.operations.some(([a, b]) => b === '/back-photo' || b === 'RETRO'));
  const broken = shareHarness(true);
  await broken.share.renderListingCanvas({ name: 'Gengar', art: '/front-photo', backArt: '/back-photo', ungraded: true }, 'post');
  assert.ok(!broken.operations.some(([a, b]) => b === '/back-photo' || b === 'RETRO'));
});

test('album: label indicates the active sale, not a permanent ban on selling', () => {
  const app = file('public/app.js');
  const i18n = file('public/js/strings-v2.js');
  assert.match(app, /albumTag: listed \? tr\("raw\.onSale"\)/);
  assert.match(app, /backArt: backArt/);
  assert.match(i18n, /"raw\.onSale": "In vendita · carta fisica"/);
  assert.ok(!i18n.includes('Nel tuo album · non vendibile'));
});

test('chart: renders a real 2-point window without inventing history', () => {
  const window = {};
  vm.runInNewContext(file('public/js/price-trend.js'), { window, Date, Number, Math });
  const el = { innerHTML: '', getAttribute() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } };
  window.DreaMintPrices.renderChart(el, {
    currency: 'EUR', windows: { avg7: 8.5, trend: 10.2 }, points: []
  });
  assert.match(el.innerHTML, /pc-plot/);
  assert.match(el.innerHTML, /Medie Cardmarket/);
  assert.ok(!el.innerHTML.includes('pc-empty'));
});

test('TCGdex: no root pricing, fallback to second detailed variant and ENG detail', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({
      id: 'swsh4-25', name: 'Charizard', localId: '25', set: { id: 'swsh4', name: 'Vivid Voltage', cardCount: { official: 185 } },
      variants_detailed: url.includes('/en/') ? [
        { pricing: null }, { pricing: { cardmarket: { avg30: 4.75, avg7: 5.25, trend: 6.30 } } }
      ] : []
    }) };
  };
  try {
    const { hits } = await lookupExternalCatalog({}, { game: 'pokemon', id: 'pokemon:swsh4-25', lang: 'ITA' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].cardmarket.trend, 6.3);
    assert.equal(hits[0].cardmarket.avg30, 4.75);
    assert.ok(requested.some((u) => u.includes('/it/cards/')));
    assert.ok(requested.some((u) => u.includes('/en/cards/')));
  } finally { globalThis.fetch = originalFetch; }
});

test('price refresh: after summary search, opens exact TCGdex detail for real Cardmarket figures', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  const snapshots = [];
  const windows = new Map();
  const env = {
    PHOTOS: { async get(key) { return windows.get(key); }, async put(key, val) { windows.set(key, val); } },
    DB: { prepare(sql) { return { bind(...args) { return {
      async first() { return null; },
      async run() { snapshots.push({ sql, args }); },
    }; } }; } }
  };
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const full = String(url).includes('/cards/swsh4-25');
    const card = { id: 'swsh4-25', name: 'Charizard', localId: '25',
      set: { id: 'swsh4', symbol: 'swsh4', name: 'Vivid Voltage', cardCount: { official: 185 } },
      image: 'https://assets.tcgdex.net/en/swsh/swsh4/25' };
    if (full) card.pricing = { cardmarket: { trend: 12.25, avg7: 11.9, avg30: 10.5 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(full ? card : [card]) };
  };
  try {
    const model = { game: 'pokemon', name: 'Charizard', code_printed: '025/185', set_code: 'swsh4', language: 'ITA' };
    const result = await refreshModelPrice(env, model);
    assert.equal(result.ok, true);
    assert.ok(requested.some((u) => u.includes('/cards?')));
    assert.ok(requested.some((u) => u.includes('/cards/swsh4-25')));
    assert.equal(snapshots.length, 1, 'one daily aligned snapshot');
    assert.equal(snapshots[0].args[4], 1225);
    const w = JSON.parse(windows.get('price:windows:' + priceCardRef(model)));
    assert.equal(w.avg30, 10.5);
  } finally { globalThis.fetch = originalFetch; }
});
